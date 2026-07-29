---
name: explainer
description: Create a narrated Code Explainer sidebar walkthrough when the user asks to explain, walk through, or understand code in the current codebase.
---

# Code Explainer

Create a narrated walkthrough in the Code Explainer sidebar.

## Non-negotiable behavior

- Do not ask the user about familiarity, depth, delivery mode, or plan approval.
- Always create a sidebar walkthrough. Infer scope, depth, emphasis, and what the
  user already knows from the request and conversation so far.
- Spawn exactly one subagent to produce the whole walkthrough. Do not split
  scouting, planning, or segment writing across separate agents.
- Give that subagent the relevant conversation context. Prefer the full context
  when earlier turns define the feature or desired depth; otherwise fork the
  recent turns that contain the request and referenced code. Never start it
  without context.
- Tell the subagent not to spawn any further agents. It must search, read,
  assemble, and send the walkthrough itself.
- Prefer a focused plan that is ready quickly. Default to 4-7 segments with 2-5
  useful highlights each. Expand only when the user explicitly asks for a deep
  or line-by-line explanation.
- Skip imports, boilerplate, and obvious syntax unless they explain an important
  design choice.

## Find the helper

Use the helper from the directory containing this skill. Common locations are:

```bash
# Codex
${CODEX_HOME:-$HOME/.codex}/skills/explainer/scripts/explainer.sh

# Claude Code
$HOME/.claude/skills/explainer/scripts/explainer.sh
```

Set its path once and check the extension before doing the code search:

```bash
EXPLAINER="${CODEX_HOME:-$HOME/.codex}/skills/explainer/scripts/explainer.sh"
"$EXPLAINER" health
```

The helper discovers the active editor through connection files under
`/tmp/code-explainer-<uid>/`, which is readable from Codex. If health fails,
tell the user to reload VS Code or Cursor. Do not use old
`~/.claude-explainer-*` files.

## Delegate once

Start one general coding subagent with the entire job below. When the agent API
supports context forking, use `fork_turns="all"` or the smallest recent-turn
fork that still contains every relevant user instruction. If context forking is
unavailable, include those turns or a faithful context summary in the task.
In Codex, make one `spawn_agent` call with a stable task name such as
`code_walkthrough`; set `fork_turns` to `"all"` or a positive recent-turn count,
never `"none"`.

The task must include:

- the user's walkthrough request
- the inferred scope and depth from the inherited conversation
- the helper path and plan rules from this skill
- an explicit instruction not to spawn more agents
- responsibility for sending the completed plan to the sidebar

Wait for this one subagent to finish. Do not repeat its code search or create a
second plan in the parent.

## Subagent workflow

1. Start with any files or symbols named by the user.
2. Search for the entry point and follow the relevant calls or data flow.
3. Read only the ranges needed to explain that flow.
4. Order segments as a coherent tour: entry point, core behavior, important
   branch or boundary, then result.
5. Write one complete JSON plan to a temporary file and send it immediately:

```bash
"$EXPLAINER" plan /tmp/code-explainer-plan.json
```

Do not pause for approval. The extension opens the first file, starts playback,
and advances automatically.

## Plan schema

Use absolute paths and current, 1-based line numbers.

```json
{
  "type": "set_plan",
  "title": "Authentication request walkthrough",
  "segments": [
    {
      "id": 1,
      "file": "/absolute/path/to/auth.ts",
      "start": 20,
      "end": 48,
      "title": "Request entry point",
      "explanation": "The handler validates the request and hands credentials to the authentication service.",
      "highlights": [
        {
          "start": 22,
          "end": 27,
          "ttsText": "The flow starts here. The handler rejects malformed input before any credential lookup happens.",
          "explanation": "Validate at the boundary"
        },
        {
          "start": 35,
          "end": 39,
          "ttsText": "With a valid request, control moves to the authentication service, which owns the actual credential check.",
          "explanation": "Hand off to the service"
        }
      ]
    }
  ]
}
```

Rules:

- Segment IDs must be unique positive integers.
- Every segment needs a non-empty explanation and at least one highlight.
- Every highlight must stay inside its segment range.
- `ttsText` is required, plain spoken prose with no markdown, paths, or line
  numbers. Explain intent and consequences, not visible syntax.
- Keep each highlight to the smallest useful range, usually 1-8 lines.
- Connect consecutive narration naturally without repeating the whole context.

After the subagent reports a successful send, reply briefly that the walkthrough
is playing in the sidebar. Do not duplicate the walkthrough in chat.

## Questions during a walkthrough

For a follow-up about the active walkthrough, run:

```bash
"$EXPLAINER" state
```

Use the returned segment and highlight index to read the exact code and answer
the question. Do not regenerate the walkthrough unless the user asks.
