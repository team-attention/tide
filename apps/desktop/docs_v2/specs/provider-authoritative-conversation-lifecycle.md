# Spec: Provider-Authoritative Conversation Lifecycle

## Implementation status

Implemented on 2026-07-19 for the shared conversation baseline and the three
structured adapters. The implementation keeps the existing `start` / `resume`
/ `writeInput` runtime-port surface, but changes its semantics: provider session
adoption is awaited before a runtime handle is published, every Composer input
has one stable delivery ID, and `writeInput` returns provider dispatch evidence.

Provider history rebuild is the side-effect-free observation path used during
restore. A standalone `observeSession` / `openForDispatch` port remains the
future interface shape documented below; it was not required to remove the
stale-Working failure because restore now treats provider history as golden and
never restores a remembered active state without a live runtime.

Implemented and covered by automated tests:

- one persisted application FIFO with stable delivery IDs;
- awaited Codex/ACP session adoption and Claude process readiness;
- Codex `clientUserMessageId`, Claude replay UUID, and ACP `messageId` /
  `userMessageId` correlation;
- provider-native terminal status and turn/delivery identity through the event
  spine;
- no adapter-owned hidden Composer queue;
- bounded protocol/ack waits and indeterminate runtime-exit recovery;
- ID-only optimistic-block reconciliation against provider history;
- stale active-state reset and full queued-delivery restore after restart.

The exact-protocol fake transports and the full Tide suite pass. The opt-in
real-provider multi-turn/crash smokes in this spec have not been run as part of
this change, so they remain release validation rather than an automated-test
claim.

## Scope

Make Tide's Thread, turn, delivery, resume, interrupt, and recovery state agree
with Codex app-server, Claude Code stream-json, and OpenCode ACP without copying
provider conversation history into a second source of truth.

This spec covers:

- provider bootstrap/readiness handshake;
- lifecycle observation and resume reconciliation;
- stable input identity and delivery acknowledgement;
- terminal outcome fidelity;
- one backend-owned Composer queue;
- request deadlines and indeterminate recovery;
- renderer states for pending, accepted, working, waiting, stalled, terminal,
  and retry decisions;
- exact provider mappings and regression tests.

Research basis:
[Provider Conversation Lifecycle Evidence](../research/provider-conversation-lifecycle-evidence.md).

## Evidence

- Provider-owned Raw Agent Session is already the persistence authority in
  [Persistence](persistence.md).
- Structured provider runtimes are already the sole active transports in
  [Structured Agent Runtime](structured-agent-runtime.md).
- Backend owns the product queue in
  [Backend-Authoritative Composer Follow-up Queue](backend-authoritative-composer-queue.md).
- The incident session's Codex history reconstructed two empty follow-up turns
  as `interrupted`, while Tide persisted `running` and optimistic user blocks.
- All three installed provider transports expose a client message correlation
  field, but with different acknowledgement/idempotency guarantees.

## Decisions

### D1. Provider history remains golden

Rollout/transcript/OpenCode messages decide conversation content. Tide never
edits provider files and never treats Agent Session Cache, lifecycle checkpoint,
or delivery ledger as a replacement conversation log.

### D2. Resume is observation plus an atomic first dispatch

Opening an old Tide Thread first calls a side-effect-free provider observation;
it does not need to spawn a runtime. When the user sends the next message, the
runtime port atomically starts/resumes the provider and dispatches that tracked
delivery.

This split is required by Claude stream-json: the process emits no `system/init`
until it receives its first user frame. A generic “await init, then send” API
would deadlock. The first frame must therefore be part of the awaited
`openForDispatch` operation, with its delivery UUID already recorded.

`openForDispatch` completes only after the adapter has initialized as far as its
protocol permits, loaded/rejoined the requested provider session, confirmed the
provider session identity, and returned delivery/lifecycle evidence. A spawned
process without that evidence remains private adapter bootstrap state.

### D3. Every Composer submission has a stable delivery UUID

The UUID is minted in the application service before queueing and survives app
restart. It is passed through the runtime port to the native correlation field:

- Codex: `clientUserMessageId`;
- Claude: user frame `uuid` plus `--replay-user-messages`;
- ACP: `PromptRequest.messageId` and `PromptResponse.userMessageId`.

Correlation does not imply idempotency. The provider capability records the
stronger guarantee separately.

### D4. Provider acknowledgement gates the durable user bubble

The renderer may show an immediate local pending bubble, but its state remains
`queued` or `dispatching` until provider evidence promotes it to `accepted`.
Tide does not mark the thread `running` merely because stdin accepted bytes.

For protocols without an early durable acknowledgement, the state remains
`dispatching`/`working-unconfirmed` until history or terminal response proves
acceptance. UI copy must be honest about that distinction.

### D5. One queue owner

`ComposerQueueService` owns every message not yet dispatched. Adapters may hold
protocol request state, but they may not accept an unbounded second queue.

During bootstrap, one in-flight dispatch is represented in the delivery ledger;
it is not copied into `queuedWrites`, `queuedPrompts`, or `pendingSteerText`.
Codex native steer is a capability-gated dispatch mode, not a hidden fallback
queue.

### D6. Native terminal outcome is preserved

The normalized event includes native session ID, turn/request ID, delivery ID
when known, terminal status, error, usage, and native evidence.

Normalized terminal statuses:

- `completed`;
- `interrupted`;
- `cancelled`;
- `failed`;
- `refused`;
- `max_tokens`;
- `indeterminate`.

Adapters retain the provider-native value alongside normalization.

### D7. Silence is not completion

Every protocol request has a bounded response deadline. Missing responses move
the request/delivery to `indeterminate` and trigger provider observation.
There is no fixed maximum model execution time. Progress liveness and protocol
response deadlines are separate.

### D8. Recovery is conservative about duplicate sends

Recovery checks provider history/correlation before retrying.

- Claude 2.1.202 may safely resend the same UUID because the provider skips
  persisted/runtime duplicates.
- Codex and OpenCode are not assumed idempotent. If acceptance cannot be proven
  or disproven, Tide exposes `indeterminate` and requires an explicit retry that
  warns about possible duplication.

### D9. Common baseline, native extensions

All providers must satisfy the common handshake, delivery ledger, terminal
outcome, interrupt, history rebuild, and recovery contracts. Features such as
Codex live status/steer and provider-native fork remain explicit capabilities.
Tide does not fake support where a protocol has no evidence.

## Out of scope

- Replacing provider storage with a Tide database.
- Editing rollout, Claude JSONL, or OpenCode database rows.
- Attaching to arbitrary provider-owned processes.
- Making one provider's live-steer behavior the cross-provider default.
- Cloud synchronization or multi-device merge.
- Retrofitting the removed hidden-PTY runtime.

## Domain model

```ts
type NormalizedTerminalStatus =
  | "completed"
  | "interrupted"
  | "cancelled"
  | "failed"
  | "refused"
  | "max_tokens"
  | "indeterminate";

type ProviderRuntimeStatus =
  | "not_loaded"
  | "bootstrapping"
  | "idle"
  | "active"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "system_error"
  | "unknown";

interface ProviderLifecycleSnapshot {
  provider: ProviderCliAgentId;
  providerSessionRef: ProviderSessionRef;
  observedAt: string;
  observationKind: "start" | "resume" | "read" | "event" | "history_rebuild";
  runtimeStatus: ProviderRuntimeStatus;
  activeTurnRef?: string;
  lastTurn?: {
    providerTurnRef?: string;
    status: NormalizedTerminalStatus | "in_progress";
    nativeStatus?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
  };
  historyCursor?: string;
  canAcceptTurn: boolean;
  canInterrupt: boolean;
  capabilities: {
    messageCorrelation: boolean;
    idempotentMessageKey: boolean;
    liveStatusRead: boolean;
    historyRead: boolean;
    fork: boolean;
    steer: boolean;
  };
}

type DeliveryState =
  | "queued"
  | "dispatching"
  | "accepted"
  | "running"
  | "terminal"
  | "indeterminate"
  | "failed";

interface ComposerDelivery {
  deliveryId: string; // UUID
  threadId: ThreadId;
  state: DeliveryState;
  capturedAt: string;
  dispatchedAt?: string;
  acknowledgedAt?: string;
  providerSessionRef?: ProviderSessionRef;
  providerTurnRef?: string;
  providerMessageRef?: string;
  nativeAckKind?: string;
  terminalStatus?: NormalizedTerminalStatus;
  retrySafety: "safe_same_key" | "check_history" | "may_duplicate";
  lastError?: string;
}
```

Pending message text and attachments remain only while needed to queue/dispatch.
After acceptance, the delivery ledger retains IDs/evidence, while visible text
comes from provider history or the reconciled Agent Session Cache.

## Contracts

### Runtime port

```ts
interface AgentRuntimeSession {
  handle: AgentRuntimeHandle;
  lifecycle: ProviderLifecycleSnapshot;
}

interface AgentRuntimeDispatchInput {
  deliveryId: string;
  value: string;
  attachments?: ComposerAttachmentRef[];
}

interface AgentRuntimeDispatchResult {
  state: "accepted" | "running" | "indeterminate";
  lifecycle: ProviderLifecycleSnapshot;
  providerTurnRef?: string;
  providerMessageRef?: string;
  nativeAckKind: string;
}

interface AgentRuntimePort {
  observeSession(input: {
    threadId: ThreadId;
    agentBinding: AgentBinding;
    scope?: ThreadScope;
  }): Promise<ProviderLifecycleSnapshot>;
  openForDispatch(input: {
    mode: "start" | "resume";
    runtime: AgentRuntimeStartInput | AgentRuntimeResumeInput;
    delivery: AgentRuntimeDispatchInput;
  }): Promise<{
    session: AgentRuntimeSession;
    dispatch: AgentRuntimeDispatchResult;
  }>;
  dispatch(
    handle: AgentRuntimeHandle,
    input: AgentRuntimeDispatchInput,
  ): Promise<AgentRuntimeDispatchResult>;
  interrupt(
    handle: AgentRuntimeHandle,
    activeTurnRef: string,
  ): Promise<ProviderLifecycleSnapshot>;
  stop(handle: AgentRuntimeHandle): Promise<void>;
}
```

`observeSession` must not start a model turn. `openForDispatch` rejects on a
definite bootstrap failure and does not publish an active handle to
`ThreadRecord` before returning successfully. Capability/command discovery uses
its existing handshake-only probe and is not a chat-session open path.

### Structured event spine

```ts
type StructuredProviderEvent =
  | {
      kind: "lifecycle_observed";
      snapshot: ProviderLifecycleSnapshot;
    }
  | {
      kind: "delivery_acknowledged";
      deliveryId: string;
      providerMessageRef?: string;
      providerTurnRef?: string;
      ackKind: string;
    }
  | {
      kind: "turn_started";
      providerTurnRef?: string;
      deliveryId?: string;
    }
  | {
      kind: "turn_completed";
      providerTurnRef?: string;
      deliveryId?: string;
      status: NormalizedTerminalStatus;
      nativeStatus?: string;
      notice?: string;
      usage?: StructuredUsagePayload;
    }
  | /* existing content/prompt/config/activity events */;
```

### Persisted Tide metadata

`thread.json` gains a storage-versioned, bounded lifecycle checkpoint and
delivery ledger. It does not persist raw provider content.

Only non-terminal deliveries and a small terminal correlation tail need to be
kept. Migration from current records:

- preserve provider session reference and queue;
- set remembered `running/starting/waiting_*` without a live runtime to
  `unknown` pending reconciliation, not immediately to completed;
- create no accepted delivery entry for legacy optimistic user blocks;
- rebuild conversation from provider history, then remove unmatched local
  optimistic blocks or mark them `indeterminate` with visible recovery action.

## Provider mappings

### Codex

Bootstrap/resume:

1. initialize;
2. `thread/start` or `thread/resume`;
3. consume returned `Thread.status` and `turns`;
4. when recovery evidence is incomplete, call
   `thread/read {includeTurns:true}`;
5. if non-active thread history contains `inProgress`, trust app-server's
   reconstructed `interrupted` status;
6. return ready only when status allows a new turn.

Dispatch:

- send `deliveryId` as `clientUserMessageId`;
- resolve accepted on successful `turn/start` response and record turn ID;
- correlate later user item `clientId` and `turn/completed`;
- preserve `completed/interrupted/failed`;
- request deadline failure triggers `thread/read`, not immediate resend.

### Claude

Launch:

- add `--replay-user-messages`;
- send `deliveryId` as user-frame `uuid`;
- treat the echoed user frame with matching UUID as acknowledgement;
- treat `result` as terminal and normalize aborted streaming to `interrupted`;
- retain provider subtype and terminal reason.

Resume:

1. rebuild transcript before launching;
2. classify a prior Tide-owned live episode with no terminal evidence as
   interrupted/indeterminate;
3. launch exactly one `--resume <session-id>` process inside
   `openForDispatch`;
4. send the already-ledgered first delivery with its UUID;
5. require `system/init` to confirm the same session ID and the matching replay
   frame to acknowledge the delivery before publishing the handle;
6. fail or mark indeterminate if session identity and delivery evidence do not
   arrive by their protocol deadlines.

The user's message is allowed to unlock Claude init only because it entered the
delivery ledger before process launch. There is no untracked bootstrap prompt.

### OpenCode ACP

History and runtime attach are separate:

- rebuild visible history with bounded `opencode export` before runtime launch;
- use `session/resume` for ordinary runtime reattachment after history is
  already available;
- use `session/load` only when ACP replay is deliberately selected as the
  history source, deduplicating by provider message IDs.

Dispatch:

- send `deliveryId` as ACP `messageId`;
- preserve `userMessageId` and `stopReason` from the prompt response;
- because OpenCode 1.18.2 acknowledges only at terminal response, represent the
  running interval as `working-unconfirmed` unless a native user-message update
  or history observation proves storage;
- do not claim idempotency;
- normalize `end_turn`, `cancelled`, `max_tokens`, `refusal`, and request error
  without flattening them.

## Flows

### Open or resume a thread

1. Load Tide metadata and cached render blocks.
2. Read/rebuild provider-owned history without starting a turn.
3. Reconcile local blocks and delivery entries by native IDs/cursors.
4. If no runtime is needed, render the reconciled idle/unknown snapshot.
5. On first send, start/resume the provider and await its handshake.
6. Compare the handshake snapshot again; provider terminal/active evidence wins
   over stale Tide `lastKnownState`.
7. Enable Composer only when `canAcceptTurn` or a deliberate queue path exists.

### Send while idle

1. Mint delivery UUID and persist `queued` entry.
2. Show pending local bubble.
3. Atomically move ledger `queued → dispatching` and remove it from the
   application queue.
4. If there is no live runtime, call `openForDispatch` once; otherwise call
   `dispatch` once.
5. Await provider session and delivery evidence from that operation.
6. On acknowledgement, move to `accepted/running`, reconcile the user block,
   and mark thread active.
7. On terminal event, store exact outcome, rebuild/finalize provider blocks,
   and move thread idle or waiting as observed.

### Queue while busy

1. Mint UUID and append only to the application queue/ledger.
2. Do not call the adapter.
3. Terminal event settles the current delivery.
4. Re-observe lifecycle.
5. Dispatch exactly the next UUID once if provider is ready.

### Interrupt

1. Require the observed active provider turn/session reference.
2. Send provider-native interrupt/cancel.
3. Await terminal evidence or observe after deadline.
4. Preserve interrupted/cancelled status.
5. Only then dispatch the next queued delivery.

### Process exit or app restart

1. Process exit is runtime ownership loss, not automatic provider turn success.
2. Mark unresolved dispatches `indeterminate` and persist.
3. Rebuild/read provider history and lifecycle.
4. Settle matched delivery IDs and native turns.
5. If provider history proves absence and retry is safe, retry with the same
   UUID; otherwise surface explicit retry/possible-duplicate choice.
6. Never leave `running` solely because Tide metadata said so before restart.

## Invariants

1. Provider history is never mutated by reconciliation.
2. A remembered Tide active state without current provider evidence cannot show
   an indefinite Working spinner.
3. One delivery UUID is dispatched at most once concurrently.
4. Only the application service owns undispatched FIFO entries.
5. A runtime handle is visible to the service only after successful provider
   adoption and evidence for the tracked first delivery.
6. Every active turn shown by Tide has provider evidence and, when supported, a
   provider turn reference.
7. Every terminal event preserves normalized and native status.
8. `runtime_exited` never means `completed` by itself.
9. An OS pipe write is not a provider acknowledgement.
10. Automatic retry never broadens a provider's proven idempotency guarantee.
11. Provider history blocks replace or reconcile optimistic user blocks by
    delivery/native ID, never by text equality.
12. Opening a Thread is side-effect-free with respect to starting a model turn.

## Implementation plan

### Slice 1 — lifecycle and delivery contracts

- Add provider lifecycle snapshot, delivery UUID/state, native terminal status,
  and capability types.
- Extend structured events and native evidence without changing runtime control
  yet.
- Preserve old event decoding for one storage version during migration.

Primary locations:

- `application/domains/agent-runtime/agent-runtime.ts`;
- `application/domains/thread/thread.ts`;
- `application/ports/outbound/agent-runtime-port.ts`;
- `adapters/outbound/agent-runtime/structured/structured-runtime-events.ts`;
- `adapters/outbound/agent-runtime/reducers/structured-native-reducer.ts`;
- shared thread/runtime event contracts.

### Slice 2 — side-effect-free observation and atomic open-for-dispatch

- Add `observeSession` and `openForDispatch`; keep transport construction private
  until the latter resolves.
- Make runtime port publish/register a handle only after provider adoption and
  first-delivery evidence.
- Implement Codex `thread/read`, Claude transcript observation, and OpenCode
  export/ACP resume snapshots.
- Add request deadlines and cleanup pending callback maps on exit.

### Slice 3 — stable delivery identity and acknowledgement

- Mint UUID in `ComposerQueueService` and persist it in `PendingInput`.
- Pass UUID through `TerminalInput`/dispatch.
- Wire Codex `clientUserMessageId`, Claude `uuid` + replay flag, and ACP
  `messageId`/`userMessageId`.
- Reconcile optimistic blocks by IDs.

### Slice 4 — transactional send and one queue owner

- Replace adapter queues with one in-flight dispatch state.
- Move `running` and durable user-block promotion after acknowledgement/evidence.
- Roll back to queued or indeterminate on bootstrap/dispatch failure.
- Keep Codex steer only behind an explicit product/capability path.

### Slice 5 — terminal fidelity and recovery

- Preserve provider turn IDs and terminal statuses through projector/service/UI.
- Reconcile on hydrate/resume and on watchdog deadline.
- Migrate stale legacy `running` records.
- Add `indeterminate` recovery actions and duplicate-send warning.

### Slice 6 — end-to-end provider parity verification

- Add exact-version fake protocol fixtures and opt-in real CLI smokes.
- Verify start, multi-turn, queue, interrupt, crash between write/ack, restart,
  resume, failure, and branch for each provider.
- Remove legacy hydrate-only active→idle repair once reconciliation owns the
  transition.

Each slice must land with its contracts and tests; do not ship Slice 4 before
Slices 1–3 provide durable identity and bootstrap evidence.

## Tests

### Contract/unit

- terminal normalization preserves every provider-native status;
- lifecycle snapshots round-trip through persistence;
- legacy running metadata migrates to unknown/reconcile-required;
- delivery state transitions reject double dispatch and illegal terminal→active
  transitions;
- queue promotion is UUID-based, never text-based.

### Codex adapter

- resume consumes `thread.status` and reconstructed turns;
- stale in-progress history becomes interrupted;
- start response acknowledges delivery with turn ID;
- client message ID appears on turn/start and steer;
- request deadline calls observe/read and clears callbacks;
- interrupted and failed terminal statuses remain distinct.

### Claude adapter

- launch includes `--replay-user-messages`;
- user input includes stable UUID;
- matching replay frame acknowledges delivery;
- duplicate UUID replay does not create a second delivery;
- aborted result maps to interrupted;
- process exit before result yields indeterminate, then transcript reconciliation
  settles it.

### OpenCode ACP adapter

- normal resume uses the chosen resume/load strategy intentionally;
- prompt includes UUID and final response captures `userMessageId`;
- every stop reason remains distinct;
- cancel waits for cancelled response or reconciliation deadline;
- load replay deduplicates message IDs;
- request maps are emptied on timeout/exit.

### Application/service

- no local user block is promoted to accepted before provider evidence;
- failed bootstrap keeps queued delivery recoverable;
- one terminal event dispatches exactly one queued UUID;
- restart of a remembered running thread reconciles before enabling Composer;
- runtime exit never records completed without terminal evidence;
- unknown acceptance never auto-retries on Codex/OpenCode.

### Incident regression

Fixture the lifecycle shape of
`019f75a1-0128-7fd3-b759-68f17d3e2182`:

- Tide metadata begins `running` with two unmatched optimistic bubbles;
- Codex read returns completed + interrupted + interrupted, status not loaded;
- hydrate/reconcile ends idle, removes Working, preserves provider history, and
  marks unmatched legacy deliveries indeterminate rather than pretending they
  are active;
- restart produces the same result.

### Opt-in real-provider smoke

For each pinned provider:

1. create session and send UUID A;
2. observe acknowledgement and terminal state;
3. queue UUID B, interrupt A, and verify B dispatches once;
4. kill Tide after dispatch but before terminal notification;
5. restart, reconcile provider history, and verify no duplicate B;
6. resume and send UUID C into the same provider session;
7. branch/fork where supported and verify original history is unchanged.

## Completion definition

This work is complete only when:

- the incident fixture and real Codex session no longer remain Working after
  restart;
- all three providers use stable delivery IDs;
- runtime resume is an awaited, observable open-for-dispatch operation;
- exact terminal outcomes survive to persisted Tide state and UI;
- no adapter owns a hidden second Composer queue;
- lost responses produce bounded indeterminate recovery rather than an infinite
  spinner;
- provider history can rebuild the visible conversation without Tide-owned raw
  chat storage;
- real multi-turn restart smokes prove that a follow-up is neither lost nor
  duplicated for Codex, Claude, and OpenCode.

## Documentation cleanup after implementation

- Mark the hidden-PTY sections of `master-plan.md` as superseded by structured
  runtimes; do not leave two active transport descriptions.
- Update `glossary.md` Product→Implementation mapping that still says Agent
  Runtime is a hidden PTY.
- Amend `persistence.md` with lifecycle checkpoint and delivery-ledger
  boundaries.
- Update `structured-agent-runtime.md` to reference this lifecycle contract.
