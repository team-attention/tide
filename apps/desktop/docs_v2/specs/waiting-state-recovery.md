# Spec: Waiting-State Recovery (no permanent lock / no permanent skeleton)

## Structural follow-up — remove timing-based prompt/state delivery (A/B/C)

The first cut (above) still left the prompt/state path leaning on timers, and that was the
real, intermittent root: an AskUserQuestion card raced into "never surfaced" (chat stuck
"Working"), and under CONCURRENT threads a sibling's card never appeared. Three structural
changes remove the timing dependence entirely (verified live: AUQ surfacing 3/3, restart+
resume 2/2, 3 concurrent threads stuck-on-Working 0 — was 1):

- **C — backend, no `setImmediate`.** `surfaceAskUserQuestion` emitted the prompt on a
  `setImmediate`; a stream event landing in that window dropped the FIRST/only question.
  Now it emits SYNCHRONOUSLY. A provider RETRACTION (control_cancel, incl. question+cancel
  in one chunk) is handled by a real `withdrawProviderPrompt` service capability — clear
  the exact prompt, promote the next queued one, or resume running — not by a deferral.
- **B — renderer, no correctness timer.** Push events were coalesced behind a
  `setTimeout(16)` flush, so a `prompt.changed`/`stateChanged` could sit in the buffer
  ("backend waiting, chat still Working"). Now control/state/lifecycle events apply
  IMMEDIATELY; ONLY `agentSessionBlock.upserted` (per-token text) is still coalesced — a
  pure render throttle that carries no state — and an immediate event drains that buffer
  first to preserve order.
- **A — authoritative per-thread state.** Per-thread events for a NON-active thread are now
  folded into `agentChatByThreadId[threadId]` as they arrive (not active-surface-only with
  hydrate-on-switch recovery, which raced under concurrency). Switching is a projection of
  already-current state; a background thread's card is waiting for you when you arrive.
- **D — clean teardown of a pending tool permission.** Interrupting/stopping the claude
  runtime while a tool-permission request (incl. AskUserQuestion) is in flight closed the
  control stream with no response, so claude recorded `Tool permission request failed: ...
  stream closed before response received` and then worked around the "broken" tool (e.g.
  printing the question as plain text). `interrupt()`/`stop()` now DENY every pending
  permission first, so claude records a clean cancellation. Pairs with C/B making Stop
  reachable in waiting states (so a Stop while a card is up takes this path).

## Scope

A Thread that enters `waiting_for_approval` / `waiting_for_input` (any provider:
claude permission/AskUserQuestion, codex approval, gemini/opencode ACP permission)
must never become permanently stuck. Concretely, fix three coupled defects that all
branch from "Thread is waiting on a prompt":

1. **Queue lock** — follow-ups sent while waiting queue Tide-side and only drain in
   `recordTurnComplete`, which (since `dfc424ee`) early-returns while an unanswered
   prompt is held → the queue never drains.
2. **No escape** — `interruptComposer` only fires for `running`/`starting`, so in a
   waiting state Stop is a no-op. With the card not surfaced, the user has no way out.
3. **Permanent skeleton** — after a renderer reload, an active Thread left in
   `hydrating` shows the loading skeleton forever when its `thread.hydrated` is not
   applied to its stored chat state (flow C).
4. **Card never surfaced (ROOT)** — the live reason a Thread sits in waiting with no
   visible card: the live-projector force-settles a turn-end whenever it carried a final
   message/notice (`dfc424ee`), and the AskUserQuestion pattern emits a final message AND
   a question card in the same turn → `recordTurnComplete(force:true)` drops the
   just-raised card. Provider-neutral (the projector ingests all CLI providers).

This is provider-agnostic: the queue/turn-end/interrupt/hydrate paths have no agentId
branching. claude is simply what was observed waiting.

## Evidence

- Persisted `index.json`: the broken Threads are exactly those with
  `lastKnownState ∈ {waiting_for_approval, waiting_for_input}` (the rail "dot").
  Idle Threads render fine. (`~/Library/Application Support/tide/threads`)
- Running the real backend (`createLiveBackendContractMessageAdapter`) against a copy
  of that data: `thread.hydrate` returns `thread.hydrated` with blocks (20/32) and
  `prompt` for the waiting Threads in <5ms. → **data is safe; the backend hydrate is
  healthy. "내용 안 보임" is a renderer display defect, not data loss.**
- Renderer reducer run: the loading skeleton (`hydrating && blocks.length === 0`) only
  persists when a `thread.hydrated` is NOT applied to the active surface (event
  threadId ≠ activeThreadId at apply time) — "flow C".
- `composer-queue-service.ts` busy branch enqueues for `running|starting|waiting_*`;
  the drain lives only in `recordTurnComplete` past the `dfc424ee` early-return.
- `composer.ts:interruptComposer` gate is `runtimeState === "running" || "starting"`.

## Decisions

- **A turn-end never force-settles a live, unanswered prompt.** Only `runtime_exited`
  forces (the card is then truly dead). Carrying a final message/notice is NOT evidence
  the prompt died — it is the AskUserQuestion shape. (Root fix.) When there is no live
  prompt, `recordTurnComplete` settles regardless of force, so this removes nothing for
  ordinary turns; an answered card still settles via `promptAnsweredPendingSettle`.
- **Holding the queue while waiting on a real prompt is CORRECT** (a follow-up must not
  blind-write into an open permission/question box). The fix is an *escape*, not
  "drain while waiting".
- **Stop is the universal escape.** Interrupt must be available in waiting states; it
  routes to the existing `stopAgentRuntime`, which already clears the prompt and either
  drains a queued follow-up (live handle) or settles to idle.
- **`thread.hydrated` is authoritative for `hydrating`.** Receiving it for a Thread must
  always clear that Thread's `hydrating`, even if the Thread is no longer the active
  surface (so switch-back / a late response can't strand the skeleton).

## Out Of Scope

- Broader provider-signal delivery auditing beyond the turn-end force heuristic.
- Re-designing the whole spurious-turn-end model: we keep "don't drop an unanswered card
  on a turn-end"; we tighten WHEN the projector forces (runtime exit only).

## Domain Model

No new domain types. Behavior changes only:
- `AgentChatShellState.runtimeState` waiting values become interruptible.
- `hydrating` is cleared by `thread.hydrated` for the addressed thread unconditionally.

## Contracts

No contract shape changes. `agentRuntime.stop` already exists and is the escape command.

## Flow

### Interrupt while waiting (new)
1. Thread is `waiting_for_approval`/`waiting_for_input`; user presses Stop (or the
   queued-row interrupt).
2. `interruptComposer` now treats waiting as busy → emits `agentRuntime.stop` and
   optimistically clears `promptState`; settles to `idle` when no follow-up is queued,
   stays `running` when one is (the backend flushes it on the interrupt turn-end).
3. Backend `stopAgentRuntime` clears the prompt, drains the queued follow-up on the live
   handle (or settles idle), unlocking the Thread.

### Hydrate clears skeleton (hardened)
1. Active Thread is `hydrating` after a reload.
2. `thread.hydrated` for that threadId → applied to the active chat (existing path);
   additionally, a `thread.hydrated` whose threadId is NOT active clears `hydrating`
   on its preserved background entry (`agentChatByThreadId[threadId]`) so switch-back
   never shows a stale skeleton.

## Invariants

- A Thread with a live runtime handle can always be interrupted from any non-idle
  runtimeState (`running`, `starting`, `waiting_for_input`, `waiting_for_approval`).
- After any `thread.hydrated` for thread T, T's stored chat state has `hydrating === false`.
- Holding behavior unchanged: while waiting with no user Stop, follow-ups stay queued.

## Tests

- `interruptComposer` returns an `agentRuntime.stop` command when `runtimeState` is
  `waiting_for_input` and when `waiting_for_approval` (both with and without a queued
  follow-up); no-op only when `idle`/`failed`/no thread.
- Interrupting a waiting Thread optimistically clears `promptState`.
- Backend lifecycle: a Thread in `waiting_for_approval` with a queued follow-up + live
  handle, on `stopAgentRuntime`, clears the prompt and flushes the queued input
  (asserts a writeInput / running state), i.e. the queue is no longer stranded.
- Renderer: an active `hydrating` Thread that receives `thread.hydrated` for ITSELF
  clears the skeleton (already true — regression guard).
- Renderer: a `thread.hydrated` for a non-active Thread clears that Thread's preserved
  `hydrating`, so opening it renders instantly (no skeleton).

## Implementation Notes

- `src/desktop/application/domains/agent-chat/state/composer.ts`: widen the
  `interruptComposer` busy gate to include `waiting_for_input`/`waiting_for_approval`;
  clear `promptState` on the optimistic state.
- `src/backend/...`: no logic change expected for the escape (covered by
  `stopAgentRuntime`); add the lifecycle test. If the test reveals a gap (e.g. the
  guard re-arms), address it minimally there.
- `src/desktop/application/domains/product-shell/state/events.ts` (+ `thread-list.ts`):
  on `thread.hydrated`, also clear `hydrating` for the addressed thread's preserved
  background entry.
- No agentId branching anywhere — keep it uniform across all four providers.
