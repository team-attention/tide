# Spec: Transcript top-anchors the optimistic first message

## Scope

The Agent Session (chat transcript) must top-anchor as soon as it shows any
conversation content — including a just-sent message that has no backend block
yet — instead of vertically centering a lone first message.

This is a renderer-only layout fix in the Agent Chat transcript. No contract,
backend, or composer-behavior change.

## Evidence

- `src/desktop/adapters/inbound/react-renderer/agent-chat/transcript/transcript.tsx`
  applies the top-anchor modifier with
  `className={\`agent-session${blocks.length > 0 ? " agent-session--has-turns" : ""}\`}`.
- `transcript.css`: `.agent-session` defaults to `justify-content: center`;
  `.agent-session--has-turns` overrides to `flex-start` (comment: "centering is
  only for the (short) empty state").
- When the provider is not yet usable (e.g. `directory_trust_required`),
  `deriveChatState` returns `provider_not_ready` and no agent blocks exist.
  A just-sent message is held as an optimistic row in `queuedInputs` and rendered
  by `createQueuedInputRow(..., false)` via the transcript's
  `chatState !== running/waiting…` branch — with `blocks.length === 0`.
- Result: the lone message renders with the centering default, floating in the
  vertical middle of the transcript (observed: a thread blocked on workspace
  trust shows the first "You" message centered, well above the composer's
  "PROVIDER SETUP REQUIRED" card).

## Decisions

- **Decided (existing intent):** center only the short empty state; a conversation
  is top-anchored.
- **This spec:** "has content" is broader than "has blocks". The transcript
  top-anchors whenever it shows real turns, the loading skeleton, an optimistic
  just-sent / queued row, or the working indicator. It centers ONLY the genuine
  empty placeholder ("No messages here"), i.e. `blocks.length === 0 && chatState
  === "ready" && queuedInputs.length === 0`.

## Out Of Scope

- Backend reconciliation of the optimistic queued row.
- `data-session-state` semantics (purely informational; no consumer).
- Renaming the `--has-turns` CSS modifier.

## Domain Model

No domain change. Pure view-layer derivation from already-available view-model
fields (`blocks`, `chatState`, `queuedInputs`).

## Contracts

No contract change.

## Flow

1. User sends a first message into a thread whose provider is not yet usable.
2. `chatState` is `provider_not_ready`; `blocks` is empty; `queuedInputs` holds
   the optimistic message.
3. The transcript renders the optimistic row AND now top-anchors it (modifier
   applied because it is not the empty placeholder).

## Invariants

- The empty placeholder ("No messages here") stays vertically centered.
- Any visible transcript content (blocks, skeleton, optimistic/queued row,
  working indicator) is top-anchored.

## Tests

- `desktop-agent-chat-composer-shell.test.tsx`:
  - A hydrated thread with no blocks + provider-not-ready + a queued optimistic
    message renders `.agent-session` WITH `agent-session--has-turns` and shows
    the message text.
  - A hydrated, ready thread with no blocks and no queued input renders
    `.agent-session` WITHOUT `agent-session--has-turns` (centered empty state)
    and shows "No messages here".

## Implementation Notes

- `transcript.tsx`: replace the `blocks.length > 0` class condition with a
  `showsEmptyPlaceholder` check; apply `agent-session--has-turns` when NOT the
  empty placeholder.
- `transcript.css`: collapse the duplicate `.agent-session--has-turns` rule into
  one while touching the file.
