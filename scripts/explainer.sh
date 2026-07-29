#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat >&2 <<'EOF'
Usage:
  explainer.sh health
  explainer.sh plan <json-file>
  explainer.sh send '<json>'
  explainer.sh state
  explainer.sh stop
EOF
	exit 2
}

RUNTIME_DIR="${CODE_EXPLAINER_RUNTIME_DIR:-/tmp/code-explainer-$(id -u)}"

if [[ -n "${CODE_EXPLAINER_CONNECTION:-}" ]]; then
	CONNECTION_FILE="$CODE_EXPLAINER_CONNECTION"
else
	CONNECTION_FILE="$(
		node - "$RUNTIME_DIR" "$PWD" <<'NODE'
const fs = require("fs");
const path = require("path");

const runtimeDir = process.argv[2];
const cwd = fs.realpathSync(process.argv[3]);
if (!fs.existsSync(runtimeDir)) process.exit(1);

const connections = [];
for (const name of fs.readdirSync(runtimeDir)) {
	if (!/^connection-\d+\.json$/.test(name)) continue;
	const file = path.join(runtimeDir, name);
	let value;
	try {
		value = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		continue;
	}
	try {
		process.kill(value.pid, 0);
	} catch (error) {
		if (error.code !== "EPERM") continue;
	}
	if (
		!Number.isInteger(value.port)
		|| value.port < 1
		|| value.port > 65535
		|| typeof value.token !== "string"
	) {
		continue;
	}
	const workspace = value.workspace
		? path.resolve(value.workspace)
		: "";
	const inWorkspace = workspace !== ""
		&& (cwd === workspace || cwd.startsWith(`${workspace}${path.sep}`));
	connections.push({
		file,
		inWorkspace,
		workspaceLength: inWorkspace ? workspace.length : 0,
		createdAt: Number(value.createdAt) || fs.statSync(file).mtimeMs,
	});
}

connections.sort((a, b) =>
	Number(b.inWorkspace) - Number(a.inWorkspace)
	|| b.workspaceLength - a.workspaceLength
	|| b.createdAt - a.createdAt
);
if (connections.length === 0) process.exit(1);
process.stdout.write(connections[0].file);
NODE
	)" || {
		echo "Code Explainer is not running. Reload VS Code or Cursor, then retry." >&2
		exit 1
	}
fi

if [[ ! -r "$CONNECTION_FILE" ]]; then
	echo "Code Explainer connection file is not readable: $CONNECTION_FILE" >&2
	exit 1
fi

CONNECTION="$(
	node - "$CONNECTION_FILE" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (
	!Number.isInteger(value.port)
	|| value.port < 1
	|| value.port > 65535
	|| typeof value.token !== "string"
	|| !/^[a-f0-9]{64}$/.test(value.token)
) {
	throw new Error("Invalid Code Explainer connection file");
}
process.stdout.write(`${value.port}\n${value.token}`);
NODE
)"
PORT="$(printf '%s\n' "$CONNECTION" | sed -n '1p')"
TOKEN="$(printf '%s\n' "$CONNECTION" | sed -n '2p')"
BASE_URL="http://127.0.0.1:$PORT"
CURL=(curl --fail-with-body --silent --show-error
	-H "Authorization: Bearer $TOKEN")

case "${1:-}" in
	health)
		"${CURL[@]}" "$BASE_URL/api/health"
		;;
	plan)
		[[ $# -eq 2 && -r "$2" ]] || usage
		"${CURL[@]}" -X POST "$BASE_URL/api/message" \
			-H "Content-Type: application/json" \
			--data-binary "@$2"
		;;
	send)
		[[ $# -eq 2 ]] || usage
		"${CURL[@]}" -X POST "$BASE_URL/api/message" \
			-H "Content-Type: application/json" \
			--data-binary "$2"
		;;
	state)
		[[ $# -eq 1 ]] || usage
		"${CURL[@]}" "$BASE_URL/api/state"
		;;
	stop)
		[[ $# -eq 1 ]] || usage
		"${CURL[@]}" -X POST "$BASE_URL/api/message" \
			-H "Content-Type: application/json" \
			--data-binary '{"type":"stop"}'
		;;
	*)
		usage
		;;
esac
