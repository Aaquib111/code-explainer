import * as vscode from "vscode";
import {
	clearHighlights,
	disposeHighlights,
	highlightSegmentRange,
	highlightSubRange,
} from "./highlight";
import { SayPlayer } from "./say-player";
import { ExplainerServer } from "./server";
import { SidebarProvider } from "./sidebar";
import type { AgentMessage, FromWebviewMessage, Segment } from "./types";
import { Walkthrough } from "./walkthrough";

const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2] as const;
const SPEED_STORAGE_KEY = "speechSpeed";

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function validStoredSpeed(value: unknown): number {
	return typeof value === "number" && SPEED_PRESETS.includes(
		value as (typeof SPEED_PRESETS)[number],
	)
		? value
		: 1;
}

export function activate(context: vscode.ExtensionContext): void {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const walkthrough = new Walkthrough();
	const sidebar = new SidebarProvider(context.extensionUri);
	const server = new ExplainerServer(walkthrough, workspaceRoot);
	const speech = new SayPlayer();

	let speed = validStoredSpeed(
		context.globalState.get<number>(SPEED_STORAGE_KEY),
	);
	let playbackGeneration = 0;

	const updateSidebar = () => {
		sidebar.updateState(walkthrough.getState(), speed);
	};

	const cancelPlayback = () => {
		playbackGeneration++;
		speech.stop();
	};

	const reportPlaybackError = (label: string, error: unknown) => {
		cancelPlayback();
		walkthrough.pause();
		const message = `${label}: ${errorMessage(error)}`;
		sidebar.sendError(message);
		void vscode.window.showErrorMessage(`Code Explainer: ${message}`);
	};

	const playCurrentHighlight = async (generation: number): Promise<void> => {
		const segment = walkthrough.getCurrentSegment();
		if (!segment || walkthrough.getState().status !== "playing") return;

		const highlightIndex = walkthrough.getHighlightIndex();
		const highlight = segment.highlights[highlightIndex];
		if (!highlight) {
			reportPlaybackError(
				"Walkthrough error",
				new Error(`Missing highlight ${highlightIndex + 1} in ${segment.title}.`),
			);
			return;
		}

		try {
			await highlightSubRange(segment.file, highlight.start, highlight.end);
		} catch (error) {
			if (generation === playbackGeneration) {
				reportPlaybackError("Could not highlight code", error);
			}
			return;
		}
		if (
			generation !== playbackGeneration
			|| walkthrough.getState().status !== "playing"
		) {
			return;
		}

		updateSidebar();
		try {
			await speech.speak(highlight.ttsText, speed);
		} catch (error) {
			if (generation === playbackGeneration) {
				reportPlaybackError("Speech failed", error);
			}
			return;
		}
		if (
			generation !== playbackGeneration
			|| walkthrough.getState().status !== "playing"
		) {
			return;
		}

		if (highlightIndex + 1 < segment.highlights.length) {
			walkthrough.setHighlightIndex(highlightIndex + 1);
		} else {
			walkthrough.nextSegment();
		}
	};

	const startCurrentHighlight = () => {
		cancelPlayback();
		const generation = playbackGeneration;
		void playCurrentHighlight(generation);
	};

	const showSegment = async (segment: Segment): Promise<void> => {
		cancelPlayback();
		const generation = playbackGeneration;
		try {
			await highlightSegmentRange(segment.file, segment.start, segment.end);
		} catch (error) {
			if (generation === playbackGeneration) {
				reportPlaybackError("Could not open code", error);
			}
			return;
		}
		if (generation !== playbackGeneration) return;

		updateSidebar();
		if (walkthrough.getState().status === "playing") {
			void playCurrentHighlight(generation);
		} else {
			const highlight = segment.highlights[walkthrough.getHighlightIndex()];
			if (highlight) {
				try {
					await highlightSubRange(
						segment.file,
						highlight.start,
						highlight.end,
					);
				} catch (error) {
					if (generation === playbackGeneration) {
						reportPlaybackError("Could not highlight code", error);
					}
				}
			}
		}
	};

	const resumePlayback = () => {
		sidebar.clearError();
		if (speech.isPaused()) {
			speech.resume();
		} else {
			startCurrentHighlight();
		}
	};

	const nextHighlight = () => {
		const segment = walkthrough.getCurrentSegment();
		if (!segment) return;
		cancelPlayback();
		const index = walkthrough.getHighlightIndex();
		if (index + 1 < segment.highlights.length) {
			walkthrough.setHighlightIndex(index + 1);
		} else {
			walkthrough.nextSegment();
		}
	};

	const previousHighlight = () => {
		const segment = walkthrough.getCurrentSegment();
		if (!segment) return;
		const index = walkthrough.getHighlightIndex();
		if (index > 0) {
			cancelPlayback();
			walkthrough.setHighlightIndex(index - 1);
		} else if (walkthrough.getState().currentIndex > 0) {
			cancelPlayback();
			walkthrough.previousSegment(true);
		}
	};

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarProvider.viewType,
			sidebar,
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
	);
	void vscode.commands.executeCommand(
		"setContext",
		"codeExplainer.walkthroughActive",
		false,
	);

	server.setMessageHandler((message: AgentMessage) => {
		switch (message.type) {
			case "set_plan":
				sidebar.clearError();
				walkthrough.setPlan(message.title, message.segments);
				sidebar.reveal();
				break;
			case "goto":
				walkthrough.goto(message.segmentId);
				break;
			case "resume":
				walkthrough.play();
				resumePlayback();
				break;
			case "stop":
				walkthrough.stop();
				break;
		}
	});

	server.start().then(
		(port) => {
			console.log(`[code-explainer] Agent API listening on ${port}`);
		},
		(error: unknown) => {
			const message = `Agent API failed to start: ${errorMessage(error)}`;
			sidebar.sendError(message);
			void vscode.window.showErrorMessage(`Code Explainer: ${message}`);
		},
	);

	walkthrough.on("plan", () => {
		updateSidebar();
		void vscode.commands.executeCommand(
			"setContext",
			"codeExplainer.walkthroughActive",
			true,
		);
	});
	walkthrough.on("segment", (segment: Segment) => {
		void showSegment(segment);
	});
	walkthrough.on("highlight", () => {
		updateSidebar();
		if (walkthrough.getState().status === "playing") {
			startCurrentHighlight();
		} else {
			const segment = walkthrough.getCurrentSegment();
			const highlight = segment?.highlights[walkthrough.getHighlightIndex()];
			if (segment && highlight) {
				const generation = playbackGeneration;
				void highlightSubRange(
					segment.file,
					highlight.start,
					highlight.end,
				).catch((error: unknown) => {
					if (generation === playbackGeneration) {
						reportPlaybackError("Could not highlight code", error);
					}
				});
			}
		}
	});
	walkthrough.on("status", () => {
		const status = walkthrough.getState().status;
		if (status === "paused") {
			speech.pause();
		} else if (status === "complete" || status === "stopped") {
			cancelPlayback();
			clearHighlights();
			void vscode.commands.executeCommand(
				"setContext",
				"codeExplainer.walkthroughActive",
				false,
			);
		}
		updateSidebar();
	});

	const changeSpeed = (newSpeed: number) => {
		if (!SPEED_PRESETS.includes(
			newSpeed as (typeof SPEED_PRESETS)[number],
		)) {
			return;
		}
		if (newSpeed === speed) return;
		speed = newSpeed;
		void context.globalState.update(SPEED_STORAGE_KEY, speed);
		updateSidebar();
		if (walkthrough.getState().status === "playing") {
			startCurrentHighlight();
		} else {
			cancelPlayback();
		}
	};

	const stepSpeed = (direction: -1 | 1) => {
		const current = SPEED_PRESETS.indexOf(
			speed as (typeof SPEED_PRESETS)[number],
		);
		const index = Math.min(
			SPEED_PRESETS.length - 1,
			Math.max(0, current + direction),
		);
		changeSpeed(SPEED_PRESETS[index]);
		void vscode.window.setStatusBarMessage(
			`Code Explainer speed: ${speed}x`,
			1500,
		);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"codeExplainer.togglePlayPause",
			() => {
				const wasPaused = walkthrough.getState().status === "paused";
				walkthrough.togglePlayPause();
				if (wasPaused && walkthrough.getState().status === "playing") {
					resumePlayback();
				}
			},
		),
		vscode.commands.registerCommand("codeExplainer.next", nextHighlight),
		vscode.commands.registerCommand("codeExplainer.prev", previousHighlight),
		vscode.commands.registerCommand("codeExplainer.stop", () => {
			walkthrough.stop();
		}),
		vscode.commands.registerCommand("codeExplainer.speedUp", () => {
			stepSpeed(1);
		}),
		vscode.commands.registerCommand("codeExplainer.speedDown", () => {
			stepSpeed(-1);
		}),
	);

	sidebar.setMessageHandler((message: FromWebviewMessage) => {
		switch (message.type) {
			case "play_pause": {
				const wasPaused = walkthrough.getState().status === "paused";
				walkthrough.togglePlayPause();
				if (wasPaused && walkthrough.getState().status === "playing") {
					resumePlayback();
				}
				break;
			}
			case "next":
				nextHighlight();
				break;
			case "prev":
				previousHighlight();
				break;
			case "goto_segment":
				walkthrough.goto(message.segmentId);
				break;
			case "speed_change":
				changeSpeed(message.speed);
				break;
			case "restart":
				sidebar.clearError();
				walkthrough.restart();
				break;
			case "close_walkthrough":
				walkthrough.stop();
				break;
			case "ready":
				break;
		}
	});

	context.subscriptions.push({
		dispose: () => {
			cancelPlayback();
			server.stop();
			speech.dispose();
			disposeHighlights();
		},
	});
}

export function deactivate(): void {}
