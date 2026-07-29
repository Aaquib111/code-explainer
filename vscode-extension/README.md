# Code Explainer

Code Explainer displays code walkthroughs created by a coding agent. It opens
the relevant files, highlights each range, and narrates the walkthrough with the
built-in macOS `say` command.

There is no cloud TTS service, Python environment, voice model, quiz, or plan
approval step. A valid plan starts playing immediately.

## Controls

- Play or pause narration
- Move to the previous or next highlight
- Jump to a segment from the outline
- Change speech speed from 0.75x to 2x
- Restart or close the walkthrough

Speech errors are shown directly in the sidebar and as an editor notification.

## Requirements

- macOS
- VS Code 1.85 or newer, or a compatible Cursor release
- the Code Explainer agent skill

See the repository README for skill installation and agent usage.
