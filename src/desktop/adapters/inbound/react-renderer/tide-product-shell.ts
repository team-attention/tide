import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  GitBranchPlus,
  Maximize2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Pin,
  PinOff,
  Search,
  Settings,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";

import {
  applyProductShellBackendEvent,
  closeProductShellWorkbenchPane,
  clearProductShellLeftUiTransientState,
  createProductShellState,
  createProductShellViewModel,
  editProductShellWorkbenchEditorPane,
  focusProductShellWorkbenchPane,
  goToProductShellEditorDefinition,
  moveProductShellEditorCursor,
  openProductShellLeftUiMenu,
  openProductShellThread,
  openProductShellThreadFromLeftUi,
  selectProductShellFileTreeEntry,
  selectProductShellChoiceSurfaceRow,
  selectProductShellLauncherAction,
  setProductShellComposerActiveSurface,
  showProductShellThreadArchiveConfirm,
  startNewProductShellThread,
  submitProductShellComposerDraft,
  saveProductShellWorkbenchEditorPane,
  toggleProductShellFileTreeWithRefresh,
  toggleProductShellLeftUi,
  toggleProductShellWorkbenchWithLauncher,
  updateProductShellBrowserActionResult,
  updateProductShellBrowserSnapshot,
  updateProductShellComposerDraft,
  writeProductShellTerminalInput,
  type ProductShellBackendCommand,
  type ProductShellAgentIdentity,
  type ProductShellBrowserActionResult,
  type ProductShellBrowserSnapshot,
  type ProductShellLeftUiMenu,
  type ProductShellProjectGroupView,
  type ProductShellState,
  type ProductShellThreadView,
  type ProductShellViewModel,
} from "../../../application/domains/product-shell/product-shell-state.ts";
import { AgentChatShell } from "./agent-chat-shell.ts";
import type {
  AgentChatBackendEvent,
  AgentChatChoiceSurfaceView,
  AgentChatComposerSurfaceKind,
} from "../../../application/domains/agent-chat/agent-chat-shell-state.ts";

export interface TideProductShellProps {
  initialState?: ProductShellState;
  onBackendCommand?: (
    command: ProductShellBackendCommand,
  ) => Promise<AgentChatBackendEvent[]> | AgentChatBackendEvent[] | void;
  onBackendEvent?: (listener: (event: AgentChatBackendEvent) => void) => (() => void) | undefined;
}

interface ProductShellHandlers {
  onNewThread: () => void;
  onThreadSelect: (threadId: string) => void;
  onLeftUiToggle: () => void;
  onWorkbenchToggle: () => void;
  onFileTreeToggle: () => void;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onComposerSurfaceChange: (surface: AgentChatComposerSurfaceKind | null) => void;
  onChoiceSurfaceRowSelect: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
  onLauncherAction: (actionId: string) => void;
  onLeftUiMenuOpen: (menu: ProductShellLeftUiMenu | null) => void;
  onThreadArchiveIntent: (threadId: string) => void;
  onLeftUiTransientClear: () => void;
  onFocusWorkbenchPane: (paneId: string) => void;
  onCloseWorkbenchPane: (paneId: string) => void;
  onFileTreeEntryOpen: (entryId: string) => void;
  onTerminalInput: (paneId: string, bytes: string) => void;
  onEditorDraftChange: (paneId: string, content: string) => void;
  onEditorCursorChange: (paneId: string, cursorOffset: number) => void;
  onEditorSave: (paneId: string) => void;
  onEditorGoToDefinition: (paneId: string) => void;
  onBrowserSnapshot: (paneId: string, snapshot: ProductShellBrowserSnapshot) => void;
  onBrowserActionResult: (paneId: string, result: ProductShellBrowserActionResult) => void;
}

type RightActionOwner = "agent-chat" | "workbench" | "file-tree";

export function TideProductShell(props: TideProductShellProps): ReactElement {
  const [shellState, setShellState] = useState(() =>
    props.initialState ?? createProductShellState({ includeFixtureData: false }),
  );
  useEffect(() => {
    return props.onBackendEvent?.((event) => {
      setShellState((state) => applyProductShellBackendEvent(state, event));
    });
  }, [props.onBackendEvent]);
  const viewModel = createProductShellViewModel(shellState);
  const applyBackendEvents = (events: AgentChatBackendEvent[] | undefined) => {
    if (events === undefined || events.length === 0) {
      return;
    }
    setShellState((state) =>
      events.reduce((nextState, event) => applyProductShellBackendEvent(nextState, event), state),
    );
  };
  const dispatchBackendCommand = (command: ProductShellBackendCommand | null) => {
    if (command === null) {
      return;
    }
    const backendResult = props.onBackendCommand?.(command);
    if (backendResult instanceof Promise) {
      void backendResult.then((events) => applyBackendEvents(events));
    } else if (backendResult !== undefined) {
      applyBackendEvents(backendResult);
    }
  };
  useEffect(() => {
    if (props.initialState !== undefined) {
      return;
    }
    dispatchBackendCommand({ kind: "thread.list", payload: {} });
  }, []);
  const handlers: ProductShellHandlers = {
    onNewThread: () => setShellState((state) => startNewProductShellThread(state)),
    onThreadSelect: (threadId) =>
      setShellState((state) => {
        const result = openProductShellThreadFromLeftUi(state, threadId, {
          backendTransportAvailable: props.onBackendCommand !== undefined,
        });
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onLeftUiToggle: () => setShellState((state) => toggleProductShellLeftUi(state)),
    onWorkbenchToggle: () =>
      setShellState((state) => {
        const result = toggleProductShellWorkbenchWithLauncher(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onFileTreeToggle: () =>
      setShellState((state) => {
        const result = toggleProductShellFileTreeWithRefresh(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onDraftChange: (draft) => setShellState((state) => updateProductShellComposerDraft(state, draft)),
    onSubmit: () =>
      setShellState((state) => {
        const result = submitProductShellComposerDraft(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onComposerSurfaceChange: (surface) =>
      setShellState((state) => setProductShellComposerActiveSurface(state, surface)),
    onChoiceSurfaceRowSelect: (surfaceKind, rowId) =>
      setShellState((state) => {
        const result = selectProductShellChoiceSurfaceRow(state, surfaceKind, rowId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onLauncherAction: (actionId) =>
      setShellState((state) => {
        const result = selectProductShellLauncherAction(state, actionId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onLeftUiMenuOpen: (menu) => setShellState((state) => openProductShellLeftUiMenu(state, menu)),
    onThreadArchiveIntent: (threadId) =>
      setShellState((state) => showProductShellThreadArchiveConfirm(state, threadId)),
    onLeftUiTransientClear: () =>
      setShellState((state) => clearProductShellLeftUiTransientState(state)),
    onFocusWorkbenchPane: (paneId) =>
      setShellState((state) => {
        const result = focusProductShellWorkbenchPane(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onCloseWorkbenchPane: (paneId) =>
      setShellState((state) => {
        const result = closeProductShellWorkbenchPane(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onFileTreeEntryOpen: (entryId) =>
      setShellState((state) => {
        const result = selectProductShellFileTreeEntry(state, entryId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onTerminalInput: (paneId, bytes) =>
      setShellState((state) => {
        const result = writeProductShellTerminalInput(state, paneId, bytes);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorDraftChange: (paneId, content) =>
      setShellState((state) => editProductShellWorkbenchEditorPane(state, paneId, content)),
    onEditorCursorChange: (paneId, cursorOffset) =>
      setShellState((state) => moveProductShellEditorCursor(state, paneId, cursorOffset)),
    onEditorSave: (paneId) =>
      setShellState((state) => {
        const result = saveProductShellWorkbenchEditorPane(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorGoToDefinition: (paneId) =>
      setShellState((state) => {
        const result = goToProductShellEditorDefinition(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBrowserSnapshot: (paneId, snapshot) =>
      setShellState((state) => {
        const result = updateProductShellBrowserSnapshot(state, paneId, snapshot);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBrowserActionResult: (paneId, actionResult) =>
      setShellState((state) => {
        const result = updateProductShellBrowserActionResult(state, paneId, actionResult);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
  };

  return createElement(
    "div",
    {
      className: [
        "tide-product-shell",
        viewModel.leftUiOpen ? "tide-product-shell--left-open" : "tide-product-shell--left-closed",
        viewModel.workbenchOpen ? "tide-product-shell--workbench-open" : "tide-product-shell--workbench-closed",
        viewModel.fileTreeOpen ? "tide-product-shell--file-tree-open" : "tide-product-shell--file-tree-closed",
      ].join(" "),
    },
    createElement(
      "div",
      { className: "tide-product-shell__body" },
      viewModel.leftUiOpen ? createLeftUi(viewModel, handlers) : null,
      createAgentChatColumn(viewModel, handlers),
      viewModel.workbenchOpen ? createWorkbenchColumn(viewModel, handlers) : null,
      viewModel.fileTreeOpen ? createFileTreeColumn(viewModel, handlers) : null,
    ),
  );
}

export function AgentIdentityIcon(props: { agentId: ProductShellAgentIdentity | string }): ReactElement {
  const agentId = normalizeAgentId(props.agentId);

  return createElement(
    "span",
    {
      className: `agent-identity-icon agent-identity-icon--${agentId}`,
      "data-agent-icon": agentId,
      "aria-label": agentLabel(agentId),
      role: "img",
    },
    createElement("span", { className: "agent-identity-icon__core" }),
    createElement("span", { className: "agent-identity-icon__orbit" }),
  );
}

function createLeftUi(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "aside",
    { className: "left-ui", "aria-label": "Left UI", "data-column": "left-ui" },
    createElement(
      "header",
      { className: "left-ui__top-row column-top-row", "aria-label": "Left UI Top Row" },
      createTrafficControls(),
      createIconButton(
        "Close Left UI",
        createElement(PanelLeftClose, { size: 15, strokeWidth: 1.9 }),
        handlers.onLeftUiToggle,
        "top-row-button",
      ),
    ),
    createElement(
      "nav",
      { className: "left-ui__nav", "aria-label": "Left UI actions" },
      createLeftNavRow("New thread", createElement(MessageSquarePlus, { size: 16, strokeWidth: 1.9 }), handlers.onNewThread),
      createLeftNavRow("Search", createElement(Search, { size: 16, strokeWidth: 1.9 })),
      createLeftNavRow("Plugins", createElement(Square, { size: 15, strokeWidth: 1.9 })),
      createLeftNavRow("Automations", createElement(Settings, { size: 15, strokeWidth: 1.9 })),
    ),
    createThreadSection("Pinned", viewModel.pinnedThreads, handlers),
    createProjectSection(viewModel.projectGroups, handlers),
    createThreadSection("Scratch", viewModel.scratchThreads, handlers),
  );
}

function createAgentChatColumn(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  const rightOwner = rightActionOwner(viewModel);
  const title = viewModel.agentChat.thread?.title ?? "New Thread";

  return createElement(
    "section",
    {
      className: "tide-product-shell__stage",
      "aria-label": "Agent Chat",
      "data-column": "agent-chat",
    },
    createElement(
      "header",
      { className: "agent-chat-top-row column-top-row", "aria-label": "Agent Chat Top Row" },
      createElement(
        "div",
        { className: "column-top-row__leading" },
        viewModel.leftUiOpen ? null : createTrafficControls(),
        viewModel.leftUiOpen
          ? null
          : createIconButton(
              "Open Left UI",
              createElement(PanelLeftOpen, { size: 15, strokeWidth: 1.9 }),
              handlers.onLeftUiToggle,
              "top-row-button",
            ),
        createElement(Pin, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
        createElement("span", { className: "column-top-row__title" }, title),
      ),
      createElement(
        "div",
        { className: "column-top-row__trailing" },
        createIconButton("Thread menu", createElement(MoreHorizontal, { size: 16, strokeWidth: 1.9 }), undefined, "top-row-button"),
        rightOwner === "agent-chat" ? createRightWindowActions(rightOwner, handlers) : null,
      ),
    ),
    createElement(AgentChatShell, {
      viewModel: viewModel.agentChat,
      showThreadHeader: false,
      onDraftChange: handlers.onDraftChange,
      onSubmit: handlers.onSubmit,
      onComposerSurfaceChange: handlers.onComposerSurfaceChange,
      onChoiceSurfaceRowSelect: handlers.onChoiceSurfaceRowSelect,
    }),
  );
}

function createWorkbenchColumn(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  const tabs = viewModel.appChrome.workbenchTabStrip.visibleTabs;
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
  const activePane = viewModel.appChrome.activeWorkbenchPane;
  const rightOwner = rightActionOwner(viewModel);

  return createElement(
    "aside",
    { className: "workbench-column", "aria-label": "Workbench", "data-column": "workbench" },
    createElement(
      "header",
      { className: "workbench-column__top-row column-top-row", "aria-label": "Workbench Top Row" },
      createElement(
        "div",
        { className: "workbench-tabs", role: "tablist", "aria-label": "Workbench Tab Strip" },
        tabs.length === 0
          ? createElement("span", { className: "workbench-tabs__empty" }, "Workbench")
          : tabs.map((tab) =>
              createElement(
                "button",
                {
                  key: tab.paneId,
                  className: "workbench-tab",
                  "data-active": tab.active,
                  type: "button",
                  role: "tab",
                  "aria-selected": tab.active,
                  onClick: () => handlers.onFocusWorkbenchPane(tab.paneId),
                },
                tab.title,
              ),
            ),
      ),
      createElement(
        "div",
        { className: "column-top-row__trailing" },
        createIconButton("Close Workbench", createElement(PanelRightClose, { size: 16, strokeWidth: 1.9 }), handlers.onWorkbenchToggle, "top-row-button"),
        rightOwner === "workbench" ? createRightWindowActions(rightOwner, handlers) : null,
      ),
    ),
    activeTab && activePane
      ? createElement(
          "section",
          {
            className: "workbench-column__pane",
            "data-pane-id": activeTab.paneId,
            "data-pane-kind": activeTab.kind,
          },
          createWorkbenchPaneContent(
            activePane,
            handlers,
            viewModel.editorDrafts[activePane.paneId],
          ),
          createIconButton("Close Pane", createElement(PanelRightClose, { size: 15, strokeWidth: 1.9 }), () => handlers.onCloseWorkbenchPane(activeTab.paneId), "workbench-column__pane-action"),
        )
      : createElement("div", { className: "workbench-column__empty" }, "No visible Workbench Pane."),
  );
}

function createWorkbenchPaneContent(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  handlers: ProductShellHandlers,
  editorDraft: ProductShellViewModel["editorDrafts"][string] | undefined,
): ReactElement {
  switch (pane.kind) {
    case "browser":
      return createElement(WorkbenchBrowserPane, { pane, handlers });
    case "editor":
      return createElement(WorkbenchEditorPane, { pane, draft: editorDraft, handlers });
    case "diff":
      return createElement(WorkbenchDiffPane, { pane });
    case "terminal":
      return createElement(WorkbenchTerminalPane, { pane, handlers });
    case "launcher":
      return createElement(WorkbenchLauncherPane, { pane, handlers });
    default:
      return createElement(
        "div",
        { className: "workbench-pane-content workbench-pane-content--generic" },
        createElement("div", { className: "workbench-column__kind" }, pane.kind),
        createElement("h2", null, pane.title),
      );
  }
}

function WorkbenchLauncherPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const actions = props.pane.actions ?? [];
  return createElement(
    "div",
    { className: "workbench-pane-content workbench-pane-content--launcher" },
    createWorkbenchPaneHeading("launcher", props.pane.title, "ready"),
    createElement(
      "div",
      { className: "workbench-launcher-actions", "aria-label": "Workbench Launcher Actions" },
      actions.map((action) =>
        createElement(
          "button",
          {
            key: action.actionId,
            className: "workbench-launcher-action",
            type: "button",
            disabled: !action.enabled,
            "data-launcher-action": action.actionId,
            onClick: () => props.handlers.onLauncherAction(action.actionId),
          },
          createElement(
            "span",
            { className: "workbench-launcher-action__icon", "aria-hidden": true },
            launcherActionIcon(action.actionId),
          ),
          createElement(
            "span",
            { className: "workbench-launcher-action__copy" },
            createElement("span", { className: "workbench-launcher-action__label" }, action.label),
            createElement(
              "span",
              { className: "workbench-launcher-action__description" },
              action.description,
            ),
          ),
        ),
      ),
    ),
  );
}

function launcherActionIcon(actionId: string): ReactElement {
  switch (actionId) {
    case "open_browser":
      return createElement(ExternalLink, { size: 15, strokeWidth: 1.9 });
    case "open_editor":
      return createElement(FileText, { size: 15, strokeWidth: 1.9 });
    case "open_terminal":
      return createElement(Terminal, { size: 15, strokeWidth: 1.9 });
    case "open_diff":
      return createElement(GitBranchPlus, { size: 15, strokeWidth: 1.9 });
    case "open_file_tree":
      return createElement(FolderOpen, { size: 15, strokeWidth: 1.9 });
    default:
      return createElement(Square, { size: 15, strokeWidth: 1.9 });
  }
}

function WorkbenchBrowserPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const title = props.pane.pageTitle ?? props.pane.title;
  const webviewRef = useRef<BrowserWebViewElement | null>(null);
  const executedActionIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const webview = webviewRef.current;
    if (webview === null || props.pane.url === undefined) {
      return;
    }
    const paneId = props.pane.paneId;
    const revision = props.pane.revision;
    const emitSnapshot = () => {
      void readBrowserWebViewSnapshot(webview).then((snapshot) => {
        props.handlers.onBrowserSnapshot(paneId, {
          revision,
          loading: false,
          ...snapshot,
        });
      });
    };
    webview.addEventListener("did-finish-load", emitSnapshot);
    webview.addEventListener("did-stop-loading", emitSnapshot);
    return () => {
      webview.removeEventListener("did-finish-load", emitSnapshot);
      webview.removeEventListener("did-stop-loading", emitSnapshot);
    };
  }, [props.handlers, props.pane.paneId, props.pane.revision, props.pane.url]);
  useEffect(() => {
    const webview = webviewRef.current;
    const action = props.pane.pendingAction;
    if (
      webview === null ||
      props.pane.url === undefined ||
      action === undefined ||
      executedActionIdsRef.current.has(action.actionId)
    ) {
      return;
    }
    executedActionIdsRef.current.add(action.actionId);
    const paneId = props.pane.paneId;
    const revision = props.pane.revision;
    void executeBrowserWebViewAction(webview, action)
      .then(async (actionResult) => {
        const snapshot = await readBrowserWebViewSnapshot(webview);
        props.handlers.onBrowserActionResult(paneId, {
          revision,
          actionId: action.actionId,
          status: actionResult.ok ? "completed" : "failed",
          message: actionResult.message,
          loading: false,
          ...snapshot,
        });
      })
      .catch((error: unknown) => {
        props.handlers.onBrowserActionResult(paneId, {
          revision,
          actionId: action.actionId,
          status: "failed",
          message: error instanceof Error ? error.message : "Browser action failed.",
          loading: false,
        });
      });
  }, [
    props.handlers,
    props.pane.paneId,
    props.pane.pendingAction?.actionId,
    props.pane.revision,
    props.pane.url,
  ]);
  return createElement(
    "div",
    { className: "workbench-pane-content workbench-pane-content--browser" },
    createWorkbenchPaneHeading("browser", title, props.pane.loading ? "loading" : "ready"),
    createWorkbenchPaneMeta([
      ["URL", props.pane.url],
      ["Revision", props.pane.revision],
    ]),
    props.pane.url
      ? createElement("webview", {
          ref: webviewRef,
          className: "workbench-browser-webview",
          "data-browser-pane-webview": props.pane.paneId,
          src: props.pane.url,
          partition: "persist:tide-workbench-browser",
        })
      : null,
    props.pane.bodyTextPreview
      ? createPreviewBlock("Browser text preview", props.pane.bodyTextPreview)
      : null,
  );
}

type BrowserWebViewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>;
  getURL?: () => string;
};

type BrowserWebViewSnapshot = Omit<ProductShellBrowserSnapshot, "revision" | "loading">;
type BrowserWebViewAction = NonNullable<
  NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>["pendingAction"]
>;
type BrowserWebViewActionExecution = { ok: boolean; message: string };

async function readBrowserWebViewSnapshot(
  webview: BrowserWebViewElement,
): Promise<BrowserWebViewSnapshot> {
  const script = `(() => ({
    url: window.location.href,
    pageTitle: document.title,
    bodyTextPreview: (document.body?.innerText ?? "").slice(0, 65536)
  }))()`;
  const rawSnapshot = await webview.executeJavaScript?.(script).catch(() => undefined);
  const snapshot =
    rawSnapshot !== null && typeof rawSnapshot === "object"
      ? (rawSnapshot as Record<string, unknown>)
      : {};
  return {
    url: stringRecordField(snapshot, "url") ?? webview.getURL?.(),
    pageTitle: stringRecordField(snapshot, "pageTitle"),
    bodyTextPreview: stringRecordField(snapshot, "bodyTextPreview"),
  };
}

async function executeBrowserWebViewAction(
  webview: BrowserWebViewElement,
  action: BrowserWebViewAction,
): Promise<BrowserWebViewActionExecution> {
  if (webview.executeJavaScript === undefined) {
    return { ok: false, message: "Browser WebView does not expose script execution." };
  }
  const payload = JSON.stringify({
    kind: action.kind,
    selector: action.selector,
    text: action.text ?? "",
  });
  const script = `((payload) => {
    const target = document.querySelector(payload.selector);
    if (!target) {
      return { ok: false, message: "Selector not found: " + payload.selector };
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    if (payload.kind === "click") {
      target.click();
      return { ok: true, message: "Clicked " + payload.selector };
    }
    if (payload.kind === "type_text") {
      target.focus?.();
      if ("value" in target) {
        target.value = payload.text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, message: "Typed " + payload.selector };
      }
      target.textContent = payload.text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, message: "Typed " + payload.selector };
    }
    return { ok: false, message: "Unsupported Browser action." };
  })(${payload})`;
  return browserActionExecutionFromUnknown(await webview.executeJavaScript(script));
}

function browserActionExecutionFromUnknown(value: unknown): BrowserWebViewActionExecution {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ok = typeof record.ok === "boolean" ? record.ok : false;
    const message =
      typeof record.message === "string" ? record.message : "Browser action finished.";
    return { ok, message };
  }
  return { ok: false, message: "Browser action returned an invalid result." };
}

function stringRecordField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function WorkbenchEditorPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  draft: ProductShellViewModel["editorDrafts"][string] | undefined;
  handlers: ProductShellHandlers;
}): ReactElement {
  const readOnly = props.pane.truncated === true;
  const value = props.draft?.content ?? props.pane.bodyText ?? props.pane.bodyTextPreview ?? "";
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (props.pane.navigationTarget === undefined || textareaRef.current === null) {
      return;
    }
    const start = lineCharacterToOffset(
      value,
      props.pane.navigationTarget.line,
      props.pane.navigationTarget.character,
    );
    if (start === undefined) {
      return;
    }
    const end = start + Math.max(0, props.pane.navigationTarget.length ?? 0);
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(start, Math.min(end, value.length));
  }, [
    props.pane.navigationTarget?.line,
    props.pane.navigationTarget?.character,
    props.pane.navigationTarget?.length,
    props.pane.revision,
    value,
  ]);
  const updateCursor = (currentTarget: { selectionStart?: number }) => {
    props.handlers.onEditorCursorChange(
      props.pane.paneId,
      currentTarget.selectionStart ?? 0,
    );
  };
  return createElement(
    "div",
    {
      className: "workbench-pane-content workbench-pane-content--editor",
      "data-editor-readonly": readOnly ? "readonly" : "editable",
    },
    createWorkbenchPaneHeading("editor", props.pane.title, readOnly ? "readonly" : props.draft?.dirty ? "edited" : "saved"),
    createWorkbenchPaneMeta([
      ["Path", props.pane.relativePath ?? props.pane.filePath],
      ["Size", formatByteCount(props.pane.byteLength)],
      ["Revision", props.pane.revision],
    ]),
    createElement(
      "textarea",
      {
        ref: textareaRef,
        className: "workbench-editor-textarea",
        "aria-label": "Editor Pane text",
        "data-navigation-target": props.pane.navigationTarget?.label,
        spellCheck: false,
        readOnly,
        value,
        onChange: (event: { currentTarget: { value: string } }) =>
          props.handlers.onEditorDraftChange(props.pane.paneId, event.currentTarget.value),
        onClick: (event: { currentTarget: { selectionStart?: number } }) =>
          updateCursor(event.currentTarget),
        onKeyUp: (event: { currentTarget: { selectionStart?: number } }) =>
          updateCursor(event.currentTarget),
        onSelect: (event: { currentTarget: { selectionStart?: number } }) =>
          updateCursor(event.currentTarget),
      },
    ),
    readOnly
      ? null
      : createElement(
          "div",
          { className: "workbench-editor-actions" },
          createElement(
            "button",
            {
              className: "workbench-editor-save",
              type: "button",
              onClick: () => props.handlers.onEditorGoToDefinition(props.pane.paneId),
            },
            "Go to definition",
          ),
          createElement(
            "button",
            {
              className: "workbench-editor-save",
              type: "button",
              disabled: props.draft?.dirty !== true,
              onClick: () => props.handlers.onEditorSave(props.pane.paneId),
            },
            "Save file",
          ),
        ),
  );
}

function lineCharacterToOffset(
  value: string,
  line: number,
  character: number,
): number | undefined {
  if (line < 0 || character < 0) {
    return undefined;
  }
  const lines = value.split("\n");
  if (line >= lines.length || character > lines[line].length) {
    return undefined;
  }
  let offset = character;
  for (let index = 0; index < line; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset;
}

function WorkbenchDiffPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
}): ReactElement {
  return createElement(
    "div",
    { className: "workbench-pane-content workbench-pane-content--diff" },
    createWorkbenchPaneHeading("diff", props.pane.title, props.pane.truncated ? "truncated" : "bounded"),
    createWorkbenchPaneMeta([
      ["Path", props.pane.relativePath ?? props.pane.filePath],
      ["Bytes", formatBeforeAfterBytes(props.pane.beforeByteLength, props.pane.afterByteLength)],
      ["Revision", props.pane.revision],
    ]),
    props.pane.diffText
      ? createPreviewBlock("Diff preview", props.pane.diffText, "workbench-preview--diff")
      : null,
  );
}

function createWorkbenchPaneHeading(kind: string, title: string, status?: string): ReactElement {
  return createElement(
    "div",
    { className: "workbench-pane-heading" },
    createElement("div", { className: "workbench-column__kind" }, kind),
    createElement(
      "div",
      { className: "workbench-pane-heading__row" },
      createElement("h2", null, title),
      status ? createElement("span", { className: "workbench-pane-heading__status" }, status) : null,
    ),
  );
}

function createWorkbenchPaneMeta(rows: Array<[string, string | undefined]>): ReactElement | null {
  const visibleRows = rows.filter(([, value]) => value !== undefined && value.length > 0);
  if (visibleRows.length === 0) {
    return null;
  }
  return createElement(
    "dl",
    { className: "workbench-pane-meta" },
    visibleRows.flatMap(([label, value]) => [
      createElement("dt", { key: `${label}-label` }, label),
      createElement("dd", { key: `${label}-value` }, value),
    ]),
  );
}

function createPreviewBlock(label: string, text: string, extraClassName = ""): ReactElement {
  return createElement(
    "pre",
    {
      className: `workbench-preview ${extraClassName}`.trim(),
      "aria-label": label,
    },
    text,
  );
}

function formatByteCount(bytes: number | undefined): string | undefined {
  return typeof bytes === "number" ? `${bytes} bytes` : undefined;
}

function formatBeforeAfterBytes(before: number | undefined, after: number | undefined): string | undefined {
  return typeof before === "number" && typeof after === "number"
    ? `${before} -> ${after} bytes`
    : undefined;
}

function WorkbenchTerminalPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const sendBytes = (bytes: string) => {
    props.handlers.onTerminalInput(props.pane.paneId, bytes);
  };

  return createElement(
    "div",
    { className: "workbench-terminal", "data-terminal-status": props.pane.status ?? "ready" },
    createElement("div", { className: "workbench-column__kind" }, "terminal"),
    createElement(
      "div",
      { className: "workbench-terminal__heading" },
      createElement("h2", null, props.pane.title),
      createElement("span", { className: "workbench-terminal__status" }, props.pane.status ?? "ready"),
    ),
    createElement(
      "dl",
      { className: "workbench-terminal__meta" },
      props.pane.command
        ? [
            createElement("dt", { key: "command-label" }, "Command"),
            createElement("dd", { key: "command-value" }, props.pane.command),
          ]
        : null,
      props.pane.cwd
        ? [
            createElement("dt", { key: "cwd-label" }, "CWD"),
            createElement("dd", { key: "cwd-value" }, props.pane.cwd),
          ]
        : null,
      props.pane.expectedCompletion
        ? [
            createElement("dt", { key: "completion-label" }, "Completion"),
            createElement("dd", { key: "completion-value" }, props.pane.expectedCompletion),
          ]
        : null,
    ),
    createElement(
      "pre",
      { className: "workbench-terminal__preview", "aria-label": "Terminal transcript preview" },
      props.pane.transcriptPreview ?? "",
    ),
    createElement(
      "form",
      {
        className: "workbench-terminal__input",
        "aria-label": "Provider Setup Surface input",
        onSubmit: (event) => {
          event.preventDefault();
          if (draft.length === 0) {
            return;
          }
          sendBytes(`${draft}\r`);
          setDraft("");
        },
      },
      createElement("input", {
        value: draft,
        onChange: (event) => setDraft(event.currentTarget.value),
        "aria-label": "Terminal input",
        placeholder: "Type input for setup...",
      }),
      createElement("button", { type: "submit" }, "Enter"),
      createElement("button", { type: "button", onClick: () => sendBytes("\u001b") }, "Esc"),
      createElement(
        "button",
        { type: "button", "aria-label": "Send Up Arrow", onClick: () => sendBytes("\u001b[A") },
        createElement(ChevronUp, { size: 14, strokeWidth: 1.9 }),
      ),
      createElement(
        "button",
        { type: "button", "aria-label": "Send Down Arrow", onClick: () => sendBytes("\u001b[B") },
        createElement(ChevronDown, { size: 14, strokeWidth: 1.9 }),
      ),
    ),
  );
}

function createFileTreeColumn(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "aside",
    { className: "file-tree-column", "aria-label": "FileTree", "data-column": "file-tree" },
    createElement(
      "header",
      { className: "file-tree-column__top-row column-top-row", "aria-label": "FileTree Top Row" },
      createElement(
        "div",
        { className: "column-top-row__leading" },
        createElement(FolderOpen, { size: 15, strokeWidth: 1.9, "aria-hidden": true }),
        createElement("span", { className: "column-top-row__title" }, viewModel.fileTree.cwdLabel),
      ),
      createRightWindowActions("file-tree", handlers),
    ),
    createElement(
      "div",
      { className: "file-tree-column__body" },
      createElement(
        "label",
        { className: "file-tree-column__search" },
        createElement(Search, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
        createElement("span", null, "Filter files..."),
      ),
      createElement(
        "div",
        { className: "file-tree-column__entries" },
        viewModel.fileTree.entries.map((entry) =>
          createElement(
            entry.kind === "file" ? "button" : "div",
            {
              key: entry.id,
              className: `file-tree-row${entry.active ? " file-tree-row--active" : ""}`,
              "data-depth": entry.depth,
              "data-file-kind": entry.kind,
              style: { "--file-tree-depth": entry.depth } as CSSProperties,
              ...(entry.kind === "file"
                ? {
                    type: "button",
                    onClick: () => handlers.onFileTreeEntryOpen(entry.id),
                  }
                : {}),
            },
            entry.kind === "folder"
              ? createElement(Folder, { size: 14, strokeWidth: 1.8, "aria-hidden": true })
              : createElement(FileText, { size: 14, strokeWidth: 1.8, "aria-hidden": true }),
            createElement("span", null, entry.name),
          ),
        ),
      ),
    ),
  );
}

function createProjectSection(
  projectGroups: ProductShellProjectGroupView[],
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "section",
    { className: "left-ui-section", "aria-label": "Projects" },
    createSectionHeader("Projects"),
    projectGroups.map((project) =>
      createElement(
        "div",
        { key: project.projectId, className: "project-group" },
        createElement(
          "div",
          { className: "project-row-wrap" },
          createElement(
            "div",
            {
              className: `project-row${project.contextMenuOpen ? " project-row--menu-open" : ""}`,
              "data-left-row-kind": "project",
              "data-project-row": project.projectId,
              "data-expanded": project.expanded,
            },
            project.expanded
              ? createElement(FolderOpen, { size: 16, strokeWidth: 1.85, "aria-hidden": true })
              : createElement(Folder, { size: 16, strokeWidth: 1.85, "aria-hidden": true }),
            createElement("span", { className: "project-row__title" }, project.name),
            createElement(
              "span",
              { className: "project-row__actions" },
              createIconButton(
                "Project menu",
                createElement(MoreHorizontal, { size: 15, strokeWidth: 1.9 }),
                () => handlers.onLeftUiMenuOpen({ kind: "project", projectId: project.projectId }),
                "project-row__action",
              ),
              createIconButton(
                "New thread in project",
                createElement(MessageSquarePlus, { size: 15, strokeWidth: 1.9 }),
                handlers.onNewThread,
                "project-row__action",
              ),
            ),
          ),
          project.contextMenuOpen ? createLeftUiContextMenu("project") : null,
        ),
        project.expanded ? project.threads.map((thread) => createThreadRow(thread, handlers)) : null,
      ),
    ),
  );
}

function createThreadSection(
  title: string,
  threads: ProductShellThreadView[],
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "section",
    { className: "left-ui-section", "aria-label": title },
    createSectionHeader(title),
    threads.map((thread) => createThreadRow(thread, handlers)),
  );
}

function createThreadRow(
  thread: ProductShellThreadView,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "div",
    { key: thread.threadId, className: "thread-row-wrap" },
    createElement(
      "div",
      {
        className: [
          "thread-row",
          thread.active ? "thread-row--active" : "",
          thread.contextMenuOpen ? "thread-row--menu-open" : "",
          thread.archiveConfirming ? "thread-row--archive-confirming" : "",
        ]
          .filter(Boolean)
          .join(" "),
        "data-left-row-kind": "thread",
        "data-thread-row": thread.threadId,
        "data-active": thread.active,
        onMouseLeave: thread.archiveConfirming ? handlers.onLeftUiTransientClear : undefined,
      },
      createElement(
        "button",
        {
          className: "thread-row__main",
          type: "button",
          "aria-pressed": thread.active,
          onClick: () => handlers.onThreadSelect(thread.threadId),
        },
        createElement("span", { className: "thread-row__title" }, thread.title),
      ),
      thread.archiveConfirming
        ? createElement(
            "button",
            {
              className: "thread-row__confirm",
              type: "button",
              "aria-label": "Confirm Archive Thread",
            },
            "Confirm",
          )
        : [
            thread.attention ? createElement("span", { key: "attention", className: "thread-row__attention" }) : null,
            createElement("span", { key: "time", className: "thread-row__time" }, thread.time),
            createElement(
              "span",
              { key: "actions", className: "thread-row__actions" },
              createIconButton(
                thread.pinned ? "Unpin Thread" : "Pin Thread",
                thread.pinned
                  ? createElement(PinOff, { size: 14, strokeWidth: 1.9 })
                  : createElement(Pin, { size: 14, strokeWidth: 1.9 }),
                undefined,
                "thread-row__action",
              ),
              createIconButton(
                "Archive Thread",
                createElement(Archive, { size: 14, strokeWidth: 1.9 }),
                () => handlers.onThreadArchiveIntent(thread.threadId),
                "thread-row__action",
              ),
            ),
          ],
    ),
    thread.contextMenuOpen ? createLeftUiContextMenu("thread") : null,
  );
}

function createLeftNavRow(label: string, icon: ReactNode, onClick?: () => void): ReactElement {
  return createElement(
    "button",
    { className: "left-ui-nav-row", type: "button", onClick },
    icon,
    createElement("span", null, label),
  );
}

function createSectionHeader(title: string): ReactElement {
  return createElement(
    "div",
    { className: "left-ui-section__header" },
    createElement("span", { className: "left-ui-section__title" }, title),
  );
}

function createRightWindowActions(
  owner: RightActionOwner,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "div",
    { className: "right-window-actions", "data-right-actions-owner": owner },
    createIconButton(
      owner === "file-tree" ? "Close FileTree" : "Open FileTree",
      owner === "file-tree"
        ? createElement(PanelRightClose, { size: 15, strokeWidth: 1.9 })
        : createElement(FolderOpen, { size: 15, strokeWidth: 1.9 }),
      handlers.onFileTreeToggle,
      "top-row-button",
    ),
    createIconButton("Open external", createElement(ExternalLink, { size: 15, strokeWidth: 1.9 }), undefined, "top-row-button"),
    createIconButton("Maximize", createElement(Maximize2, { size: 15, strokeWidth: 1.9 }), undefined, "top-row-button"),
  );
}

function createLeftUiContextMenu(kind: "thread" | "project"): ReactElement {
  const items =
    kind === "thread"
      ? [
          { label: "Pin / unpin", icon: createElement(Pin, { size: 15, strokeWidth: 1.9 }) },
          { label: "Archive", icon: createElement(Archive, { size: 15, strokeWidth: 1.9 }) },
        ]
      : [
          { label: "Pin project", icon: createElement(Pin, { size: 16, strokeWidth: 1.9 }) },
          { label: "Open in Finder", icon: createElement(FolderOpen, { size: 16, strokeWidth: 1.9 }) },
          { label: "Create permanent worktree", icon: createElement(GitBranchPlus, { size: 16, strokeWidth: 1.9 }) },
          { label: "Rename project", icon: createElement(Pencil, { size: 16, strokeWidth: 1.9 }) },
          { label: "Archive chats", icon: createElement(Archive, { size: 16, strokeWidth: 1.9 }) },
          { label: "Remove", icon: createElement(Trash2, { size: 16, strokeWidth: 1.9 }), danger: true },
        ];

  return createElement(
    "div",
    {
      className: `left-ui-context-menu left-ui-context-menu--${kind}`,
      "data-left-ui-menu-kind": kind,
    },
    items.map((item) =>
      createElement(
        "button",
        {
          key: item.label,
          className: `left-ui-context-menu__item${item.danger ? " left-ui-context-menu__item--danger" : ""}`,
          type: "button",
        },
        createElement("span", { className: "left-ui-context-menu__icon", "aria-hidden": true }, item.icon),
        createElement("span", null, item.label),
      ),
    ),
  );
}

function rightActionOwner(viewModel: ProductShellViewModel): RightActionOwner {
  if (viewModel.fileTreeOpen) {
    return "file-tree";
  }
  if (viewModel.workbenchOpen) {
    return "workbench";
  }
  return "agent-chat";
}

function createTrafficControls(): ReactElement {
  return createElement(
    "div",
    { className: "traffic-controls", "aria-hidden": "true" },
    createElement("span", { className: "traffic-dot traffic-dot--close" }),
    createElement("span", { className: "traffic-dot traffic-dot--minimize" }),
    createElement("span", { className: "traffic-dot traffic-dot--zoom" }),
  );
}

function createIconButton(
  label: string,
  icon: ReactNode,
  onClick?: () => void,
  className = "icon-button",
): ReactElement {
  return createElement(
    "button",
    { className, type: "button", title: label, "aria-label": label, onClick },
    icon,
  );
}

function normalizeAgentId(agentId: string): ProductShellAgentIdentity {
  if (agentId === "claude" || agentId === "antigravity" || agentId === "openai_api") {
    return agentId;
  }
  return "codex";
}

function agentLabel(agentId: ProductShellAgentIdentity): string {
  switch (agentId) {
    case "codex":
      return "Codex CLI";
    case "claude":
      return "Claude Code";
    case "antigravity":
      return "Antigravity CLI";
    case "openai_api":
      return "OpenAI API";
  }
}
