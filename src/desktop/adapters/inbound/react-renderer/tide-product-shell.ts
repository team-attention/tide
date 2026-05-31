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
  X,
} from "lucide-react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
// xterm core is CommonJS and safe to import in any environment (it does not
// touch browser globals at load). default-import the module namespace so both
// the Vite build and Node's ESM test loader resolve it. The fit/webgl addons
// are UMD bundles that reference `self` at load, so they are browser-only and
// are dynamically imported inside the mount effect (and gracefully skipped when
// unavailable, e.g. headless/jsdom/no-GPU).
import * as xtermModule from "@xterm/xterm";

// `@xterm/xterm` is CommonJS, and its export shape differs across loaders: the
// `Terminal` class is a named export under Vite's ESM interop and Node's ESM
// loader, but lives under `.default` in some bundling paths. Default-importing
// the module gave `undefined` under Vite (dev optimizeDeps), white-screening
// the whole shell. Resolve the constructor defensively so the same source works
// in the Vite dev server, the Vite/rollup production build, and Node ESM tests.
const xtermNamespace = xtermModule as unknown as {
  Terminal?: typeof import("@xterm/xterm").Terminal;
  default?: { Terminal?: typeof import("@xterm/xterm").Terminal };
};
const XtermTerminal =
  xtermNamespace.Terminal ?? xtermNamespace.default?.Terminal;
import { javascript } from "@codemirror/lang-javascript";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { css as cssLanguage } from "@codemirror/lang-css";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";

// Markdown rendering for the Editor Pane Preview. `html: false` escapes raw HTML
// in file content so rendering local/agent-authored files cannot execute markup.
const markdownRenderer = new MarkdownIt({ html: false, linkify: true, typographer: true });

import {
  applyProductShellBackendEvent,
  closeProductShellWorkbenchPane,
  clearProductShellLeftUiTransientState,
  confirmProductShellThreadArchive,
  createProductShellState,
  createProductShellViewModel,
  editProductShellWorkbenchEditorPane,
  focusProductShellWorkbenchPane,
  goToProductShellEditorDefinition,
  goToProductShellEditorReferences,
  moveProductShellEditorCursor,
  openProductShellLeftUiMenu,
  openProductShellThread,
  openProductShellThreadFromLeftUi,
  selectProductShellFileTreeEntry,
  setProductShellSearchQuery,
  toggleProductShellSearch,
  selectProductShellChoiceSurfaceRow,
  selectProductShellLauncherAction,
  setProductShellComposerActiveSurface,
  showProductShellThreadArchiveConfirm,
  startProductShellThreadRename,
  submitProductShellThreadRename,
  cancelProductShellThreadRename,
  startNewProductShellThread,
  submitProductShellComposerDraft,
  saveProductShellWorkbenchEditorPane,
  toggleProductShellFileTreeWithRefresh,
  toggleProductShellLeftUi,
  toggleProductShellThreadPin,
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
  onThreadArchiveConfirm: (threadId: string) => void;
  onThreadPinToggle: (threadId: string) => void;
  onThreadRenameStart: (threadId: string) => void;
  onThreadRenameSubmit: (threadId: string, title: string) => void;
  onThreadRenameCancel: () => void;
  onSearchQueryChange: (query: string) => void;
  onSearchToggle: () => void;
  onLeftUiTransientClear: () => void;
  onFocusWorkbenchPane: (paneId: string) => void;
  onCloseWorkbenchPane: (paneId: string) => void;
  onFileTreeEntryOpen: (entryId: string) => void;
  onTerminalInput: (paneId: string, bytes: string) => void;
  onEditorDraftChange: (paneId: string, content: string) => void;
  onEditorCursorChange: (paneId: string, cursorOffset: number) => void;
  onEditorSave: (paneId: string) => void;
  onEditorGoToDefinition: (paneId: string) => void;
  onEditorGoToReferences: (paneId: string) => void;
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
      // Terminal output is a hot path: write it straight to the GPU terminal and
      // skip the React reducer so streaming bytes never re-render the shell.
      if (event.kind === "workbench.terminalOutput") {
        const payload = event.payload as { paneId?: unknown; chunk?: unknown };
        if (typeof payload.paneId === "string" && typeof payload.chunk === "string") {
          routeProductShellTerminalOutput(payload.paneId, payload.chunk);
        }
        return;
      }
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
        // Populate the FileTree for the newly active thread (the refresh path
        // only fired on manual toggle before, leaving the tree empty on open).
        if (result.state.fileTreeOpen && result.state.activeThreadId) {
          dispatchBackendCommand({
            kind: "workbench.command",
            payload: {
              threadId: result.state.activeThreadId,
              command: "refresh_file_tree",
              data: { maxDepth: 2, maxEntries: 200 },
            },
          });
        }
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
    onThreadArchiveConfirm: (threadId) =>
      setShellState((state) => {
        const result = confirmProductShellThreadArchive(state, threadId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onThreadPinToggle: (threadId) =>
      setShellState((state) => {
        const result = toggleProductShellThreadPin(state, threadId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onThreadRenameStart: (threadId) =>
      setShellState((state) => startProductShellThreadRename(state, threadId)),
    onThreadRenameSubmit: (threadId, title) =>
      setShellState((state) => {
        const result = submitProductShellThreadRename(state, threadId, title);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onThreadRenameCancel: () =>
      setShellState((state) => cancelProductShellThreadRename(state)),
    onSearchQueryChange: (query) =>
      setShellState((state) => setProductShellSearchQuery(state, query)),
    onSearchToggle: () =>
      setShellState((state) => toggleProductShellSearch(state)),
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
    onEditorGoToReferences: (paneId) =>
      setShellState((state) => {
        const result = goToProductShellEditorReferences(state, paneId);
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
      viewModel.searchActive
        ? createElement(
            "div",
            { className: "left-ui-search" },
            createElement(Search, { size: 16, strokeWidth: 1.9, "aria-hidden": true }),
            createElement("input", {
              className: "left-ui-search__input",
              type: "search",
              "aria-label": "Search threads",
              placeholder: "Search",
              autoFocus: true,
              value: viewModel.searchQuery,
              onChange: (event: { currentTarget: { value: string } }) =>
                handlers.onSearchQueryChange(event.currentTarget.value),
              onKeyDown: (event: { key: string }) => {
                if (event.key === "Escape") {
                  handlers.onSearchToggle();
                }
              },
            }),
          )
        : createLeftNavRow("Search", createElement(Search, { size: 16, strokeWidth: 1.9 }), handlers.onSearchToggle),
    ),
    createElement(
      "div",
      { className: "left-ui__sections" },
      createThreadSection("Pinned", viewModel.pinnedThreads, handlers),
      createProjectSection(viewModel.projectGroups, handlers),
      createThreadSection("Scratch", viewModel.scratchThreads, handlers),
    ),
    createElement(
      "div",
      { className: "left-ui__footer" },
      createLeftNavRow("Settings", createElement(Settings, { size: 16, strokeWidth: 1.9 })),
    ),
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
                "div",
                {
                  key: tab.paneId,
                  className: "workbench-tab",
                  "data-active": tab.active,
                  role: "tab",
                  "aria-selected": tab.active,
                },
                createElement(
                  "button",
                  {
                    className: "workbench-tab__label",
                    type: "button",
                    onClick: () => handlers.onFocusWorkbenchPane(tab.paneId),
                  },
                  tab.title,
                ),
                tab.active
                  ? createElement(
                      "button",
                      {
                        className: "workbench-tab__close",
                        type: "button",
                        title: "Close Pane",
                        "aria-label": "Close Pane",
                        onClick: () => handlers.onCloseWorkbenchPane(tab.paneId),
                      },
                      createElement(X, { size: 12, strokeWidth: 2.2, "aria-hidden": true }),
                    )
                  : null,
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
  const language = inferEditorLanguage(props.pane.relativePath ?? props.pane.filePath);
  const isMarkdown = language === "markdown";
  return createElement(
    "div",
    {
      className: "workbench-pane-content workbench-pane-content--editor",
      "data-editor-readonly": readOnly ? "readonly" : "editable",
    },
    createEditorBreadcrumb(props.pane, props.draft?.dirty === true),
    isMarkdown
      ? createElement(WorkbenchMarkdownView, {
          paneId: props.pane.paneId,
          value,
          readOnly,
          dirty: props.draft?.dirty === true,
          revision: props.pane.revision,
          handlers: props.handlers,
        })
      : createElement(
          "div",
          { className: "workbench-editor-stack" },
          createElement(WorkbenchCodeEditor, {
            paneId: props.pane.paneId,
            value,
            readOnly,
            dirty: props.draft?.dirty === true,
            language,
            revision: props.pane.revision,
            navigationTarget: props.pane.navigationTarget,
            handlers: props.handlers,
          }),
          createWorkbenchEditorReferences(props.pane.references),
        ),
  );
}

// Breadcrumb path bar matching the Figma editor (`tide › CLAUDE.md`): the
// workspace root name followed by the file's path segments.
function createEditorBreadcrumb(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  dirty: boolean,
): ReactElement {
  const relativePath = pane.relativePath ?? pane.title;
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (pane.filePath && pane.relativePath && pane.filePath.endsWith(pane.relativePath)) {
    const root = pane.filePath.slice(0, pane.filePath.length - pane.relativePath.length);
    const rootName = root.replace(/\/+$/, "").split("/").pop();
    if (rootName) {
      segments.unshift(rootName);
    }
  }
  return createElement(
    "div",
    { className: "workbench-editor-breadcrumb", "aria-label": "Editor breadcrumb" },
    ...segments.flatMap((segment, index) =>
      index < segments.length - 1
        ? [
            createElement("span", { key: `crumb-${index}`, className: "workbench-editor-breadcrumb__crumb" }, segment),
            createElement("span", { key: `sep-${index}`, className: "workbench-editor-breadcrumb__sep" }, "›"),
          ]
        : [createElement("span", { key: `crumb-${index}`, className: "workbench-editor-breadcrumb__crumb" }, segment)],
    ),
    dirty
      ? createElement("span", { className: "workbench-editor-breadcrumb__dirty", title: "Unsaved changes" }, "●")
      : null,
  );
}

// Markdown Editor Pane: a pretty rendered Preview (Obsidian-style reading view)
// by default, toggleable to a raw-source Edit mode that saves on Cmd/Ctrl+S.
function WorkbenchMarkdownView(props: {
  paneId: string;
  value: string;
  readOnly: boolean;
  dirty: boolean;
  revision: string;
  handlers: ProductShellHandlers;
}): ReactElement {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const toggle = (target: "preview" | "edit", label: string) =>
    createElement(
      "button",
      {
        type: "button",
        className: "workbench-md-toggle__option",
        "data-active": mode === target ? "true" : "false",
        "aria-pressed": mode === target,
        onClick: () => setMode(target),
      },
      label,
    );
  return createElement(
    "div",
    { className: "workbench-md", "data-md-mode": mode },
    createElement(
      "div",
      { className: "workbench-md-toggle", role: "group", "aria-label": "Markdown view mode" },
      toggle("preview", "Preview"),
      props.readOnly ? null : toggle("edit", "Edit"),
    ),
    mode === "preview" || props.readOnly
      ? createElement("div", {
          className: "workbench-md-preview markdown-body",
          "aria-label": "Markdown preview",
          dangerouslySetInnerHTML: { __html: markdownRenderer.render(props.value) },
        })
      : createElement(WorkbenchCodeEditor, {
          paneId: props.paneId,
          value: props.value,
          readOnly: props.readOnly,
          dirty: props.dirty,
          language: "markdown",
          revision: props.revision,
          navigationTarget: undefined,
          handlers: props.handlers,
        }),
  );
}

function createWorkbenchEditorReferences(
  references: NonNullable<
    ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
  >["references"],
): ReactElement | null {
  if (references === undefined) {
    return null;
  }
  const heading = `References${references.query ? ` to ${references.query}` : ""} (${references.items.length}${references.truncated ? "+" : ""})`;
  return createElement(
    "div",
    { className: "workbench-editor-references", "aria-label": "References" },
    createElement("div", { className: "workbench-editor-references__heading" }, heading),
    references.items.length === 0
      ? createElement("div", { className: "workbench-editor-references__empty" }, "No references found.")
      : createElement(
          "ul",
          { className: "workbench-editor-references__list" },
          references.items.map((item, index) =>
            createElement(
              "li",
              {
                key: `${item.relativePath}:${item.line}:${item.character}:${index}`,
                className: "workbench-editor-references__item",
              },
              createElement(
                "span",
                { className: "workbench-editor-references__location" },
                `${item.relativePath}:${item.line + 1}:${item.character + 1}`,
              ),
              item.label
                ? createElement("span", { className: "workbench-editor-references__label" }, item.label)
                : null,
            ),
          ),
        ),
  );
}

function inferEditorLanguage(path: string | undefined): string {
  const ext = (path ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mts", "cts"].includes(ext)) return "ts";
  if (ext === "json") return "json";
  if (ext === "rs") return "rust";
  if (ext === "css") return "css";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  return "text";
}

function editorLanguageExtensions(language: string) {
  switch (language) {
    case "ts":
      return [javascript({ jsx: true, typescript: true })];
    case "json":
      return [jsonLanguage()];
    case "rust":
      return [rust()];
    case "css":
      return [cssLanguage()];
    case "markdown":
      return [markdownLang()];
    default:
      return [];
  }
}

// Real code editor: CodeMirror 6 (MIT). Grammar-based highlighting, line
// numbers, selection, editing. Read-only Panes still render highlighted via
// CodeMirror with editing disabled.
function WorkbenchCodeEditor(props: {
  paneId: string;
  value: string;
  readOnly: boolean;
  dirty: boolean;
  language: string;
  revision: string;
  navigationTarget?: NonNullable<
    ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
  >["navigationTarget"];
  handlers: ProductShellHandlers;
}): ReactElement {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const nav = props.navigationTarget;
  useEffect(() => {
    const view = editorRef.current?.view;
    if (nav === undefined || view === undefined) {
      return;
    }
    const lineNumber = Math.min(Math.max(nav.line + 1, 1), view.state.doc.lines);
    const lineInfo = view.state.doc.line(lineNumber);
    const from = Math.min(lineInfo.from + Math.max(nav.character, 0), lineInfo.to);
    const to = Math.min(from + Math.max(nav.length ?? 0, 0), view.state.doc.length);
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  }, [nav?.line, nav?.character, nav?.length, props.revision]);

  // Cmd/Ctrl+S saves — like a real editor, instead of a Save button.
  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        props.handlers.onEditorSave(props.paneId);
        return true;
      },
    },
  ]);

  // Right-click targets the symbol under the pointer (move the caret there so
  // the LSP query resolves the clicked identifier), then opens the editor
  // context menu with Go to Definition / Find References.
  const openContextMenu = (event: {
    preventDefault: () => void;
    clientX: number;
    clientY: number;
  }) => {
    event.preventDefault();
    const view = editorRef.current?.view;
    if (view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos !== null && pos !== undefined) {
        view.dispatch({ selection: { anchor: pos } });
        props.handlers.onEditorCursorChange(props.paneId, pos);
      }
    }
    setContextMenu({ x: event.clientX, y: event.clientY });
  };
  const closeMenu = () => setContextMenu(null);

  const menuItem = (label: string, onSelect: () => void, disabled = false) =>
    createElement(
      "button",
      {
        type: "button",
        className: "workbench-editor-menu__item",
        disabled,
        onClick: () => {
          onSelect();
          closeMenu();
        },
      },
      label,
    );

  return createElement(
    "div",
    {
      className: "workbench-editor-surface",
      "aria-label": "Editor Pane text",
      "data-editor-language": props.language,
      "data-navigation-target": nav?.label,
      onContextMenu: openContextMenu,
    },
    createElement(CodeMirror, {
      ref: editorRef,
      className: "workbench-editor-cm",
      value: props.value,
      editable: !props.readOnly,
      readOnly: props.readOnly,
      basicSetup: {
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !props.readOnly,
      },
      extensions: [saveKeymap, EditorView.lineWrapping, ...editorLanguageExtensions(props.language)],
      onChange: (next: string) => props.handlers.onEditorDraftChange(props.paneId, next),
      onUpdate: (update: ViewUpdate) => {
        if (update.selectionSet) {
          props.handlers.onEditorCursorChange(props.paneId, update.state.selection.main.head);
        }
      },
    }),
    contextMenu === null
      ? null
      : createElement(
          "div",
          {
            className: "workbench-editor-menu-backdrop",
            onClick: closeMenu,
            onContextMenu: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              closeMenu();
            },
          },
          createElement(
            "div",
            {
              className: "workbench-editor-menu",
              role: "menu",
              "aria-label": "Editor actions",
              style: { left: `${contextMenu.x}px`, top: `${contextMenu.y}px` } as CSSProperties,
            },
            menuItem("Go to Definition", () => props.handlers.onEditorGoToDefinition(props.paneId)),
            menuItem("Find References", () => props.handlers.onEditorGoToReferences(props.paneId)),
            props.readOnly
              ? null
              : menuItem("Save", () => props.handlers.onEditorSave(props.paneId), !props.dirty),
          ),
        ),
  );
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
    props.pane.diffText ? createDiffView(props.pane.diffText) : null,
  );
}

type DiffLineKind = "header" | "hunk" | "added" | "removed" | "context";

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "header";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "added";
  }
  if (line.startsWith("-")) {
    return "removed";
  }
  return "context";
}

// D4: render the bounded unified diff as change-type-tagged lines so added and
// removed lines read distinctly. Unknown markers fall back to context so no
// diff content (including a trailing "[diff truncated]" notice) is hidden.
function createDiffView(diffText: string): ReactElement {
  const lines = diffText.split("\n");
  return createElement(
    "div",
    { className: "workbench-diff", "aria-label": "Diff view", role: "group" },
    lines.map((line, index) => {
      const kind = classifyDiffLine(line);
      const marker = kind === "added" ? "+" : kind === "removed" ? "-" : kind === "context" ? " " : "";
      const text =
        kind === "added" || kind === "removed" || (kind === "context" && line.startsWith(" "))
          ? line.slice(1)
          : line;
      return createElement(
        "div",
        { key: index, className: `workbench-diff-line workbench-diff-line--${kind}` },
        createElement(
          "span",
          { className: "workbench-diff-line__marker", "aria-hidden": "true" },
          marker,
        ),
        createElement("span", { className: "workbench-diff-line__text" }, text),
      );
    }),
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

function formatBeforeAfterBytes(before: number | undefined, after: number | undefined): string | undefined {
  return typeof before === "number" && typeof after === "number"
    ? `${before} -> ${after} bytes`
    : undefined;
}

// Live terminal byte sinks keyed by paneId. Terminal output is a hot path, so
// it is written straight to the GPU terminal and never funneled through React
// state (which would re-render the whole shell per chunk).
const terminalOutputSinks = new Map<string, (chunk: string) => void>();

function routeProductShellTerminalOutput(paneId: string, chunk: string): boolean {
  const sink = terminalOutputSinks.get(paneId);
  if (sink === undefined) {
    return false;
  }
  sink(chunk);
  return true;
}

// Real GPU-accelerated terminal: xterm.js with the WebGL addon (MIT). Drawing
// many cells is a simple, parallel job — like v1's WGPU cell rendering — so it
// belongs on the GPU, not per-cell DOM. Falls back to xterm's default renderer
// when WebGL is unavailable (headless/jsdom/no-GPU).
function WorkbenchTerminalView(props: {
  paneId: string;
  initialText: string;
  onInput: (paneId: string, bytes: string) => void;
}): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || XtermTerminal === undefined) {
      return;
    }
    // xterm core mounts synchronously so the terminal is visible immediately.
    const term = new XtermTerminal({
      convertEol: true,
      fontSize: 12,
      fontFamily: '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      scrollback: 5000,
      theme: { background: "#fcfcfb", foreground: "#242424", cursor: "#343038" },
    });
    term.open(host);
    if (props.initialText.length > 0) {
      term.write(props.initialText);
    }
    const dataSub = term.onData((data) => props.onInput(props.paneId, data));
    terminalOutputSinks.set(props.paneId, (chunk) => term.write(chunk));

    let active = true;
    let fitAddon: { fit: () => void } | undefined;
    let observer: ResizeObserver | undefined;
    // Attach the fit + GPU (WebGL) addons asynchronously; they only upgrade an
    // already-visible terminal, so there is no first-open delay.
    void (async () => {
      try {
        const fitMod = (await import("@xterm/addon-fit")) as {
          FitAddon?: new () => { fit: () => void };
          default?: { FitAddon: new () => { fit: () => void } };
        };
        const FitAddonCtor = fitMod.FitAddon ?? fitMod.default?.FitAddon;
        if (active && FitAddonCtor !== undefined) {
          fitAddon = new FitAddonCtor();
          term.loadAddon(fitAddon as never);
          fitAddon.fit();
          if (typeof ResizeObserver !== "undefined" && hostRef.current !== null) {
            observer = new ResizeObserver(() => {
              try {
                fitAddon?.fit();
              } catch {
                // measurement unavailable
              }
            });
            observer.observe(hostRef.current);
          }
        }
      } catch {
        // fit addon unavailable (headless/jsdom) — terminal still renders.
      }
      try {
        const webglMod = (await import("@xterm/addon-webgl")) as {
          WebglAddon?: new () => { onContextLoss: (cb: () => void) => void; dispose: () => void };
          default?: { WebglAddon: new () => { onContextLoss: (cb: () => void) => void; dispose: () => void } };
        };
        const WebglAddonCtor = webglMod.WebglAddon ?? webglMod.default?.WebglAddon;
        if (active && WebglAddonCtor !== undefined) {
          const webgl = new WebglAddonCtor();
          webgl.onContextLoss(() => webgl.dispose());
          term.loadAddon(webgl as never);
        }
      } catch {
        // No WebGL (headless/jsdom/no-GPU) — xterm uses its default renderer.
      }
    })();

    return () => {
      active = false;
      terminalOutputSinks.delete(props.paneId);
      dataSub.dispose();
      observer?.disconnect();
      term.dispose();
    };
  }, [props.paneId]);
  return createElement("div", {
    className: "workbench-terminal-xterm",
    "data-terminal-xterm": props.paneId,
    ref: hostRef,
  });
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
    createElement(WorkbenchTerminalView, {
      paneId: props.pane.paneId,
      initialText: props.pane.transcriptPreview ?? "",
      onInput: props.handlers.onTerminalInput,
    }),
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
      thread.renaming
        ? createElement("input", {
            className: "thread-row__rename-input",
            "aria-label": "Rename thread",
            defaultValue: thread.title,
            autoFocus: true,
            onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
            onKeyDown: (event: {
              key: string;
              currentTarget: { value: string };
              preventDefault: () => void;
            }) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handlers.onThreadRenameSubmit(thread.threadId, event.currentTarget.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                handlers.onThreadRenameCancel();
              }
            },
            onBlur: (event: { currentTarget: { value: string } }) =>
              handlers.onThreadRenameSubmit(thread.threadId, event.currentTarget.value),
          })
        : createElement(
            "button",
            {
              className: "thread-row__main",
              type: "button",
              "aria-pressed": thread.active,
              onClick: () => handlers.onThreadSelect(thread.threadId),
              onDoubleClick: () => handlers.onThreadRenameStart(thread.threadId),
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
              onClick: () => handlers.onThreadArchiveConfirm(thread.threadId),
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
                () => handlers.onThreadPinToggle(thread.threadId),
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
