# Spec: Goal complete follow-up must not stall behind stale live state

## Scope

Defines the failure mode where a completed provider-backed goal appears idle and
accepts a follow-up in the Composer, but the follow-up does not reach the
provider session until the Tide app is restarted.

This spec covers:

- how a goal-complete event can settle the Thread before the provider turn has
  emitted all late final events.
- how stale in-memory live state can make an idle Thread look busy to the
  Composer queue.
- what cleanup, queue, and diagnostics behavior must change so a follow-up is
  either sent/resumed or visibly rejected.

It does not change provider resume protocols, persisted Agent Session Cache
format, or the product meaning of a completed goal.

## Incident Evidence

A local incident on 2026-07-03 had this externally visible state:

- The left rail stopped showing running activity.
- The Thread showed a `Complete` goal badge.
- The Composer was enabled and allowed submit.
- Submitting a follow-up created a local user bubble, but no agent response,
  spinner, or provider turn started.
- Restarting the app made the same Thread accept a follow-up successfully.

Raw storage and provider evidence showed:

- Thread metadata was persisted as `lastKnownState: "idle"` with
  `goalState.status: "complete"`.
- The target provider event evidence ended with goal completion, a final answer,
  then task completion; there was no failed provider resume entry for the stuck
  follow-up before restart.
- The target Agent Session Cache and provider log had no user-message block for
  the stuck follow-up before restart.
- A direct resume of the same provider session succeeded, so an invalid provider
  session reference was not the root cause.
- After app restart, the same follow-up path worked, which points to stale live
  Backend memory rather than corrupted persisted Thread metadata.

Do not add raw local user paths, transcript bodies, or full provider session
identifiers to committed docs or tests. The important evidence is the state/event
sequence, not the private transcript.

## Root Cause Hypothesis

The failure is a live-state ordering bug:

1. The provider integration emits a goal update with `status: "complete"`.
2. `live-projector.ts` handles `goal_updated` by recording the goal state and,
   when the goal no longer keeps the runtime busy, calls `emitTurnComplete` with
   `force: true`.
3. `recordTurnComplete` settles the Thread to `runtimeState: "idle"` and
   `lastKnownState: "idle"`, and clears `streamingBlocks`.
4. Late final provider events can still arrive after the goal-complete settle:
   final message/content blocks, usage/activity updates, and the provider
   `turn_completed` event.
5. Some late events can put in-memory streaming/projected blocks back into the
   Thread after it is already idle.
6. The later provider `turn_completed` calls `recordTurnComplete`, but the
   method returns early when `runtimeState` is already idle. That early return
   skips stale live-state cleanup.
7. The Thread is now externally idle but internally still has a live runtime
   handle and stale live tail state.
8. The next Composer follow-up goes through `isThreadBusyForComposerQueue`.
   Because `activeRuntimeHandle` exists and stale live state remains, the input
   is classified as `queued` rather than `sent`.
9. No real provider turn is running, so no future turn-complete event flushes the
   queued input. The optimistic user bubble remains without a provider turn.

The observed restart recovery follows from the same hypothesis: restart drops the
in-memory runtime handle, streaming tail, and pending queue, then restores the
persisted idle Thread metadata. The next follow-up takes the normal resume/send
path.

## Current Code Paths

- `live-projector.ts`
  - `goal_updated` calls `emitGoalState`.
  - if `goalKeepsRuntimeBusy` is false, it calls `emitTurnComplete({ force:
    true })`.
  - `turn_completed` later calls `emitTurnComplete` again unless the goal is
    still active.
- `thread-runtime-service.ts`
  - `recordTurnComplete` has an early return when the runtime state is not
    running, starting, waiting for approval, or waiting for input.
  - The early return happens before prompt, queue, browser-driving, and
    `streamingBlocks` cleanup.
  - The non-early path clears `streamingBlocks`, clears dead prompt state, flushes
    queued input, or marks the Thread idle.
- `composer-queue-service.ts`
  - `isThreadBusyForComposerQueue` returns false only when there is no active
    runtime handle.
  - With a live handle, it treats active runtime state, active last-known state,
    prompt state, or non-empty `streamingBlocks` as busy.
  - The busy path queues the Composer input without appending a local user block
    or writing to the provider.
- Renderer Composer state
  - `submitComposer` optimistically shows the user input before the Backend
    command resolves.
  - Backend command rejection/timeout handling is not strong enough to make this
    specific stuck queued path visible.

## Decisions

### D1. Goal complete may settle display state, but it must not strand late live state

A completed goal is allowed to make the Thread look idle to the user. However,
late provider events from the same turn must not leave state that later causes an
idle Thread to be treated as busy.

The cleanup invariant is stronger than the runtime-state transition: stale live
tail state must be cleared even when a duplicate or late turn-complete arrives
after the Thread is already idle.

### D2. Idle Threads must not queue behind streaming tail alone

`streamingBlocks` is evidence of an in-flight turn only while the Thread is
otherwise active. If `runtimeState` and `lastKnownState` are idle/open and no
prompt is live, stale `streamingBlocks` alone must not make a follow-up queue
forever.

The preferred behavior is:

- if the Thread is active, queue the follow-up and flush it on turn complete.
- if the Thread is idle, send/resume the follow-up immediately.
- if the Backend cannot determine safety, surface an explicit command error
  rather than silently keeping an optimistic bubble.

### D3. A queued Composer input requires a future drain signal

`composer.sendInput` may return `queued` only when there is a real active turn or
prompt lifecycle that can drain the queue. If no such future signal exists, the
service must send now, clear stale state and send, or fail visibly.

### D4. The incident needs command-level diagnostics

This class of bug was hard to prove from disk because queued runtime state and
`agentRuntime.stateChanged` are not durable conversation blocks. The Backend
should expose enough command result/debug information to distinguish:

- `sent`
- `queued`
- `provider_not_ready`
- command failure
- command timeout

The UI should not show a durable-looking user bubble when the Backend command
has not produced a sent user block or a real queued state with a known drain.

## Required Fixes

1. Make `recordTurnComplete` perform stale cleanup even on idle duplicate/late
   completion:
   - clear `streamingBlocks` when no active prompt/turn is live.
   - clear browser-driving/live activity residue as appropriate.
   - preserve the existing prompt protections for genuinely live unanswered
     prompts.
2. Harden `isThreadBusyForComposerQueue`:
   - do not treat `streamingBlocks` alone as busy when runtime and last-known
     state are idle.
   - keep queueing when `runtimeState`, `lastKnownState`, or prompt state proves
     a real active turn.
3. Add a guard before returning `queued`:
   - a queued input must have an active runtime state, active last-known state,
     or live prompt that can produce a future drain.
   - otherwise clear stale state and send/resume, or return a visible failure.
4. Add Renderer/IPC command failure handling:
   - catch `composer.sendInput` rejections/timeouts.
   - remove or mark the optimistic user bubble if no submitted block was
     accepted.
   - surface Backend `contract.error` in the Composer/Thread state.
5. Add structured diagnostics for `composer.sendInput`:
   - request id, thread id, runtime id, previous runtime state, last-known state,
     streaming tail count, prompt presence, resulting status.
   - diagnostics must avoid transcript body content.

## Tests

### Service tests

- `idle_thread_with_stale_streaming_tail_sends_followup_not_queued`
  - seed a Thread with `runtimeState: "idle"`, `lastKnownState: "idle"`, an
    `activeRuntimeHandle`, and a stale streaming block.
  - call `sendComposerInput`.
  - expect `status: "sent"`, a submitted local user block, and a provider
    `writeInput`.
- `late_turn_complete_after_goal_settle_clears_streaming_tail`
  - start running, record a streaming block, call `recordTurnComplete({ force:
    true })` to mimic goal-complete settle.
  - add a late streaming block while idle.
  - call `recordTurnComplete` again to mimic provider `turn_completed`.
  - expect hydrate to return no streaming tail and the next follow-up to send.
- `queued_status_requires_active_drain_source`
  - assert `sendComposerInput` can return `queued` only when runtime state,
    last-known state, or prompt state indicates an active drain source.

### Projector tests

- `goal_complete_before_turn_completed_does_not_strand_followup`
  - feed structured events in this order:
    `turn_started`, streaming/content activity, `goal_updated complete`, late
    content/streaming activity, `turn_completed`.
  - submit a follow-up.
  - expect a local user block and provider input write, not a queued-only state.

### Renderer tests

- `send_input_backend_error_rolls_back_or_marks_optimistic_bubble`
  - simulate `composer.sendInput` returning `contract.error` or timing out.
  - ensure the Composer does not leave an indistinguishable successful user
    bubble.
- `queued_followup_without_running_state_is_visible_as_error`
  - simulate a Backend event/result that cannot produce a drain signal.
  - ensure the user sees retry/error state instead of silent idle.

## Invariants

- I1. A Thread that is externally idle must be able to accept a follow-up without
  app restart.
- I2. `streamingBlocks` is an in-flight tail, not a durable busy marker.
- I3. `composer.sendInput` status `queued` implies a known future drain source.
- I4. A completed goal must not leave a live runtime handle in a state that
  blocks future follow-ups.
- I5. Optimistic UI state must reconcile to sent, queued-with-drain, or failed;
  it must not remain as an unbacked user bubble.

## Open Questions

- Should goal completion stop/park the active runtime handle, or keep it alive
  for faster follow-up resume? Keeping it alive is acceptable only if idle
  follow-ups bypass stale busy checks.
- Should `agentRuntime.stateChanged` events that carry queued inputs be persisted
  as lightweight diagnostic events, or should diagnostics remain log-only?
- Should the Composer show an explicit "queued" chip only when the queue has a
  live drain source?

## Rollout Plan

1. Add the service regression tests first; confirm the stale-tail scenario fails.
2. Fix `recordTurnComplete` cleanup and Composer queue busy classification.
3. Add projector coverage for goal-complete-before-turn-complete ordering.
4. Add Renderer command failure reconciliation tests.
5. Add diagnostics after the behavioral fix, not as a substitute for the fix.
