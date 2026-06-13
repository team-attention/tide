import type { ProductShellBackendEventSource, ProductShellContentSearch, ProductShellState } from "./types.ts";
import { applyAgentChatBackendEvent, setAvailableProviderAgents, updateComposerDraft } from "../../agent-chat/agent-chat.ts";
import type { AgentChatBackendEvent, AgentChatCommandOption, AgentChatThreadSummary } from "../../agent-chat/agent-chat.ts";
import { applyAppChromeBackendEvent } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { applyProductShellThreadArchivedEvent, applyProductShellThreadEvent, applyProductShellThreadLaunchOptionsChangedEvent, applyProductShellThreadPinChangedEvent, applyProductShellThreadRenamedEvent, toProductShellThreadFromSummary } from "./thread-list.ts";
import { setProductShellProviderCommands } from "./composer-bridge.ts";
import { productShellFileTreeFromPayload } from "./file-tree.ts";
import { reconcileEditorDrafts } from "./workbench.ts";
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
  const nextState = {
    ...state,
    agentChat,
    appChrome,
  };

  switch (event.kind) {
    case "thread.listed":
      // Record which provider-CLI agents the backend detected locally so the composer
      // agent menu enables them and shows the rest disabled.
      setAvailableProviderAgents(
        (event.payload as { availableAgents?: readonly string[] }).availableAgents ?? null,
      );
      return applyProductShellThreadListEvent(nextState, event);
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
    case "workbench.changed": {
      const payload = event.payload as {
        threadId?: string;
        panes?: AppChromeWorkbenchPaneRef[];
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
      const existingPaneIds = new Set(
        (threadId === null
          ? []
          : nextState.threads.find((thread) => thread.threadId === threadId)?.workbenchPanes ?? []
        ).map((pane) => pane.paneId),
      );
      const hasNewRealPane = panes.some(
        (pane) => pane.visible && pane.kind !== "launcher" && !existingPaneIds.has(pane.paneId),
      );
      const anyVisible = panes.some((pane) => pane.visible);
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
        workbenchOpen: hasNewRealPane ? true : anyVisible ? nextState.workbenchOpen : false,
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
      return {
        ...nextState,
        fileTree: productShellFileTreeFromPayload(payload.fileTree),
        expandedFolderPaths: [],
        // A tree for a DIFFERENT directory closes the previous project's viewer;
        // re-listing the same directory (toggle) leaves it open.
        startPageFile:
          nextState.startPageFile !== null && nextState.startPageFile.cwd === payload.cwd
            ? nextState.startPageFile
            : null,
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
      return {
        ...nextState,
        workbenchOpen: true,
        startPagePendingNavigation:
          navigationTarget !== undefined ? null : nextState.startPagePendingNavigation,
        startPageFile: {
          cwd: payload.cwd,
          relativePath: payload.relativePath,
          content: typeof payload.content === "string" ? payload.content : "",
          truncated: payload.truncated === true,
          navigationTarget,
        },
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
      const file = nextState.startPageFile;
      if (
        file === null ||
        file.cwd !== payload.cwd ||
        file.relativePath !== payload.relativePath
      ) {
        return nextState;
      }
      return {
        ...nextState,
        startPageFile: {
          ...file,
          content: typeof payload.content === "string" ? payload.content : file.content,
          truncated: payload.truncated === true,
          draft: undefined,
          dirty: false,
        },
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
