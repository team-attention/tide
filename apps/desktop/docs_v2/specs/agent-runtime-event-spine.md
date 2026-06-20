# Spec: Agent Runtime Event Spine

Master runtime spec. This is the structural backbone that every provider
(Codex CLI, Claude Code, Antigravity CLI) and every seamless-terminal feature
(turn lifecycle, streaming, in-session commands, directory trust, questions,
queuing, message edit, interrupt/steering) rides on.

It exists to remove the current churn root: provider-specific turn detection
implemented as polling + file/text scraping spread across infrastructure and a
4500-line service. It replaces that with one typed, provider-owned, ordered
event stream the Backend application consumes uniformly.

## Scope

In scope:

- Define `AgentRuntimeEvent`: the normalized, typed, ordered lifecycle event a
  provider runtime emits.
- Define `AgentRuntimeEventSource`: the single outbound port each Agent
  Integration implements to produce that stream by fusing its own Provider
  Signals (PTY transcript, hooks, rollout/transcript history, MCP).
- Define how the Backend service consumes one uniform stream to drive Agent
  Runtime State, Prompt State, Agent Session Blocks, queuing, and interrupt —
  with no provider-specific branching in the service or infrastructure.
- Map the ten seamless-terminal features onto the spine so each becomes a
  provider-owned event or a uniform runtime control op, not a new makeshift path.
- Define the migration: extract turn detection from `live-backend.ts` and
  `thread-runtime-service.ts` into per-provider event sources, slice by slice,
  with the existing behavior preserved at each step.

Out of scope (consume the spine, specified elsewhere):

- Agent Session Block reader rules — `agent-session-rendering.md`.
- Provider Readiness preflight / Setup Surface — existing specs.
- Tide MCP Tool Surface and Workbench operation — existing MCP specs.
- Desktop rendering, layout, and polish.

## Evidence

As-is, observed in the current code (2026-06-06):

- `src/backend/infrastructure/node/live/live-backend.ts` (3221 lines) contains
  `codexRolloutTurnEnded(...)`: it tail-reads the codex rollout JSONL
  (`readBoundedTail(path, 256*1024)`), splits lines, and scans for `event_msg`
  payload types `task_complete` / `turn_aborted` to decide a turn ended. It runs
  on a 500ms/1000ms `pollWhileRunning` loop and calls `endRunningTurn` →
  `recordTurnComplete`. Its own comment calls it "a fallback for a missing
  `codex-stop` hook". This is provider-specific lifecycle detection living in
  infrastructure wiring.
- `src/backend/application/services/thread-runtime-service.ts` (4536 lines) owns
  `recordTurnComplete`, queuing (`pendingInput`), and state transitions, but the
  decision of *whether a turn ended* arrives from infrastructure, not from the
  provider adapter.
- The Agent Integration adapters
  (`codex|claude|antigravity-agent-integration.ts`, ~400 lines each) are clean:
  they build launch/resume plans and `detectPromptState`, but they do **not**
  own the live event stream or turn lifecycle. That ownership leaked upward.
- Memory `v2-agy-never-finishes`: antigravity emits no usable turn-end → "Working"
  forever. Memory `v2-concurrency-hang-binding`: concurrent spawns mis-bind
  rollout↔thread and some produce zero output. Both are symptoms of lifecycle
  detection that is not owned per-runtime by the provider adapter.
- Existing typed surfaces already align with this direction: `RawAgentFrame`
  (`raw-agent-frame.ts`) with `source`/`sequence`/`payloadKind`, `PromptState`,
  and `AgentRuntimeState` enums exist. The spine formalizes the *control* stream
  that sits beside the existing *content* frame stream.

Conclusion: the architecture on paper (Raw Agent Frame → reader → Block) is
sound for **content**. The missing piece is a typed **control/lifecycle** stream
owned by the provider adapter. Today that control plane is implicit, polled, and
scraped in the wrong layer.

## Decisions

1. **One event source per runtime, owned by the Agent Integration.** Each
   provider adapter returns an `AgentRuntimeEventSource` for a started/resumed
   runtime. The adapter internally fuses its own signals (PTY bytes, hooks,
   rollout/transcript tail, MCP) and emits one ordered typed stream. Nothing
   above the adapter knows about rollout files or stop hooks.

2. **Turn lifecycle is an event, not an inference.** `turn.ended` with a typed
   `reason` is emitted by the provider adapter from its single best signal,
   deduped at the adapter. The service reacts to the event; it never decides turn
   completion by scanning text or polling files.

3. **The Backend service is provider-neutral.** The service consumes
   `AgentRuntimeEvent` and maps it to Agent Runtime State, Prompt State, frame
   append, queuing flush, and interrupt settling. It contains zero `if (codex)`
   lifecycle branches. Provider asymmetry lives only inside adapters.

4. **Content frames stay; control events are added beside them.** `RawAgentFrame`
   remains the unit the reader turns into Agent Session Blocks. The spine carries
   the control/lifecycle events and references frames; it does not replace the
   frame→block pipeline.

5. **Push, not poll, is the target.** Event sources are pull/`AsyncIterable` or
   push callbacks driven by real signals (PTY data, hook bridge calls, file
   watch). Where a provider only exposes a pollable file today (codex rollout),
   the polling is an *implementation detail inside that one adapter*, not a
   service/infra concern, and emits the same typed events. This keeps the makeshift
   contained and deletable when a better signal exists.

6. **No fallback-on-fallback in shared code.** A provider adapter may fuse
   multiple of its own signals (e.g. codex stop-hook OR rollout `task_complete`),
   but it resolves them to ONE deduped `turn.ended` internally. The service sees
   one event. Shared/infra code holds no provider fallbacks.

## Out Of Scope

- Changing provider launch/resume command shaping (already in adapters).
- Changing the Agent Session Block schema or reader contract.
- Persistence format changes beyond storing Last Known State already supported.
- Direct API Agent runtimes; they are not part of the current v2 runtime path.

## Domain Model

New domain types under `src/backend/application/domains/agent-runtime/`.

### AgentRuntimeEvent

The normalized control/lifecycle event. Ordered per runtime by `sequence`.

| Field | Purpose |
|-------|---------|
| `runtimeId` | Runtime that produced the event. |
| `threadId` | Thread that owns the runtime. |
| `agentId` | Provider identity (for telemetry/labels only; not for service branching). |
| `sequence` | Monotonic order within one runtime's event stream. |
| `observedAt` | Backend observation time. |
| `type` | Event type (below). |
| `payload` | Type-specific payload (below). |

Event types and payloads:

| `type` | Meaning | Payload |
|--------|---------|---------|
| `runtime.started` | The hidden PTY provider session is live. | `{ providerSessionRef? }` |
| `turn.started` | A user turn began processing. | `{ cause: "initial" \| "follow_up" \| "prompt_answer", inputRef? }` |
| `output.delta` | Streaming agent/reasoning text for the active turn. | `{ frameId }` (references an appended `RawAgentFrame`) |
| `prompt.opened` | Provider needs user action (approval/question/choice/permission/command picker). | `{ promptState }` |
| `prompt.closed` | A previously open prompt was answered or withdrawn. | `{ promptId, outcome: "answered" \| "withdrawn" }` |
| `turn.ended` | The active turn finished. | `{ reason: "completed" \| "aborted" \| "error" \| "interrupted" }` |
| `runtime.exited` | The provider process exited. | `{ code?, signal?, expected: boolean }` |

Rules:

- `turn.started` and `turn.ended` are balanced per turn. The adapter must emit
  exactly one `turn.ended` per `turn.started` (dedupe fused signals internally).
- `output.delta` references frames already appended through the existing
  frame→block path; the spine does not carry content bytes.
- `prompt.opened` carries the existing `PromptState` shape unchanged.
- Unknown provider lifecycle observations do NOT invent events. If the adapter
  cannot prove a turn ended, it does not emit `turn.ended`; recovery is handled
  by `runtime.exited` or explicit user stop. (No text-scrape guessing.)

### AgentRuntimeEventSource (outbound port)

```
src/backend/application/ports/outbound/agent-runtime-event-source-port.ts
```

```ts
export interface AgentRuntimeEventSource {
  runtimeId: string;
  /** Ordered lifecycle events for this runtime until runtime.exited. */
  events(): AsyncIterable<AgentRuntimeEvent>;
  /** Send a user turn into the runtime (composer input or prompt answer). */
  submit(input: TerminalInput): Promise<void>;
  /** Interrupt/steer the active turn; resolves when the interrupt is delivered. */
  interrupt(): Promise<void>;
  /** Discover provider In-Session Commands for the slash/option menu, if any. */
  queryCommands?(prefix: string): Promise<InSessionCommand[]>;
  /** Stop the runtime and release the PTY. */
  stop(): Promise<void>;
}
```

The existing `AgentIntegrationPort` gains one method that returns an
`AgentRuntimeEventSource` for a started runtime, replacing the implicit launch +
external polling. Launch/resume *plan* building stays as-is; the integration
now also owns the *live* source.

## Contracts

No new Shared Contract wire shapes are required by this spec. `AgentRuntimeEvent`
is Backend-internal. Its effects surface to Desktop through existing
`BackendEvent` stream updates:

- `turn.started` / `turn.ended` → Agent Runtime State stream update
  (`running` ↔ `idle`/`failed`).
- `prompt.opened` / `prompt.closed` → existing Prompt State stream update.
- `output.delta` → existing Agent Session Block stream update.

This keeps the Desktop contract stable while the Backend spine is restructured.

## Flow

Target runtime flow (replaces infra polling):

```
Composer send
  -> thread-runtime-service.submit(threadId, input)
  -> AgentRuntimeEventSource.submit(input)        # provider adapter
  -> provider CLI in hidden PTY runs the turn
  -> adapter fuses PTY + hook + history into events
  -> events(): turn.started, output.delta*, [prompt.opened/closed]*, turn.ended
  -> service maps each event uniformly:
       turn.started   -> runtimeState = running
       output.delta   -> (frame already appended) emit block update
       prompt.opened  -> Prompt State; runtimeState = waiting_*
       turn.ended     -> settle: flush queued pendingInput or go idle
```

Interrupt flow:

```
Stop button while running
  -> service.interrupt(threadId)
  -> AgentRuntimeEventSource.interrupt()           # provider-native interrupt
  -> adapter emits turn.ended(reason="interrupted")
  -> service settles uniformly (same path as completed)
```

## Feature Mapping

How the ten seamless-terminal goals ride this one spine:

| Goal | Mechanism on the spine |
|------|------------------------|
| 1. Accurate turn-end | `turn.ended` event, provider-owned, deduped. Deletes infra polling. |
| 2. Real streaming | `output.delta` events over already-appended frames. |
| 3. Slash/command options | `queryCommands(prefix)` on the source → Composer menu (In-Session Commands). |
| 4. Directory trust | Provider Readiness preflight (existing) gates before `runtime.started`; unchanged, but now clearly *before* the spine. |
| 5. AI question answering | `prompt.opened{question}` → answer via `submit({kind:"prompt_answer"})` → `prompt.closed`. |
| 6. Queue next message | Service-side `pendingInput`; flush on `turn.ended` uniformly (no provider branch). |
| 7. Edit individual message | Composer/thread op above the runtime; re-submit forms a new `turn.started`. |
| 8. Interrupt / steering | `interrupt()` op → `turn.ended{interrupted}`; queued steer flushes next. |
| 9. Workbench robustness | MCP tool surface attached to same session (separate spec); spine unaffected. |
| 10. Polish/layout | Desktop; consumes stable Runtime/Prompt state from the spine. |

## Invariants

1. The Backend application service and infrastructure contain no provider-specific
   turn-lifecycle detection. Lifecycle is decided inside Agent Integrations.
2. Exactly one `turn.ended` is observed per `turn.started`, per runtime.
3. The service reacts to events; it never polls files or scans free text to
   decide a turn ended.
4. Event ordering per runtime is monotonic by `sequence`.
5. A provider that cannot prove turn-end emits no `turn.ended`; the UI shows
   recovery via `runtime.exited` or explicit stop, never a fabricated settle.
6. `RawAgentFrame` remains the content unit; the spine carries control/lifecycle
   only and references frames by id.
7. Concurrent runtimes never share lifecycle state: each `AgentRuntimeEventSource`
   is bound to one `runtimeId` and one PTY.
8. Adapters fuse their own multiple signals internally and expose one deduped
   stream; shared code holds no fallback chains.

## Tests

Fake-provider first (no real CLI):

| Invariant / Behavior | Test |
|---|---|
| Service drives state from a uniform stream | `service_maps_runtime_events_to_runtime_state_without_provider_branch` |
| One turn.ended per turn.started | `fused_signals_resolve_to_single_turn_ended` |
| Settle flushes queued input | `turn_ended_flushes_queued_composer_input` |
| Interrupt settles like completion | `interrupt_emits_turn_ended_interrupted_and_settles` |
| No fabricated settle | `runtime_without_turn_end_does_not_auto_settle` |
| Concurrent isolation | `two_runtimes_keep_independent_turn_lifecycles` |
| Prompt round-trip | `prompt_opened_then_answer_emits_prompt_closed` |
| Ordering | `events_are_consumed_in_sequence_order` |

Architecture boundary additions:

- `backend/infrastructure` and `backend/application/services` must not reference
  provider rollout/transcript turn-detection helpers (enforce by forbidding the
  moved symbol names outside `adapters/outbound/agent-integrations`).

Provider smoke (after fake path green), per provider:

- `codex|claude|antigravity_emits_turn_started_and_single_turn_ended`.

## Implementation Notes

Migration is additive-then-subtractive to avoid a big-bang rewrite:

- **Slice 1 (additive):** add `AgentRuntimeEvent`, `AgentRuntimeEventSource` port,
  and a fake event source. Add a thin service consumer path that can run *beside*
  the existing one, proven by fake-provider tests. No deletion yet.
- **Slice 2 (codex):** implement the codex `AgentRuntimeEventSource` inside the
  codex integration, moving `codexRolloutTurnEnded` + history polling out of
  `live-backend.ts`. Switch codex onto the spine. Delete the infra codex
  detection. Keep the rollout tail as a *private* detail of the codex source.
- **Slice 3 (claude + antigravity):** same move for the other two. This is where
  antigravity "forever Working" and concurrent-binding bugs get fixed by
  per-runtime sources.
- **Slice 4 (controls):** interrupt, queuing flush, and prompt round-trip all
  expressed uniformly on the spine for all three providers.

`thread-runtime-service.ts` (4536 lines) and `live-backend.ts` (3221 lines)
should shrink as provider lifecycle moves into adapters. Splitting those god-files
is a natural consequence, not a separate goal; do it where the spine migration
exposes a clean seam, and record any ambiguous split as an open question rather
than forcing it.

## Open Questions

1. Should `AgentRuntimeEventSource.events()` be a single-consumer `AsyncIterable`
   or a fan-out subscription? Single-consumer (service owns it) is simpler and
   matches one-runtime-one-owner; pick that unless replay needs force otherwise.
2. Should `output.delta` carry the `frameId` only (current proposal) or also a
   coalesced text span for cheaper Desktop diffing? Decide when wiring streaming
   perf in Slice 2 against a real codex turn.
3. Where does `queryCommands` get its data per provider (interactive menu scrape
   vs. static catalog)? Evidence-gated per provider; defer to a focused
   in-session-commands spec after Slice 3.
4. Codex rollout polling stays inside the codex source for now; replace with a
   file watch when proven. Tracked, not blocking.
```
