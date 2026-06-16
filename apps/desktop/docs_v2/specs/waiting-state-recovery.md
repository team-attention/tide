# Spec: Waiting-State Recovery (no permanent lock / no permanent skeleton)

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
