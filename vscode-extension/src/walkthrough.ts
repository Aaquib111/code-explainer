import { EventEmitter } from "events";
import type { Segment, WalkthroughStatus } from "./types";

export interface WalkthroughState {
	title: string;
	segments: Segment[];
	currentIndex: number;
	currentHighlightIndex: number;
	status: WalkthroughStatus;
}

export class Walkthrough extends EventEmitter {
	private state: WalkthroughState = {
		title: "",
		segments: [],
		currentIndex: -1,
		currentHighlightIndex: 0,
		status: "idle",
	};

	getState(): WalkthroughState {
		return { ...this.state, segments: [...this.state.segments] };
	}

	getCurrentSegment(): Segment | undefined {
		return this.state.segments[this.state.currentIndex];
	}

	getHighlightIndex(): number {
		return this.state.currentHighlightIndex;
	}

	setPlan(title: string, segments: Segment[]): void {
		if (segments.length === 0) {
			throw new Error("A walkthrough needs at least one segment.");
		}
		this.state = {
			title,
			segments,
			currentIndex: 0,
			currentHighlightIndex: 0,
			status: "playing",
		};
		this.emit("plan", this.getState());
		this.emit("status", this.state.status);
		this.emit("segment", segments[0]);
	}

	play(): void {
		if (this.state.status !== "paused") return;
		this.state.status = "playing";
		this.emit("status", this.state.status);
	}

	pause(): void {
		if (this.state.status !== "playing") return;
		this.state.status = "paused";
		this.emit("status", this.state.status);
	}

	togglePlayPause(): void {
		if (this.state.status === "playing") {
			this.pause();
		} else if (this.state.status === "paused") {
			this.play();
		}
	}

	stop(): void {
		if (this.state.status === "idle" || this.state.status === "stopped") return;
		this.state.status = "stopped";
		this.emit("status", this.state.status);
	}

	complete(): void {
		this.state.status = "complete";
		this.emit("status", this.state.status);
	}

	restart(): void {
		if (this.state.segments.length === 0) return;
		this.state.currentIndex = 0;
		this.state.currentHighlightIndex = 0;
		this.state.status = "playing";
		this.emit("status", this.state.status);
		this.emit("segment", this.state.segments[0]);
	}

	nextSegment(): boolean {
		const nextIndex = this.state.currentIndex + 1;
		if (nextIndex >= this.state.segments.length) {
			this.complete();
			return false;
		}
		return this.moveToIndex(nextIndex);
	}

	previousSegment(startAtLastHighlight = false): boolean {
		const index = this.state.currentIndex - 1;
		if (index < 0 || index >= this.state.segments.length) return false;
		this.state.currentIndex = index;
		this.state.currentHighlightIndex = startAtLastHighlight
			? this.state.segments[index].highlights.length - 1
			: 0;
		this.emit("segment", this.state.segments[index]);
		return true;
	}

	goto(segmentId: number): boolean {
		const index = this.state.segments.findIndex(
			(segment) => segment.id === segmentId,
		);
		return this.moveToIndex(index);
	}

	setHighlightIndex(index: number): void {
		const count = this.getCurrentSegment()?.highlights.length ?? 0;
		if (index < 0 || index >= count) {
			throw new RangeError(`Highlight index ${index} is out of range.`);
		}
		this.state.currentHighlightIndex = index;
		this.emit("highlight", index);
	}

	private moveToIndex(index: number): boolean {
		if (index < 0 || index >= this.state.segments.length) return false;
		this.state.currentIndex = index;
		this.state.currentHighlightIndex = 0;
		if (this.state.status === "complete" || this.state.status === "stopped") {
			this.state.status = "playing";
			this.emit("status", this.state.status);
		}
		this.emit("segment", this.state.segments[index]);
		return true;
	}
}
