# Spec: Composer Message Edit

Feature #6 of the seamless-terminal goal: edit an individual message. Audit found
no message-edit / rewind / fork path in the codebase — this is a genuine gap.

## Scope

This spec covers the provider-agnostic, headlessly-verifiable slice:

- **Edit the queued (not-yet-sent) Composer message.** While a turn is running the
  user can queue a follow-up (`pendingInput`). Before it flushes, the user can fix
  a typo or rewrite it. Editing replaces the queued value in place; the runtime has
  not seen it yet, so this needs no provider rewind and works identically for
  Codex, Claude, and Antigravity.

Out of scope (separate, evidence-gated slice):

- **Edit an already-sent message** (rewind/fork the provider session to before that
  message and re-run). This is provider-native: Claude exposes `--fork-session`,
  Codex/Antigravity rewind support is unproven. Record as a decision point; do not
  fake a cross-provider rewind.

## Evidence

- `thread-runtime-service.ts` already owns `pendingInput` (a `PendingInput` of
  kind `composer_input`) set when `sendComposerInput` is called while the runtime
  is `running`/`starting` or provider-not-ready, and flushed by `recordTurnComplete`
  / consumed by `stopAgentRuntime`. There is no method to mutate it.
- No `editMessage` / `rewind` / `fork-session` symbol exists in `src`.

## Decisions

1. Editing applies only to the current queued `pendingInput`. There is exactly one
   queued input per Thread (the model is single-slot), so "edit the queued message"
   is unambiguous.
2. Editing preserves the queued launch options; it replaces only the text value and
   refreshes `capturedAt`.
3. Editing an empty/whitespace value is a clear request to discard the queued input
   (cancel the queue), not to store an empty message.
4. If there is no queued input, edit fails with `no_pending_input` — the caller
   should send instead.

## Domain Model

No new domain type. Reuses `PendingInput` on `ThreadRecord`.

## Contracts

Service-level first (this slice). A `BackendCommand` (`composer.editQueuedInput`)
and Desktop wiring follow once the service behavior is proven — noted, not built
here, to keep the slice tight.

New inbound service method:

```ts
editPendingInput(input: {
  threadId: ThreadId;
  value: string;
}): Promise<ServiceResult<EditPendingInputResult>>;

interface EditPendingInputResult {
  thread: ThreadSnapshot;
  status: "edited" | "discarded";
}
```

## Flow

```
turn running, user queued "fix teh bug"
  -> editPendingInput(threadId, "fix the bug")
  -> pendingInput.value = "fix the bug", capturedAt refreshed
  -> status: "edited"
  -> on turn end, the corrected message flushes as the next turn
```

Discard:

```
editPendingInput(threadId, "   ")
  -> pendingInput = undefined
  -> status: "discarded"
```

## Invariants

1. Editing never writes to the Agent Runtime (the queued input has not been sent).
2. Editing preserves the queued launch options.
3. Exactly one queued input per Thread; edit targets that slot.
4. Editing with no queued input fails; it does not silently create one.
5. Empty/whitespace edit discards the queued input rather than queuing blank text.

## Tests

| Invariant | Test |
|---|---|
| Edit replaces queued text, keeps options | `editing_queued_input_replaces_text_and_preserves_launch_options` |
| Edit does not touch the runtime | `editing_queued_input_does_not_write_to_runtime` |
| Edited text is what flushes next | `turn_end_flushes_the_edited_queued_message` |
| No queue → failure | `editing_with_no_queued_input_fails` |
| Whitespace discards | `editing_queued_input_with_blank_value_discards_it` |

## Implementation Notes

- Add `editPendingInput` to the `ThreadRuntimeService` interface and class.
- Mirror the trimming/normalization `sendComposerInput` applies to message text so
  the queued value stays consistent with a freshly-sent message.
- Image attachments on the queued message are out of scope for the edit slice; the
  text value is edited, existing materialized attachment paths are preserved.

## Open Questions

1. Should edit also support changing the queued message's attachments? Defer until
   the Desktop composer-edit UI exists.
2. Already-sent message edit (rewind/fork) — which providers can prove session
   rewind? Evidence-gated; separate spec.
