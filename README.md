# Code Explainer

Code Explainer lets a coding agent build and play a narrated walkthrough in
VS Code or Cursor. The extension opens each file, highlights the relevant lines,
shows the explanation in a sidebar, and narrates it with macOS `say`.

The current design is deliberately small:

- exactly one context-aware subagent creates the whole walkthrough
- no familiarity quiz, delivery-mode picker, or plan approval
- no Python environment, model download, TTS server, or WebSocket service
- playback starts as soon as the agent sends a valid plan
- narration uses the system voice and supports speeds from 0.75x to 2x
- speech and file errors appear in the sidebar instead of failing silently

## How a walkthrough runs

1. You ask your coding agent to explain some code.
2. The skill gives one subagent the relevant recent turns or full conversation.
3. That subagent reads the code, creates one complete line-level plan, and sends
   it to the extension. It does not spawn more agents.
4. The extension opens the first range and starts playback automatically.

The skill defaults to a focused four-to-seven-segment walkthrough. A broad
request that needs the full conversation and many files will take longer because
the agent must inspect the code and write all narration before playback starts.

## Requirements

- macOS
- Node.js 20 or newer
- VS Code 1.85 or newer, or Cursor
- Codex, Claude Code, Amp, or OpenCode

Setup recognizes the `code` and `cursor` shell commands as well as standard
installations in `/Applications`.

Claude support means local Claude Code, not Claude Desktop, Cowork, or a cloud
session. Claude Code 2.1.203 or newer is required because setup installs the
personal skill as a symlink.

## Setup

### From an existing checkout

Choose the agent that should receive the skill:

```bash
# Codex
./setup.sh --agent codex --editor code

# Claude Code
./setup.sh --agent claude --editor code
```

Replace `code` with `cursor` to target Cursor. Run both commands if you use both
agents; the second run keeps the first skill link. The default `--editor all`
installs into every detected editor. The default `--agent auto` uses the current
canonical skill location when possible, otherwise it prefers an existing Codex
or Claude Code installation.

### Fresh Codex installation

Clone directly into the canonical Codex skill directory so there is no second
copy:

```bash
CODEX_ROOT="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$CODEX_ROOT/skills"
git clone https://github.com/Aaquib111/code-explainer.git \
  "$CODEX_ROOT/skills/explainer"
"$CODEX_ROOT/skills/explainer/setup.sh" --agent codex --editor code
```

Replace `code` with `cursor` in the last command if needed.

### Fresh Claude Code installation

Clone directly into Claude Code's personal skill directory:

```bash
mkdir -p "$HOME/.claude/skills"
git clone https://github.com/Aaquib111/code-explainer.git \
  "$HOME/.claude/skills/explainer"
"$HOME/.claude/skills/explainer/setup.sh" --agent claude --editor code
```

Replace `code` with `cursor` in the last command if needed.

### What setup does

`setup.sh` is non-interactive and safe to rerun. It:

1. checks macOS, `/usr/bin/say`, Node.js, npm, and the selected editor
2. installs locked development dependencies with `npm ci`
3. runs the TypeScript check and creates a small VSIX package
4. installs version `0.3.0` over the existing extension with the same ID
5. verifies CLI-based installations
6. links this checkout into the selected agent's skill directory instead of
   copying it

Setup does not install Python packages or download a voice model.

Start a new agent session after the first installation so the skill appears.
Also reload the editor window so the extension starts.

### If setup cannot write to the editor directory

macOS may prevent an agent process from accessing the VS Code application or
`~/.vscode`, even though the same command works in your terminal. Setup still
installs the selected agent's skill and writes a ready-to-install VSIX here:

```text
vscode-extension/code-explainer-0.3.0.vsix
```

Finish the editor installation:

1. Open the command palette in VS Code or Cursor.
2. Run **Extensions: Install from VSIX...**
3. Select the path printed by setup.
4. Run **Developer: Reload Window**.

Setup exits with status 1 when this manual editor step remains. It does not print
a false success message.

### Verify the connection

Reload the editor, open the workspace you want to explain, then run from that
workspace:

```bash
# Codex
EXPLAINER="${CODEX_HOME:-$HOME/.codex}/skills/explainer/scripts/explainer.sh"

# Claude Code
EXPLAINER="$HOME/.claude/skills/explainer/scripts/explainer.sh"

"$EXPLAINER" health
```

Use only the assignment for your agent.

Expected output:

```json
{"status":"ok","workspace":"/absolute/path/to/your/workspace"}
```

That response confirms the helper can reach the extension for the current
workspace. The Code Explainer activity-bar icon should also be visible. To
verify agent discovery, start a new agent session and ask it to walk you through
a small function.

### Updating

If this repository is the canonical Codex clone:

```bash
cd "${CODEX_HOME:-$HOME/.codex}/skills/explainer"
git pull
./setup.sh --agent codex --editor code
```

For a canonical Claude Code clone:

```bash
cd "$HOME/.claude/skills/explainer"
git pull
./setup.sh --agent claude --editor code
```

If setup previously linked another checkout, update that checkout and run the
setup command for your agent there. Setup recognizes an existing link and does
not create a nested or duplicate installation.

An older copied skill may block the link step. After saving any local changes,
replace that old installation explicitly:

```bash
# Use the agent you are replacing.
./setup.sh --agent codex --editor code --replace-skill
```

### Other supported agent locations

| Setup flag | Skill location |
|---|---|
| `--agent codex` | `${CODEX_HOME:-$HOME/.codex}/skills/explainer` |
| `--agent claude` | `~/.claude/skills/explainer` |
| `--agent amp` | `~/.config/agents/skills/explainer` |
| `--agent opencode` | `~/.config/opencode/skills/explainer` |
| `--agent none` | Build and install only the editor extension |

Claude Code follows the same one-subagent workflow as Codex. The parent passes
the relevant conversation turns or a faithful summary into that task and tells
the subagent to complete discovery, writing, and sidebar delivery without
delegating again.

## Use

Ask naturally:

```text
Walk me through the authentication flow.
Explain how this request reaches the database.
Give me a deep walkthrough of the retry logic.
Walk me through the changes in this branch, but keep it quick.
```

The skill infers scope, depth, emphasis, and prior familiarity from the
conversation. It does not ask setup questions. For speed, it passes only the
relevant recent turns unless earlier context is needed to understand the
request.

## Playback controls

The sidebar provides play, pause, previous highlight, next highlight, a
clickable outline, restart, close, and speech-speed controls.

Keyboard shortcuts while a walkthrough is active:

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Play or pause |
| `Ctrl+Shift+[` | Previous highlight |
| `Ctrl+Shift+]` | Next highlight |
| `Ctrl+Shift+-` | Slow down |
| `Ctrl+Shift+=` | Speed up |
| `Ctrl+Shift+\` | Stop |

The extension invokes `/usr/bin/say -r <words-per-minute>` directly. Changing
speed restarts the current highlight at the new rate. Pausing suspends the
current `say` process and resumes it from the same place.

## Agent connection

The extension exposes a small authenticated HTTP API on localhost. The helper
supports:

```bash
scripts/explainer.sh health
scripts/explainer.sh plan /path/to/plan.json
scripts/explainer.sh state
scripts/explainer.sh send '{"type":"goto","segmentId":2}'
scripts/explainer.sh stop
```

Connection files live under `/tmp/code-explainer-<uid>/`. The directory is
user-only and each connection file has mode `0600`, while remaining accessible
to local coding agents. When several editor windows are open, the helper chooses
the workspace that contains the current directory. It also tolerates restricted
process inspection in sandboxed agent sessions.

## Troubleshooting

### `Code Explainer is not running`

1. Confirm the VSIX is installed in the editor you are using.
2. Run **Developer: Reload Window**.
3. Run `explainer.sh health` from the workspace open in that editor window.

If several windows are open, change the terminal's current directory to the
workspace you want before retrying.

### Setup prints `Operation not permitted`

Use the VSIX path that setup prints and follow the manual installation steps
above. The selected agent's skill link is still created.

### Speech stops

The walkthrough pauses and shows the full `say` error in the sidebar and an
editor notification. Fix the reported problem, then press Play to retry the
current highlight.

### A walkthrough takes too long to generate

Ask for a quick or focused walkthrough and name the entry file or symbol when
you know it. This lets the single subagent use recent context and a small set of
files instead of reconstructing a large feature from the whole conversation.

## Development

```bash
cd vscode-extension
npm ci
npm test
npm run check
npm run package
```

To rebuild and reinstall from the repository root:

```bash
./scripts/reinstall-extension.sh --editor code
```

The release package contains no runtime dependencies and is roughly 18 KB.

## Uninstall

Uninstall `srujangurram.code-explainer` from the editor's Extensions view or
with its CLI:

```bash
code --uninstall-extension srujangurram.code-explainer
# or
cursor --uninstall-extension srujangurram.code-explainer
```

Then remove the agent registration and runtime files:

```bash
# Codex
rm -rf "${CODEX_HOME:-$HOME/.codex}/skills/explainer"

# Claude Code
rm -rf "$HOME/.claude/skills/explainer"

rm -rf "/tmp/code-explainer-$(id -u)"
```

Run only the removal command for your agent. If the skill path is a symlink
created by setup, removing it leaves the source checkout intact. If it is the
canonical clone, that command removes the clone.

## License

MIT
