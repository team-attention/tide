import type { ProductShellBackendCommand, ProductShellState, ProductShellUpdateResult } from "./types.ts";
import { COMPOSER_LAUNCHER_PANE_ID, isUntitledPaneId } from "./types.ts";
import { removeProductShellUntitledFile } from "./untitled-files.ts";
import { applyDrop, reconcileTree, setRatioAtPath } from "./workbench-split-tree.ts";
import type { DropZone } from "./workbench-split-tree.ts";
import { closeWorkbenchPane, focusWorkbenchPane, releaseWorkbenchAgentBrowserControl, resizeWorkbenchTerminal, writeWorkbenchTerminalInput } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { shellTimestamp } from "./create.ts";
// Workbench shell / layout / launcher / browser reducers. Editor + start-page-editor
// reducers live in ./workbench-editor.ts. (spec: navigable-source-structure)

export function toggleProductShellWorkbench(state: ProductShellState): ProductShellState {
  const workbenchOpen = !state.workbenchOpen;
  return {
    ...state,
    workbenchOpen,
    // Closing the Workbench abandons any pending in-pane Editor file picker (a transient
    // "about to open a file" state), so it never lingers and re-appears instead of the
    // Launcher when the Workbench is reopened.
    editorPickerFilter: workbenchOpen ? state.editorPickerFilter : null,
    // Remember this thread's open/closed choice so switching away and back doesn't
    // re-derive it from pane visibility (which re-opened a workbench the user closed).
    workbenchOpenByThreadId:
      state.activeThreadId === null
        ? state.workbenchOpenByThreadId
        : { ...state.workbenchOpenByThreadId, [state.activeThreadId]: workbenchOpen },
    // Leaving/closing the workbench can't leave a dangling fullscreen.
    workbenchFullscreen: state.workbenchOpen ? false : state.workbenchFullscreen,
  };
}

// Open workbench pane ids, in tab order — the live set the split tree is
// reconciled against.
function workbenchOpenPaneIds(state: ProductShellState): string[] {
  return state.appChrome.workbenchPanes.map((pane) => pane.paneId);
}

// Set the workbench presentation to Stacked (one active pane + tab strip) or
// Split (draggable tree). The backend owns the per-Thread layoutMode, so a thread
// also gets a set_layout_mode command; the composer/start page (no thread) just
// updates the renderer draft value. Entering Split reconciles the tree against the
// live pane set.
export function setProductShellWorkbenchLayout(
  state: ProductShellState,
  mode: "stacked" | "split",
): ProductShellUpdateResult {
  const nextState: ProductShellState = {
    ...state,
    workbenchLayoutMode: mode,
    workbenchLayoutTree:
      mode === "split"
        ? reconcileTree(state.workbenchLayoutTree, workbenchOpenPaneIds(state))
        : state.workbenchLayoutTree,
  };
  if (state.activeThreadId === null) {
    return { state: nextState, command: null };
  }
  return {
    state: nextState,
    command: {
      kind: "workbench.command",
      payload: { threadId: state.activeThreadId, command: "set_layout_mode", data: { mode } },
    },
  };
}

// Toggle between Stacked and Split.
export function toggleProductShellWorkbenchLayoutMode(
  state: ProductShellState,
): ProductShellUpdateResult {
  return setProductShellWorkbenchLayout(
    state,
    state.workbenchLayoutMode === "split" ? "stacked" : "split",
  );
}

// Re-arrange the split tree when a pane is dropped onto another pane's edge
// (split) or center (swap).
export function applyProductShellWorkbenchDrop(
  state: ProductShellState,
  draggedPaneId: string,
  targetPaneId: string,
  zone: DropZone,
): ProductShellState {
  const tree = reconcileTree(state.workbenchLayoutTree, workbenchOpenPaneIds(state));
  if (tree === null) {
    return state;
  }
  return { ...state, workbenchLayoutTree: applyDrop(tree, draggedPaneId, targetPaneId, zone) };
}

// Resize a split after a divider drag (path = sequence of "a"/"b" to the split).
export function setProductShellWorkbenchSplitRatio(
  state: ProductShellState,
  path: ("a" | "b")[],
  ratio: number,
): ProductShellState {
  const tree = reconcileTree(state.workbenchLayoutTree, workbenchOpenPaneIds(state));
  if (tree === null) {
    return state;
  }
  return { ...state, workbenchLayoutTree: setRatioAtPath(tree, path, ratio) };
}

// Expand the active workbench pane to fill the window (focus mode), or restore.
// Forces the workbench open when entering fullscreen.
export function toggleProductShellWorkbenchFullscreen(state: ProductShellState): ProductShellState {
  const next = !state.workbenchFullscreen;
  return {
    ...state,
    workbenchFullscreen: next,
    workbenchOpen: next ? true : state.workbenchOpen,
  };
}

export function toggleProductShellWorkbenchWithLauncher(
  state: ProductShellState,
): ProductShellUpdateResult {
  const nextState = toggleProductShellWorkbench(state);
  if (state.workbenchOpen || state.activeThreadId === null) {
    return { state: nextState, command: null };
  }

  if (state.appChrome.workbenchPanes.length > 0) {
    return { state: nextState, command: null };
  }

  return {
    state: nextState,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_launcher",
      },
    },
  };
}

// Opens the Workbench (if needed) and asks Backend to open the Launcher Pane,
// the entry point for creating Browser/Terminal/Editor/Diff Panes. This is the
// "New Pane" Tab Strip action; it never closes an already-open Workbench.
export function openProductShellWorkbenchLauncher(
  state: ProductShellState,
): ProductShellUpdateResult {
  // Composer (New Thread) page: there is no backend launcher pane yet — open the
  // Workbench and focus the synthetic composer Launcher (the view-model renders it
  // as the first pane). Opening real panes from it stays renderer-local until send.
  if (state.activeThreadId === null) {
    return {
      state: {
        ...state,
        workbenchOpen: true,
        editorPickerFilter: null,
        draftActiveWorkbenchPaneId: COMPOSER_LAUNCHER_PANE_ID,
      },
      command: null,
    };
  }
  return {
    state: { ...state, workbenchOpen: true, editorPickerFilter: null },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_launcher",
      },
    },
  };
}

export function selectProductShellLauncherAction(
  state: ProductShellState,
  actionId: string,
  launcherPaneId?: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null) {
    // Composer launcher actions are dispatched through handlers that first create
    // the backend Draft Thread, then re-enter this reducer with activeThreadId set.
    return { state, command: null };
  }
  const launcher =
    state.appChrome.workbenchPanes.find(
      (pane) => pane.kind === "launcher" && pane.paneId === launcherPaneId,
    ) ??
    state.appChrome.workbenchPanes.find(
      (pane) => pane.kind === "launcher",
    );
  const action = launcher?.actions?.find((candidate) => candidate.actionId === actionId);
  // The EMPTY-workbench launcher is a synthetic, frontend-only pane (no backend
  // launcher pane), so `launcher`/`action` are undefined — but its action buttons
  // are the standard set. Allow the known launcher commands to fire even without a
  // real launcher pane (else clicking them on an empty workbench silently no-ops).
  const KNOWN_LAUNCHER_COMMANDS = ["open_terminal", "open_browser", "open_editor", "open_diff"];
  const enabledOnRealLauncher = action !== undefined && action.enabled;
  const knownOnSyntheticLauncher = launcher === undefined && KNOWN_LAUNCHER_COMMANDS.includes(actionId);
  if (!enabledOnRealLauncher && !knownOnSyntheticLauncher) {
    return { state, command: null };
  }
  if (actionId === "open_terminal") {
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "open_terminal",
          ...(launcher === undefined ? {} : { targetPaneId: launcher.paneId }),
        },
      },
    };
  }
  if (actionId === "open_diff") {
    // The git Changes pane: the backend creates/reveals the singleton "changes" pane.
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "open_diff",
          ...(launcher === undefined ? {} : { targetPaneId: launcher.paneId }),
        },
      },
    };
  }
  if (actionId === "open_browser") {
    // The Launcher is a PLACEHOLDER: the backend RESOLVES it into the new Browser
    // Pane (replace-in-slot, v1 parity). No disposition here — the backend forces a
    // fresh pane precisely when it's replacing an active launcher. Several browsers
    // come from opening several launchers (+ → launcher → resolve), not a persistent
    // launcher.
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "open_browser",
          ...(launcher === undefined ? {} : { targetPaneId: launcher.paneId }),
        },
      },
    };
  }
  if (actionId === "open_editor") {
    // The Editor launcher entry turns the Launcher pad into an in-pane file picker
    // (a searchable file list right where you clicked). Load the tree behind it; the
    // picker reads it, and choosing a file opens it in the Editor (consuming the
    // launcher). The FileTree column is NOT forced open.
    return {
      state: { ...state, editorPickerFilter: "" },
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "refresh_file_tree",
          data: { maxDepth: 12, maxEntries: 4000 },
        },
      },
    };
  }
  return { state, command: null };
}

function generateDraftThreadId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `draft-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

// Lazily create the Composer's Draft Thread and make it the ACTIVE thread, so the whole
// app (Workbench / FileTree / Editor / Terminal / Browser) operates on it through the
// normal active-thread path — no Composer-only plumbing, no per-pane special-casing. The
// chat stays the start Composer because agentChat.thread is untouched (null), and the chat
// renders on composer.mode (= agentChat.thread ? follow_up : start), not activeThreadId.
// Returns the next state + the thread.createDraft command to dispatch (null when a draft
// is already active). See docs_v2/specs/composer-draft-thread.md.
export function ensureComposerDraftThreadActive(
  state: ProductShellState,
): { state: ProductShellState; command: ProductShellBackendCommand | null } {
  if (state.draftThreadId !== null) {
    return { state, command: null };
  }
  const draftThreadId = generateDraftThreadId();
  const startOptions = state.agentChat.composer.startOptions;
  return {
    state: {
      ...state,
      draftThreadId,
      activeThreadId: draftThreadId,
      // The Draft Thread inherits the Composer's current Workbench open/closed state. Making
      // it the active thread otherwise re-derives workbenchOpen from its (initially empty)
      // pane set in applyProductShellThreadEvent and snaps the Workbench shut — e.g. opening
      // the Editor file picker, which is renderer-only state with no backend pane yet, must
      // keep the Workbench open rather than close it and strand the picker.
      workbenchOpenByThreadId: {
        ...state.workbenchOpenByThreadId,
        [draftThreadId]: state.workbenchOpen,
      },
      // Make appChrome reflect the Draft Thread so the workbench interaction handlers
      // (terminal input/resize, editor save, browser snapshot) — which operate on
      // appChrome.thread — target the draft. The backend's workbench.changed then fills
      // appChrome.workbenchPanes (preserving this thread stub). agentChat.thread stays
      // untouched, so the chat remains the start Composer.
      appChrome: {
        ...state.appChrome,
        thread: {
          threadId: draftThreadId,
          title: "New Thread",
          agentBinding: { agentId: startOptions.agentBinding.agentId },
        },
      },
    },
    command: {
      kind: "thread.createDraft",
      payload: {
        threadId: draftThreadId,
        agentBinding: startOptions.agentBinding,
        scope: startOptions.scope,
        launchOptions: startOptions.launchOptions,
      },
    },
  };
}

// Discard the Composer's Draft Thread (chip change / leaving the Composer): tell the
// backend to tear it down (kills its terminal PTYs) and drop the renderer's draft binding,
// returning the active-thread pointer to the Composer (null). No-op when there is no draft.
export function discardProductShellDraftThread(
  state: ProductShellState,
): { state: ProductShellState; command: ProductShellBackendCommand | null } {
  if (state.draftThreadId === null) {
    return { state, command: null };
  }
  const wasActive = state.activeThreadId === state.draftThreadId;
  return {
    state: {
      ...state,
      draftThreadId: null,
      activeThreadId: wasActive ? null : state.activeThreadId,
      // Clear the Draft Thread stub + its panes from appChrome (back to the Composer).
      appChrome: wasActive
        ? { ...state.appChrome, thread: null, workbenchPanes: [], activeWorkbenchPaneId: undefined }
        : state.appChrome,
    },
    command: { kind: "thread.discardDraft", payload: { threadId: state.draftThreadId } },
  };
}

// Opens an http(s) link (clicked in a chat message) in a fresh Workbench Browser
// Pane, opening the Workbench column if needed. This is the default destination
// for a chat link, so it never replaces either the app window or the page already
// open in another Browser Pane. The pane's own toolbar offers "open in external
// browser" for when the user wants their system browser.
export function openProductShellBrowserAtUrl(
  state: ProductShellState,
  url: string,
  options?: { newPane?: boolean },
): ProductShellUpdateResult {
  if (url.length === 0) {
    return { state, command: null };
  }
  if (state.activeThreadId === null) {
    return { state, command: null };
  }
  // Chat/session links default to a fresh Browser Pane so they never replace the page
  // you're already reading. Callers that explicitly want reuse can pass newPane: false.
  const data = options?.newPane === false
    ? { url }
    : { url, disposition: "new_browser_pane" as const };
  return {
    state: { ...state, workbenchOpen: true },
    command: {
      kind: "workbench.command",
      payload: { threadId: state.activeThreadId, command: "open_browser", data },
    },
  };
}

export function focusProductShellWorkbenchPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  // Untitled (renderer-owned) panes are focused renderer-locally in BOTH contexts —
  // they are not in the backend Workbench snapshot. The view-model honors this
  // override when the pane id is an untitled one.
  if (isUntitledPaneId(paneId)) {
    return { state: { ...state, draftActiveWorkbenchPaneId: paneId }, command: null };
  }
  // Composer (New Thread) page: focus is renderer-local (draft browsers + the
  // synthetic launcher/editor); there is no backend thread to focus.
  if (state.activeThreadId === null) {
    return { state: { ...state, draftActiveWorkbenchPaneId: paneId }, command: null };
  }
  const result = focusWorkbenchPane(state.appChrome, paneId);
  return {
    state: {
      ...state,
      appChrome: result.state,
      // Focusing a real backend pane drops any untitled active override.
      draftActiveWorkbenchPaneId: null,
    },
    command: result.command,
  };
}

export function closeProductShellWorkbenchPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  // Untitled (renderer-owned) panes close renderer-locally in BOTH contexts.
  if (isUntitledPaneId(paneId)) {
    return {
      state: { ...removeProductShellUntitledFile(state, paneId), editorPickerFilter: null },
      command: null,
    };
  }
  // Composer (New Thread) page before a Draft Thread exists: no backend panes yet,
  // only the synthetic launcher. Files/Browser/Terminal/Diff create a Draft Thread
  // before they become panes.
  if (state.activeThreadId === null) {
    return {
      state: {
        ...state,
        editorPickerFilter: null,
        draftActiveWorkbenchPaneId:
          state.draftActiveWorkbenchPaneId === paneId ? COMPOSER_LAUNCHER_PANE_ID : state.draftActiveWorkbenchPaneId,
        workbenchOpen: false,
      },
      command: null,
    };
  }
  const result = closeWorkbenchPane(state.appChrome, paneId);
  return {
    state: {
      ...state,
      editorPickerFilter: null,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function releaseProductShellAgentBrowserControl(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  // Composer (New Thread) page: draft browser panes have no backend agent driving.
  if (state.activeThreadId === null) {
    return { state, command: null };
  }
  const result = releaseWorkbenchAgentBrowserControl(state.appChrome, paneId);
  return {
    state: {
      ...state,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function writeProductShellTerminalInput(
  state: ProductShellState,
  paneId: string,
  bytes: string,
): ProductShellUpdateResult {
  const result = writeWorkbenchTerminalInput(state.appChrome, paneId, bytes);
  return {
    state,
    command: result.command,
  };
}

export function resizeProductShellTerminal(
  state: ProductShellState,
  paneId: string,
  cols: number,
  rows: number,
): ProductShellUpdateResult {
  const result = resizeWorkbenchTerminal(state.appChrome, paneId, cols, rows);
  return {
    state: { ...state, appChrome: result.state },
    command: result.command,
  };
}

export function workbenchPane(
  paneId: string,
  kind: AppChromeWorkbenchPaneRef["kind"],
  title: string,
): AppChromeWorkbenchPaneRef {
  return {
    paneId,
    kind,
    title,
    revision: "preview-1",
    updatedAt: shellTimestamp,
  };
}
