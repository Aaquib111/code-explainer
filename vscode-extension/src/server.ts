import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import type { AgentMessage, Highlight, Segment } from "./types";
import type { Walkthrough } from "./walkthrough";

const MAX_BODY_SIZE = 1024 * 1024;
const RUNTIME_DIR = path.join(
	"/tmp",
	`code-explainer-${process.getuid?.() ?? "user"}`,
);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateHighlight(
	value: unknown,
	segment: Segment,
	index: number,
): string | undefined {
	if (!isRecord(value)) return `highlight ${index + 1} must be an object`;
	if (!Number.isInteger(value.start) || !Number.isInteger(value.end)) {
		return `highlight ${index + 1} needs integer start and end lines`;
	}
	const start = value.start as number;
	const end = value.end as number;
	if (start < segment.start || end < start || end > segment.end) {
		return `highlight ${index + 1} must stay within lines `
			+ `${segment.start}-${segment.end}`;
	}
	if (typeof value.ttsText !== "string" || value.ttsText.trim() === "") {
		return `highlight ${index + 1} needs non-empty ttsText`;
	}
	if (
		value.explanation !== undefined
		&& typeof value.explanation !== "string"
	) {
		return `highlight ${index + 1} explanation must be a string`;
	}
	return undefined;
}

function validateSegment(value: unknown, index: number): string | undefined {
	if (!isRecord(value)) return `segment ${index + 1} must be an object`;
	if (!Number.isInteger(value.id) || (value.id as number) < 1) {
		return `segment ${index + 1} needs a positive integer id`;
	}
	if (typeof value.file !== "string" || !path.isAbsolute(value.file)) {
		return `segment ${index + 1} needs an absolute file path`;
	}
	if (!Number.isInteger(value.start) || !Number.isInteger(value.end)) {
		return `segment ${index + 1} needs integer start and end lines`;
	}
	if ((value.start as number) < 1 || (value.end as number) < (value.start as number)) {
		return `segment ${index + 1} has an invalid line range`;
	}
	if (typeof value.title !== "string" || value.title.trim() === "") {
		return `segment ${index + 1} needs a title`;
	}
	if (typeof value.explanation !== "string" || value.explanation.trim() === "") {
		return `segment ${index + 1} needs an explanation`;
	}
	if (!Array.isArray(value.highlights) || value.highlights.length === 0) {
		return `segment ${index + 1} needs at least one highlight`;
	}

	const segment = value as unknown as Segment;
	for (let i = 0; i < segment.highlights.length; i++) {
		const error = validateHighlight(
			segment.highlights[i] as Highlight,
			segment,
			i,
		);
		if (error) return `segment ${index + 1}: ${error}`;
	}
	return undefined;
}

export function validateAgentMessage(value: unknown): string | undefined {
	if (!isRecord(value) || typeof value.type !== "string") {
		return "message needs a type";
	}

	if (value.type === "stop" || value.type === "resume") return undefined;
	if (value.type === "goto") {
		return Number.isInteger(value.segmentId) && (value.segmentId as number) > 0
			? undefined
			: "goto needs a positive integer segmentId";
	}
	if (value.type !== "set_plan") {
		return `unsupported message type: ${value.type}`;
	}
	if (typeof value.title !== "string" || value.title.trim() === "") {
		return "set_plan needs a title";
	}
	if (!Array.isArray(value.segments) || value.segments.length === 0) {
		return "set_plan needs at least one segment";
	}

	const ids = new Set<number>();
	for (let i = 0; i < value.segments.length; i++) {
		const error = validateSegment(value.segments[i], i);
		if (error) return error;
		const id = (value.segments[i] as Segment).id;
		if (ids.has(id)) return `segment id ${id} is duplicated`;
		ids.add(id);
	}
	return undefined;
}

export class ExplainerServer {
	private readonly httpServer: http.Server;
	private readonly authToken = crypto.randomBytes(32).toString("hex");
	private port = 0;
	private connectionFile: string | undefined;
	private onAgentMessage: ((message: AgentMessage) => void) | undefined;

	constructor(
		private readonly walkthrough: Walkthrough,
		private readonly workspaceRoot: string | undefined,
	) {
		this.httpServer = http.createServer(this.handleHttp.bind(this));
	}

	start(): Promise<number> {
		return new Promise((resolve, reject) => {
			const onError = (error: Error) => reject(error);
			this.httpServer.once("error", onError);
			this.httpServer.listen(0, "127.0.0.1", () => {
				this.httpServer.off("error", onError);
				const address = this.httpServer.address();
				this.port = typeof address === "object" && address
					? address.port
					: 0;
				try {
					this.writeConnectionFile();
					resolve(this.port);
				} catch (error) {
					this.httpServer.close();
					reject(error);
				}
			});
		});
	}

	stop(): void {
		this.httpServer.close();
		if (this.connectionFile) {
			fs.rmSync(this.connectionFile, { force: true });
			this.connectionFile = undefined;
		}
	}

	setMessageHandler(handler: (message: AgentMessage) => void): void {
		this.onAgentMessage = handler;
	}

	private writeConnectionFile(): void {
		fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
		fs.chmodSync(RUNTIME_DIR, 0o700);
		this.removeStaleConnections();

		this.connectionFile = path.join(
			RUNTIME_DIR,
			`connection-${process.pid}.json`,
		);
		const connection = {
			port: this.port,
			token: this.authToken,
			workspace: this.workspaceRoot ?? "",
			pid: process.pid,
			createdAt: Date.now(),
		};
		fs.writeFileSync(
			this.connectionFile,
			`${JSON.stringify(connection)}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
	}

	private removeStaleConnections(): void {
		for (const name of fs.readdirSync(RUNTIME_DIR)) {
			if (!/^connection-\d+\.json$/.test(name)) continue;
			const file = path.join(RUNTIME_DIR, name);
			try {
				const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
					pid?: number;
				};
				if (typeof data.pid !== "number") {
					fs.rmSync(file, { force: true });
					continue;
				}
				process.kill(data.pid, 0);
			} catch {
				fs.rmSync(file, { force: true });
			}
		}
	}

	private checkAuth(request: http.IncomingMessage): boolean {
		return request.headers.authorization === `Bearer ${this.authToken}`;
	}

	private handleHttp(
		request: http.IncomingMessage,
		response: http.ServerResponse,
	): void {
		response.setHeader("Content-Type", "application/json");
		if (!this.checkAuth(request)) {
			this.respond(response, 401, { error: "Unauthorized" });
			return;
		}

		const url = new URL(request.url ?? "/", `http://127.0.0.1:${this.port}`);
		if (request.method === "GET" && url.pathname === "/api/health") {
			this.respond(response, 200, {
				status: "ok",
				workspace: this.workspaceRoot ?? null,
			});
			return;
		}
		if (request.method === "GET" && url.pathname === "/api/state") {
			const state = this.walkthrough.getState();
			this.respond(response, 200, {
				title: state.title,
				status: state.status,
				currentIndex: state.currentIndex,
				currentHighlight: state.currentHighlightIndex,
				totalSegments: state.segments.length,
				segment: this.walkthrough.getCurrentSegment() ?? null,
			});
			return;
		}
		if (request.method === "POST" && url.pathname === "/api/message") {
			this.readBody(request, response);
			return;
		}
		this.respond(response, 404, { error: "Not found" });
	}

	private readBody(
		request: http.IncomingMessage,
		response: http.ServerResponse,
	): void {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			body += chunk;
			if (body.length > MAX_BODY_SIZE && !response.writableEnded) {
				this.respond(response, 413, { error: "Request body is too large" });
				request.destroy();
			}
		});
		request.on("end", () => {
			if (response.writableEnded) return;

			let message: unknown;
			try {
				message = JSON.parse(body);
			} catch {
				this.respond(response, 400, { error: "Invalid JSON" });
				return;
			}
			const error = validateAgentMessage(message);
			if (error) {
				this.respond(response, 400, { error });
				return;
			}
			this.onAgentMessage?.(message as AgentMessage);
			this.respond(response, 200, { ok: true });
		});
	}

	private respond(
		response: http.ServerResponse,
		status: number,
		body: Record<string, unknown>,
	): void {
		response.writeHead(status);
		response.end(JSON.stringify(body));
	}
}
