# Spec: ThreadRuntimeService Decomposition

The structural-simplicity goal ("구조적으로 심플") requires breaking the
`ThreadRuntimeService` god-class. Leaf-helper extraction is done (8 modules,
service 4536→3869). What remains is the class itself: 21 public + 35 private
methods over one shared `this.threads` map. This spec designs the split PRECISELY
before any method moves, so the surgery is clean, not a makeshift hack.

## Scope

Design-only. Defines the target collaborators, the shared-state ownership, the
facade contract, the migration order, and the test gate. No method is moved in
this spec; it is the contract the migration slices follow.

## Evidence (current shape)

- `ThreadRuntimeService` (class, ~3000 lines) holds: `threads: Map<ThreadId,
  ThreadRecord>` (the only mutable shared state), 14 outbound ports
  (`agentRuntimePort`, `providerReadinessPort`, `ptyTranscriptPort`,
  `providerSetupSurfaceTerminalPort`, `workbenchTerminalPort`,
  `workspaceCommandPort`, `workspaceFilePort`, `workspaceCodeIntelligencePort`,
  `composerAttachmentStorePort`, `providerTrustPort`), `clock`, `idGenerator`,
  `onAsyncEvent`, plus `ensureScratchDirectory`.
- Every public method begins `const thread = this.threads.get(input.threadId)`.
- Two methods dominate: `handleWorkbenchCommand` (~530 lines) and
  `handleTideMcpToolCall` (~870 lines). Together they are ~half the class.
- Public methods group cleanly by responsibility (below).

## Responsibility Groups

| Group | Public methods |
|-------|----------------|
| Thread store / list | `restoreThreads`, `listThreads`, `archiveThread`, `setThreadPinned`, `renameThread`, `hydrateThread` |
| Runtime lifecycle | `startThread`, `sendComposerInput`, `editPendingInput`, `answerPrompt`, `recordProviderPromptState`, `recordProviderSessionRef`, `recordAgentSessionBlock`, `resumeAgentRuntime`, `stopAgentRuntime`, `recordTurnComplete`, `appendRawAgentFrame`, `trustWorkspace` |
| Workbench commands | `handleWorkbenchCommand`, `readWorkspaceFileTree` |
| Tide MCP tools | `listTideMcpTools`, `handleTideMcpToolCall` |

## Decisions

1. **Shared state lives in a `ThreadStore`.** Extract `threads: Map` plus its
   primitive accessors (`get`, `set`, `values`, `has`) into a small `ThreadStore`
   class. Every collaborator holds the SAME `ThreadStore` instance — state stays
   single-owner, no copies, no divergence. This is the linchpin that makes the
   split safe.

2. **Collaborators are constructor-injected, not inherited.** Each collaborator
   (`WorkbenchCommandHandler`, `TideMcpToolHandler`, and optionally a
   `RuntimeLifecycleCoordinator`) receives `{ store, ...the ports it actually
   needs, clock, idGenerator, onAsyncEvent }`. No collaborator reaches into the
   facade.

3. **`ThreadRuntimeService` becomes a thin facade.** It keeps the SAME public
   interface (the contract Desktop/adapters depend on) and delegates each method
   to the owning collaborator. The public `ThreadRuntimeService` type and
   `createThreadRuntimeService` factory are unchanged — zero ripple to callers,
   adapters, or tests.

4. **Migrate the two giants first.** `TideMcpToolHandler` (handleTideMcpToolCall +
   listTideMcpTools + their private helpers) and `WorkbenchCommandHandler`
   (handleWorkbenchCommand + readWorkspaceFileTree + helpers) are the most
   self-contained and the largest. Moving them first yields the biggest
   simplicity win with the least entanglement, since they mostly read a thread,
   call ports, mutate workbench state, and emit events.

5. **Lifecycle stays in the facade initially.** The lifecycle group shares the
   most cross-method state/flow (queue flush, turn settle, readiness replay).
   Extract it LAST, only after the two giants prove the `ThreadStore` pattern
   holds. Record any unclear lifecycle seam as an open question rather than
   forcing an early split.

## Target Shape

```
services/
  thread-store.ts                 # ThreadStore: owns the threads Map + accessors
  workbench-command-handler.ts    # handleWorkbenchCommand, readWorkspaceFileTree
  tide-mcp-tool-handler.ts        # listTideMcpTools, handleTideMcpToolCall
  thread-runtime-service.ts       # facade: composes store + handlers, delegates
```

Facade composition (illustrative):

```ts
const store = new ThreadStore(seeds);
const mcp = new TideMcpToolHandler({ store, /* ports */ });
const workbench = new WorkbenchCommandHandler({ store, /* ports */ });
// facade method:
handleTideMcpToolCall(input) { return this.mcp.handleToolCall(input); }
```

## Invariants

1. The public `ThreadRuntimeService` interface and `createThreadRuntimeService`
   signature are unchanged. Callers/adapters/tests need no edits.
2. There is exactly one `threads` map for the whole service; all collaborators
   share the one `ThreadStore`. No method holds a private copy.
3. Each migration slice is behavior-preserving: the full 548-test suite stays
   green and `tsc --noEmit` stays clean after every slice.
4. A collaborator depends only on `ThreadStore` + the ports it uses + clock/id/
   event — never on the facade or another collaborator's internals.
5. Provider-specific logic does not re-enter the service via this split (the
   Agent Runtime Event Spine boundary still holds).

## Entanglement finding (verified 2026-06-06)

A `this.<method>(` call map of `handleTideMcpToolCall` (lines 2809–3690) shows the
MCP path is NOT independent of the workbench-command path. It calls shared private
methods that the workbench-command and lifecycle paths also use:

- `openWorkbenchTerminal`, `ensureWorkbenchTerminalRunning`, `stopTerminalPane`,
  `completeWorkbenchTerminal`, `appendWorkbenchTerminalOutput`
- `openProviderSetupSurface`, `ensureProviderSetupSurfaceRunning`,
  `completeProviderSetupSurface`, `appendProviderSetupSurfaceOutput`
- `emitAsyncEvent`, `appendLocalUserMessageBlock`

So extracting `TideMcpToolHandler` first would either break those calls or
duplicate the shared methods (makeshift). The correct order extracts the shared
concern FIRST.

### Refined collaborator set

- **`ThreadStore`** (DONE) — shared Thread map.
- **`WorkbenchRuntime`** (NEW, extract next) — owns visible Workbench Terminal +
  Provider Setup Surface pane lifecycle and `emitAsyncEvent`. Depends on
  `ThreadStore`, `workbenchTerminalPort`, `providerSetupSurfaceTerminalPort`,
  `clock`, `idGenerator`, `onAsyncEvent`. This is the shared dependency of both
  handlers — the second linchpin after `ThreadStore`.
- **`TideMcpToolHandler`** — depends on `ThreadStore` + `WorkbenchRuntime` +
  workspace ports (`workspaceFilePort`, `workspaceCommandPort`,
  `workspaceCodeIntelligencePort`). Holds the `*Output` builders.
- **`WorkbenchCommandHandler`** — depends on `ThreadStore` + `WorkbenchRuntime`.
- **`RuntimeLifecycleCoordinator`** — evidence-gated, last.

## Migration Slices (revised)

1. `ThreadStore` — DONE. One shared instance; call sites unchanged.
2. `WorkbenchRuntime` — extract the shared Terminal/Setup-Surface pane lifecycle +
   `emitAsyncEvent`. Facade + future handlers delegate. This unblocks the handler
   splits without duplication.
3. `TideMcpToolHandler` — move MCP methods + `*Output` builders; inject
   `WorkbenchRuntime`; facade delegates.
4. `WorkbenchCommandHandler` — move workbench-command methods; inject
   `WorkbenchRuntime`; facade delegates.
5. (Evidence-gated) `RuntimeLifecycleCoordinator`.

Each slice keeps the full 548-test suite green and `tsc` clean. This order was
chosen from the verified call map, not assumed — the shared concern moves before
its consumers, so no method is duplicated and nothing is patched around.

## Bidirectional coupling finding (verified 2026-06-06)

A second call-map (the Terminal/Setup-Surface region, lines 2333–2860) shows the
shared `WorkbenchRuntime` candidate is NOT a leaf either — it calls BACK into the
lifecycle group:

- `replayPendingInputIfProviderReady`, `startOrResumeRuntimeForPendingInput`,
  `activeOrResumedHandle` — i.e. completing a Provider Setup Surface triggers
  pending-input replay and a runtime start.

So the coupling is bidirectional: lifecycle → opens setup surface; setup-surface
completion → replays pending input → lifecycle starts the runtime. This is
intrinsic domain coupling, not accidental file size.

**Design consequence — extraction needs a collaboration protocol, not a method
move.** `WorkbenchRuntime` must NOT call lifecycle methods directly. Instead it
emits a typed outcome (e.g. `setupSurfaceCompleted(threadId)` /
`terminalCompleted`) that the lifecycle coordinator (or the facade, initially)
observes and acts on. The clean seam is:

```
WorkbenchRuntime  --(SetupSurfaceCompleted event/callback)-->  Lifecycle
Lifecycle         --(openSetupSurface / openTerminal request)-->  WorkbenchRuntime
```

This is why the class split is a designed effort, not a mechanical slice: the
collaboration contract (the two directions above, as explicit callbacks/events)
must be defined first, then methods move onto either side of it. Defining that
contract IS the next design step; only after it is fixed do the methods move,
each slice behavior-preserving and test-guarded.

## Safe progress boundary

Mechanical, low-risk extraction is now exhausted: 8 leaf modules + `ThreadStore`
are done and verified (548 tests green). The remaining class split crosses
intrinsic bidirectional coupling, so it proceeds only behind the collaboration
contract above — designed first, executed in behavior-preserving slices. Forcing
a naive method move here would duplicate shared methods or sever the
setup→replay→start flow, i.e. exactly the makeshift this project forbids.

## Tests

No new behavior tests required — this is a refactor. The gate is the EXISTING
suite (548 tests) staying green plus `tsc --noEmit` clean after each slice. Add an
architecture-boundary assertion that collaborators do not import the facade.

## Why This Is Not Makeshift

The split is designed around the one real invariant (single shared `ThreadStore`)
and preserves the public contract, so it is a clean separation of responsibilities
rather than a patchwork. Each slice is small, mechanical, and test-guarded. The
giants move first because they are genuinely separable; the entangled lifecycle
moves last and only when proven — no forced abstraction.

## Open Questions

1. Does `handleTideMcpToolCall` mutate lifecycle state (turn/prompt) in ways that
   couple it to the lifecycle group? If so, that coupling is surfaced as a
   `ThreadStore` operation, not a cross-collaborator call. Verify when moving it.
2. Should `onAsyncEvent` emission be centralized in `ThreadStore` (so collaborators
   emit through one path) or injected per-collaborator? Decide in slice 1.
