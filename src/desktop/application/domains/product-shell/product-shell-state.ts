import {
  applyAgentChatBackendEvent,
  createAgentChatShellState,
  createAgentChatShellViewModel,
  selectAgentChatChoiceSurfaceRow,
  setComposerActiveSurface,
  submitComposer,
  updateComposerDraft,
  type AgentChatBackendCommand,
  type AgentChatComposerSurfaceKind,
  type AgentChatBlock,
  type AgentChatBackendEvent,
  type AgentChatAgentBinding,
  type AgentChatPromptState,
  type AgentChatShellState,
  type AgentChatShellViewModel,
  type AgentChatThreadScope,
  type AgentChatThreadSummary,
  type AgentChatChoiceSurfaceView,
} from "../agent-chat/agent-chat-shell-state.ts";
import {
  applyAppChromeBackendEvent,
  closeWorkbenchPane,
  createAppChromeState,
  createAppChromeViewModel,
  focusWorkbenchPane,
  writeWorkbenchTerminalInput,
  type AppChromeBackendCommand,
  type AppChromeWorkbenchPaneRef,
  type AppChromeState,
  type AppChromeViewModel,
} from "../app-chrome/app-chrome-state.ts";

export type ProductShellAgentIdentity = "codex" | "claude" | "antigravity" | "openai_api";

export type ProductShellLeftUiMenu =
  | { kind: "thread"; threadId: string }
  | { kind: "project"; projectId: string };

export interface ProductShellThread {
  threadId: string;
  title: string;
  agentId: ProductShellAgentIdentity;
  time: string;
  scope: AgentChatThreadScope;
  launchOptions?: Record<string, unknown>;
  workbenchPanes: AppChromeWorkbenchPaneRef[];
  pinned?: boolean;
  attention?: boolean;
}

export interface ProductShellProject {
  projectId: string;
  name: string;
}

export interface ProductShellState {
  activeThreadId: string | null;
  leftUiOpen: boolean;
  workbenchOpen: boolean;
  fileTreeOpen: boolean;
  leftUiMenu: ProductShellLeftUiMenu | null;
  archiveConfirmThreadId: string | null;
  projects: ProductShellProject[];
  threads: ProductShellThread[];
  agentChat: AgentChatShellState;
  appChrome: AppChromeState;
  fileTree: ProductShellFileTreeView | null;
  editorDrafts: Record<string, ProductShellEditorDraft>;
  nextLocalThreadNumber: number;
}

export type ProductShellBackendCommand =
  | { kind: "thread.list"; payload: { includeArchived?: boolean } }
  | { kind: "thread.hydrate"; payload: { threadId: string } }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "open_launcher" | "open_browser" | "open_terminal";
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "open_editor";
        data: {
          path: string;
        };
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "refresh_file_tree";
        data: {
          maxDepth: number;
          maxEntries: number;
        };
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "save_editor_file";
        targetPaneId: string;
        data: {
          baseRevision: string;
          content: string;
        };
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "go_to_definition";
        targetPaneId: string;
        data: {
          line: number;
          character: number;
        };
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "update_browser_snapshot";
        targetPaneId: string;
        data: ProductShellBrowserSnapshot;
      };
    }
  | {
      kind: "workbench.command";
      payload: {
        threadId: string;
        command: "update_browser_action_result";
        targetPaneId: string;
        data: ProductShellBrowserActionResult;
      };
    }
  | AgentChatBackendCommand
  | AppChromeBackendCommand;

export interface CreateProductShellStateInput {
  includeFixtureData?: boolean;
}

export interface ProductShellUpdateResult {
  state: ProductShellState;
  command: ProductShellBackendCommand | null;
}

export interface ProductShellThreadView extends ProductShellThread {
  active: boolean;
  archiveConfirming: boolean;
  contextMenuOpen: boolean;
}

export interface ProductShellProjectGroupView {
  projectId: string;
  name: string;
  expanded: boolean;
  contextMenuOpen: boolean;
  threads: ProductShellThreadView[];
}

export interface ProductShellViewModel {
  activeThreadId: string | null;
  leftUiOpen: boolean;
  workbenchOpen: boolean;
  fileTreeOpen: boolean;
  pinnedThreads: ProductShellThreadView[];
  projectGroups: ProductShellProjectGroupView[];
  scratchThreads: ProductShellThreadView[];
  agentChat: AgentChatShellViewModel;
  appChrome: AppChromeViewModel;
  fileTree: ProductShellFileTreeView;
  editorDrafts: Record<string, ProductShellEditorDraft>;
}

export interface ProductShellEditorDraft {
  paneId: string;
  baseRevision: string;
  content: string;
  dirty: boolean;
  cursorOffset?: number;
}

export interface ProductShellBrowserSnapshot {
  revision: string;
  url?: string;
  pageTitle?: string;
  bodyTextPreview?: string;
  loading: boolean;
}

export interface ProductShellBrowserActionResult extends ProductShellBrowserSnapshot {
  actionId: string;
  status: "completed" | "failed";
  message: string;
}

export interface ProductShellFileTreeView {
  root?: string;
  cwdLabel: string;
  revision?: string;
  updatedAt?: string;
  entries: ProductShellFileTreeEntryView[];
  truncated?: boolean;
}

export interface ProductShellFileTreeEntryView {
  id: string;
  name: string;
  relativePath: string;
  depth: number;
  kind: "folder" | "file";
  active?: boolean;
}

const shellTimestamp = "2026-05-28T00:00:00.000Z";

const initialProjects: ProductShellProject[] = [
  { projectId: "tide", name: "tide" },
  { projectId: "slice", name: "slice" },
];

const initialThreads: ProductShellThread[] = [
  {
    threadId: "thread-master-plan",
    title: "v2 master plan implementation",
    agentId: "codex",
    time: "now",
    scope: { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" },
    workbenchPanes: [
      workbenchPane("pane-thread-master-plan-diff", "diff", "Master plan diff"),
    ],
    pinned: true,
  },
  {
    threadId: "thread-workbench",
    title: "Workbench MCP surface",
    agentId: "codex",
    time: "14m",
    scope: { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" },
    workbenchPanes: [
      workbenchPane("pane-thread-workbench-browser", "browser", "Browser preview"),
      workbenchPane("pane-thread-workbench-diff", "diff", "Review diff"),
    ],
  },
  {
    threadId: "thread-persistence",
    title: "Thread persistence cache",
    agentId: "claude",
    time: "1h",
    scope: { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" },
    workbenchPanes: [
      workbenchPane("pane-thread-persistence-editor", "editor", "Thread metadata"),
    ],
  },
  {
    threadId: "thread-visual",
    title: "Desktop shell visual pass",
    agentId: "antigravity",
    time: "2h",
    scope: { kind: "project", projectId: "slice", cwd: "/Users/eatnug/Workspace/slice" },
    workbenchPanes: [
      workbenchPane("pane-thread-visual-browser", "browser", "Visual preview"),
    ],
    attention: true,
  },
  {
    threadId: "thread-sketch",
    title: "Explore a compact composer",
    agentId: "codex",
    time: "yesterday",
    scope: { kind: "scratch", scratchCwd: "Scratch" },
    workbenchPanes: [],
  },
];

export function createProductShellState(
  input: CreateProductShellStateInput = {},
): ProductShellState {
  const includeFixtureData = input.includeFixtureData ?? true;
  return {
    activeThreadId: null,
    leftUiOpen: true,
    workbenchOpen: false,
    fileTreeOpen: false,
    leftUiMenu: null,
    archiveConfirmThreadId: null,
    projects: includeFixtureData ? initialProjects : [],
    threads: includeFixtureData ? initialThreads : [],
    agentChat: createStartAgentChatState(),
    appChrome: createAppChromeState(),
    fileTree: null,
    editorDrafts: {},
    nextLocalThreadNumber: 1,
  };
}

export function createProductShellViewModel(
  state: ProductShellState,
): ProductShellViewModel {
  return {
    activeThreadId: state.activeThreadId,
    leftUiOpen: state.leftUiOpen,
    workbenchOpen: state.workbenchOpen,
    fileTreeOpen: state.fileTreeOpen,
    pinnedThreads: state.threads
      .filter((thread) => thread.pinned)
      .map((thread) => toThreadView(thread, state)),
    projectGroups: state.projects.map((project, index) => ({
      ...project,
      expanded: index === 0,
      contextMenuOpen:
        state.leftUiMenu?.kind === "project" && state.leftUiMenu.projectId === project.projectId,
      threads: state.threads
        .filter((thread) => thread.scope.kind === "project")
        .filter((thread) => thread.scope.kind === "project" && thread.scope.projectId === project.projectId)
        .map((thread) => toThreadView(thread, state)),
    })),
    scratchThreads: state.threads
      .filter((thread) => thread.scope.kind === "scratch")
      .map((thread) => toThreadView(thread, state)),
    agentChat: createAgentChatShellViewModel(state.agentChat),
    appChrome: createAppChromeViewModel(state.appChrome),
    fileTree: createFileTreeView(state),
    editorDrafts: state.editorDrafts,
  };
}

export function startNewProductShellThread(
  state: ProductShellState,
): ProductShellState {
  return {
    ...state,
    activeThreadId: null,
    workbenchOpen: false,
    fileTreeOpen: false,
    leftUiMenu: null,
    archiveConfirmThreadId: null,
    agentChat: createStartAgentChatState(),
    appChrome: createAppChromeState(),
    fileTree: null,
    editorDrafts: {},
  };
}

export function toggleProductShellLeftUi(state: ProductShellState): ProductShellState {
  return {
    ...state,
    leftUiOpen: !state.leftUiOpen,
  };
}

export function toggleProductShellWorkbench(state: ProductShellState): ProductShellState {
  return {
    ...state,
    workbenchOpen: !state.workbenchOpen,
  };
}

export function toggleProductShellWorkbenchWithLauncher(
  state: ProductShellState,
): ProductShellUpdateResult {
  const nextState = toggleProductShellWorkbench(state);
  if (state.workbenchOpen || state.activeThreadId === null) {
    return { state: nextState, command: null };
  }

  const hasVisiblePane = state.appChrome.workbenchPanes.some((pane) => pane.visible);
  if (hasVisiblePane) {
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

export function toggleProductShellFileTree(state: ProductShellState): ProductShellState {
  return {
    ...state,
    fileTreeOpen: !state.fileTreeOpen,
  };
}

export function toggleProductShellFileTreeWithRefresh(
  state: ProductShellState,
): ProductShellUpdateResult {
  const nextState = toggleProductShellFileTree(state);
  if (state.fileTreeOpen || state.activeThreadId === null) {
    return { state: nextState, command: null };
  }

  return {
    state: nextState,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "refresh_file_tree",
        data: {
          maxDepth: 2,
          maxEntries: 160,
        },
      },
    },
  };
}

export function setProductShellComposerActiveSurface(
  state: ProductShellState,
  surface: AgentChatComposerSurfaceKind | null,
): ProductShellState {
  return {
    ...state,
    agentChat: setComposerActiveSurface(state.agentChat, surface).state,
  };
}

export function selectProductShellChoiceSurfaceRow(
  state: ProductShellState,
  surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
  rowId: string,
): ProductShellUpdateResult {
  const result = selectAgentChatChoiceSurfaceRow(state.agentChat, surfaceKind, rowId);
  return {
    state: {
      ...state,
      agentChat: result.state,
    },
    command: result.command,
  };
}

export function selectProductShellLauncherAction(
  state: ProductShellState,
  actionId: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null) {
    return { state, command: null };
  }
  const launcher = state.appChrome.workbenchPanes.find(
    (pane) => pane.kind === "launcher" && pane.visible,
  );
  const action = launcher?.actions?.find((candidate) => candidate.actionId === actionId);
  if (action === undefined || !action.enabled) {
    return { state, command: null };
  }
  if (action.actionId === "open_terminal") {
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "open_terminal",
        },
      },
    };
  }
  if (action.actionId === "open_browser") {
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "open_browser",
        },
      },
    };
  }
  if (action.actionId === "open_file_tree") {
    return {
      state: {
        ...state,
        fileTreeOpen: true,
      },
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "refresh_file_tree",
          data: {
            maxDepth: 2,
            maxEntries: 160,
          },
        },
      },
    };
  }
  return { state, command: null };
}

export function selectProductShellFileTreeEntry(
  state: ProductShellState,
  entryId: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null || state.fileTree === null) {
    return { state, command: null };
  }
  const entry = state.fileTree.entries.find(
    (candidate) => candidate.id === entryId || candidate.relativePath === entryId,
  );
  if (entry === undefined || entry.kind !== "file") {
    return { state, command: null };
  }

  return {
    state: {
      ...state,
      workbenchOpen: true,
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_editor",
        data: {
          path: entry.relativePath,
        },
      },
    },
  };
}

export function openProductShellLeftUiMenu(
  state: ProductShellState,
  menu: ProductShellLeftUiMenu | null,
): ProductShellState {
  return {
    ...state,
    leftUiMenu: menu,
    archiveConfirmThreadId: null,
  };
}

export function showProductShellThreadArchiveConfirm(
  state: ProductShellState,
  threadId: string,
): ProductShellState {
  return {
    ...state,
    leftUiMenu: null,
    archiveConfirmThreadId: threadId,
  };
}

export function clearProductShellLeftUiTransientState(
  state: ProductShellState,
): ProductShellState {
  return {
    ...state,
    leftUiMenu: null,
    archiveConfirmThreadId: null,
  };
}

export function applyProductShellPromptState(
  state: ProductShellState,
  prompt: AgentChatPromptState | null,
): ProductShellState {
  return {
    ...state,
    agentChat: applyAgentChatBackendEvent(state.agentChat, {
      kind: "prompt.changed",
      payload: { prompt },
    }),
    appChrome: applyAppChromeBackendEvent(state.appChrome, {
      kind: "prompt.changed",
      payload: { prompt },
    }),
  };
}

export function openProductShellThread(
  state: ProductShellState,
  threadId: string,
): ProductShellState {
  const thread = state.threads.find((candidate) => candidate.threadId === threadId);
  if (!thread) {
    return state;
  }

  return hydrateProductShellThread(state, thread, previewBlocksForThread(thread));
}

export function openProductShellThreadFromLeftUi(
  state: ProductShellState,
  threadId: string,
  input: { backendTransportAvailable: boolean },
): ProductShellUpdateResult {
  if (!input.backendTransportAvailable) {
    return { state: openProductShellThread(state, threadId), command: null };
  }

  return {
    state: {
      ...state,
      leftUiMenu: null,
      archiveConfirmThreadId: null,
    },
    command: {
      kind: "thread.hydrate",
      payload: { threadId },
    },
  };
}

export function updateProductShellComposerDraft(
  state: ProductShellState,
  draft: string,
): ProductShellState {
  return {
    ...state,
    agentChat: updateComposerDraft(state.agentChat, draft).state,
  };
}

export function sendProductShellComposerDraft(
  state: ProductShellState,
): ProductShellState {
  return submitProductShellComposerDraft(state).state;
}

export function submitProductShellComposerDraft(
  state: ProductShellState,
): ProductShellUpdateResult {
  const input = state.agentChat.composer.draft.trim();
  if (input.length === 0) {
    return { state, command: null };
  }

  const result = submitComposer(state.agentChat);
  return {
    state: result.state === state.agentChat ? state : { ...state, agentChat: result.state },
    command: result.command,
  };
}

export function applyProductShellBackendEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  const applyToActiveSurfaces = shouldApplyBackendEventToActiveSurfaces(state, event);
  const agentChat = applyToActiveSurfaces
    ? applyAgentChatBackendEvent(state.agentChat, event)
    : state.agentChat;
  const appChrome = applyToActiveSurfaces
    ? applyAppChromeBackendEvent(state.appChrome, event)
    : state.appChrome;
  const nextState = {
    ...state,
    agentChat,
    appChrome,
  };

  switch (event.kind) {
    case "thread.listed":
      return applyProductShellThreadListEvent(nextState, event);
    case "thread.started":
    case "thread.hydrated":
      return applyProductShellThreadEvent(nextState, event);
    case "agentRuntime.stateChanged": {
      const payload = event.payload as { state?: string };
      if (!applyToActiveSurfaces) {
        return nextState;
      }
      return payload.state === "running"
        ? {
            ...nextState,
            agentChat: updateComposerDraft(nextState.agentChat, "").state,
          }
        : nextState;
    }
    case "workbench.changed": {
      const payload = event.payload as {
        threadId?: string;
        panes?: AppChromeWorkbenchPaneRef[];
        fileTree?: unknown;
      };
      if (
        state.activeThreadId !== null &&
        payload.threadId !== undefined &&
        payload.threadId !== state.activeThreadId
      ) {
        return state;
      }
      const panes = payload.panes ?? [];
      const threadId = payload.threadId ?? state.activeThreadId;
      return {
        ...nextState,
        threads:
          threadId === null
            ? nextState.threads
            : nextState.threads.map((thread) =>
                thread.threadId === threadId
                  ? { ...thread, workbenchPanes: panes }
                  : thread,
              ),
        workbenchOpen: panes.some((pane) => pane.visible),
        fileTree:
          payload.fileTree === undefined
            ? nextState.fileTree
            : productShellFileTreeFromPayload(payload.fileTree),
        editorDrafts: reconcileEditorDrafts(nextState.editorDrafts, panes),
      };
    }
    default:
      return nextState;
  }
}

function shouldApplyBackendEventToActiveSurfaces(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): boolean {
  if (
    event.kind === "thread.listed" ||
    event.kind === "thread.started" ||
    event.kind === "thread.hydrated"
  ) {
    return true;
  }
  const eventThreadId = threadIdFromBackendEvent(event);
  if (eventThreadId === undefined || state.activeThreadId === null) {
    return true;
  }
  return eventThreadId === state.activeThreadId;
}

function threadIdFromBackendEvent(event: AgentChatBackendEvent): string | undefined {
  switch (event.kind) {
    case "agentRuntime.stateChanged":
    case "providerReadiness.changed":
    case "prompt.changed":
    case "agentSessionBlock.completed":
    case "workbench.changed": {
      const payload = event.payload as { threadId?: unknown };
      return typeof payload.threadId === "string" ? payload.threadId : undefined;
    }
    case "agentSessionBlock.upserted": {
      const payload = event.payload as { block?: { threadId?: unknown } };
      return typeof payload.block?.threadId === "string" ? payload.block.threadId : undefined;
    }
    default:
      return undefined;
  }
}

function applyProductShellThreadListEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  const payload = event.payload as { threads?: AgentChatThreadSummary[] };
  const threads = (payload.threads ?? [])
    .filter((thread) => !thread.archived)
    .map(toProductShellThreadFromSummary);
  const activeThreadId = threads.some((thread) => thread.threadId === state.activeThreadId)
    ? state.activeThreadId
    : null;

  return {
    ...state,
    activeThreadId,
    projects: projectsFromThreads(threads),
    threads,
    leftUiMenu: null,
    archiveConfirmThreadId: null,
    fileTree: null,
    editorDrafts: {},
  };
}

export function focusProductShellWorkbenchPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const result = focusWorkbenchPane(state.appChrome, paneId);
  return {
    state: {
      ...state,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function closeProductShellWorkbenchPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const result = closeWorkbenchPane(state.appChrome, paneId);
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
    state: {
      ...state,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function editProductShellWorkbenchEditorPane(
  state: ProductShellState,
  paneId: string,
  content: string,
): ProductShellState {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (pane === undefined || pane.truncated === true) {
    return state;
  }
  const baseContent = pane.bodyText ?? pane.bodyTextPreview ?? "";
  return {
    ...state,
    editorDrafts: {
      ...state.editorDrafts,
      [paneId]: {
        paneId,
        baseRevision: pane.revision,
        content,
        dirty: content !== baseContent,
        cursorOffset: Math.min(
          state.editorDrafts[paneId]?.cursorOffset ?? content.length,
          content.length,
        ),
      },
    },
  };
}

export function moveProductShellEditorCursor(
  state: ProductShellState,
  paneId: string,
  cursorOffset: number,
): ProductShellState {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (pane === undefined || pane.truncated === true) {
    return state;
  }
  const currentDraft = state.editorDrafts[paneId];
  const content = currentDraft?.content ?? pane.bodyText ?? pane.bodyTextPreview ?? "";
  const boundedOffset = Math.max(0, Math.min(Math.floor(cursorOffset), content.length));

  return {
    ...state,
    editorDrafts: {
      ...state.editorDrafts,
      [paneId]: {
        paneId,
        baseRevision: currentDraft?.baseRevision ?? pane.revision,
        content,
        dirty: currentDraft?.dirty ?? false,
        cursorOffset: boundedOffset,
      },
    },
  };
}

export function goToProductShellEditorDefinition(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (state.activeThreadId === null || pane === undefined || pane.truncated === true) {
    return { state, command: null };
  }
  const draft = state.editorDrafts[paneId];
  const content = draft?.content ?? pane.bodyText ?? pane.bodyTextPreview ?? "";
  const position = offsetToLineCharacter(content, draft?.cursorOffset ?? 0);

  return {
    state: {
      ...state,
      appChrome: {
        ...state.appChrome,
        activeWorkbenchPaneId: paneId,
      },
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "go_to_definition",
        targetPaneId: paneId,
        data: position,
      },
    },
  };
}

export function updateProductShellBrowserSnapshot(
  state: ProductShellState,
  paneId: string,
  snapshot: ProductShellBrowserSnapshot,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "browser",
  );
  if (
    state.activeThreadId === null ||
    pane === undefined ||
    snapshot.revision !== pane.revision
  ) {
    return { state, command: null };
  }

  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "update_browser_snapshot",
        targetPaneId: paneId,
        data: snapshot,
      },
    },
  };
}

export function updateProductShellBrowserActionResult(
  state: ProductShellState,
  paneId: string,
  result: ProductShellBrowserActionResult,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "browser",
  );
  if (
    state.activeThreadId === null ||
    pane === undefined ||
    result.revision !== pane.revision ||
    pane.pendingAction?.actionId !== result.actionId
  ) {
    return { state, command: null };
  }

  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "update_browser_action_result",
        targetPaneId: paneId,
        data: result,
      },
    },
  };
}

export function saveProductShellWorkbenchEditorPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  const draft = state.editorDrafts[paneId];
  if (
    state.activeThreadId === null ||
    pane === undefined ||
    pane.truncated === true ||
    draft === undefined ||
    !draft.dirty
  ) {
    return { state, command: null };
  }
  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "save_editor_file",
        targetPaneId: paneId,
        data: {
          baseRevision: draft.baseRevision,
          content: draft.content,
        },
      },
    },
  };
}

function toProductShellThreadFromSummary(
  threadSummary: AgentChatThreadSummary,
): ProductShellThread {
  return {
    threadId: threadSummary.threadId,
    title: threadSummary.title,
    agentId: normalizeAgentId(threadSummary.agentBinding.agentId),
    time: "now",
    scope: threadSummary.scope,
    launchOptions: cloneLaunchOptions(threadSummary.launchOptions),
    workbenchPanes: [],
    pinned: threadSummary.pinned,
    attention:
      threadSummary.lastKnownState === "waiting_for_input" ||
      threadSummary.lastKnownState === "waiting_for_approval",
  };
}

function projectsFromThreads(threads: ProductShellThread[]): ProductShellProject[] {
  const projects = new Map<string, ProductShellProject>();
  for (const thread of threads) {
    if (thread.scope.kind !== "project") {
      continue;
    }
    if (!projects.has(thread.scope.projectId)) {
      projects.set(thread.scope.projectId, {
        projectId: thread.scope.projectId,
        name: thread.scope.projectId,
      });
    }
  }
  return [...projects.values()];
}

function reconcileEditorDrafts(
  drafts: Record<string, ProductShellEditorDraft>,
  panes: AppChromeWorkbenchPaneRef[],
): Record<string, ProductShellEditorDraft> {
  const next: Record<string, ProductShellEditorDraft> = {};
  for (const pane of panes) {
    if (pane.kind !== "editor" || pane.visible === false || pane.truncated === true) {
      continue;
    }
    const draft = drafts[pane.paneId];
    if (draft === undefined) {
      continue;
    }
    const baseContent = pane.bodyText ?? pane.bodyTextPreview ?? "";
    if (draft.baseRevision === pane.revision) {
      next[pane.paneId] = draft;
      continue;
    }
    if (draft.content !== baseContent) {
      next[pane.paneId] = {
        paneId: pane.paneId,
        baseRevision: pane.revision,
        content: baseContent,
        dirty: false,
        cursorOffset: 0,
      };
    }
  }
  return next;
}

function offsetToLineCharacter(
  content: string,
  offset: number,
): { line: number; character: number } {
  const boundedOffset = Math.max(0, Math.min(Math.floor(offset), content.length));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < boundedOffset; index += 1) {
    if (content[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return {
    line,
    character: boundedOffset - lineStart,
  };
}

function hydrateProductShellThread(
  state: ProductShellState,
  thread: ProductShellThread,
  blocks: AgentChatBlock[],
): ProductShellState {
  const threadSummary = toAgentChatThreadSummary(thread);
  const agentChat = applyAgentChatBackendEvent(createStartAgentChatState(), {
    kind: "thread.hydrated",
    payload: {
      thread: threadSummary,
      blocks,
      runtimeState: "idle",
      workbenchPanes: thread.workbenchPanes.filter((pane) => pane.visible),
    },
  });
  const appChrome = applyAppChromeBackendEvent(createAppChromeState(), {
    kind: "thread.hydrated",
    payload: {
      thread: {
        threadId: thread.threadId,
        title: thread.title,
        agentBinding: agentBindingForShellAgent(thread.agentId),
        launchOptions: cloneLaunchOptions(thread.launchOptions),
      },
      runtimeState: "idle",
      workbenchPanes: thread.workbenchPanes.filter((pane) => pane.visible),
    },
  });

  return {
    ...state,
    activeThreadId: thread.threadId,
    agentChat: updateComposerDraft(agentChat, "").state,
    appChrome,
    workbenchOpen: thread.workbenchPanes.some((pane) => pane.visible),
    leftUiMenu: null,
    archiveConfirmThreadId: null,
    fileTree: null,
    editorDrafts: {},
  };
}

function createFileTreeView(state: ProductShellState): ProductShellFileTreeView {
  if (state.fileTree !== null) {
    return cloneProductShellFileTree(state.fileTree);
  }

  const thread = state.threads.find((candidate) => candidate.threadId === state.activeThreadId);
  const cwdLabel =
    thread?.scope.kind === "project"
      ? thread.scope.projectId
      : thread?.scope.scratchCwd || "tide";

  return {
    cwdLabel,
    entries: [],
  };
}

function productShellFileTreeFromPayload(
  payload: unknown,
): ProductShellFileTreeView | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const entries = Array.isArray(record.entries)
    ? record.entries.flatMap(productShellFileTreeEntryFromPayload)
    : [];
  const view: ProductShellFileTreeView = {
    cwdLabel:
      typeof record.cwdLabel === "string" && record.cwdLabel.length > 0
        ? record.cwdLabel
        : "tide",
    entries,
  };

  if (typeof record.root === "string") {
    view.root = record.root;
  }
  if (typeof record.revision === "string") {
    view.revision = record.revision;
  }
  if (typeof record.updatedAt === "string") {
    view.updatedAt = record.updatedAt;
  }
  if (typeof record.truncated === "boolean") {
    view.truncated = record.truncated;
  }

  return view;
}

function productShellFileTreeEntryFromPayload(
  payload: unknown,
): ProductShellFileTreeEntryView[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.relativePath !== "string" ||
    typeof record.depth !== "number" ||
    !Number.isInteger(record.depth) ||
    (record.kind !== "folder" && record.kind !== "file")
  ) {
    return [];
  }

  return [
    {
      id: record.id,
      name: record.name,
      relativePath: record.relativePath,
      depth: Math.max(0, record.depth),
      kind: record.kind,
      active: record.active === true,
    },
  ];
}

function cloneProductShellFileTree(
  fileTree: ProductShellFileTreeView,
): ProductShellFileTreeView {
  return {
    ...fileTree,
    entries: fileTree.entries.map((entry) => ({ ...entry })),
  };
}

function applyProductShellThreadEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  const payload = event.payload as {
    thread?: AgentChatThreadSummary;
    workbenchPanes?: AppChromeWorkbenchPaneRef[];
    fileTree?: unknown;
  };
  const threadSummary = payload.thread;
  if (!threadSummary) {
    return state;
  }

  const shellThread: ProductShellThread = {
    threadId: threadSummary.threadId,
    title: threadSummary.title,
    agentId: normalizeAgentId(threadSummary.agentBinding.agentId),
    time: "now",
    scope: threadSummary.scope,
    launchOptions: cloneLaunchOptions(threadSummary.launchOptions),
    workbenchPanes: payload.workbenchPanes ?? [],
    pinned: threadSummary.pinned,
    attention:
      threadSummary.lastKnownState === "waiting_for_input" ||
      threadSummary.lastKnownState === "waiting_for_approval",
  };
  const existingThread = state.threads.find(
    (candidate) => candidate.threadId === threadSummary.threadId,
  );
  const threads = existingThread
    ? state.threads.map((thread) =>
        thread.threadId === threadSummary.threadId ? { ...thread, ...shellThread } : thread,
      )
    : [shellThread, ...state.threads];

  return {
    ...state,
    activeThreadId: threadSummary.threadId,
    threads,
    agentChat: updateComposerDraft(state.agentChat, "").state,
    workbenchOpen: shellThread.workbenchPanes.some((pane) => pane.visible),
    fileTree:
      payload.fileTree === undefined
        ? null
        : productShellFileTreeFromPayload(payload.fileTree),
  };
}

function createStartAgentChatState(): AgentChatShellState {
  return createAgentChatShellState({
    startOptions: {
      agentBinding: agentBindingForShellAgent("codex"),
      scope: { kind: "project", projectId: "tide", cwd: "/Users/eatnug/Workspace/tide" },
      launchOptions: {
        model: "gpt-5.5",
        permission: "Auto-review",
        worktree: "current folder",
        branch: "main",
      },
    },
  });
}

function toThreadView(
  thread: ProductShellThread,
  state: ProductShellState,
): ProductShellThreadView {
  return {
    ...thread,
    active: thread.threadId === state.activeThreadId,
    archiveConfirming: state.archiveConfirmThreadId === thread.threadId,
    contextMenuOpen:
      state.leftUiMenu?.kind === "thread" && state.leftUiMenu.threadId === thread.threadId,
  };
}

function toAgentChatThreadSummary(thread: ProductShellThread): AgentChatThreadSummary {
  return {
    threadId: thread.threadId,
    title: thread.title,
    agentBinding: agentBindingForShellAgent(thread.agentId),
    scope: thread.scope,
    launchOptions: cloneLaunchOptions(thread.launchOptions),
    context: { worktree: "current folder", branch: "main" },
    createdAt: shellTimestamp,
    updatedAt: shellTimestamp,
    pinned: Boolean(thread.pinned),
    archived: false,
    lastKnownState: thread.attention ? "waiting_for_input" : "idle",
  };
}

function previewBlocksForThread(thread: ProductShellThread): AgentChatBlock[] {
  return [
    {
      blockId: `${thread.threadId}-preview`,
      threadId: thread.threadId,
      agentId: thread.agentId,
      kind: "agent_text",
      role: "agent",
      status: "complete",
      title: "Thread ready",
      body: `${thread.title} is loaded as a local Product Shell preview.`,
      updatedAt: shellTimestamp,
    },
  ];
}

function normalizeAgentId(agentId: string): ProductShellAgentIdentity {
  if (agentId === "claude" || agentId === "antigravity" || agentId === "openai_api") {
    return agentId;
  }
  return "codex";
}

function agentBindingForShellAgent(agentId: ProductShellAgentIdentity): AgentChatAgentBinding {
  if (agentId === "openai_api") {
    return {
      agentId,
      runtimeSource: { kind: "tide_api", provider: "openai" },
    };
  }
  return {
    agentId,
    runtimeSource: { kind: "provider_cli", integrationId: agentId },
  };
}

function cloneLaunchOptions(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return launchOptions === undefined ? undefined : { ...launchOptions };
}

function workbenchPane(
  paneId: string,
  kind: AppChromeWorkbenchPaneRef["kind"],
  title: string,
): AppChromeWorkbenchPaneRef {
  return {
    paneId,
    kind,
    title,
    visible: true,
    revision: "preview-1",
    updatedAt: shellTimestamp,
  };
}
