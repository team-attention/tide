import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  discardProductShellDraftThread,
  ensureComposerDraftThreadActive,
  selectProductShellLauncherAction,
  submitProductShellComposerDraft,
  toggleProductShellWorkbench,
  writeProductShellTerminalInput,
  type ProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

// Renderer side of docs_v2/specs/composer-draft-thread.md, PURE model: the Composer's
// Draft Thread BECOMES the active thread, so every pane (Terminal/Editor/Diff/Browser) and
// every interaction (typing/saving/snapshots) runs through the normal active-thread path.
// The chat stays the start Composer because it renders on composer.mode (= agentChat.thread
// ? follow_up : start), which is independent of activeThreadId.

function composerState(): ProductShellState {
  const state = createProductShellState({ includeFixtureData: false });
  assert.equal(state.activeThreadId, null);
  assert.equal(state.draftThreadId, null);
  return state;
}

const terminalPane = {
  paneId: "term-1",
  kind: "terminal" as const,
  title: "Terminal",
  revision: "rev-1",
  updatedAt: "2026-06-16T00:00:00.000Z",
  status: "running" as const,
};

test("ensureComposerDraftThreadActive creates the draft and makes it the active thread", () => {
  const { state, command } = ensureComposerDraftThreadActive(composerState());

  assert.equal(command?.kind, "thread.createDraft");
  const draftId = state.draftThreadId;
  assert.notEqual(draftId, null);
  // The draft IS the active thread now — the whole app operates on it.
  assert.equal(state.activeThreadId, draftId);
  assert.equal((command as { payload: { threadId: string } }).payload.threadId, draftId);
  // appChrome reflects the draft so workbench interaction handlers target it...
  assert.equal(state.appChrome.thread?.threadId, draftId);
  // ...but the chat stays the start Composer (agentChat.thread untouched).
  assert.equal(state.agentChat.thread, null);
});

test("ensureComposerDraftThreadActive is idempotent (reuses the active draft)", () => {
  const first = ensureComposerDraftThreadActive(composerState());
  const second = ensureComposerDraftThreadActive(first.state);
  assert.equal(second.command, null);
  assert.equal(second.state.draftThreadId, first.state.draftThreadId);
});

test("thread.listed keeps the active Composer Draft Thread even though drafts are not in the rail", () => {
  const draft = ensureComposerDraftThreadActive(composerState());
  const draftId = draft.state.draftThreadId as string;
  const withDirtyEditor: ProductShellState = {
    ...draft.state,
    workbenchOpen: true,
    editorDrafts: {
      "pane-editor": {
        paneId: "pane-editor",
        baseRevision: "pane-editor:rev",
        content: "dirty edit",
        dirty: true,
      },
    },
  };

  const afterList = applyProductShellBackendEvent(withDirtyEditor, {
    kind: "thread.listed",
    payload: { threads: [] },
  } as Parameters<typeof applyProductShellBackendEvent>[1]);

  assert.equal(afterList.activeThreadId, draftId);
  assert.equal(afterList.draftThreadId, draftId);
  assert.equal(afterList.appChrome.thread?.threadId, draftId);
  assert.equal(afterList.agentChat.thread, null);
  assert.equal(afterList.editorDrafts["pane-editor"]?.dirty, true);
});

test("Composer Draft Thread routes Browser and Diff launcher actions to backend workbench panes", () => {
  const draft = ensureComposerDraftThreadActive(composerState());
  const draftId = draft.state.draftThreadId as string;

  const browser = selectProductShellLauncherAction(draft.state, "open_browser");
  assert.equal(browser.command?.kind, "workbench.command");
  assert.equal((browser.command as { payload: { threadId: string; command: string } }).payload.threadId, draftId);
  assert.equal((browser.command as { payload: { command: string } }).payload.command, "open_browser");

  const diff = selectProductShellLauncherAction(draft.state, "open_diff");
  assert.equal(diff.command?.kind, "workbench.command");
  assert.equal((diff.command as { payload: { threadId: string; command: string } }).payload.threadId, draftId);
  assert.equal((diff.command as { payload: { command: string } }).payload.command, "open_diff");
});

test("typing into the Composer's Draft Thread terminal routes to the draft (the bug)", () => {
  // Make the draft active, then deliver its terminal via workbench.changed (gate passes
  // because activeThreadId === draftId), then type into it.
  const draft = ensureComposerDraftThreadActive(composerState());
  const draftId = draft.state.draftThreadId as string;
  const withPane = applyProductShellBackendEvent(draft.state, {
    kind: "workbench.changed",
    payload: { threadId: draftId, panes: [terminalPane], activePaneId: "term-1" },
  } as Parameters<typeof applyProductShellBackendEvent>[1]);
  // The terminal pane is in the active workbench (rendered through the normal path).
  assert.equal(withPane.appChrome.workbenchPanes.some((p) => p.paneId === "term-1"), true);
  // appChrome.thread is still the draft stub (workbench.changed preserves it).
  assert.equal(withPane.appChrome.thread?.threadId, draftId);

  const typed = writeProductShellTerminalInput(withPane, "term-1", "ls\r");

  // Input routes to the DRAFT thread — not a null/absent active thread (the old bug).
  assert.equal(typed.command?.kind, "workbench.command");
  assert.equal((typed.command as { payload: { threadId: string } }).payload.threadId, draftId);
  assert.equal((typed.command as { payload: { command: string } }).payload.command, "write_terminal_input");
});

test("sending starts the Draft Thread in place (reuses its id) and clears the draft binding", () => {
  const draft = ensureComposerDraftThreadActive(composerState());
  const draftId = draft.state.draftThreadId as string;
  const withMessage: ProductShellState = {
    ...draft.state,
    agentChat: {
      ...draft.state.agentChat,
      composer: { ...draft.state.agentChat.composer, draft: "go" },
    },
  };

  const result = submitProductShellComposerDraft(withMessage);

  assert.equal(result.command?.kind, "thread.start");
  // Started in place: same id (its live terminal carries in), still the active thread.
  assert.equal((result.command as { payload: { threadId: string } }).payload.threadId, draftId);
  assert.equal(result.state.activeThreadId, draftId);
  // Draft binding cleared; the chat now has a thread (→ transcript).
  assert.equal(result.state.draftThreadId, null);
  assert.equal(result.state.agentChat.thread?.threadId, draftId);
});

// --- Editor file picker vs. Workbench open state (the second reported bug) ---

test("the Composer Draft Thread inherits the Composer's Workbench-open state", () => {
  // Making the draft active must remember the Composer's current open state, so a later
  // re-derivation (thread.started) doesn't snap the Workbench shut on the new thread.
  const open = ensureComposerDraftThreadActive({ ...composerState(), workbenchOpen: true });
  assert.equal(open.state.workbenchOpenByThreadId[open.state.draftThreadId as string], true);
});

test("opening the Editor file picker keeps the Workbench open when the draft's empty workbench.changed arrives", () => {
  // Composer with the Workbench open → click Editor: the draft becomes active and the in-pane
  // file picker opens (editorPickerFilter set). The picker is renderer-only — it has NO
  // backend pane — so the draft's first workbench.changed carries an empty pane set.
  const draft = ensureComposerDraftThreadActive({ ...composerState(), workbenchOpen: true });
  const draftId = draft.state.draftThreadId as string;
  const picking = selectProductShellLauncherAction(draft.state, "open_editor");
  assert.notEqual(picking.state.editorPickerFilter, null); // the picker is open
  assert.equal(picking.state.workbenchOpen, true);

  const afterEvent = applyProductShellBackendEvent(picking.state, {
    kind: "workbench.changed",
    payload: { threadId: draftId, panes: [] },
  } as Parameters<typeof applyProductShellBackendEvent>[1]);

  // The bug: the empty pane set read as "nothing visible" and closed the Workbench from
  // under the picker. With the fix the open picker keeps it open.
  assert.equal(afterEvent.workbenchOpen, true);
  assert.notEqual(afterEvent.editorPickerFilter, null);
});

test("closing the Workbench abandons a pending Editor file picker (no stale picker on reopen)", () => {
  const withPicker: ProductShellState = {
    ...composerState(),
    workbenchOpen: true,
    editorPickerFilter: "",
  };
  const closed = toggleProductShellWorkbench(withPicker);
  assert.equal(closed.workbenchOpen, false);
  assert.equal(closed.editorPickerFilter, null); // picker abandoned on close

  // Reopening shows the Launcher, not the stale picker.
  const reopened = toggleProductShellWorkbench(closed);
  assert.equal(reopened.workbenchOpen, true);
  assert.equal(reopened.editorPickerFilter, null);
});

test("discarding the draft tears it down and returns the active pointer to the Composer", () => {
  const draft = ensureComposerDraftThreadActive(composerState());
  const draftId = draft.state.draftThreadId as string;

  const discarded = discardProductShellDraftThread(draft.state);

  assert.equal(discarded.command?.kind, "thread.discardDraft");
  assert.equal((discarded.command as { payload: { threadId: string } }).payload.threadId, draftId);
  // Back to the Composer: no active thread, no draft, appChrome reset.
  assert.equal(discarded.state.activeThreadId, null);
  assert.equal(discarded.state.draftThreadId, null);
  assert.equal(discarded.state.appChrome.thread, null);

  // No draft → no-op.
  assert.equal(discardProductShellDraftThread(discarded.state).command, null);
});
