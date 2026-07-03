# Spec: Agent Runtime Live Idle Chat State

## Scope

Keep Agent Chat's visible `Working` state aligned with the active turn, not with
whether a provider runtime process is still alive.

## Evidence

- `ThreadSummaryDto.live` is documented as true while an in-process runtime handle
  exists, including `idle-but-alive`.
- Structured provider runtimes keep their process/session alive after a turn ends
  so the next turn can reuse it.
- `deriveChatState` treated `thread.live === true && lastKnownState === "running"`
  as `running`, and `agentRuntime.stateChanged` updated only `runtimeState`.
  Therefore a thread hydrated as live/running could remain visually `Working`
  after an idle state event.

## Decisions

- `live` means runtime liveness only. It must not by itself imply an active turn.
- `agentRuntime.stateChanged` is authoritative for the displayed thread's
  last-known turn state.
- The active `ThreadSummary` cached inside Agent Chat must update its
  `lastKnownState` when a runtime state event arrives.

## Out Of Scope

- Changing backend turn-end detection.
- Changing the `live` contract or using it to tear down idle provider runtimes.

## Domain Model

- `runtimeState`: current active runtime state carried by Backend events.
- `lastKnownState`: last observed user-facing turn state in the thread summary.
- `live`: whether the backend still owns a runtime handle for the thread.

## Contracts

- `agentRuntime.stateChanged(state: "idle")` must make Agent Chat render as ready
  even if the thread summary remains `live: true`.
- `agentRuntime.stateChanged(state: "running")` must keep Agent Chat running and
  refresh the working timer from `changedAt`.
- Waiting runtime states continue to map to waiting chat states.

## Flow

1. A structured provider turn starts; Backend emits `agentRuntime.stateChanged`
   with `state: "running"`.
2. Agent Chat records `runtimeState: "running"` and updates the thread summary's
   `lastKnownState` to `running`.
3. The provider emits a final answer and `turn_completed`.
4. Backend emits `agentRuntime.stateChanged` with `state: "idle"` while the
   provider runtime handle may still be live.
5. Agent Chat records `runtimeState: "idle"` and updates the thread summary's
   `lastKnownState` to `idle`, so the `Working` indicator disappears.

## Invariants

- A live-but-idle runtime must not render `Working`.
- A live-and-running runtime may render `Working`.
- State-change events must keep the active Agent Chat state and its cached thread
  summary coherent.

## Tests

- Hydrate a live/running thread, apply `agentRuntime.stateChanged: idle`, and
  assert the view model is `ready` with no `Working` indicator.

## Implementation Notes

- Keep the fix in the Desktop Agent Chat reducer; backend state and provider
  runtime integrity remain unchanged.
