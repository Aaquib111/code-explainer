import * as vscode from "vscode";
import type { FromWebviewMessage, ToWebviewMessage } from "./types";
import type { WalkthroughState } from "./walkthrough";

export class SidebarProvider implements vscode.WebviewViewProvider {
	static readonly viewType = "codeExplainer.sidebar";

	private view: vscode.WebviewView | undefined;
	private onMessage:
		| ((message: FromWebviewMessage) => void | Promise<void>)
		| undefined;
	private latestState: ToWebviewMessage | undefined;
	private latestError = "";

	constructor(private readonly extensionUri: vscode.Uri) {}

	setMessageHandler(
		handler: (message: FromWebviewMessage) => void | Promise<void>,
	): void {
		this.onMessage = handler;
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(
			(message: FromWebviewMessage) => {
				if (message.type === "ready") {
					if (this.latestState) this.postMessage(this.latestState);
					if (this.latestError) this.sendError(this.latestError);
					return;
				}
				this.onMessage?.(message);
			},
		);
	}

	reveal(): void {
		if (this.view) {
			this.view.show?.(true);
			return;
		}
		void vscode.commands.executeCommand("codeExplainer.sidebar.focus");
	}

	updateState(state: WalkthroughState, speed: number): void {
		this.latestState = {
			type: "update",
			title: state.title,
			segments: state.segments,
			currentSegment: state.segments[state.currentIndex]?.id ?? -1,
			currentHighlight: state.currentHighlightIndex,
			status: state.status,
			speed,
		};
		this.postMessage(this.latestState);
	}

	sendError(message: string): void {
		this.latestError = message;
		this.postMessage({ type: "error", message });
	}

	clearError(): void {
		this.latestError = "";
		this.postMessage({ type: "error", message: "" });
	}

	private postMessage(message: ToWebviewMessage): void {
		void this.view?.webview.postMessage(message);
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.js"),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.css"),
		);
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>Code Explainer</title>
</head>
<body>
	<section id="idle-view" class="centered">
		<h1>Code Explainer</h1>
		<p>No walkthrough is running.</p>
		<p class="muted">Ask your coding agent to walk you through some code.</p>
	</section>

	<section id="active-view" hidden>
		<header>
			<div class="eyebrow-row">
				<span class="eyebrow">Code Explainer</span>
				<button id="btn-close" class="plain-button" title="Close walkthrough">Close</button>
			</div>
			<h1 id="walkthrough-title"></h1>
			<div class="progress-track"><div id="progress-fill"></div></div>
			<div class="location-row">
				<span id="step-counter"></span>
				<span id="segment-title"></span>
				<span id="segment-location"></span>
			</div>
		</header>

		<div id="speech-error" role="alert" hidden></div>

		<div class="transport">
			<button id="btn-prev" title="Previous highlight">Previous</button>
			<button id="btn-play-pause" class="primary">Pause</button>
			<button id="btn-next" title="Next highlight">Next</button>
		</div>

		<div class="speed-control">
			<span>Speed</span>
			<div id="speed-buttons">
				<button data-speed="0.75">0.75x</button>
				<button data-speed="1">1x</button>
				<button data-speed="1.25">1.25x</button>
				<button data-speed="1.5">1.5x</button>
				<button data-speed="2">2x</button>
			</div>
		</div>

		<div id="explanation-text" class="explanation"></div>

		<div class="outline">
			<h2>Outline</h2>
			<ol id="outline-list"></ol>
		</div>
	</section>

	<section id="done-view" class="centered" hidden>
		<h1>Walkthrough complete</h1>
		<p id="done-summary"></p>
		<button id="btn-restart" class="primary">Restart</button>
	</section>

	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let nonce = "";
	for (let i = 0; i < 32; i++) {
		nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}
	return nonce;
}
