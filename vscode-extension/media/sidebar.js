// @ts-check

/** @type {ReturnType<typeof acquireVsCodeApi>} */
const vscode = acquireVsCodeApi();

let state = {
	title: "",
	segments: [],
	currentSegment: -1,
	currentHighlight: 0,
	status: "idle",
	speed: 1,
};

function currentSegment() {
	return state.segments.find((segment) => segment.id === state.currentSegment);
}

function progress() {
	let current = 0;
	let total = 0;
	for (const segment of state.segments) {
		const count = segment.highlights.length;
		if (segment.id === state.currentSegment) {
			current += state.currentHighlight + 1;
		} else if (
			state.segments.findIndex((item) => item.id === segment.id)
			< state.segments.findIndex((item) => item.id === state.currentSegment)
		) {
			current += count;
		}
		total += count;
	}
	return { current, total };
}

function render() {
	const idle = document.getElementById("idle-view");
	const active = document.getElementById("active-view");
	const done = document.getElementById("done-view");

	idle.hidden = state.status !== "idle" && state.status !== "stopped";
	active.hidden = state.status === "idle"
		|| state.status === "stopped"
		|| state.status === "complete";
	done.hidden = state.status !== "complete";

	if (state.status === "complete") {
		document.getElementById("done-summary").textContent =
			`${state.segments.length} segments covered`;
		return;
	}
	if (active.hidden) return;

	const segment = currentSegment();
	document.getElementById("walkthrough-title").textContent = state.title;
	document.getElementById("segment-title").textContent = segment?.title ?? "";
	document.getElementById("segment-location").textContent = segment
		? `${segment.file.split("/").pop()}:${segment.start}-${segment.end}`
		: "";

	const { current, total } = progress();
	document.getElementById("step-counter").textContent =
		total > 0 ? `${current}/${total}` : "";
	document.getElementById("progress-fill").style.width =
		total > 0 ? `${(current / total) * 100}%` : "0";

	const highlight = segment?.highlights[state.currentHighlight];
	document.getElementById("explanation-text").textContent =
		highlight?.explanation || segment?.explanation || "";

	const playPause = document.getElementById("btn-play-pause");
	playPause.textContent = state.status === "playing" ? "Pause" : "Play";
	playPause.setAttribute(
		"aria-label",
		state.status === "playing" ? "Pause narration" : "Play narration",
	);

	for (const button of document.querySelectorAll("#speed-buttons button")) {
		button.classList.toggle(
			"active",
			Number(button.dataset.speed) === state.speed,
		);
	}
	renderOutline();
}

function renderOutline() {
	const list = document.getElementById("outline-list");
	list.replaceChildren();
	const activeIndex = state.segments.findIndex(
		(segment) => segment.id === state.currentSegment,
	);

	state.segments.forEach((segment, index) => {
		const item = document.createElement("li");
		const button = document.createElement("button");
		button.textContent = segment.title;
		button.className = index === activeIndex
			? "current"
			: index < activeIndex
				? "complete"
				: "";
		button.addEventListener("click", () => {
			vscode.postMessage({ type: "goto_segment", segmentId: segment.id });
		});
		item.appendChild(button);
		list.appendChild(item);
	});
}

document.getElementById("btn-play-pause").addEventListener("click", () => {
	vscode.postMessage({ type: "play_pause" });
});
document.getElementById("btn-prev").addEventListener("click", () => {
	vscode.postMessage({ type: "prev" });
});
document.getElementById("btn-next").addEventListener("click", () => {
	vscode.postMessage({ type: "next" });
});
document.getElementById("btn-restart").addEventListener("click", () => {
	vscode.postMessage({ type: "restart" });
});
document.getElementById("btn-close").addEventListener("click", () => {
	vscode.postMessage({ type: "close_walkthrough" });
});

for (const button of document.querySelectorAll("#speed-buttons button")) {
	button.addEventListener("click", () => {
		vscode.postMessage({
			type: "speed_change",
			speed: Number(button.dataset.speed),
		});
	});
}

window.addEventListener("message", (event) => {
	const message = event.data;
	if (message.type === "update") {
		state = {
			title: message.title,
			segments: message.segments,
			currentSegment: message.currentSegment,
			currentHighlight: message.currentHighlight,
			status: message.status,
			speed: message.speed,
		};
		render();
		return;
	}
	if (message.type === "error") {
		const error = document.getElementById("speech-error");
		error.textContent = message.message;
		error.hidden = message.message === "";
	}
});

vscode.postMessage({ type: "ready" });
render();
