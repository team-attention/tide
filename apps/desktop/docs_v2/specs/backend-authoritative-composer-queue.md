# Spec: Backend-Authoritative Composer Follow-up Queue

## Scope

Make the Composer follow-up queue (messages typed while a turn runs, held FIFO and
run one-per-turn-end) **backend-authoritative and uniform across every agent**. The
backend already owns the queue (`thread.pendingInput` + `pendingInputQueue`) and
already flushes it uniformly on turn-end (`turn_completed` →
`ingestTurnOutcomeAndSettle` → `recordTurnComplete`, identical for every provider —
provider differences live only in the adapter that produces `turn_completed`).

The break is one-sided: the **renderer keeps its own optimistic copy** of the queue
and *guesses* when to add/remove rows from events. That guess desyncs from the real
backend queue, producing: a message that both runs and stays queued; a queued
message that never visibly advances; rows removed in the wrong order.

Fix: the backend **publishes its real queue** to the renderer; the renderer
**displays that** as the source of truth. The renderer may still append optimistically
on submit for instant feedback, but every backend update reconciles it to the truth.

In scope:
- A `queuedInputs: string[]` (head-first pending composer-input texts) on the Thread
  snapshot DTO, and an `agentRuntime.queueChanged` event the backend emits whenever a
  thread's queue changes (enqueue / flush / edit / interrupt-drop).
- Renderer: set `queuedInputs` from the backend (hydrate snapshot + queueChanged),
  remove the optimistic remove-guessing (value-match on user blocks, hydrate filter).

Out of scope: the per-provider `turn_completed` detection (already uniform); changing
flush ordering/semantics; the renderer steer-chip visuals (unchanged).

## Evidence

- `thread.pendingInput?: PendingInput` (head) + `pendingInputQueue?: PendingInput[]`
  (tail) on `ThreadRecord` are the real FIFO queue (`thread.ts`).
- Flush is uniform: `live-backend.ts` `turn_completed` → `ingestTurnOutcomeAndSettle`
  → `emitTurnComplete` → `service.recordTurnComplete`, which promotes the next head and
  `writeInput`s it. No provider branching above the adapter.
- `rg pendingInput|queuedInput src/shared/contracts` → **nothing**: the queue is never
  sent to the renderer. `agent-chat-shell-state.ts` maintains `queuedInputs: string[]`
  purely optimistically and removes rows by matching `agentSessionBlock.upserted`
  user-block bodies — the desync source.

## Decisions

- **D1. Queue is published, not inferred.** The Thread snapshot carries
  `queuedInputs` (head-first input texts), and the backend emits
  `agentRuntime.queueChanged { threadId, queuedInputs }` on every queue mutation.
- **D2. Uniform, adapter-agnostic.** The publish happens in the application service
  (`ThreadRuntimeService`) at the queue mutation points, so it is identical for every
  agent. Adapters only decide *when a turn ends*, not how the queue is surfaced.
- **D3. Optimistic append stays; remove-guessing goes.** On submit while busy the
  renderer appends optimistically (instant), but it no longer removes rows by guessing
  from user blocks — `queueChanged`/hydrate reconcile to the backend's list.

## Domain Model

`ThreadRecord` unchanged (`pendingInput` head + `pendingInputQueue` tail). A pure
derivation `pendingInputTexts(thread): string[]` = `[pendingInput, ...queue]`'s
`value`s.

## Contracts

```ts
// ThreadSummary (snapshot DTO) gains:
queuedInputs?: string[]; // head-first pending composer-input texts; [] when none

// New backend→renderer event:
"agentRuntime.queueChanged": { threadId: ThreadId; queuedInputs: string[] };
```

## Flow

- Submit while busy → renderer appends optimistically + `composer.sendInput`. Backend
  enqueues → emits `queueChanged` → renderer sets `queuedInputs` = backend list.
- Turn ends → backend flushes head (runs it) → emits `queueChanged` (now shorter) →
  renderer updates. The flushed message appears as a real user block from the runtime.
- Edit/remove a queued row → `composer.editQueuedInput` → backend mutates → `queueChanged`.
- Interrupt with no live handle drops the queue → `queueChanged` (empty).
- Open/switch a thread → hydrate snapshot's `queuedInputs` seeds the renderer.

## Invariants

1. The renderer's displayed queue equals the backend queue after any `queueChanged`
   or hydrate (optimistic append is only a pre-reconcile placeholder).
2. The queue surfacing is identical for every agent (service-level, no per-provider code).
3. A flushed message is never shown twice: it leaves `queuedInputs` (backend dropped it)
   and arrives as a real user block.

## Tests

- backend: enqueue→`queuedInputs` has it; flush→it's gone; edit/remove→updated
  (`ThreadRuntimeService` + snapshot).
- backend: `queueChanged` emitted on send/turn-complete/edit (live-backend wiring or a
  service-event assertion).
- renderer: `agentRuntime.queueChanged` sets `queuedInputs`; hydrate seeds it; a user
  block no longer mutates `queuedInputs` (reconciliation owns it).

## Implementation Notes

- Add `pendingInputTexts` to `thread-snapshot.ts`; put `queuedInputs` on the snapshot.
- Emit `queueChanged` from the application service via its event sink at the three
  mutation points (send, recordTurnComplete, editPendingInput) — uniform.
- Renderer: `applyAgentChatBackendEvent` handles `agentRuntime.queueChanged`;
  `thread.hydrated` seeds `queuedInputs` from the snapshot; delete the
  `agentSessionBlock.upserted` value-match removal and the hydrate filter.

## Location

- `src/shared/contracts/{thread,events}.ts`
- `src/backend/application/services/{thread-snapshot,thread-runtime-service}.ts`
- `src/backend/infrastructure/node/live/live-backend.ts`
- `src/desktop/application/domains/agent-chat/agent-chat.ts`
- `src/desktop/application/domains/product-shell/product-shell.ts`
