# Spec: Backend-Owned Process Lifecycle

## Status

Implemented for Backend-owned long-lived processes on 2026-07-19. The shared
registry/spawner, provider-native pre-signal hooks, OpenCode helper leases,
graceful Main -> Backend shutdown, exact crash manifests, LSP/PTY migration,
and architecture gates are in-tree. Bounded one-shot command consolidation is
a follow-up boundary, not part of the long-lived leak recurrence gate.

## Scope

Define one lifecycle for every long-lived child process owned by the Tide
Backend while preserving provider-native protocol behavior inside each
adapter.

This slice covers:

- Codex app-server runtimes;
- Claude Code stream-json runtimes;
- OpenCode ACP runtimes;
- the OpenCode HTTP auth/catalog helper;
- command-discovery probe runtimes;
- Backend-owned language servers and Workbench terminal processes;
- graceful Desktop Main -> Backend shutdown;
- hard-crash and force-quit orphan recovery.

It also defines the boundary for bounded one-shot commands. It does not change
conversation history ownership, provider session identity, turn semantics, or
the provider-authoritative recovery model.

## Incident

On 2026-07-19 the local machine had 38 processes matching:

```text
opencode serve --port 0 --hostname 127.0.0.1
```

37 had `PPID 1`. Their sampled aggregate was about 8.3 GiB RSS and 30.5% CPU.
The one non-orphan belonged to the current Backend. Restarting Tide repeatedly
created one more server because startup catalog preload asks
`ProviderDetection` for OpenCode provider options.

The leak is structural:

1. `createProviderDetection()` creates a closure-owned `OpencodeAuthServer`.
2. Its first request lazily spawns `opencode serve`.
3. `ProviderDetection` exposes no shutdown/dispose method.
4. `live-backend.shutdown()` flushes persistence and closes/removes MCP
   artifacts, but does not stop provider runtimes or helpers.
5. production `electron-main.ts` calls `backendProcess?.kill()` directly from
   `before-quit` instead of using the already-designed graceful supervisor.
6. the orphan reaper recognizes only `TIDE_RUNTIME_ID`, while this helper is
   not a Thread runtime and carries no such tag.

Adding one `opencodeAuthServer.stop()` call would close only the clean-exit
path. It would leave the same ownership gap for force quit, future provider
helpers, LSPs, terminals, and any spawn path added later.

## Evidence Boundary

This design is based on the exact locally installed provider builds and the
current Tide source, not on UI similarity.

| Surface | Version/evidence | Observed process shape |
| --- | --- | --- |
| Codex | `codex-cli 0.144.4`; `codex app-server --help`; `codex-app-server-client.ts` | one persistent `codex app-server` child over stdio; Tide holds `ChildProcess`, `pid`, pending protocol callbacks, and `stop()` |
| Claude Code | `2.1.202`; `claude --help`; `claude-stream-json-client.ts` | one persistent `claude --print --input-format stream-json --output-format stream-json` child; Tide owns stdin/stdout and permission/config state |
| OpenCode runtime | `1.18.2`; `opencode acp --help`; `acp-client.ts` | one persistent `opencode acp` child; Tide owns ACP JSON-RPC callbacks and the session/prompt lifecycle |
| OpenCode helper | `1.18.2`; `opencode serve --help`; `opencode-auth-server.ts` | one lazily spawned headless HTTP server cached in a closure; currently not connected to Backend shutdown |
| Tide runtime port | `agent-integration-agent-runtime-port.ts` | all three provider clients are stored in one `Map<runtimeId, StructuredRuntimeState>` and already implement `StructuredRuntimeClient { stop(), pid }` |
| Desktop/Backend | `electron-main.ts`, `backend-process-supervisor.ts`, `backend-entrypoint.ts`, `live-backend.ts` | a graceful supervisor abstraction exists in tests, but production quit sends a raw kill; Backend shutdown does not enumerate children |
| Existing recovery | `reap-orphaned-agents.ts`, `agent-reaper-guardian.ts` | scans orphaned processes for `TIDE_RUNTIME_ID`; it cannot identify backend-scoped helpers and treats a routing env value as ownership proof |

Provider conversation semantics remain grounded in
`research/provider-conversation-lifecycle-evidence.md`. In particular, session
IDs and turn status are conversation evidence, not process ownership IDs.

## Provider Parity Finding

All three supported agents fit the same **process ownership** structure.
They do not fit one generic **provider protocol** implementation.

| Concern | Common rule | Vendor-specific behavior retained |
| --- | --- | --- |
| Spawn ownership | Backend creates and registers exactly one owned process before exposing a runtime handle | command, args, env projection, transport framing, and readiness handshake |
| Runtime identity | process resource binds to `backendInstanceId`, `resourceId`, and optional Thread/runtime scope | Codex thread ID, Claude session UUID, and OpenCode session ID remain provider session refs |
| Turn interrupt | runtime stays alive after a turn-level interrupt | Codex `turn/interrupt`; Claude control request; ACP `session/cancel` |
| Graceful preparation | adapter settles its own callbacks/prompts before the child is signalled | Codex clears tool/request state; Claude denies pending permissions and ends stdin; ACP clears pending responses; future adapters may have a native shutdown RPC |
| Exit escalation | common supervisor waits, sends TERM, waits, sends KILL, and observes exit | grace callback and timing class may differ by resource kind |
| Crash cleanup | owner manifest and guardian target the exact owned process tree | no provider-specific orphan scanner |
| Conversation recovery | process death is surfaced and provider history is reconciled | Codex read/resume, Claude transcript, and OpenCode export/ACP remain distinct |

Therefore the correct abstraction is not `GenericAgentClient`. It is an
`OwnedProcessSpawner` plus provider-supplied lifecycle hooks. A future agent can
join only by supplying its native transport client and satisfying this common
ownership contract.

### New provider admission rule

A future provider-CLI integration fits this structure when it can declare:

1. every process Tide launches for one runtime, including sidecars;
2. the readiness point after which the runtime handle is safe to publish;
3. its provider-native turn interrupt behavior;
4. the adapter cleanup required before OS signalling;
5. which process tree Tide owns and may terminate;
6. how exit is observed and converted to native/runtime evidence;
7. how provider history is reconciled after process loss.

A provider that launches two cooperating children registers two process
resources under one runtime scope; it does not hide the sidecar behind one PID.
A remote service or an already-running user daemon that Tide did not launch is
an external endpoint resource, not an owned process, and must never be reaped by
this registry. This keeps the lifecycle reusable without falsely claiming that
all future agent architectures are subprocesses.

## Decisions

### D1. One Backend resource registry is authoritative

Generalize the draft `AgentResourceRegistry` from `agent-resource-model.md` into
one Backend in-memory `BackendResourceRegistry`. Runtime-scoped agent resources
and backend/workspace/pane-scoped helpers use the same state machine. Do not add
a second process list next to the runtime port.

The registry stores operational ownership metadata and live handles. It is not
golden conversation data and is never used to reconstruct chat history.

### D2. Every long-lived child is spawned through one owned spawner

Direct `spawn()` of a long-lived child is forbidden outside the process
lifecycle infrastructure and its guardian entrypoint. `OwnedProcessSpawner`
must:

1. allocate a resource ID and owner token;
2. record `planned` before spawn;
3. spawn the child in a dedicated process group where supported;
4. synchronously bind PID/process-group identity before returning control;
5. attach exit/error observation;
6. return a managed handle whose `stop()` resolves only after observed exit or
   an explicit `indeterminate` result.

An architecture test maintains the small allowlist of raw spawn sites.

### D3. Process ownership is independent of runtime identity

`TIDE_RUNTIME_ID` routes runtime/MCP traffic. It is not proof that a process is
owned, because child commands inherit environment variables and backend-scoped
helpers have no runtime ID.

Owned process identity uses:

```ts
interface OwnedProcessIdentity {
  backendInstanceId: string;
  resourceId: string;
  ownerToken: string;
  kind:
    | "agent_runtime"
    | "provider_helper"
    | "command_probe"
    | "language_server"
    | "workbench_terminal";
  scope: BackendResourceScope;
}

type BackendResourceScope =
  | { kind: "backend" }
  | { kind: "runtime"; threadId: string; runtimeId: string; agentId: ProviderCliAgentId }
  | { kind: "workspace"; cwd: string }
  | { kind: "pane"; threadId: string; paneId: string }
  | { kind: "operation"; operationId: string };
```

The owner token is non-secret collision-resistant evidence. A new Backend must
strip inherited process-owner values and must never adopt an old process from
ambient env.

### D4. Common escalation wraps vendor-specific graceful hooks

The adapter owns protocol cleanup; the supervisor owns OS termination and
deadlines.

```ts
interface OwnedProcessStopHooks {
  beforeSignal?: (reason: StopReason) => Promise<void>;
}

interface ManagedOwnedProcess {
  readonly identity: OwnedProcessIdentity;
  readonly pid: number;
  readonly exited: Promise<ProcessExit>;
  stop(reason: StopReason): Promise<ProcessStopReport>;
}
```

`beforeSignal` may settle pending provider callbacks, send a protocol shutdown,
deny an open permission, cancel timers, or close stdin. It must not create its
own detached `setTimeout(SIGKILL)` path. The common supervisor then performs:

1. transition `active -> stopping` atomically;
2. run `beforeSignal` within its bounded grace window;
3. wait briefly for natural exit/EOF;
4. send `SIGTERM` to the owned group and wait;
5. send `SIGKILL` to survivors and wait for the exit observation;
6. record `released`, `failed`, or `indeterminate` with evidence.

Concurrent calls share one stop promise. An exit racing with stop is a normal,
idempotent release.

### D5. Registration and exit are event-driven

The process `exit`/`error` observation updates the same registry entry used by
shutdown. Provider `runtime_exited` remains a normalized runtime event, but it
is not a second process lifecycle authority.

A provider runtime is inserted into the runtime map only after its readiness
handshake. Its process is registered earlier, immediately at spawn. If readiness
fails, the managed handle is stopped and awaited before the error returns.

### D6. OpenCode auth/catalog server is a leased backend resource

The OpenCode HTTP server is not a Thread runtime. Register it as:

```text
kind = provider_helper
scope = backend
provider = opencode
```

`OpencodeAuthServer` becomes an async disposable lease owner:

- concurrent API requests share one start promise and one process;
- an active request holds a lease;
- the last released lease starts an injected-clock idle timer;
- after 30 seconds idle, the managed process is stopped and awaited;
- a later request starts a new helper;
- child exit rejects/reset in-flight state deterministically;
- Backend shutdown cancels the timer, rejects new leases, waits for current
  requests within the shutdown deadline, then stops the helper;
- catalog preload may warm the helper but may not pin a permanent lease.

The 30-second value is one named policy constant with fake-clock tests, not a
magic timer scattered through provider code.

### D7. Production app quit uses the real graceful control path

Wire production `electron-main.ts` through the supervisor behavior already
specified and unit-tested in `backend-process-supervisor.ts`. Do not leave a
test-only graceful abstraction next to a raw production kill.

Main and Backend use a private control-plane exchange:

```ts
type BackendControlMessage =
  | { kind: "backend.shutdown.request"; requestId: string; reason: ShutdownReason; deadlineAt: string }
  | { kind: "backend.shutdown.complete"; requestId: string; report: BackendShutdownReport };
```

It is not a Renderer chat command. Main prevents the first quit, closes new
Renderer ingress, sends the request, waits for acknowledgement/Backend exit,
then continues app quit. A second quit request does not start a second shutdown.
If the deadline expires, Main terminates Backend and relies on the guardian.

`SIGTERM`/`SIGINT` in the Backend call the same `BackendShutdownCoordinator`.
They are not a separate cleanup implementation.

### D8. Shutdown order preserves final events and dependencies

Backend shutdown is one idempotent state machine:

```text
accepting
  -> quiescing (reject new process starts and new commands)
  -> stopping producers/resources
  -> flushing persistence
  -> closing MCP/socket/artifacts
  -> complete
```

Required order:

1. stop accepting new runtime/helper/terminal/LSP starts;
2. cancel startup probes and provider-catalog work;
3. stop active agent runtimes and provider helpers with `allSettled`;
4. stop language servers and Workbench terminal process trees;
5. ingest any final runtime-exit/turn events;
6. flush pending conversation/cache persistence;
7. close the Tide MCP socket only after provider runtimes are down;
8. remove owned runtime artifacts;
9. write the final empty/released owner manifest and acknowledge Main.

One resource failure is recorded but does not skip cleanup of later resources.
The Backend-wide deadline bounds the whole sequence.

### D9. Hard-crash recovery uses exact owner manifests

Replace broad `ps` cleanup based only on `TIDE_RUNTIME_ID` with an owner-scoped,
secret-free process manifest under the Backend runtime artifact directory.

Each active entry contains:

- backend instance ID and resource ID;
- random owner token;
- direct PID and process group ID where supported;
- random per-spawn owner token, used as the process birth fingerprint;
- expected executable identity;
- tree cleanup policy;
- lifecycle state and last update timestamp.

Writes are atomic. The guardian already launched for that Backend watches its
owner PID. After the owner dies it reads only that owner's manifest, validates
PID birth/executable/token evidence, and terminates matching active groups.
PID alone is never enough. A live Backend's manifest is never reaped.

For the narrow spawn-before-PID-bind crash window, the pre-recorded owner token
allows the guardian to locate the just-spawned process group. The token may be
inherited by descendants, so it identifies the owned group, not an arbitrary
single process. New Backend launch sanitization prevents inherited tokens from
becoming owner input.

On macOS/Linux, group signalling is the initial strategy. On Windows, the
common interface remains but hard-crash tree ownership requires a Job Object
implementation before Windows can claim the same guarantee; until then the
guardian is a documented no-op rather than an unsafe process-name kill.

### D10. Tree policy is explicit

Every spawn declares one policy:

- `owned_tree`: provider runtime, provider helper, LSP, and Workbench terminal;
  stop the owned process group so grandchildren do not survive the surface
  that created them.
- `root_only`: only for a reviewed command whose descendants are intentionally
  independent.
- `detached_guardian`: only the Tide guardian itself; it is never registered as
  a reapable child of the Backend it watches.

Provider/runtime code cannot silently choose `detached` or `unref`.

### D11. One-shot commands use a bounded owned runner

Catalog/version/export/git commands that are expected to exit use
`OwnedCommandRunner`, with timeout, abort-on-shutdown, output bounds, and an
operation-scoped diagnostic record. They do not occupy the long-lived registry
after completion.

Synchronous probes are not orphan risks but block Backend command delivery.
They remain on an explicit allowlist and should be migrated off critical paths.

### D12. Legacy untagged OpenCode servers are not auto-killed

The 37 existing orphans predate the new owner manifest. Automatic cleanup must
not guess ownership from executable name alone. A separate explicit maintenance
action may show the exact candidates and ask the user before terminating them.
New code prevents recurrence; it does not silently kill unrelated user servers.

## Domain Model

```ts
type BackendResourceState =
  | "planned"
  | "spawning"
  | "active"
  | "stopping"
  | "released"
  | "failed"
  | "indeterminate";

interface BackendProcessResource {
  identity: OwnedProcessIdentity;
  state: BackendResourceState;
  executable: string;
  pid?: number;
  processGroupId?: number;
  birthFingerprint?: string;
  treePolicy: "owned_tree" | "root_only" | "detached_guardian";
  createdAt: string;
  updatedAt: string;
  exit?: ProcessExit;
  failure?: { code: string; message: string };
}

interface BackendResourceRegistry {
  plan(resource: BackendProcessResource): void;
  bindProcess(resourceId: string, binding: ProcessBinding): void;
  markStopping(resourceId: string): void;
  markExited(resourceId: string, exit: ProcessExit): void;
  markIndeterminate(resourceId: string, failure: ResourceFailure): void;
  active(scope?: BackendResourceScope): readonly BackendProcessResource[];
  shutdown(reason: ShutdownReason, deadline: number): Promise<ProcessStopReport[]>;
}
```

Only immutable diagnostics or crash-recovery manifest fields cross persistence.
`ChildProcess`, stream objects, callbacks, and stop promises remain in memory.

## Failure Semantics

| Failure | Required result |
| --- | --- |
| spawn throws or emits error | resource becomes `failed`; no runtime handle is published |
| readiness handshake fails | managed process is stopped and awaited; start/resume rejects |
| provider exits while idle | registry releases process; runtime emits `runtime_exited`; conversation state reconciles separately |
| provider exits during turn | same process release plus provider-authoritative delivery/turn recovery; never invent completion |
| graceful hook hangs | hook deadline expires and common TERM/KILL escalation continues |
| TERM ignored | KILL group, await exit, report escalation |
| KILL cannot be confirmed | resource becomes `indeterminate`; shutdown report and owner manifest retain evidence for guardian/startup recovery |
| Backend is SIGKILLed | guardian validates owner manifest and kills only matching active groups |
| guardian dies too | next Backend startup processes stale manifests with the same owner-dead and process-identity checks |
| PID reused | birth/executable/token mismatch causes safe refusal and a diagnostic, never a kill |
| shutdown called twice | all callers await the same coordinator promise |
| helper request races idle timer | lease acquisition cancels timer before use; timer checks lease generation before stop |

## Invariants

1. No supported provider runtime is launched through a generic provider
   protocol fallback.
2. Every long-lived Backend child has exactly one registered owner before its
   handle is visible outside the spawner.
3. Codex, Claude, and OpenCode share process supervision, not protocol logic.
4. A process resource ID is not a provider session ID or Thread ID.
5. Turn interrupt never substitutes for process stop, and process stop never
   invents a provider turn outcome.
6. `stop()` resolves after exit evidence or returns `indeterminate`; scheduling
   a kill timer is not completion.
7. Backend shutdown prevents new spawns before enumerating resources.
8. Provider runtimes stop before the MCP endpoint they may still use.
9. One cleanup failure cannot skip remaining resources or persistence flush.
10. Reaping requires dead-owner evidence plus exact process identity; process
    name, PID, PPID, or `TIDE_RUNTIME_ID` alone is insufficient.
11. Provider/user auth, config, transcript, session, and history files are never
    deleted by process cleanup.
12. Owner manifests contain no credentials, prompt text, command output, or
    inherited environment dump.
13. The detached guardian is the only intentional Backend-surviving child.
14. Production Main and tests exercise the same graceful shutdown path.
15. Adding a new raw long-lived spawn fails architecture tests.

## Tests

### Registry and spawner

- state transitions are legal and monotonic;
- spawn error leaves no active entry;
- exit-before-bind and exit-during-stop races settle exactly once;
- concurrent stop calls share one result;
- graceful exit, TERM escalation, KILL escalation, and indeterminate exit are
  deterministic under fake clocks/processes;
- shutdown rejects a new registration after quiescing;
- `allSettled` cleanup records one failure and continues others;
- manifest writes redact env/args that may contain secrets.

### Provider parity contract

Run the same ownership suite against factories for all three transports:

- Codex `codex_app_server` registers runtime scope and clears pending protocol
  work in `beforeSignal`;
- Claude `claude_stream_json` denies pending permissions, closes stdin, and then
  uses common escalation;
- OpenCode `acp` clears ACP requests and then uses common escalation;
- each publishes a runtime handle only after readiness;
- each exit removes the same registry entry and emits one runtime exit;
- vendor-specific interrupt messages remain unchanged;
- no adapter contains a private delayed SIGKILL timer.

### OpenCode helper

- 20 concurrent catalog/auth requests spawn one server;
- every request releases its lease on success and failure;
- idle expiry stops and awaits the server;
- a new request before expiry cancels the stale timer generation;
- helper crash resets URL/start state and the next request can restart;
- Backend shutdown stops the helper even when catalog preload started it;
- helper never receives a fake Thread/runtime identity.

### Desktop/Backend integration

- real production bridge sends shutdown request and waits for completion;
- runtime exit events are ingested before persistence flush;
- MCP socket closes after provider runtimes;
- timeout invokes Backend terminate exactly once;
- SIGTERM uses the same coordinator as control-plane shutdown;
- update/relaunch, normal quit, window close on non-macOS, and second quit all
  converge on the same state machine.

### Crash recovery and safety

- guardian reaps Codex, Claude, OpenCode ACP, OpenCode helper, LSP, and terminal
  fixtures from a dead-owner manifest;
- guardian refuses a live owner, reused PID without the exact token,
  executable mismatch, or token mismatch;
- startup recovery handles a stale manifest when no guardian survived;
- an unrelated user-run `opencode serve` with no matching manifest is untouched;
- a descendant that inherited `TIDE_RUNTIME_ID` but is outside the recorded
  owned group is untouched;
- process-group cleanup removes a fixture grandchild;
- 20 Backend restart cycles return the count of Tide-owned provider/helper
  processes to zero after each cycle.

### Architecture gates

- raw long-lived `spawn`/`fork` calls exist only in the owned spawner and
  guardian implementation;
- provider adapters depend on the owned spawner and do not import ad-hoc
  process cleanup utilities;
- production `electron-main.ts` does not call `backendProcess.kill()` on the
  normal quit path;
- Backend shutdown enumerates the common registry, not provider-name branches.

## Implementation Slices

### Slice 1: Pin the incident and introduce the registry

- add fake-process registry/spawner tests;
- add the spawn-site architecture inventory;
- implement `BackendResourceRegistry`, `OwnedProcessSpawner`, and injected
  clocks/deadlines without changing provider behavior;
- extend the existing Agent Resource Model rather than maintaining two stores.

### Slice 2: Migrate the three structured runtimes and probes

- inject the spawner into Codex, Claude, and ACP clients;
- move OS escalation out of adapter `stop()` methods;
- register before readiness and await release on every failure path;
- add `stopAll()`/shutdown ownership at the runtime-port boundary;
- migrate command probes through operation/runtime scope.

### Slice 3: Fix OpenCode helper ownership

- make `ProviderDetection` async-disposable;
- add leased `OpencodeAuthServer` lifecycle and idle expiry;
- include provider detection in Backend shutdown;
- prove startup catalog preload cannot leave a helper after shutdown.

This slice fixes recurrence of the observed leak on clean shutdown, but it is
not released alone without Slice 4 crash coverage.

### Slice 4: Wire graceful Main/Backend shutdown and guardian manifests

- add private shutdown request/ack transport;
- route production quit and Backend signals through one coordinator;
- write exact owner manifests and update the guardian/startup reaper;
- retain bounded force-terminate fallback;
- remove `TIDE_RUNTIME_ID` as cleanup authority.

### Slice 5: Migrate other Backend children

- LSP clients;
- Workbench PTY bridge/process group;
- keep bounded catalog/version/export runners outside the long-lived registry;
- consolidate those runners behind a separate bounded-command abstraction in
  follow-up work, with an explicit synchronous/one-shot allowlist meanwhile.

### Slice 6: Release gate and optional legacy cleanup

- run unit, architecture, real-provider smoke, packaged quit, force-quit, and
  20-cycle restart tests;
- verify zero new Tide-owned orphans after every scenario;
- expose an explicit diagnostic/maintenance action for pre-manifest legacy
  OpenCode servers if desired; never perform name-only automatic cleanup.

## Completion Definition

This work is complete only when:

1. Codex, Claude, and OpenCode runtime clients pass the same ownership contract
   tests while retaining their native protocol tests.
2. OpenCode catalog preload and API-key connection leave no helper after idle
   expiry or Backend shutdown.
3. normal quit waits for Backend child cleanup and persistence flush.
4. force quit/crash is recovered by exact owner identity without touching an
   unrelated process.
5. 20 repeated Backend start/quit cycles produce zero net owned processes.
6. every long-lived Backend child appears in registry diagnostics and the raw
   spawn architecture gate is green.
7. chat history and provider session recovery tests remain unchanged except for
   honest runtime-exit evidence; no process cleanup path mutates golden
   conversation data.

## Relationship To Existing Specs

- `agent-resource-model.md` remains the broader resource model. This spec is
  authoritative for its process resource state, live handles, and cleanup.
- `agent-runtime-process-ownership.md` remains authoritative for App -> Backend
  -> provider -> MCP connection ownership. This spec adds lifecycle and crash
  reclamation to that ownership.
- `structured-agent-runtime.md` remains authoritative for provider protocols.
- `provider-authoritative-conversation-lifecycle.md` remains authoritative for
  history, delivery acknowledgement, turn status, and resume reconciliation.
- `backend-desktop-process-connection.md` remains authoritative for the
  Main/Backend process boundary; its graceful shutdown requirement must be wired
  into production by this slice.

## Out Of Scope

- inventing one shared conversation/session protocol;
- changing provider-owned auth, config, transcript, rollout, or session stores;
- adopting processes started outside Tide;
- automatically killing legacy processes by command name;
- claiming Windows hard-crash tree guarantees before a Job Object owner exists;
- preserving a provider runtime across Backend restart.
