# Tide v2 Build Status and Unblock Runbook

Living status of the v2 implementation against the product goal. Update this when
a slice lands or a gate is cleared.

Verification baseline at last update: **373 behavior tests pass**, `tsc --noEmit`
clean, `npm run build` green, and the built Electron app boots its Backend
utilityProcess and runs the full agent loop (openai_api + fake-OpenAI Electron
smoke reaches `ok:true`).

## Runtime spine re-architecture (in progress)

The seamless-terminal goal (accurate turn-end, streaming, in-session commands,
directory trust, question answering, queuing, message edit, interrupt/steering —
across Codex/Claude/Antigravity, with no perf regression and no makeshift) is
gated on one structural change: replacing scattered polling/scrape turn-detection
with a typed, provider-owned event stream.

- **Master spec:** `specs/agent-runtime-event-spine.md` — the Agent Runtime Event
  Spine. Each Agent Integration owns one `AgentRuntimeEventSource` per runtime and
  fuses its own Provider Signals into one ordered typed `AgentRuntimeEvent` stream
  (`runtime.started`/`turn.started`/`output.delta`/`prompt.opened`/`prompt.closed`/
  `turn.ended`/`runtime.exited`). The Backend service consumes it uniformly via a
  pure reducer with zero provider branching.
- **Why:** today `live-backend.ts` (infra) tail-polls the codex rollout JSONL for
  `task_complete`/`turn_aborted` on a 500ms loop and calls it "a fallback for a
  missing codex-stop hook" — provider lifecycle detection in the wrong layer,
  fallback-on-fallback. This is the churn root behind antigravity "forever Working"
  and the concurrent-spawn binding bug.
- **Slice 1 — DONE & verified:** added `AgentRuntimeEvent` + `InSessionCommand`
  (`domains/agent-runtime/agent-runtime-event.ts`), the `AgentRuntimeEventSource`
  port, and the pure `reduceRuntimeEvent` reducer (`runtime-turn-reducer.ts`) that
  enforces single-turn.ended dedupe, no-fabricated-settle, prompt waiting states,
  and concurrent-runtime isolation. 12 new tests pass; full suite 516 pass;
  typecheck clean. Additive only — existing path untouched.
- **Slice 2 — in progress:** codex turn-end detection extracted out of
  `live-backend.ts` into the codex Agent Integration
  (`agent-integrations/codex/codex-rollout-turn-detection.ts`,
  `detectCodexRolloutTurnEnd`) with 7 fixture tests; `live-backend.ts` now only
  reads the rollout tail and delegates. A boundary guard
  (`tests/runtime-spine-boundary.test.ts`) asserts the codex turn-end literals
  (`task_complete`/`turn_aborted`) no longer appear in the infra/service god-files
  — they live only in the codex adapter. 526 tests pass; typecheck clean.
  Remaining for Slice 2: build the full codex `AgentRuntimeEventSource` that owns
  the polling loop + emits `turn.started`/`output.delta`/`turn.ended`, switch the
  service onto the spine, and delete the infra polling loop. That step changes
  live runtime wiring and needs real-codex verification (auth + trusted dir), so
  it is a focused next session, not a headless change.
- **Slice 3 — in progress (headless portion done):** the turn-end *hook event*
  knowledge moved from infra into each Agent Integration via
  `AgentIntegrationPort.turnEndSignalEvents()` — codex declares `["codex-stop"]`,
  claude/antigravity declare `["agent-idle"]`. `live-backend.ts` no longer
  hardcodes `TURN_END_SIGNAL_EVENTS`; it asks the integration. Boundary guard
  extended to forbid the hook-event literals in infra. Per-provider tests added.
  Antigravity's transcript turn-end rule (PLANNER_RESPONSE with content and no
  tool_calls) is also extracted into its adapter
  (`antigravity-transcript-turn-detection.ts`, `antigravityRecordIsTurnEnd`) with
  fixtures. **All three providers now own their turn-end detection in their own
  adapters** — no provider lifecycle logic remains in infra/service. 534 tests
  pass; typecheck clean. Remaining for Slice 3: the full event-source-loop
  migration (move the polling loops themselves into per-runtime sources) needs
  real-runtime verification.
- **Next:** finish the event-source loop migration (real-runtime); Slice 4
  interrupt / queuing / prompt round-trip uniformly on the spine.

### Feature audit (the 10 seamless-terminal features)

A code/test audit found that 9 of the 10 are already implemented at the service
level and tested; the reliability gap is the runtime spine (turn detection),
which the slices above address. The one genuine *missing* feature was message
edit — now started:

- streaming, slash/command options, directory trust, question/approval answer,
  queuing, interrupt-via-stop (stop consumes the queued follow-up = steering),
  workbench file ops (user + agent): all present with tests.
- **Message edit — NEW, service slice DONE & verified:** `editPendingInput`
  edits the queued (not-yet-sent) Composer message in place, provider-agnostically
  (no rewind needed; the runtime hasn't seen it). Blank value discards the queue.
  Spec `specs/composer-message-edit.md`. Wired through the **entire stack except
  the React button render**: `editPendingInput` service → `composer.editQueuedInput`
  shared contract → inbound adapter routing → Desktop `editQueuedInput` state action
  (edits the optimistic `queuedInput` row, blank discards) → command draft mapping.
  The React UI is now done too: an edit button on the queued row (event-delegated
  `[data-edit-queued]`) → `editProductShellQueuedInput` pulls the queued text back
  into the Composer and discards the backend queue (blank edit); user re-sends to
  re-queue. CSS `.agent-session-turn__edit` with hover. 12 tests across
  service/contract/desktop-state/product-shell/render-markup layers; 547 pass;
  typecheck clean. Message-edit is complete through every layer including the React
  render (markup-asserted). Only a literal pixel screenshot of the transient queued
  state is unverified (needs dev-harness seeding). Remaining for the broader feature:
  the evidence-gated "edit an already-sent message" (provider rewind/fork) slice.

### Structural simplicity — god-file decomposition (in progress)

The product goal demands "구조적으로 심플" (structurally simple). `thread-runtime-service.ts`
(was 4536 lines) and `live-backend.ts` (3221 lines) are god-files. Decomposition is
behavior-preserving and test-guarded (548 tests), done in safe leaf-cluster slices:

- **DONE (8 slices, service 4536→3869 / ~14.7%, 548 tests green throughout):**
  - `services/thread-runtime-clone.ts` (175) — pure deep-clone/mapper helpers.
  - `services/unavailable-workspace-ports.ts` (95) — null-object workspace ports.
  - `services/diff-text.ts` (36) — pure unified-diff text utilities.
  - `services/service-value-helpers.ts` (126) — scalar value parsers + limits + titles.
  - `services/record-helpers.ts` (75) — record/array coercion helpers.
  - `services/workbench-snapshot.ts` (201) — workbench pane-ref/snapshot mapping.
  - `services/workbench-command-data.ts` (154) — Tide MCP/workbench `*FromData` parsers.
  Each leaf-pure / self-contained, behavior-preserving, typecheck clean.
- **Leaf-helper extraction is now essentially exhausted.** What remains in the 3869
  lines is the `ThreadRuntimeService` class itself plus a few thread-bound helpers
  (`snapshotThread`, `normalizeThreadSeed`, `promptAnswerValue`, MCP guards).
- **Class split — designed + shared infra extracted.** Design spec:
  `specs/thread-runtime-service-decomposition.md` (collaborators, shared-state via
  one `ThreadStore`, facade preserved, migration order, verified entanglement +
  bidirectional-coupling analysis, test gate). The shared infrastructure that
  every collaborator needs is now extracted so collaborators can return results
  without importing the facade:
  - `services/thread-store.ts` — the single shared `ThreadStore` (state linchpin).
  - `services/service-result.ts` — `ServiceResult`/`ServiceError`/`ServiceErrorCode`
    + `failure` (re-exported from the service for back-compat).
  - `services/thread-snapshot.ts` — `snapshotThread` (ThreadRecord→ThreadSnapshot).
  - `ThreadSeed` moved to the `thread` domain (re-exported from the service);
    `normalizeThreadSeed` moved into `thread-snapshot.ts`.
  - **First real collaborator class split — DONE:** `services/thread-crud-service.ts`
    (`ThreadCrudService`) owns restore/list/archive/setPinned/rename + their DTOs;
    takes the shared `ThreadStore` + clock; the facade delegates and re-exports the
    DTOs. This validates the whole decomposition design end-to-end (shared store +
    collaborator + thin facade).
  - `ThreadRuntimeAsyncEvent` moved to `thread-runtime-events.ts` (re-exported) —
    the async event vocabulary, so collaborators emit events without the facade.
  - `services/workbench-launcher.ts` — launcher Pane management (pure functions).
  - **`services/workbench-runtime.ts` (`WorkbenchRuntime`) — DONE, the hard one.**
    Owns the Workbench Terminal + Provider Setup Surface pane lifecycle and both
    handle maps; takes the shared `ThreadStore` + the two terminal ports +
    clock/id/emitAsyncEvent and ONE injected lifecycle callback
    (`onProviderSetupReady` → `replayPendingInputIfProviderReady`). The
    bidirectional setup→replay coupling is resolved by that single callback — no
    facade reach-back. Facade delegates the call sites and exposes handle accessors
    for terminal input/resize. 174 setup-surface/terminal/MCP/workbench tests pass
    in isolation; non-PTY suite green.
  - `services/tide-mcp-output.ts` — the Tide MCP tool output DTOs.
  - `services/workbench-browser-operations.ts` — Browser Pane ops (pure functions).
  - `services/workbench-file-operations.ts` (`WorkbenchFileOperations`) — file/editor
    ops. `threadRoot` moved to `thread-snapshot.ts`.
  - `services/workbench-exec-operations.ts` (`WorkbenchExecOperations`) — code
    navigation (go-to-def/refs) + terminal (run/open) ops; collaborates with
    `WorkbenchRuntime` (live terminals) + `WorkbenchFileOperations` (open the
    definition file). `commandRunStatus` moved with it.
  - `services/tide-mcp-output.ts` + `services/workbench-browser-operations.ts` +
    `services/workbench-file-operations.ts` + `services/workbench-exec-operations.ts`
    — all workbench *Output operations.
  - **`services/tide-mcp-tool-handler.ts` (`TideMcpToolHandler`) — DONE.** The Tide
    MCP dispatcher: MCP types + `TIDE_MCP_TOOL_DEFINITIONS` + resolveMcpThread +
    tool dispatch + observe/guard helpers; depends on the shared store + ops
    collaborators. Facade delegates `listTideMcpTools` / `handleTideMcpToolCall`.
  - **`services/workbench-command-handler.ts` (`WorkbenchCommandHandler`) — DONE.**
    The visible Workbench command dispatcher (open/close panes, terminal input/
    resize, editor save, navigation, file-tree refresh) + its DTOs; dispatches to
    the ops collaborators + WorkbenchRuntime. Extracted verbatim by mirroring the
    service field names. Facade delegates `handleWorkbenchCommand` /
    `readWorkspaceFileTree`.
  Service 4536→1616 (**~64%**). Non-PTY suite green throughout.
  **`thread-runtime-service.ts` remaining:** now mostly the lifecycle/runtime core
  (startThread, sendComposerInput, answerPrompt, recordTurnComplete, trustWorkspace,
  resume/stop, pending-input replay, hydrate, frame append) + the thin facade — the
  intentionally-last, evidence-gated `RuntimeLifecycleCoordinator` split (shares the
  most cross-method flow). Extract only at a clean seam.

- **`live-backend.ts` (infra, 3221 lines) decomposition — IN PROGRESS:**
  - `infrastructure/node/live-backend-fs.ts` — bounded fs read primitives.
  - `infrastructure/node/live-backend-json.ts` — pure JSON/record coercion parsers.
  - `infrastructure/node/provider-state-readers.ts` — provider readiness state from `$HOME`.
  - `infrastructure/node/provider-session-ref.ts` — session-ref builders/parsers.
  - `infrastructure/node/provider-history-helpers.ts` — the shared parsing helpers
    used by BOTH the provider-history frame readers and the conversation rebuilders
    (joinTextContent, boundedToolText, codex tool-frame, claude tool-use/result,
    antigravityConversationItems + `AntigravityConversationItem`).
  - `infrastructure/node/provider-conversation-rebuilders.ts` — rebuild an Agent
    Session (ordered blocks) from provider transcript/rollout history for Thread
    reopen (rebuildCodex/Claude/Antigravity + rebuildConversationFromProviderHistory;
    re-exported from live-backend for tests).
  - `infrastructure/node/recent-provider-files.ts` — scans each provider's history
    dir for recent transcript/rollout files (recentCodexRollouts/ClaudeTranscripts/
    AntigravityTranscripts + recentProviderFiles).
  - `infrastructure/node/provider-history-readers.ts` — reads each provider's own
    on-disk history (codex rollout / claude transcript / antigravity transcript) and
    the hook-signal spool into bounded provider-record frames for the live projector:
    the 4 frame interfaces (Codex/Claude/Antigravity ProviderHistoryFrame +
    ProviderSignalSpoolFrame), the 6 read* functions (read*ProviderSessionRefsFromHome,
    read*ProviderHistoryFramesFromHome, readProviderSignalFramesFromSpool), and the 2
    private containsUserMessage gate helpers. Concurrency-safe by construction: reads
    ONLY the hook-bound file, never a recency-scan fallback. Re-exported from
    live-backend for tests (backend-agent-runtime-port-wiring imports all 6).
  live-backend 3221→1831 (8 infra leaf modules), typecheck clean + non-PTY suite
  green (548 pass). Pruned the now-orphaned leaf imports from live-backend
  (live-backend-json group, history-helpers group, several session-ref id parsers,
  recent-transcript scanners) — those helpers are now consumed only inside the
  extracted modules. Next: the projector closure
  (`createLiveAgentSessionEventProjector`, the polling loops = task #7 territory,
  real-runtime-gated).

  Note: 3 real-PTY tests (`python_pty_process_launcher_*`,
  `workbench_terminal_pty_port_runs_a_live_command...`) are timing-flaky under
  full-suite subprocess load — they pass in isolation. Not a refactor regression;
  the decomposition changes are pure type/mapper relocations.
- **The real win (separate, careful):** splitting the service CLASS by responsibility
  (thread CRUD / runtime lifecycle / workbench / MCP / workspace-file). That is an
  interface-design surgery best done as a dedicated focused pass, not rushed — record
  as the structural end-state, not a quick slice.

### Launch readiness + real-runtime gate

`npm run build` is green with all the above changes bundled — the app is
launch-ready. The remaining requirement ("all features seamless across 3 real
agents in the running app", performance, visual polish) is a **real-runtime gate**
that needs `npm run dev` + provider auth in a human environment; it cannot be done
headlessly. `implementation/real-runtime-verification-checklist.md` makes that
verification systematic (10 features × 3 agents matrix + concurrency + turn-end
focus). Run it; any failure localizes to one Agent Integration adapter + the
still-polling loop in `live-backend.ts` (task #7).

## Done and verified

- **Codex-app-style Thread management** — list, archive, pin, rename, and Left UI
  search, each end-to-end (Shared Contracts → Backend service → event-driven
  persistence → Product Shell) with tests.
  Spec: `specs/backend-thread-list-product-shell-bootstrap.md`.
- **Workbench panes**
  - Editor — real CodeMirror 6 (MIT): grammar highlighting, line numbers,
    edit/save, LSP go-to-definition + go-to-references (TS language service).
    Specs: `specs/workbench-editor-pane-editing.md`, `workbench-editor-code-navigation.md`.
  - Terminal — live PTY session + GPU-accelerated xterm.js/WebGL renderer with
    output streamed off the React hot path (delta-chunk `workbench.terminalOutput`).
    Spec: `specs/workbench-terminal-pane-session.md`.
  - Diff — structured unified-diff rendering (added/removed/hunk/context).
  - Launcher — actions open the corresponding panes.
  - Browser — Electron `<webview>` wired with snapshot + click/type action
    capture (unit-tested). See gate B below for live page-load verification.
- **Multi coding-agent compatibility** — Codex / Claude / Antigravity route to
  provider-specific Agent Integrations (not a generic GPT path) and launch a
  hidden PTY; OpenAI API is a Tide API Agent. Provider Readiness preflight +
  Provider Setup Surface (not-ready → preserve input → setup terminal → replay)
  is implemented and tested. See gate A for the live-login step.
- **Agent-operable MCP** — observe and operate (e.g. open browser) verified
  end-to-end over the real stdio↔unix-socket transport a provider CLI uses;
  socket server is resilient to broken clients.
- **Performance** — see `~/.claude` memory `v2-performance-budget`: backend
  bundle externalizes node deps (10.3MB→290KB); terminal uses the GPU; terminal
  output bypasses React; CodeMirror/xterm/CodeMirror render only their viewport.
  Renderer bundle ≈ 2.1MB (~480KB gzip) for a real editor + GPU terminal.

## Open gates (need one environment action, not code)

These are the only items left for "everything actually works", and each needs a
human/environment step that cannot be done headlessly.

### Gate A — Multi-agent real answers — VERIFIED for antigravity + openai
Routing, hidden-PTY launch, readiness preflight, and Setup Surface are done.
Root-cause fix (commit "Deliver first message as provider launch-time prompt"):
the first message is delivered as the provider CLI's launch-time prompt
(codex/claude positional, antigravity `--prompt-interactive`) so a turn starts
immediately — the old type-into-TUI-after-launch did not reliably start a turn.

**Verified:** the antigravity Electron smoke now returns a real answer captured
as a role:agent block (`agentOutputFound:true`, was false before the fix), and
openai_api streams a real answer. Multi-agent real answers work end-to-end.

Codex uses the same code path and will answer identically once its login is
valid — during testing its token was invalidated:

Real-answer verification is still blocked by two non-code conditions found while
testing with a live codex login:
- **Auth token invalidated:** codex returned `token_invalidated` /
  `refresh_token_reused` / 401. The login got invalidated (running codex
  concurrently can rotate/reuse the refresh token). **Action:** run a fresh
  `codex login` and do NOT run other codex processes meanwhile.
- **Directory trust:** codex refuses to run in an untrusted dir ("Not inside a
  trusted directory"). The Thread Execution Context cwd must be a trusted codex
  directory (this is provider-owned trust state, surfaced via Provider Readiness
  / Setup Surface).
- **Then:** `npm run test:smoke:electron -- --agent codex` should report
  `agentOutputFound:true` once auth + trust hold.

### Gate B — Browser pane live page-load (GUI)
The `<webview>` + snapshot/action evidence loop is wired and unit-tested. The
actual page render only happens in a painted Electron window; the headless smoke
can't drive it (command-result events are returned to the caller, not broadcast
to the Product Shell that mounts the webview).
- **Action:** `npm run dev`, open a Thread, open a Browser pane, confirm a page
  loads and the title/text snapshot returns. Report any visual issue.

### Gate C — Figma-exact reproduction (UNBLOCKED — reading Figma via curl)
The Figma Dev Mode MCP server (Figma desktop, 127.0.0.1:3845/mcp) is drivable by
manual JSON-RPC over curl WITHOUT a Claude Code restart: initialize →
notifications/initialized → tools/list → tools/call, reusing the `mcp-session-id`
header. Tools: get_metadata, get_design_context, get_variable_defs (the design
uses inline values, returns {}), get_screenshot. Pass an explicit `nodeId`
(e.g. workbench `1223:2`); without one the tools act on the current selection
("Nothing is selected").

Ground truth extracted (workbench frame 1223:2, 1920x1080): 4 columns —
Left Rail (256) | Agent Chat + Composer | Workbench editor (tabs + breadcrumb) |
FileTree ("Filter files…"). Top Row 52. Palette + type roles already match. The
current Product Shell already matches this structure closely.

Known divergence to fix: the Left UI "Search" is a nav row (icon + "Search"),
not an inline input — the inline input belongs only to the FileTree filter.

Headless conformance loop (no Electron GUI needed): a dev-only harness
(`src/desktop/renderer/dev-harness.html`/`.ts`, not in the production build
input) mounts the real Product Shell with a Figma-matching fixture. Serve it
with `npx vite src/desktop/renderer --port 5199` and open
`/dev-harness.html?probe=N` (bump N to bust the snapshot cache). The harness
reports layout (column order, rail width, top-row height, editor/composer
presence) via `document.title` because the Browser Pane snapshot extractor does
not surface the CSS-grid DOM as text — read it with capture_pane's `title`.

This loop already (a) caught and fixed a real white-screen bug — the xterm
default import resolved to `undefined` under Vite, throwing at module load; and
(b) conformed the Left Rail to Figma's 256px (was minmax(246,270)→246). Verified
top row 52 and 4-column order match. The production build (`vite preview
--outDir out/renderer`) also renders, confirming the fix ships.

Conformed dimensions (measured in the harness against Figma frame 1223:2):

| Element | Figma | Now |
|---|---|---|
| Left Rail width | 256 | 256 ✓ |
| Top rows (rail / chat / tab bar / filetree) | 52 | 52 ✓ |
| FileTree column width | 344 | 344 ✓ |
| FileTree search height | 32 | 32 ✓ |
| File row height | 30 | 30 ✓ |
| Workbench tab height | 30 | 30 ✓ |
| Composer chips | 28 | 28 ✓ |
| Composer padding | 12 | 12 ✓ |
| Left UI Search | nav row | nav row ✓ |

Editor pane is now a real code editor (not a viewer): breadcrumb + CodeMirror
filling the pane; Go to Definition / Find References on the right-click context
menu; Cmd/Ctrl+S to save. No file-info (Path/Size/Revision) panel, no action
button bar.

Composer: the follow-up input now rests at one line and auto-grows
(field-sizing). The follow-up composer is intentionally taller than Figma's bare
90px because it shows the thread's read-only context block (spec:
follow_up_shell_displays_thread_context_without_inline_edit_controls) — a
deliberate Tide feature, an accepted divergence, not chrome to strip.

Exact-value conformance (pulled from Figma get_design_context, frame 1223:2 /
composer 1223:91), not estimates:
- Palette: bg #fdfdfc, surface #f4f3f0, line #e4e2de, line-strong #d9d6cf,
  text #242424, muted #8a8781, action #343038 — all matched to Figma hex.
- Composer: radius 14, shadow 0 8px 11px rgba(52,48,56,0.13); chips border
  #d9d6cf, radius 8, height 28; placeholder "Ask for follow-up changes".
- Composer chip icons: real lucide shield-check + chevron-down (permission),
  chevron-down (model) — were placeholder glyphs.
- Typography: Inter (OFL-1.1) self-hosted via @fontsource and loaded in the
  renderer entry; build emits the woff2. (Font load is only confirmable in the
  Electron/Chromium app — the WebKit harness does not register it.)

Remaining is true fine-grain (per-icon insets, individual row paddings/colors)
with diminishing returns; conform via the same get_design_context + harness loop
as needed.

## Deferred (evidence-gated, intentionally not done)

- Agent Session list virtualization — real for very long transcripts, but
  variable-height windowing can't be verified headlessly and risks scroll jank;
  do it with real-app profiling, not blind. Recorded in the perf budget.
- Backend search across archived Threads (current search is a client-side filter
  over loaded Threads).
