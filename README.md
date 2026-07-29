# Code Explainer

Code Explainer lets a coding agent send a walkthrough to VS Code or Cursor. The
extension opens each code range, moves a highlight through the important lines,
and narrates the explanation with macOS `say`.

The workflow is intentionally small:

- one context-inheriting subagent searches the code and creates the walkthrough
- no familiarity quiz, mode picker, or plan approval
- no Python environment, model download, TTS server, or audio streaming
- playback starts as soon as the agent sends a valid plan
- speech speed is adjustable from 0.75x to 2x

## Requirements

- macOS
- Node.js 20 or newer
- VS Code or Cursor

Setup detects standard app installations automatically. It also accepts the
`code` or `cursor` shell command when available.

## Install for Codex

Clone directly into Codex's skill directory, then run the non-interactive setup:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
git clone https://github.com/Aaquib111/code-explainer.git \
  "${CODEX_HOME:-$HOME/.codex}/skills/explainer"
"${CODEX_HOME:-$HOME/.codex}/skills/explainer/setup.sh" --agent codex
```

Reload the editor once after installation.

If you already have this repository checked out elsewhere, run:

```bash
./setup.sh --agent codex
```

Setup links that checkout into Codex's skill directory instead of copying it, so
there is only one installation to update. If an older copied installation is
already there, replace it explicitly:

```bash
./setup.sh --agent codex --replace-skill
```

Setup is idempotent. It checks macOS `say`, builds and type-checks the extension,
installs the same extension ID with `--force`, and verifies the editor reports it
as installed. It does not install Python packages or download a voice model.

Other supported skill locations:

```bash
./setup.sh --agent claude
./setup.sh --agent amp
./setup.sh --agent opencode
```

Use `--editor code` or `--editor cursor` to target one editor. The default is
every detected editor.

## Use

Ask naturally:

```text
Walk me through the authentication flow.
Explain how this request reaches the database.
Give me a deep walkthrough of the retry logic.
```

The skill infers scope, depth, emphasis, and prior familiarity from the request
and recent conversation. It does not ask setup questions. It dispatches exactly
one subagent with the relevant recent turns or full conversation, and that
subagent handles discovery, planning, narration, and delivery without spawning
more agents. A typical walkthrough has four to seven segments and is sent to the
sidebar in one request.

## Controls

The sidebar has:

- play and pause
- previous and next highlight
- clickable segment outline
- speech speed from 0.75x to 2x
- restart and close

Keyboard shortcuts while a walkthrough is active:

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Play or pause |
| `Ctrl+Shift+[` | Previous highlight |
| `Ctrl+Shift+]` | Next highlight |
| `Ctrl+Shift+-` | Slow down |
| `Ctrl+Shift+=` | Speed up |
| `Ctrl+Shift+\` | Stop |

The extension runs `/usr/bin/say` directly and changes its words-per-minute rate
for playback speed. If `say` cannot start or exits with an error, the walkthrough
pauses and the error appears in both the sidebar and an editor notification.

## Agent connection

The extension exposes a small authenticated HTTP API on localhost. Its helper
script supports:

```bash
scripts/explainer.sh health
scripts/explainer.sh plan /path/to/plan.json
scripts/explainer.sh state
scripts/explainer.sh send '{"type":"goto","segmentId":2}'
scripts/explainer.sh stop
```

Connection files live in `/tmp/code-explainer-<uid>/` with user-only
permissions. This location is accessible to Codex. When several editor windows
are open, the helper chooses the connection whose workspace contains the
current directory.

## Development

```bash
cd vscode-extension
npm ci
npm run check
npm run compile
```

To rebuild and reinstall:

```bash
./scripts/reinstall-extension.sh
```

## Uninstall

```bash
code --uninstall-extension srujangurram.code-explainer
cursor --uninstall-extension srujangurram.code-explainer
rm -rf "${CODEX_HOME:-$HOME/.codex}/skills/explainer"
rm -rf "/tmp/code-explainer-$(id -u)"
```

Only run the editor command you use. If the skill path is a symlink created by
setup, removing it does not remove the source checkout.

## License

MIT
