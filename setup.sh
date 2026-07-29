#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$SCRIPT_DIR/vscode-extension"
EXTENSION_ID="srujangurram.code-explainer"

AGENT="auto"
EDITOR="all"
REPLACE_SKILL=false

usage() {
	cat <<'EOF'
Usage: ./setup.sh [options]

Options:
  --agent auto|codex|claude|amp|opencode|none
      Link this checkout into one agent's skill directory. Default: auto.
  --editor all|code|cursor
      Install into every detected editor or one explicit editor. Default: all.
  --replace-skill
      Replace an older Code Explainer skill at the selected canonical path.
  -h, --help
EOF
}

fail() {
	echo "Error: $*" >&2
	exit 1
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--agent)
			[[ $# -ge 2 ]] || fail "--agent needs a value"
			AGENT="$2"
			shift 2
			;;
		--editor)
			[[ $# -ge 2 ]] || fail "--editor needs a value"
			EDITOR="$2"
			shift 2
			;;
		--replace-skill)
			REPLACE_SKILL=true
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			fail "unknown option: $1"
			;;
	esac
done

case "$AGENT" in
	auto|codex|claude|amp|opencode|none) ;;
	*) fail "unsupported agent: $AGENT" ;;
esac
case "$EDITOR" in
	all|code|cursor) ;;
	*) fail "unsupported editor: $EDITOR" ;;
esac

[[ "$(uname -s)" == "Darwin" ]] || fail "Code Explainer requires macOS"
[[ -x /usr/bin/say ]] || fail "macOS speech command is missing: /usr/bin/say"
command -v node >/dev/null || fail "Node.js 20 or newer is required"
command -v npm >/dev/null || fail "npm is required"

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" -ge 20 ]] || fail "Node.js 20 or newer is required"
EXTENSION_VERSION="$(node -p \
	'require(process.argv[1]).version' "$EXTENSION_DIR/package.json")"

find_editor_cli() {
	local name="$1"
	local candidate
	if command -v "$name" >/dev/null; then
		command -v "$name"
		return
	fi
	if [[ "$name" == "code" ]]; then
		for candidate in \
			"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
			"$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
		do
			[[ -x "$candidate" ]] && printf '%s\n' "$candidate" && return
		done
	else
		for candidate in \
			"/Applications/Cursor.app/Contents/Resources/app/bin/cursor" \
			"$HOME/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
		do
			[[ -x "$candidate" ]] && printf '%s\n' "$candidate" && return
		done
	fi
	return 1
}

EDITORS=()
if [[ "$EDITOR" == "all" ]]; then
	for candidate in code cursor; do
		if cli="$(find_editor_cli "$candidate")"; then
			EDITORS+=("$cli")
		fi
	done
	[[ ${#EDITORS[@]} -gt 0 ]] \
		|| fail "Install VS Code or Cursor, then rerun setup"
else
	CLI="$(find_editor_cli "$EDITOR")" \
		|| fail "Editor not found: $EDITOR"
	EDITORS+=("$CLI")
fi

echo "Building Code Explainer..."
(
	cd "$EXTENSION_DIR"
	npm ci --no-audit --no-fund --loglevel=error
	npm run check
	npm run compile -- --minify
)

BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/code-explainer-build.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT
VSIX="$BUILD_DIR/code-explainer.vsix"
INSTALL_INCOMPLETE=false
MANUAL_VSIX=""
(
	cd "$EXTENSION_DIR"
	./node_modules/.bin/vsce package \
		--no-dependencies \
		--allow-missing-repository \
		--out "$VSIX"
)

for editor in "${EDITORS[@]}"; do
	editor_name="$(basename "$editor")"
	echo "Installing extension in $editor..."
	if "$editor" --install-extension "$VSIX" --force; then
		if ! "$editor" --list-extensions | grep -Fqx "$EXTENSION_ID"; then
			fail "$editor did not report $EXTENSION_ID after installation"
		fi
	else
		editor_status=$?
		if [[ "$editor_status" -ne 126 ]]; then
			fail "$editor_name extension installation failed"
		fi

		command -v unzip >/dev/null \
			|| fail "unzip is required for the editor installation fallback"
		if [[ "$editor_name" == "code" ]]; then
			installed_dir="$HOME/.vscode/extensions"
		else
			installed_dir="$HOME/.cursor/extensions"
		fi
		if ! mkdir -p "$installed_dir" 2>/dev/null; then
			MANUAL_VSIX="$EXTENSION_DIR/code-explainer-$EXTENSION_VERSION.vsix"
			cp "$VSIX" "$MANUAL_VSIX"
			INSTALL_INCOMPLETE=true
			echo "Could not access $installed_dir from this process."
			echo "VSIX ready for manual installation: $MANUAL_VSIX"
			continue
		fi
		target_dir="$installed_dir/$EXTENSION_ID-$EXTENSION_VERSION"
		stage_dir="$BUILD_DIR/manual-$editor_name"
		mkdir -p "$stage_dir"
		unzip -q "$VSIX" "extension/*" -d "$stage_dir"
		for old_dir in "$installed_dir/$EXTENSION_ID-"*; do
			[[ -d "$old_dir" ]] || continue
			rm -rf "$old_dir"
		done
		mv "$stage_dir/extension" "$target_dir"
		rmdir "$stage_dir"
		echo "Installed extension directly at $target_dir"
	fi
done

skill_target() {
	case "$1" in
		codex)
			printf '%s\n' "${CODEX_HOME:-$HOME/.codex}/skills/explainer"
			;;
		claude)
			printf '%s\n' "$HOME/.claude/skills/explainer"
			;;
		amp)
			printf '%s\n' "$HOME/.config/agents/skills/explainer"
			;;
		opencode)
			printf '%s\n' "$HOME/.config/opencode/skills/explainer"
			;;
	esac
}

same_directory() {
	local left="$1"
	local right="$2"
	[[ -d "$left" && -d "$right" ]] || return 1
	[[ "$(cd -P "$left" && pwd)" == "$(cd -P "$right" && pwd)" ]]
}

if [[ "$AGENT" == "auto" ]]; then
	for candidate in codex claude amp opencode; do
		target="$(skill_target "$candidate")"
		if same_directory "$SCRIPT_DIR" "$target"; then
			AGENT="none"
			break
		fi
	done
	if [[ "$AGENT" == "auto" ]]; then
		if [[ -n "${CODEX_HOME:-}" || -d "$HOME/.codex" ]]; then
			AGENT="codex"
		elif [[ -d "$HOME/.claude" ]]; then
			AGENT="claude"
		elif [[ -d "$HOME/.config/agents" ]]; then
			AGENT="amp"
		elif [[ -d "$HOME/.config/opencode" ]]; then
			AGENT="opencode"
		else
			AGENT="codex"
		fi
	fi
fi

if [[ "$AGENT" != "none" ]]; then
	TARGET="$(skill_target "$AGENT")"
	if same_directory "$SCRIPT_DIR" "$TARGET"; then
		echo "Skill already installed at $TARGET"
	else
		if [[ -e "$TARGET" || -L "$TARGET" ]]; then
			if ! $REPLACE_SKILL; then
				fail "$TARGET already exists; rerun with --replace-skill to replace it"
			fi
			[[ "$TARGET" != "$SCRIPT_DIR" ]] || fail "refusing to replace the source"
			rm -rf "$TARGET"
		fi
		mkdir -p "$(dirname "$TARGET")"
		ln -s "$SCRIPT_DIR" "$TARGET"
		echo "Linked skill at $TARGET"
	fi
fi

chmod +x "$SCRIPT_DIR/setup.sh" "$SCRIPT_DIR/scripts/"*.sh

echo
if $INSTALL_INCOMPLETE; then
	echo "Skill setup complete, but the editor extension still needs installation."
	echo "In the editor, run 'Extensions: Install from VSIX...' and select:"
	echo "  $MANUAL_VSIX"
	echo "Then reload the editor window."
	exit 1
fi

echo "Setup complete."
echo "Reload your editor once, then ask your agent to walk you through code."
