import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { SayPlayer, wordsPerMinute } from "../src/say-player";
import { ExplainerServer, validateAgentMessage } from "../src/server";
import type { SetPlanMessage } from "../src/types";
import { Walkthrough } from "../src/walkthrough";

const temporaryDirectories: string[] = [];

afterEach(() => {
	delete process.env.SAY_TEST_FAIL;
	delete process.env.SAY_TEST_LOG;
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function validPlan(): SetPlanMessage {
	return {
		type: "set_plan",
		title: "Test walkthrough",
		segments: [
			{
				id: 1,
				file: "/tmp/example.ts",
				start: 2,
				end: 8,
				title: "Entry point",
				explanation: "The request enters here.",
				highlights: [
					{
						start: 3,
						end: 5,
						ttsText: "The request is checked before processing starts.",
					},
				],
			},
		],
	};
}

function fakeSayCommand(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fake-say-"));
	temporaryDirectories.push(directory);
	const command = path.join(directory, "say");
	fs.writeFileSync(
		command,
		`#!/bin/sh
printf '%s\\n' "$@" > "$SAY_TEST_LOG.args"
cat > "$SAY_TEST_LOG.text"
if [ -n "$SAY_TEST_FAIL" ]; then
  echo "synthetic speech failure" >&2
  exit 7
fi
`,
		{ mode: 0o755 },
	);
	process.env.SAY_TEST_LOG = path.join(directory, "call");
	return command;
}

test("speech speed maps to the macOS say rate", () => {
	assert.equal(wordsPerMinute(1), 190);
	assert.equal(wordsPerMinute(1.5), 285);
	assert.throws(() => wordsPerMinute(2.5), RangeError);
});

test("SayPlayer passes speed and narration to the command", async () => {
	const player = new SayPlayer(fakeSayCommand());
	await player.speak("A concise explanation.", 1.25);

	assert.equal(
		fs.readFileSync(`${process.env.SAY_TEST_LOG}.args`, "utf8"),
		"-r\n238\n",
	);
	assert.equal(
		fs.readFileSync(`${process.env.SAY_TEST_LOG}.text`, "utf8"),
		"A concise explanation.",
	);
});

test("SayPlayer surfaces command failures", async () => {
	const player = new SayPlayer(fakeSayCommand());
	process.env.SAY_TEST_FAIL = "1";

	await assert.rejects(
		player.speak("This will fail.", 1),
		/synthetic speech failure/,
	);
});

test("walkthrough plans require complete narrated highlights", () => {
	assert.equal(validateAgentMessage(validPlan()), undefined);

	const missingNarration = validPlan();
	missingNarration.segments[0].highlights[0].ttsText = "";
	assert.match(
		validateAgentMessage(missingNarration) ?? "",
		/non-empty ttsText/,
	);

	const relativePath = validPlan();
	relativePath.segments[0].file = "src/example.ts";
	assert.match(validateAgentMessage(relativePath) ?? "", /absolute file path/);
});

test("a walkthrough starts immediately and completes after its last segment", () => {
	const walkthrough = new Walkthrough();
	const plan = validPlan();

	walkthrough.setPlan(plan.title, plan.segments);
	assert.equal(walkthrough.getState().status, "playing");
	assert.equal(walkthrough.getHighlightIndex(), 0);

	assert.equal(walkthrough.nextSegment(), false);
	assert.equal(walkthrough.getState().status, "complete");
});

test("the local API uses a protected connection file and accepts a plan", async (t) => {
	const walkthrough = new Walkthrough();
	const server = new ExplainerServer(walkthrough, "/tmp/test-workspace");
	server.setMessageHandler((message) => {
		if (message.type === "set_plan") {
			walkthrough.setPlan(message.title, message.segments);
		}
	});
	const port = await server.start();
	t.after(() => server.stop());

	const connectionFile = path.join(
		"/tmp",
		`code-explainer-${process.getuid()}`,
		`connection-${process.pid}.json`,
	);
	const connection = JSON.parse(fs.readFileSync(connectionFile, "utf8")) as {
		token: string;
	};
	assert.equal(fs.statSync(connectionFile).mode & 0o777, 0o600);

	const unauthorized = await fetch(`http://127.0.0.1:${port}/api/health`);
	assert.equal(unauthorized.status, 401);

	const response = await fetch(`http://127.0.0.1:${port}/api/message`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${connection.token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(validPlan()),
	});
	assert.equal(response.status, 200);
	assert.equal(walkthrough.getState().status, "playing");
});
