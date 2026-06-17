import type { ProductShellBackendEventSource, ProductShellContentSearch, ProductShellStartPageFile, ProductShellState } from "./types.ts";
import { startFilePaneId } from "./types.ts";
import { applyAgentChatBackendEvent, setAvailableProviderAgents, setOpencodeEnvironment, setOpencodeModelCatalog, setOpencodeVendors, setProviderModelCatalog, updateComposerDraft } from "../../agent-chat/agent-chat.ts";
import type { AgentChatBackendEvent, AgentChatCommandOption, AgentChatThreadSummary } from "../../agent-chat/agent-chat.ts";
import { applyAppChromeBackendEvent } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { applyProductShellThreadArchivedEvent, applyProductShellThreadEvent, applyProductShellThreadLaunchOptionsChangedEvent, applyProductShellThreadPinChangedEvent, applyProductShellThreadRenamedEvent, toProductShellThreadFromSummary } from "./thread-list.ts";
import { setProductShellProviderCommands } from "./composer-bridge.ts";
import { createStartAgentChatState } from "./start.ts";
import { productShellFileTreeFromPayload } from "./file-tree.ts";
import { reconcileEditorDrafts } from "./workbench-editor.ts";
import { projectsFromThreads } from "./view-model.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

export function applyProductShellBackendEvent(
  state: ProductShellState,
  event: AgentChatBackendEvent,
  source: ProductShellBackendEventSource = "command",
): ProductShellState {
  const applyToActiveSurfaces = shouldApplyBackendEventToActiveSurfaces(state, event, source);
  const agentChat = applyToActiveSurfaces
    ? applyAgentChatBackendEvent(state.agentChat, event)
    : state.agentChat;
  const appChrome = applyToActiveSurfaces
    ? applyAppChromeBackendEvent(state.appChrome, event)
    : state.appChrome;
  // AUTHORITATIVE PER-THREAD STATE: a per-thread event for a NON-active thread that we
  // already hold chat state for is folded into that thread's stored entry — so its
  // running/waiting/prompt/blocks stay current while it sits in the background. Without
  // this, a background thread's prompt.changed/stateChanged/block events were dropped
  // (active-surface only) and recovery leaned on a hydrate race at switch time, which
  // broke under concurrency (a sibling thread's AskUserQuestion never surfaced; the chat
  // stayed "Working"). Switching is now a pure projection of an already-current entry.
  // (The active thread's own entry is captured into the map at switch time via
  // preserveActiveAgentChat, so we never double-fold it here.)
  const eventThreadId = threadIdFromBackendEvent(event);
  // thread.hydrated / thread.started carry a thread's AUTHORITATIVE chat state (its
  // blocks + a CLEARED `hydrating`). They must reach that thread's stored entry even
  // when it is not the active surface at apply time. A hydrate is dispatched on open
  // but its response resolves a round-trip later; if focus moved in that window (a
  // notification jumped to another thread, a thread.listed nulled activeThreadId, …)
  // the response matched neither the active surface NOR an existing background entry,
  // so it was dropped — and `hydrating` was never cleared, stranding the thread on the
  // loading skeleton until an app restart. Seed a fresh entry for these events so the
  // hydrate is recorded no matter where focus is.
  const seedsThreadState = event.kind === "thread.hydrated" || event.kind === "thread.started";
  const foldsIntoBackgroundThread =
    eventThreadId !== undefined &&
    eventThreadId !== state.activeThreadId &&
    (state.agentChatByThreadId[eventThreadId] !== undefined || seedsThreadState);
  const agentChatByThreadId = foldsIntoBackgroundThread
    ? {
        ...state.agentChatByThreadId,
        [eventThreadId]: applyAgentChatBackendEvent(
          state.agentChatByThreadId[eventThreadId] ?? createStartAgentChatState(),
          event,
        ),
      }
    : state.agentChatByThreadId;
  const nextState = {
    ...state,
    agentChat,
    appChrome,
    agentChatByThreadId,
  };

  switch (event.kind) {
    case "thread.listed": {
      // Record which provider-CLI agents the backend detected locally so the composer agent menu
      // enables them and labels the rest "Not installed". This is fast (which-based) and arrives
      // immediately — opencode's slower catalog comes separately via providerCatalog.changed, so
      // the agent menu is never blocked behind it. See provider-cli-setup-handoff.md.
      const listedPayload = event.payload as { availableAgents?: readonly string[] };
      setAvailableProviderAgents(listedPayload.availableAgents ?? null);
      return applyProductShellThreadListEvent(nextState, event);
    }
    case "providerCatalog.changed": {
      // opencode's catalog, delivered out of band from thread.listed: the model menu (multi-vendor
      // router), the "Connect a model" on-ramp grid + connected-state, and version. Module-level
      // setters; returning a fresh nextState triggers the re-render that reads them.
      const catalog = event.payload as {
        opencodeModels?: ReadonlyArray<{ value: string; label: string; vendor?: string; detail?: string }>;
        opencodeVendors?: ReadonlyArray<{ id: string; label: string; connected: boolean; method?: string; popular?: boolean; usable?: boolean }>;
        opencodeEnvironment?: { version?: string; testedWith?: string; executablePath?: string };
      };
      setOpencodeModelCatalog(
        catalog.opencodeModels?.map((model) => ({
          value: model.value,
          label: model.label,
          vendor: model.vendor,
          detail: model.detail,
        })) ?? null,
      );
      setOpencodeVendors(
        catalog.opencodeVendors?.map((vendor) => ({
          id: vendor.id,
          label: vendor.label,
          connected: vendor.connected,
          method: vendor.method,
          popular: vendor.popular,
          usable: vendor.usable,
        })) ?? null,
      );
      setOpencodeEnvironment(catalog.opencodeEnvironment ?? null);
      return nextState;
    }
    case "thread.started":
    case "thread.hydrated":
      return applyProductShellThreadEvent(nextState, event, source);
    case "thread.archived":
      return applyProductShellThreadArchivedEvent(nextState, event);
    case "thread.pinChanged":
      return applyProductShellThreadPinChangedEvent(nextState, event);
    case "thread.renamed":
      return applyProductShellThreadRenamedEvent(nextState, event);
    case "thread.launchOptionsChanged":
      return applyProductShellThreadLaunchOptionsChangedEvent(nextState, event);
    case "agentRuntime.stateChanged": {
      const payload = event.payload as { threadId?: string; state?: string };
      // Update the thread's rail status for EVERY thread regardless of focus, so
      // background threads show their live running / needs-input state in the list
      // (v1 parity — running agents were always indicated, not just the focused one).
      const threads =
        payload.threadId === undefined
          ? nextState.threads
          : nextState.threads.map((thread) =>
              thread.threadId === payload.threadId
                ? {
                    ...thread,
                    running: payload.state === "running",
                    attention:
                      payload.state === "waiting_for_input" ||
                      payload.state === "waiting_for_approval",
                  }
                : thread,
            );
      const withThreads = threads === nextState.threads ? nextState : { ...nextState, threads };
      // The active thread's composer also clears its draft when its own run starts.
      if (applyToActiveSurfaces && payload.state === "running") {
        return {
          ...withThreads,
          agentChat: updateComposerDraft(withThreads.agentChat, "").state,
        };
      }
      return withThreads;
    }
    case "agentRuntime.commandsChanged": {
      // The provider protocol's real slash-commands/skills (claude init,
      // codex skills/list, gemini available_commands_update) — authoritative and
      // richer than the pre-turn file discovery, so they replace providerCommands.
      const commandsPayload = event.payload as {
        commands?: AgentChatCommandOption[];
      };
      if (commandsPayload.commands === undefined || commandsPayload.commands.length === 0) {
        return nextState;
      }
      return setProductShellProviderCommands(nextState, commandsPayload.commands);
    }
    case "agentRuntime.modelCatalogChanged": {
      // The agent self-reported its model catalog over the protocol (gemini ACP /
      // opencode configOptions) — cache it so the composer menu reflects the real
      // list. Module-level cache (read by cliModelOptionsForAgent); no view change.
      const catalogPayload = event.payload as {
        agentId?: string;
        models?: ReadonlyArray<{ value: string; label: string; vendor?: string; detail?: string }>;
      };
      if (catalogPayload.agentId !== undefined) {
        setProviderModelCatalog(
          catalogPayload.agentId,
          catalogPayload.models?.map((model) => ({
            value: model.value,
            label: model.label,
            vendor: model.vendor,
            detail: model.detail,
          })) ?? null,
        );
      }
      return nextState;
    }
    case "workbench.changed": {
      const payload = event.payload as {
        threadId?: string;
        panes?: AppChromeWorkbenchPaneRef[];
        activePaneId?: string;
        layoutMode?: "stacked" | "split";
        fileTree?: unknown;
      };
      // A workbench change only touches the view when it is FOR the active thread.
      // This must also hold when no thread is active (the New Thread composer,
      // activeThreadId === null): a BACKGROUND thread opening a browser must not flip
      // the workbench open on the composer the user is looking at. (payload.threadId
      // undefined means an inherently active-thread-scoped event — let it through.)
      if (
        payload.threadId !== undefined &&
        payload.threadId !== state.activeThreadId
      ) {
        return state;
      }
      const panes = payload.panes ?? [];
      const threadId = payload.threadId ?? state.activeThreadId;
      // Auto-open only when a NEW real (non-launcher) visible pane appears (an agent
      // opened a browser, the user opened a terminal/editor). An UPDATE to existing
      // panes — e.g. terminal output/status events stream workbench.changed — must
      // NOT re-open the workbench, or the user could never close it while a terminal
      // is running. Otherwise preserve the user's open/closed intent, and close only
      // when nothing is visible at all.
      // Previous panes for this thread, to detect a genuinely NEW pane. Background threads
      // use their per-thread memory; the active thread (incl. the Composer's Draft Thread,
      // which isn't in the rail list) uses its live appChrome panes BEFORE this event.
      const previousPanes =
        threadId === null
          ? []
          : nextState.threads.find((thread) => thread.threadId === threadId)?.workbenchPanes ??
            (threadId === state.activeThreadId ? state.appChrome.workbenchPanes : []);
      const existingPaneIds = new Set(previousPanes.map((pane) => pane.paneId));
      const hasNewRealPane = panes.some(
        (pane) => pane.visible && pane.kind !== "launcher" && !existingPaneIds.has(pane.paneId),
      );
      const anyVisible = panes.some((pane) => pane.visible);
      // The in-pane Editor file picker is renderer-only state (it has no backend pane), so a
      // workbench.changed carrying an empty pane set — e.g. the Composer Draft Thread's first
      // event, fired the moment the user clicks Editor to open the picker — must NOT read as
      // "nothing visible" and snap the workbench shut from under the picker. Treat an open
      // picker like a visible pane: preserve the user's open state rather than closing.
      // A string (incl. "") means the picker is open; null/undefined means closed. Use a
      // typeof check rather than `!== null` so a missing value never reads as "open".
      const pickerOpen = typeof nextState.editorPickerFilter === "string";
      const nextWorkbenchOpen = hasNewRealPane
        ? true
        : anyVisible || pickerOpen
          ? nextState.workbenchOpen
          : false;
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
        workbenchOpen: nextWorkbenchOpen,
        // Keep the per-thread memory in sync with the effective open state (a new pane
        // opens it; an update keeps the user's choice), so switching away and back
        // restores exactly what's on screen now.
        workbenchOpenByThreadId:
          threadId === null
            ? nextState.workbenchOpenByThreadId
            : { ...nextState.workbenchOpenByThreadId, [threadId]: nextWorkbenchOpen },
        // Backend owns the Thread's Stacked/Split presentation; reflect it (e.g. an
        // agent's tide_set_workbench_layout) when present.
        workbenchLayoutMode: payload.layoutMode ?? nextState.workbenchLayoutMode,
        fileTree:
          payload.fileTree === undefined
            ? nextState.fileTree
            : productShellFileTreeFromPayload(payload.fileTree),
        editorDrafts: reconcileEditorDrafts(nextState.editorDrafts, panes),
      };
    }
    case "workspace.fileTreeLoaded": {
      // Start-page file tree for the composer-selected directory. Only applies while
      // no thread is active (the New Thread page); once a thread opens, that thread's
      // own tree takes over.
      if (state.activeThreadId !== null) {
        return nextState;
      }
      const payload = event.payload as { cwd?: string; fileTree?: unknown };
      const nextTree = productShellFileTreeFromPayload(payload.fileTree);
      // Keep the expanded set when re-listing the SAME directory (a lazy expand
      // round-trip); reset it only when a different project's tree loads.
      const sameRoot =
        nextTree?.root !== undefined && nextTree.root === nextState.fileTree?.root;
      return {
        ...nextState,
        fileTree: nextTree,
        expandedFolderPaths: sameRoot ? nextState.expandedFolderPaths : [],
        // A tree for a DIFFERENT directory closes the previous project's open files;
        // re-listing the same directory (toggle) leaves them open.
        startPageFiles: nextState.startPageFiles.filter((file) => file.cwd === payload.cwd),
      };
    }
    case "workspace.fileLoaded": {
      // The start-page editor's file content. Ignored once a thread is active
      // (the thread's own workbench owns file display there). Opens the Workbench
      // column so the file shows as an editor pane on the right — the view-model
      // synthesizes that pane from startPageFile.
      if (state.activeThreadId !== null) {
        return nextState;
      }
      const payload = event.payload as {
        cwd?: string;
        relativePath?: string;
        content?: string;
        truncated?: boolean;
      };
      if (typeof payload.cwd !== "string" || typeof payload.relativePath !== "string") {
        return nextState;
      }
      // A cross-file go-to-definition opened this file; carry its target in so the
      // editor scrolls to the definition once the content is here.
      const pending = nextState.startPagePendingNavigation;
      const navigationTarget =
        pending !== null && pending.relativePath === payload.relativePath ? pending.target : undefined;
      // Open the file as its OWN editor tab: replace it if already open (fresh read),
      // else append. The loaded file becomes the active tab.
      const loadedFile: ProductShellStartPageFile = {
        cwd: payload.cwd,
        relativePath: payload.relativePath,
        content: typeof payload.content === "string" ? payload.content : "",
        truncated: payload.truncated === true,
        navigationTarget,
      };
      const loadedIndex = nextState.startPageFiles.findIndex(
        (file) => file.cwd === loadedFile.cwd && file.relativePath === loadedFile.relativePath,
      );
      const startPageFiles =
        loadedIndex >= 0
          ? nextState.startPageFiles.map((file, index) => (index === loadedIndex ? loadedFile : file))
          : [...nextState.startPageFiles, loadedFile];
      return {
        ...nextState,
        workbenchOpen: true,
        startPagePendingNavigation:
          navigationTarget !== undefined ? null : nextState.startPagePendingNavigation,
        startPageFiles,
        draftActiveWorkbenchPaneId: startFilePaneId(loadedFile.relativePath),
      };
    }
    case "workspace.fileSaved": {
      // The start-page editor's save landed on disk: re-base the editor to the
      // saved content and drop the dirty draft. Ignored once a thread is active.
      if (state.activeThreadId !== null) {
        return nextState;
      }
      const payload = event.payload as {
        cwd?: string;
        relativePath?: string;
        content?: string;
        truncated?: boolean;
      };
      const savedIndex = nextState.startPageFiles.findIndex(
        (file) => file.cwd === payload.cwd && file.relativePath === payload.relativePath,
      );
      if (savedIndex < 0) {
        return nextState;
      }
      return {
        ...nextState,
        startPageFiles: nextState.startPageFiles.map((file, index) =>
          index === savedIndex
            ? {
                ...file,
                content: typeof payload.content === "string" ? payload.content : file.content,
                truncated: payload.truncated === true,
                draft: undefined,
                dirty: false,
              }
            : file,
        ),
      };
    }
    case "workspace.contentSearchResults": {
      const payload = event.payload as Partial<ProductShellContentSearch>;
      return {
        ...nextState,
        contentSearch: {
          query: typeof payload.query === "string" ? payload.query : "",
          matches: Array.isArray(payload.matches) ? payload.matches : [],
          fileCount: typeof payload.fileCount === "number" ? payload.fileCount : 0,
          truncated: payload.truncated === true,
        },
      };
    }
    default:
      return nextState;
  }
}

function shouldApplyBackendEventToActiveSurfaces(
  state: ProductShellState,
  event: AgentChatBackendEvent,
  source: ProductShellBackendEventSource,
): boolean {
  // thread.listed updates the whole rail, never a single chat surface.
  if (event.kind === "thread.listed") {
    return true;
  }
  // The active chat shows exactly the active thread (focus is user-owned). Apply an
  // event to it only when the event is FOR the active thread — regardless of where
  // it came from. A late command response for a thread the user already left, or a
  // background broadcast, never touches the current chat. No active thread (New
  // Thread composer) → nothing applies.
  if (state.activeThreadId === null) {
    return false;
  }
  const eventThreadId = threadIdFromBackendEvent(event);
  if (eventThreadId === undefined) {
    return true;
  }
  return eventThreadId === state.activeThreadId;
}

function threadIdFromBackendEvent(event: AgentChatBackendEvent): string | undefined {
  switch (event.kind) {
    case "agentRuntime.stateChanged":
    case "agentRuntime.usageChanged":
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
    case "thread.started":
    case "thread.hydrated": {
      const payload = event.payload as { thread?: { threadId?: unknown } };
      return typeof payload.thread?.threadId === "string" ? payload.thread.threadId : undefined;
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
    threadsLoaded: true,
    leftRailMenu: null,
    archiveConfirmThreadId: null,
    fileTree: null,
    editorDrafts: {},
  };
}
