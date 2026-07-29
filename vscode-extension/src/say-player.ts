import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";

const DEFAULT_WORDS_PER_MINUTE = 190;
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;

interface ActiveSpeech {
	child: ChildProcessWithoutNullStreams;
	paused: boolean;
	settled: boolean;
	stderr: string;
	resolve: () => void;
	reject: (error: Error) => void;
}

export function wordsPerMinute(speed: number): number {
	if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
		throw new RangeError(
			`Speech speed must be between ${MIN_SPEED} and ${MAX_SPEED}.`,
		);
	}
	return Math.round(DEFAULT_WORDS_PER_MINUTE * speed);
}

export class SayPlayer {
	private active: ActiveSpeech | undefined;

	constructor(private readonly command = "/usr/bin/say") {}

	isAvailable(): boolean {
		try {
			fs.accessSync(this.command, fs.constants.X_OK);
			return true;
		} catch {
			return false;
		}
	}

	isPaused(): boolean {
		return this.active?.paused ?? false;
	}

	speak(text: string, speed: number): Promise<void> {
		const narration = text.trim();
		if (!narration) {
			return Promise.reject(new Error("Narration text is empty."));
		}
		if (!this.isAvailable()) {
			return Promise.reject(
				new Error(`macOS speech command was not found at ${this.command}.`),
			);
		}

		this.stop();
		const rate = wordsPerMinute(speed);

		return new Promise((resolve, reject) => {
			const child = spawn(this.command, ["-r", String(rate)], {
				stdio: ["pipe", "pipe", "pipe"],
			});
			const speech: ActiveSpeech = {
				child,
				paused: false,
				settled: false,
				stderr: "",
				resolve,
				reject,
			};
			this.active = speech;

			child.stdout.resume();
			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk: string) => {
				speech.stderr = `${speech.stderr}${chunk}`.slice(-4096);
			});
			child.stdin.on("error", (error: NodeJS.ErrnoException) => {
				if (error.code !== "EPIPE") {
					this.fail(speech, error);
				}
			});
			child.on("error", (error) => this.fail(speech, error));
			child.on("close", (code, signal) => {
				if (speech.settled) return;
				if (code === 0) {
					this.finish(speech);
					return;
				}
				const detail = speech.stderr.trim();
				const reason = detail || `exited with ${code ?? signal ?? "unknown status"}`;
				this.fail(speech, new Error(`macOS say failed: ${reason}`));
			});

			child.stdin.end(narration);
		});
	}

	pause(): void {
		const speech = this.active;
		if (!speech || speech.paused) return;
		if (speech.child.kill("SIGSTOP")) {
			speech.paused = true;
		}
	}

	resume(): void {
		const speech = this.active;
		if (!speech || !speech.paused) return;
		if (speech.child.kill("SIGCONT")) {
			speech.paused = false;
		}
	}

	stop(): void {
		const speech = this.active;
		if (!speech) return;

		this.active = undefined;
		speech.settled = true;
		speech.resolve();
		if (speech.paused) {
			speech.child.kill("SIGCONT");
		}
		speech.child.kill("SIGTERM");
	}

	private finish(speech: ActiveSpeech): void {
		if (speech.settled) return;
		speech.settled = true;
		if (this.active === speech) {
			this.active = undefined;
		}
		speech.resolve();
	}

	private fail(speech: ActiveSpeech, error: Error): void {
		if (speech.settled) return;
		speech.settled = true;
		if (this.active === speech) {
			this.active = undefined;
		}
		speech.child.kill("SIGTERM");
		speech.reject(error);
	}

	dispose(): void {
		this.stop();
	}
}
