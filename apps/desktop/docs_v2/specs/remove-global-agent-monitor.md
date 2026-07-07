# Spec: Remove Global Agent Monitor

## Scope

Remove the persistent global Agent Monitor panel from Product Shell.

Keep Thread-local live activity evidence, especially Claude Code subagent counts
and nested tool-call counts, because that is the useful signal for the active
Thread's Agent Chat.

## Evidence

- The removed panel grouped multiple Threads into `Needs You`, `Running`, and
  `Idle / Stopped`.
- Claude subagent visibility already has a Thread-local path through
  `agentRuntime.activityChanged`, `liveActivityEnrichment`, and
  `live-turn-activity-visibility`.
- The desired product behavior is not a global Thread monitor. It is detecting
  activity inside one running Thread, such as Claude Code subagents.

## Decisions

- Remove Product Shell state, view model fields, handlers, chrome buttons,
  React panel, and tests that exist only for the global panel.
- Do not remove backend structured runtime activity events or Claude subagent
  watchers.
- Do not remove Agent Chat live activity labels.

## Out Of Scope

- Designing a replacement subagent inspector.
- Changing provider runtime event contracts.
- Changing review or git handoff behavior.

## Domain Model

No new domain model.

The remaining model is `AgentChatShellState.liveActivityEnrichment`, scoped to
the active Thread's Agent Chat.

## Contracts

No Shared Contract changes. `agentRuntime.activityChanged` remains available.

## Flow

Claude subagent transcript/watch evidence -> backend live activity event ->
Desktop Agent Chat state -> active Thread activity label.

## Invariants

- No app-chrome Agent Monitor toggle exists.
- No global monitor panel can be opened.
- Product Shell does not keep duplicate per-thread runtime snapshots only for
  monitor rendering.
- Thread-local subagent activity tests continue to pass.

## Tests

- Typecheck catches removed Product Shell fields and handlers.
- Existing `live-turn-activity`, `claude-subagent-activity`, and
  `subagent-activity-watcher` tests keep the desired one-Thread activity path
  covered.
