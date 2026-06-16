# Spec: Composer Draft Thread

## Scope

Promote the Composer (New Thread) screen to a first-class **Draft Thread**: a real
`ThreadRecord` that already holds the full Execution Context (scope/cwd, agentBinding,
launchOptions = model/permission/branch/worktree) and owns a live backend Workbench,
but whose **agent runtime has not started yet**. "Send" *starts* the existing Draft
Thread (deferred agent spawn) rather than creating a new thread.

All Workbench panes — Browser, Editor, Terminal, Changes/Diff — operate uniformly on
the Draft Thread through the normal per-thread `workbench.command` path. The renderer's
ad-hoc pre-thread pane structures (synthetic launcher with disabled actions, draft
browser panes, start-file editors, untitled editors, draft Changes pane) collapse into
one concept.

This replaces the inconsistency where Browser/Editor/Changes each had a separate
renderer-only pre-thread hack while Terminal/Diff were simply disabled — because the
visible Terminal Pane needs a backend PTY owner and there was no thread to host it.

## Evidence

- `thread-runtime-service.ts:582` `startThread` already separates `ThreadRecord`
  creation (587–603, `lifecycleState:"creating"`, `runtimeState:"not_started"`) from the
  agent spawn `agentRuntimePort.start()` (657). The **provider-not-ready branch**
  (625–643) already leaves a registered thread with `runtimeState:"not_started"` and **no
  agent spawned**, queuing the input — proof that "thread exists, agent not started" is an
  already-legal state.
- Composer context (agentId / model / permission / worktree / branch / cwd) already lives
  in renderer Start state (`product-shell/state/start.ts`).
- Pre-thread pane hacks today: `composerWorkbenchAppChrome` (`workbench-pane-view.ts`)
  renders a synthetic launcher + draft browser/changes panes + start-file + untitled
  editors; `composerLauncherPane` hard-codes Editor/Terminal/Diff `enabled:false`;
  `selectProductShellLauncherAction` (`workbench.ts:225`) no-ops every action except
  `open_browser` when `activeThreadId === null`.
- `activeThreadId === null` is the "composer mode" signal in **42 sites across 11
  renderer files**.
- **Two separate PTY paths** (`live-backend.ts`): `agentRuntimePort` (agent transport,
  `agent-runtime`/`agent-integrations`; does not even receive `ptyLauncher`) vs
  `workbenchTerminalPort` = `createPtyWorkbenchTerminalPort` (the visible Terminal Pane,
  `pty/workbench-terminal-pty-port.ts`). This work touches only the latter.

## Decisions

- **D1 — Draft Thread is a real `ThreadRecord`** with a new `lifecycleState: "draft"` and
  `runtimeState: "not_started"`. This **reverses** the earlier "no phantom thread"
  call recorded in `v2-chat-renders-agentchat-directly` / `v2-start-page-editor`. The
  earlier rejection was specifically of *eager agent spawn*; a Draft Thread is the
  opposite — it **never** spawns an agent until Send. That rejection is what produced the
  current per-pane inconsistency, so we adopt the unified concept the user asked for.
- **D2 — Send starts the existing Draft Thread in place** (same `threadId`); it does not
  create a new thread. `startThread` splits into `createDraftThread` (context + workbench,
  no agent) and the existing start path operating on the already-registered draft.
- **D3 — Composer mode = "active thread is a draft"**, not `activeThreadId === null`. The
  active thread id points at the Draft Thread while composing.
- **D4 — Changing the project/cwd or agent chip replaces the Draft Thread**: discard the
  old draft (tear down its Workbench, kill terminal PTYs) and create a new one. Panes
  close — identical to switching threads. (Pure launchOptions tweaks that don't change
  scope/agent — model/permission/branch — mutate the draft in place.)
- **D5 — Draft Threads are not persisted and not listed in the rail** until started.
  Discarded drafts tear down their Workbench through the existing close/teardown path.
- **D6 — Out of scope / untouched: `agent-runtime`, `agent-integrations`.** The visible
  Terminal stays on `workbenchTerminalPort`. No change to how the coding agent is driven.

## Out Of Scope

Agent runtime transport and provider integrations; persistence format beyond "don't
persist drafts"; multi-draft (only the active composer draft exists at a time).

## Domain Model

- `ThreadLifecycleState` gains `"draft"`.
- A Draft Thread: `lifecycleState:"draft"`, `runtimeState:"not_started"`,
  `workbench: defaultWorkbenchState()`, full `scope`/`agentBinding`/`launchOptions`, no
  `activeRuntimeHandle`.
- `createDraftThread({ scope, agentBinding, launchOptions }) -> ThreadRecord`.
- `startThread({ threadId: <draft>, initialMessage, ... })` runs the readiness + agent
  spawn half on the existing draft; `draft -> running`.
- `discardDraftThread(threadId)` tears down the Workbench (terminal PTYs killed) and
  removes the record. No-op for non-draft threads.

## Contracts

Add `createDraftThread` and `discardDraftThread` to the backend service + Desktop IPC.
`startThread` already accepts `input.threadId`; reuse it to start a draft in place.

## Flow

1. Enter composer → `createDraftThread(scope, agentBinding, launchOptions)`; active thread
   id = draft id; composer UI renders because the active thread is a draft.
2. Open Browser / Editor / Terminal / Changes → ordinary `workbench.command(threadId =
   draft)`. Launcher actions all enabled.
3. Send → `startThread(threadId = draft, initialMessage)` → agent spawns once; `draft ->
   running`; the thread now appears in the rail.
4. Change project/agent chip → `discardDraftThread(old)` + `createDraftThread(new)`.
5. Leave composer without sending → `discardDraftThread`.

## Invariants

- A draft thread has no `activeRuntimeHandle` and never calls `agentRuntimePort.start`
  until `startThread`.
- Exactly one agent spawn per thread (no double-start when a draft is started).
- Discarding a draft kills its visible-terminal PTYs (no orphan processes).
- `agent-runtime` / `agent-integration` code is unchanged.

## Tests

- backend: `createDraftThread` registers a thread and does **not** call
  `agentRuntimePort.start` (fake runtime spy); `open_terminal` on the draft calls
  `workbenchTerminalPort.start` with the draft threadId and yields a visible pane;
  `startThread` on the draft id calls `agentRuntimePort.start` exactly once and moves it
  to `running`; `discardDraftThread` tears down the terminal handle and removes the
  thread.
- renderer: composer mode derived from draft status (not `activeThreadId === null`);
  launcher enables Editor/Terminal/Diff; changing scope/agent chip discards + recreates the
  draft.
- boundary: no new import from `agent-runtime` into the workbench/composer path.

## Implementation Notes

**Renderer realization — the Draft Thread IS the active thread (PURE).** The decisive design
choice (after a wrong first cut): when the user opens the first Composer pane,
`ensureComposerDraftThreadActive` (state/workbench.ts) creates the backend draft AND sets
`activeThreadId = draftThreadId` plus an `appChrome.thread` stub. The whole app — Workbench,
FileTree, Editor, Terminal, Browser — and every interaction handler (terminal input/resize,
editor save, browser snapshot) then operate on the draft through the NORMAL active-thread path,
with zero per-pane special-casing. The chat stays the start Composer because it renders on
`composer.mode` (`= agentChat.thread ? "follow_up" : "start"`), which is independent of
`activeThreadId`; the draft never sets `agentChat.thread`. The launcher handler just calls
`ensureComposerDraftThreadActive` then the normal `selectProductShellLauncherAction`.

**Anti-pattern (do NOT do this):** a parallel renderer structure — a separate
`draftThreadBackendPanes` field + custom launcher/event routing with `activeThreadId` left null —
renders the panes but BREAKS interactions, because the interaction handlers route through
`appChrome.thread` (the active thread). The first cut did exactly this and the terminal wasn't
typeable. The fix is to reuse the active-thread machinery, not duplicate it.

**`activeThreadId === null` audit:** most sites that used it to mean "Composer" now correctly take
the thread path with the draft (turning OFF the old renderer hacks: start-page editor, draft
browser). Only sites meaning "the chat is composing" must switch to `agentChat.thread === null`
(notably `preferredStartComposerFromState`, or composer prefs stop persisting while a draft is
active). No wholesale 42-site rewrite was needed.

Slices (all done):

1. **Backend Draft Thread lifecycle** — `"draft"` state; `DraftThreadService` (create / discard /
   `prepareStartInPlace`) + `newThreadRecord`; `startThread` starts a draft in place; `listThreads`
   excludes drafts. (agent-runtime untouched)
2. **Contracts + Desktop transport** — `thread.createDraft` / `thread.discardDraft`.
3. **Renderer (PURE)** — `ensureComposerDraftThreadActive`; enable all launcher actions; remove the
   parallel wiring.
4. **Lifecycle** — Send rebinds the started thread id → draft id (start in place); discard on
   chip-replace / New Thread / leaving resets `activeThreadId` + `appChrome.thread`; drafts not
   persisted / not in rail.

**Verification:** typecheck + build green; full behavior suite green; live via
`scripts/pw-composer-draft-terminal-verify.cjs` (terminal typed + echoed in the Composer, chat
stays the start Composer, Send starts in place).
