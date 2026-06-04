# Spec: Antigravity Turn Completion (transcript-based)

## Why

Antigravity threads in v2 show "Working" forever. Confirmed by two diagnostic runs
(distinct markers on every plugin hook): antigravity fires ONLY `PreToolUse` and
`PostToolUse` hooks. `PreInvocation`, `PostInvocation`, `Stop`, `Notification`,
`SessionStart`, `SessionEnd` never fire. So the `Stop → agent-idle` turn-end signal
the runtime waits for (`TURN_END_SIGNAL_EVENTS`) never arrives → `recordTurnComplete`
is never called → the thread never returns to idle.

Antigravity has no turn-end hook, so completion must be read from its transcript —
the same way codex (rollout) and claude (transcript) already work.

## Evidence

Transcript `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl`
for one turn:

```
USER_INPUT
CONVERSATION_HISTORY
PLANNER_RESPONSE   (tool_calls: [list_dir])      ← intermediate: has a tool call
LIST_DIRECTORY     (tool result)
PLANNER_RESPONSE   (tool_calls: [view_file])     ← intermediate
VIEW_FILE          (tool result)
PLANNER_RESPONSE   (content: "<final answer>")   ← TERMINAL: content, NO tool_calls
```

A `PLANNER_RESPONSE` is the turn's end iff it has visible `content` and **no
`tool_calls`**. Intermediate planner responses always carry a `tool_calls` entry.

## Domain Model

- `AntigravityConversationItem` gains `turnEnd?: boolean`, set true on the `message`
  item produced from a `PLANNER_RESPONSE` whose `tool_calls` is empty.
- `AntigravityProviderHistoryFrame` gains `turnComplete?: boolean` (top-level, not in
  `payload`, so block projection is unchanged), carried from the item's `turnEnd`.

## Flow

1. `antigravityConversationItems` marks the terminal planner message `turnEnd: true`.
2. `readAntigravityProviderHistoryFramesFromHome` carries `turnComplete` on that frame.
3. `emitAntigravityHistory`: after projecting newly-seen frames, if any carried
   `turnComplete`, call `emitTurnComplete({ threadId, service, onEvent })` — the same
   path the codex/claude turn-end signal uses (returns the runtime to idle / flushes a
   queued Composer input).

The `seenKeys` dedup means each terminal message is processed once, so completion
fires once per turn (a new terminal planner message = a turn just ended).

## Invariants

- A `PLANNER_RESPONSE` with any `tool_calls` is never a turn end (the agent will run
  the tool and continue).
- `turnComplete` lives on the frame, never in the block `payload` (blocks unchanged).
- Completion still flows through `recordTurnComplete`, so queued-input flushing and
  idle transition stay identical to the hook path.

## Out Of Scope

- The `PreToolUse → agent-needs-input` mapping (flaps "waiting" on every tool; should
  be `agent-running`) — separate cosmetic fix, and the installed plugin only refreshes
  on `agy plugin install`.

## Tests

- A terminal `PLANNER_RESPONSE` (content, no tool_calls) yields a frame with
  `turnComplete === true`.
- A `PLANNER_RESPONSE` carrying `tool_calls` (with or without content) yields no
  `turnComplete` frame.

## Location

`src/backend/infrastructure/node/live-backend.ts`
(`antigravityConversationItems`, `readAntigravityProviderHistoryFramesFromHome`,
`emitAntigravityHistory`). Tests: `tests/backend-agent-runtime-port-wiring.test.ts`.
