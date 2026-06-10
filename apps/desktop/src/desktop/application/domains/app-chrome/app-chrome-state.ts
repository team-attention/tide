export type AppChromeRuntimeState =
  | "not_started"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "idle"
  | "stopping"
  | "stopped"
  | "failed";

export type AppChromeConnectionState =
  | "backend_disconnected"
  | "starting"
  | "handshaking"
  | "connected"
  | "renderer_reconnecting";

export type AppChromeWorkbenchPaneKind =
  | "browser"
  | "diff"
  | "editor"
  | "terminal"
  | "launcher";

export interface AppChromeThreadSummary {
  threadId: string;
  title: string;
  agentBinding: {
    agentId: string;
  };
}

export interface AppChromeWorkbenchPaneRef {
  paneId: string;
  kind: AppChromeWorkbenchPaneKind;
  title: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
  loading?: boolean;
  url?: string;
  pageTitle?: string;
  pendingAction?: AppChromeBrowserPaneAction;
  lastAction?: AppChromeBrowserPaneActionResult;
  filePath?: string;
  relativePath?: string;
  bodyText?: string;
  bodyTextPreview?: string;
  byteLength?: number;
  truncated?: boolean;
  navigationTarget?: AppChromeEditorNavigationTarget;
  references?: AppChromeEditorReferenceList;
  diffText?: string;
  beforeByteLength?: number;
  afterByteLength?: number;
  command?: string;
  args?: string[];
  cwd?: string;
  status?: "ready" | "running" | "completed" | "failed";
  expectedCompletion?: "process_exit" | "retry_preflight";
  transcriptPreview?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  actions?: AppChromeLauncherPaneAction[];
}

export interface AppChromeBrowserPaneAction {
  actionId: string;
  kind: "click" | "type_text";
  selector: string;
  text?: string;
  requestedAt: string;
}

export interface AppChromeBrowserPaneActionResult extends AppChromeBrowserPaneAction {
  status: "completed" | "failed";
  message: string;
  completedAt: string;
}

export interface AppChromeEditorNavigationTarget {
  line: number;
  character: number;
  length?: number;
  label?: string;
  sourcePaneId?: string;
}

export interface AppChromeEditorReference {
  relativePath: string;
  line: number;
  character: number;
  length?: number;
  label?: string;
}

export interface AppChromeEditorReferenceList {
  query?: string;
  items: AppChromeEditorReference[];
  truncated: boolean;
}

export interface AppChromeLauncherPaneAction {
  actionId: "open_browser" | "open_editor" | "open_terminal" | "open_diff" | "open_file_tree";
  label: string;
  description: string;
  enabled: boolean;
}

export interface AppChromeState {
  backendConnectionState: AppChromeConnectionState;
  thread: AppChromeThreadSummary | null;
  runtimeState: AppChromeRuntimeState;
  providerReadinessNeedsAttention: boolean;
  promptNeedsAttention: boolean;
  workbenchPanes: AppChromeWorkbenchPaneRef[];
  activeWorkbenchPaneId?: string;
  loadingActionId?: string;
  errorMessage?: string;
}

export interface AppChromeViewModel {
  statusBar: AppChromeStatusBarView;
  workbenchTabStrip: WorkbenchTabStripView;
  activeWorkbenchPane?: AppChromeWorkbenchPaneRef;
  // All visible panes (full refs), in tab order — for split-mode tiling. In
  // tab-group mode only activeWorkbenchPane is shown.
  visibleWorkbenchPanes: AppChromeWorkbenchPaneRef[];
  errorMessage?: string;
}

export interface AppChromeStatusBarView {
  backendConnectionState: AppChromeConnectionState;
  runtimeState: AppChromeRuntimeState;
  agentLabel?: string;
  providerReadinessNeedsAttention: boolean;
  promptNeedsAttention: boolean;
}

export interface WorkbenchTabStripView {
  visible: boolean;
  visibleTabs: WorkbenchTabView[];
  overflowTabs: WorkbenchTabView[];
}

export interface WorkbenchTabView {
  paneId: string;
  kind: AppChromeWorkbenchPaneKind;
  title: string;
  active: boolean;
  loading: boolean;
  revision: string;
  focusAction: ChromeActionView;
  closeAction: ChromeActionView;
}

export type ChromeActionState =
  | "default"
  | "active"
  | "disabled"
  | "loading"
  | "attention";

export interface ChromeActionView {
  id: string;
  icon: string;
  tooltip: string;
  accessibleLabel: string;
  state: ChromeActionState;
  disabled: boolean;
}

export type AppChromeBackendCommand = {
  kind: "workbench.command";
  payload:
    | {
        threadId: string;
        command: "focus_pane" | "close_pane";
        targetPaneId: string;
      }
    | {
        threadId: string;
        command: "write_terminal_input";
        targetPaneId: string;
        data: { bytes: string };
      }
    | {
        threadId: string;
        command: "resize_terminal";
        targetPaneId: string;
        data: { cols: number; rows: number };
      };
};

export interface AppChromeUpdateResult {
  state: AppChromeState;
  command: AppChromeBackendCommand | null;
}

export interface AppChromeBackendEvent {
  kind: string;
  payload: Record<string, unknown>;
}

export interface AppChromeViewOptions {
  maxVisibleTabs?: number;
}

const DEFAULT_MAX_VISIBLE_TABS = 6;

export function createAppChromeState(): AppChromeState {
  return {
    backendConnectionState: "connected",
    thread: null,
    runtimeState: "not_started",
    providerReadinessNeedsAttention: false,
    promptNeedsAttention: false,
    workbenchPanes: [],
  };
}

export function applyAppChromeBackendEvent(
  state: AppChromeState,
  event: AppChromeBackendEvent,
): AppChromeState {
  switch (event.kind) {
    case "backend.connectionChanged": {
      const payload = event.payload as { state?: AppChromeConnectionState };
      return {
        ...state,
        backendConnectionState: payload.state ?? state.backendConnectionState,
      };
    }
    case "thread.hydrated": {
      const payload = event.payload as {
        thread: AppChromeThreadSummary;
        runtimeState?: AppChromeRuntimeState;
        workbenchPanes?: AppChromeWorkbenchPaneRef[];
      };
      return {
        ...state,
        thread: payload.thread,
        runtimeState: payload.runtimeState ?? state.runtimeState,
        workbenchPanes: payload.workbenchPanes ?? state.workbenchPanes,
        activeWorkbenchPaneId:
          firstVisiblePaneId(payload.workbenchPanes ?? state.workbenchPanes) ??
          state.activeWorkbenchPaneId,
      };
    }
    case "thread.started": {
      const payload = event.payload as {
        thread: AppChromeThreadSummary;
        runtimeState?: AppChromeRuntimeState;
      };
      return {
        ...state,
        thread: payload.thread,
        runtimeState: payload.runtimeState ?? state.runtimeState,
      };
    }
    case "agentRuntime.stateChanged": {
      const payload = event.payload as {
        threadId?: string;
        state?: AppChromeRuntimeState;
      };
      if (state.thread && payload.threadId !== state.thread.threadId) {
        return state;
      }
      return {
        ...state,
        runtimeState: payload.state ?? state.runtimeState,
      };
    }
    case "providerReadiness.changed": {
      const payload = event.payload as { readiness?: { ready?: boolean } };
      return {
        ...state,
        providerReadinessNeedsAttention: payload.readiness?.ready === false,
      };
    }
    case "prompt.changed": {
      return {
        ...state,
        promptNeedsAttention: event.payload.prompt !== null,
      };
    }
    case "workbench.changed": {
      const payload = event.payload as {
        threadId?: string;
        panes?: AppChromeWorkbenchPaneRef[];
        activePaneId?: string;
      };
      if (state.thread && payload.threadId !== state.thread.threadId) {
        return state;
      }
      const panes = payload.panes ?? [];
      return {
        ...state,
        workbenchPanes: panes,
        activeWorkbenchPaneId:
          payload.activePaneId && paneExists(panes, payload.activePaneId)
            ? payload.activePaneId
            : state.activeWorkbenchPaneId && paneExists(panes, state.activeWorkbenchPaneId)
            ? state.activeWorkbenchPaneId
            : firstVisiblePaneId(panes),
      };
    }
    case "contract.error": {
      const payload = event.payload as { message?: string };
      return {
        ...state,
        errorMessage: payload.message ?? "Contract error",
      };
    }
    default:
      return state;
  }
}

export function createAppChromeViewModel(
  state: AppChromeState,
  options: AppChromeViewOptions = {},
): AppChromeViewModel {
  const maxVisibleTabs = options.maxVisibleTabs ?? DEFAULT_MAX_VISIBLE_TABS;
  const visiblePanes = state.workbenchPanes.filter((pane) => pane.visible);
  const tabs = visiblePanes.map((pane) => toWorkbenchTabView(pane, state));
  const activeWorkbenchPane =
    visiblePanes.find((pane) => pane.paneId === state.activeWorkbenchPaneId) ??
    visiblePanes[0];

  return {
    statusBar: {
      backendConnectionState: state.backendConnectionState,
      runtimeState: state.runtimeState,
      agentLabel: state.thread
        ? formatAgentLabel(state.thread.agentBinding.agentId)
        : undefined,
      providerReadinessNeedsAttention: state.providerReadinessNeedsAttention,
      promptNeedsAttention: state.promptNeedsAttention,
    },
    workbenchTabStrip: {
      visible: tabs.length > 0,
      visibleTabs: tabs.slice(0, maxVisibleTabs),
      overflowTabs: tabs.slice(maxVisibleTabs),
    },
    activeWorkbenchPane,
    visibleWorkbenchPanes: visiblePanes,
    errorMessage: state.errorMessage,
  };
}

export function focusWorkbenchPane(
  state: AppChromeState,
  paneId: string,
): AppChromeUpdateResult {
  if (!state.thread || !paneExists(state.workbenchPanes, paneId)) {
    return { state, command: null };
  }
  return {
    state: {
      ...state,
      activeWorkbenchPaneId: paneId,
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.thread.threadId,
        command: "focus_pane",
        targetPaneId: paneId,
      },
    },
  };
}

export function closeWorkbenchPane(
  state: AppChromeState,
  paneId: string,
): AppChromeUpdateResult {
  if (!state.thread || !paneExists(state.workbenchPanes, paneId)) {
    return { state, command: null };
  }
  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.thread.threadId,
        command: "close_pane",
        targetPaneId: paneId,
      },
    },
  };
}

export function writeWorkbenchTerminalInput(
  state: AppChromeState,
  paneId: string,
  bytes: string,
): AppChromeUpdateResult {
  const pane = state.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.visible,
  );
  if (!state.thread || pane?.kind !== "terminal" || pane.status !== "running" || bytes.length === 0) {
    return { state, command: null };
  }

  return {
    state: {
      ...state,
      activeWorkbenchPaneId: paneId,
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.thread.threadId,
        command: "write_terminal_input",
        targetPaneId: paneId,
        data: { bytes },
      },
    },
  };
}

// Tells the backend to resize the PTY to match the rendered terminal grid, so the
// shell wraps + redraws correctly. Does not change visible state (no activePane
// side effects) — it's a pure transport for cols/rows.
export function resizeWorkbenchTerminal(
  state: AppChromeState,
  paneId: string,
  cols: number,
  rows: number,
): AppChromeUpdateResult {
  const pane = state.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.visible,
  );
  if (!state.thread || pane?.kind !== "terminal" || pane.status !== "running") {
    return { state, command: null };
  }
  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.thread.threadId,
        command: "resize_terminal",
        targetPaneId: paneId,
        data: { cols, rows },
      },
    },
  };
}

export function setChromeActionLoading(
  state: AppChromeState,
  loadingActionId: string,
): AppChromeState {
  return {
    ...state,
    loadingActionId,
  };
}

function toWorkbenchTabView(
  pane: AppChromeWorkbenchPaneRef,
  state: AppChromeState,
): WorkbenchTabView {
  const focusActionId = `focus:${pane.paneId}`;
  const closeActionId = `close:${pane.paneId}`;
  const anyActionLoading = state.loadingActionId !== undefined;

  return {
    paneId: pane.paneId,
    kind: pane.kind,
    title: pane.title,
    active: state.activeWorkbenchPaneId === pane.paneId,
    loading: pane.loading === true,
    revision: pane.revision,
    focusAction: {
      id: focusActionId,
      icon: "o",
      tooltip: `Focus ${pane.title}`,
      accessibleLabel: `Focus ${pane.title}`,
      state:
        state.loadingActionId === focusActionId
          ? "loading"
          : state.activeWorkbenchPaneId === pane.paneId
            ? "active"
            : "default",
      disabled: anyActionLoading && state.loadingActionId !== focusActionId,
    },
    closeAction: {
      id: closeActionId,
      icon: "x",
      tooltip: `Close ${pane.title}`,
      accessibleLabel: `Close ${pane.title}`,
      state: state.loadingActionId === closeActionId ? "loading" : "default",
      disabled: anyActionLoading,
    },
  };
}

function firstVisiblePaneId(
  panes: AppChromeWorkbenchPaneRef[],
): string | undefined {
  return panes.find((pane) => pane.visible)?.paneId;
}

function paneExists(
  panes: AppChromeWorkbenchPaneRef[],
  paneId: string,
): boolean {
  return panes.some((pane) => pane.paneId === paneId && pane.visible);
}

function formatAgentLabel(agentId: string): string {
  switch (agentId) {
    case "codex":
      return "Codex CLI";
    case "claude":
      return "Claude Code";
    case "antigravity":
      return "Antigravity CLI";
    case "gemini":
      return "Gemini CLI";
    default:
      return agentId;
  }
}
