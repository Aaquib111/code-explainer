export interface Highlight {
	start: number;
	end: number;
	ttsText: string;
	explanation?: string;
}

export interface Segment {
	id: number;
	file: string;
	start: number;
	end: number;
	title: string;
	explanation: string;
	highlights: Highlight[];
}

export interface SetPlanMessage {
	type: "set_plan";
	title: string;
	segments: Segment[];
}

export interface GotoMessage {
	type: "goto";
	segmentId: number;
}

export interface ResumeMessage {
	type: "resume";
}

export interface StopMessage {
	type: "stop";
}

export type AgentMessage =
	| SetPlanMessage
	| GotoMessage
	| ResumeMessage
	| StopMessage;

export type WalkthroughStatus =
	| "playing"
	| "paused"
	| "complete"
	| "stopped"
	| "idle";

export interface WebviewUpdateMessage {
	type: "update";
	title: string;
	segments: Segment[];
	currentSegment: number;
	currentHighlight: number;
	status: WalkthroughStatus;
	speed: number;
}

export interface WebviewErrorMessage {
	type: "error";
	message: string;
}

export type ToWebviewMessage = WebviewUpdateMessage | WebviewErrorMessage;

export type FromWebviewMessage =
	| { type: "ready" }
	| { type: "play_pause" }
	| { type: "next" }
	| { type: "prev" }
	| { type: "goto_segment"; segmentId: number }
	| { type: "speed_change"; speed: number }
	| { type: "restart" }
	| { type: "close_walkthrough" };
