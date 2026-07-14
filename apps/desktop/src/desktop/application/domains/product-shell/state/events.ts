import type { ProductShellBackendEventSource, ProductShellContentSearch, ProductShellProviderCapability, ProductShellProviderUsage, ProductShellState } from "./types.ts";
import { applyAgentChatBackendEvent, updateComposerDraft } from "../../agent-chat/agent-chat.ts";
import type { AgentChatBackendEvent, AgentChatCommandOption, AgentChatProviderCatalog, AgentChatProviderReadiness, AgentChatThreadSummary } from "../../agent-chat/agent-chat.ts";
import { applyAppChromeBackendEvent } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { applyProductShellThreadArchivedEvent, applyProductShellThreadEvent, applyProductShellThreadLaunchOptionsChangedEvent, applyProductShellThreadPinChangedEvent, applyProductShellThreadRenamedEvent, toProductShellThreadFromSummary } from "./thread-list.ts";
import { setProductShellProviderCommands } from "./composer-bridge.ts";
import { activeSurfaceThreadId, createStartAgentChatState, isProductShellAgentIdentity } from "./start.ts";
import { productShellFileTreeFromPayload } from "./file-tree.ts";
import { defaultModelForProvider, providerCatalogFromPayload, providerModelsFromPayload } from "./provider-catalog-payload.ts";
import { providerInventoryFromPayload, providerReadinessFromInventoryPayload } from "./provider-inventory-payload.ts";
import { applyDismissedProductShellEditorReferences, reconcileEditorDrafts } from "./workbench-editor.ts";
import { projectsFromThreads } from "./view-model.ts";
import { resolveProductShellActiveWorkbenchPaneId } from "./workbench-active-pane.ts";
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
  // AUTHORITATIVE PER-THREAD STATE: a per-thread event for a NON-active thread is ALWAYS
  // folded into that thread's stored entry — seeding a fresh entry when none is held yet.
  // The backend is authoritative for EVERY thread, so the renderer must never drop a
  // thread's prompt.changed / agentRuntime.stateChanged / block / hydrate events just
  // because that thread is not the surface on screen. Which thread is being viewed is a
  // pure VIEW concern and must never gate authoritative-state retention.
  //
  // This used to fold ONLY when an entry already existed OR the event was a
  // hydrate/started "seed", so a per-thread DATA event for a thread we held no entry for
  // was silently dropped. That stranded two real cases the moment focus had moved (a
  // notification jumped away, a thread.listed transiently nulled activeThreadId, the user
  // switched): (1) a late hydrate response landed nowhere → endless loading skeleton;
  // (2) the promoted card of a batched parallel-permission turn (claude blocks until
  // EVERY can_use_tool is answered) never surfaced → the thread wedged "running" with no
  // card and no way out. Folding unconditionally records the card, so re-viewing the
  // thread always shows it. See claude-parallel-permission-wedge.md.
  //
  // The displayed thread's own entry is captured into the map at switch time via
  // preserveActiveAgentChat (and its live events land on agentChat above), so excluding the
  // surface thread id here never double-folds it.
  const eventThreadId = threadIdFromBackendEvent(event);
  const surfaceThreadId = activeSurfaceThreadId(state);
  const foldsIntoBackgroundThread =
    eventThreadId !== undefined && eventThreadId !== surfaceThreadId;
  const agentChatByThreadId = foldsIntoBackgroundThread
    ? {
        ...state.agentChatByThreadId,
        [eventThreadId]: applyAgentChatBackendEvent(
          state.agentChatByThreadId[eventThreadId] ?? createStartAgentChatState(),
          event,
        ),
      }
    : state.agentChatByThreadId;
  const foldedState = {
    ...state,
    agentChat,
    appChrome,
    agentChatByThreadId,
  };
  const nextState = foldedState;

  switch (event.kind) {
    case "thread.listed": {
      return applyProductShellThreadListEvent(
        seedProviderInventoryFromLegacyThreadList(nextState, event),
        event,
      );
    }
    case "providerInventory.changed": {
      const providerInventory = providerInventoryFromPayload(event.payload);
      if (providerInventory === null) {
        return nextState;
      }
      return applyProviderInventoryReadinessToStartComposer(
        { ...nextState, providerInventory },
        event.payload,
      );
    }
    case "providerCatalog.changed": {
      const catalog = providerCatalogFromPayload(event.payload);
      if (catalog === null) {
        return nextState;
      }
      return {
        ...nextState,
        providerCatalogs: {
          ...nextState.providerCatalogs,
          [catalog.agentId]: catalog,
        },
      };
    }
    case "providerUsage.changed": {
      const usagePayload = event.payload as {
        usages?: ReadonlyArray<{
          agentId?: unknown;
          usage?: ProductShellProviderUsage["usage"];
          observedAt?: unknown;
        }>;
      };
      const incoming: ProductShellProviderUsage[] = (usagePayload.usages ?? [])
        .filter(
          (entry): entry is {
            agentId: ProductShellProviderUsage["agentId"];
            usage: ProductShellProviderUsage["usage"];
            observedAt?: string;
          } =>
            typeof entry === "object" &&
            entry !== null &&
            typeof entry.agentId === "string" &&
            isProductShellAgentIdentity(entry.agentId) &&
            entry.usage !== undefined &&
            (entry.observedAt === undefined || typeof entry.observedAt === "string"),
        )
        .map((entry) => ({
          agentId: entry.agentId,
          usage: entry.usage,
          ...(entry.observedAt !== undefined ? { observedAt: entry.observedAt } : {}),
        }));
      if (incoming.length === 0) {
        return nextState;
      }
      const byKey = new Map(
        nextState.providerUsage.map((entry) => [providerUsageKey(entry), entry] as const),
      );
      for (const entry of incoming) {
        byKey.set(providerUsageKey(entry), entry);
      }
      const providerUsage = [...byKey.values()];
      return { ...nextState, providerUsage };
    }
    case "thread.started":
    case "thread.hydrated":
    case "thread.goalSet":
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
      // codex skills/list, ACP available_commands_update) — authoritative and
      // richer than the pre-turn file discovery, so they replace providerCommands.
      const commandsPayload = event.payload as {
        commands?: AgentChatCommandOption[];
      };
      if (commandsPayload.commands === undefined || commandsPayload.commands.length === 0) {
        return nextState;
      }
      return setProductShellProviderCommands(nextState, commandsPayload.commands);
    }
    case "agentRuntime.capabilitiesChanged": {
      const payload = event.payload as {
        capabilities?: ProductShellProviderCapability[];
      };
      if (payload.capabilities === undefined) {
        return nextState;
      }
      return { ...nextState, providerCapabilities: payload.capabilities };
    }
    case "agentRuntime.modelCatalogChanged": {
      // The agent self-reported its model catalog over the protocol (ACP /
      // opencode configOptions). Fold it into the same Product Shell provider
      // catalog slice as provider.catalog.get.
      const catalogPayload = event.payload as {
        agentId?: string;
        models?: ReadonlyArray<{ value: string; label: string; vendor?: string; detail?: string }>;
      };
      const agentId = catalogPayload.agentId;
      if (agentId === undefined || !isProductShellAgentIdentity(agentId)) {
        return nextState;
      }
      const previous = nextState.providerCatalogs[agentId];
      const catalog: AgentChatProviderCatalog = {
        agentId,
        status: "ready",
        models: providerModelsFromPayload(catalogPayload.models),
        vendors: previous?.vendors,
        environment: previous?.environment,
        currentModel: previous?.currentModel,
        defaultModel: previous?.defaultModel ?? defaultModelForProvider(agentId),
      };
      return {
        ...nextState,
        providerCatalogs: {
          ...nextState.providerCatalogs,
          [catalog.agentId]: catalog,
        },
      };
    }
    case "workbench.changed": {
      const payload = event.payload as {
        threadId?: string;
        panes?: AppChromeWorkbenchPaneRef[];
        activePaneId?: string;
        layoutMode?: "stacked" | "split";
        fileTree?: unknown;
      };
      if (
        payload.threadId !== undefined &&
        payload.threadId !== state.activeThreadId
      ) {
        // Background thread workbench state is still authoritative. Record its panes, but
        // never touch the visible appChrome/workbenchOpen for the thread the user is
        // looking at.
        const panes = payload.panes ?? [];
        const threadId = payload.threadId;
        const previousThread = nextState.threads.find((thread) => thread.threadId === threadId);
        const previousPanes = previousThread?.workbenchPanes ?? [];
        const activeWorkbenchPaneId = resolveProductShellActiveWorkbenchPaneId(
          panes,
          payload.activePaneId ?? previousThread?.activeWorkbenchPaneId,
        );
        const existingPaneIds = new Set(previousPanes.map((pane) => pane.paneId));
        const hasNewRealPane = panes.some(
          (pane) => pane.kind !== "launcher" && !existingPaneIds.has(pane.paneId),
        );
        const hasOpenPane = panes.length > 0;
        const threadExists = nextState.threads.some((thread) => thread.threadId === threadId);
        const nextWorkbenchOpenByThreadId =
          threadExists && (hasNewRealPane || !hasOpenPane)
            ? {
                ...nextState.workbenchOpenByThreadId,
                [threadId]: hasNewRealPane,
              }
            : nextState.workbenchOpenByThreadId;
        return {
          ...nextState,
          threads: nextState.threads.map((thread) =>
            thread.threadId === threadId
              ? { ...thread, workbenchPanes: panes, activeWorkbenchPaneId }
              : thread,
          ),
          workbenchOpenByThreadId: nextWorkbenchOpenByThreadId,
        };
      }
      const panes = payload.panes ?? [];
      const threadId = payload.threadId ?? state.activeThreadId;
      const currentVisiblePanes =
        threadId !== null && threadId === state.activeThreadId
          ? state.appChrome.workbenchPanes
          : [];
      const incomingLauncherOnly =
        panes.length > 0 && panes.every((pane) => pane.kind === "launcher");
      const currentHasRealPane = currentVisiblePanes.some((pane) => pane.kind !== "launcher");
      if (incomingLauncherOnly && currentHasRealPane) {
        return { ...nextState, appChrome: state.appChrome };
      }
      const referencesFilter = applyDismissedProductShellEditorReferences(
        panes,
        nextState.dismissedEditorReferenceKeys,
      );
      const visiblePanes = referencesFilter.panes;
      const nextActiveWorkbenchPaneId = resolveProductShellActiveWorkbenchPaneId(
        visiblePanes,
        payload.activePaneId ?? nextState.appChrome.activeWorkbenchPaneId,
      );
      // Auto-open only when a NEW real (non-launcher) pane appears (an agent
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
        (pane) => pane.kind !== "launcher" && !existingPaneIds.has(pane.paneId),
      );
      const hasOpenPane = panes.length > 0;
      // The in-pane Editor file picker is renderer-only state (it has no backend pane), so a
      // workbench.changed carrying an empty pane set — e.g. the Composer Draft Thread's first
      // event, fired the moment the user clicks Editor to open the picker — must NOT read as
      // "nothing visible" and snap the workbench shut from under the picker. Treat an open
      // picker like an open pane: preserve the user's open state rather than closing.
      // A string (incl. "") means the picker is open; null/undefined means closed. Use a
      // typeof check rather than `!== null` so a missing value never reads as "open".
      const pickerOpen = typeof nextState.editorPickerFilter === "string";
      const untitledOpen =
        threadId !== null && nextState.untitledFiles.some((file) => file.threadId === threadId);
      const preserveOpenEmptyDraft =
        threadId !== null &&
        threadId === nextState.draftThreadId &&
        panes.length === 0 &&
        previousPanes.length === 0 &&
        nextState.workbenchOpenByThreadId[threadId] === true;
      const nextWorkbenchOpen = hasNewRealPane
        ? true
        : hasOpenPane || pickerOpen || untitledOpen || preserveOpenEmptyDraft
          ? nextState.workbenchOpen
          : false;
      return {
        ...nextState,
        threads:
          threadId === null
            ? nextState.threads
            : nextState.threads.map((thread) =>
                thread.threadId === threadId
                  ? { ...thread, workbenchPanes: visiblePanes, activeWorkbenchPaneId: nextActiveWorkbenchPaneId }
                  : thread,
              ),
        appChrome: {
          ...nextState.appChrome,
          workbenchPanes: visiblePanes,
          activeWorkbenchPaneId: nextActiveWorkbenchPaneId,
        },
        dismissedEditorReferenceKeys: referencesFilter.dismissedEditorReferenceKeys,
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
        editorDrafts: reconcileEditorDrafts(nextState.editorDrafts, visiblePanes),
      };
    }
    case "workspace.fileTreeLoaded": {
      const payload = event.payload as { cwd?: string; fileTree?: unknown };
      if (typeof payload.cwd !== "string" || payload.cwd !== activeWorkspaceFileTreeCwd(nextState)) {
        return nextState;
      }
      const nextTree = productShellFileTreeFromPayload(payload.fileTree);
      const composerFileMentions =
        nextTree !== null
          ? {
              cwd: payload.cwd,
              entries: nextTree.entries.filter((entry) => entry.kind === "file"),
              truncated: nextTree.truncated,
            }
          : nextState.composerFileMentions;
      // Start-page file tree for the composer-selected directory. Only applies while
      // no thread is active (the New Thread page); once a thread opens, that thread's
      // own tree takes over. The Composer @ mention cache is still updated above.
      if (state.activeThreadId !== null) {
        return { ...nextState, composerFileMentions };
      }
      // Keep the expanded set when re-listing the SAME directory (a lazy expand
      // round-trip); reset it only when a different project's tree loads.
      const sameRoot =
        nextTree?.root !== undefined && nextTree.root === nextState.fileTree?.root;
      return {
        ...nextState,
        composerFileMentions,
        fileTree: nextTree,
        expandedFolderPaths: sameRoot ? nextState.expandedFolderPaths : [],
      };
    }
    case "workspace.fileLoaded": {
      return nextState;
    }
    case "workspace.fileSaved": {
      return nextState;
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

function activeWorkspaceFileTreeCwd(state: ProductShellState): string | null {
  const scope = state.agentChat.thread?.scope ?? state.agentChat.composer.startOptions.scope;
  if (scope?.kind !== "project" || scope.cwd.length === 0) {
    return null;
  }
  return scope.cwd;
}

function providerUsageKey(entry: ProductShellProviderUsage): string {
  return entry.agentId;
}

const PRODUCT_SHELL_PROVIDER_AGENT_IDS = ["codex", "claude", "opencode"] as const;

function seedProviderInventoryFromLegacyThreadList(
  state: ProductShellState,
  event: AgentChatBackendEvent,
): ProductShellState {
  if (state.providerInventory !== null) {
    return state;
  }
  const payload = event.payload as { availableAgents?: unknown };
  if (!Array.isArray(payload.availableAgents)) {
    return state;
  }
  const installed = new Set(
    payload.availableAgents.filter((agentId): agentId is ProductShellProviderUsage["agentId"] =>
      typeof agentId === "string" && isProductShellAgentIdentity(agentId),
    ),
  );
  return {
    ...state,
    providerInventory: {
      agents: PRODUCT_SHELL_PROVIDER_AGENT_IDS.map((agentId) => ({
        agentId,
        installed: installed.has(agentId),
      })),
    },
  };
}

function applyProviderInventoryReadinessToStartComposer(
  state: ProductShellState,
  payload: unknown,
): ProductShellState {
  if (state.agentChat.thread !== null) {
    return state;
  }
  const agentId = state.agentChat.composer.startOptions.agentBinding.agentId;
  if (!isProductShellAgentIdentity(agentId)) {
    return state;
  }
  const incoming = providerReadinessFromInventoryPayload(payload, agentId);
  if (incoming === null) {
    return state;
  }
  return {
    ...state,
    agentChat: {
      ...state.agentChat,
      providerReadiness: mergeInventoryReadinessUpdate(
        state.agentChat.providerReadiness,
        incoming,
      ),
    },
  };
}

function mergeInventoryReadinessUpdate(
  existing: AgentChatProviderReadiness | null,
  incoming: AgentChatProviderReadiness,
): AgentChatProviderReadiness {
  if (existing?.agentId !== incoming.agentId) {
    return incoming;
  }
  if (incoming.update === undefined) {
    const { update: _update, ...withoutUpdate } = existing;
    return withoutUpdate;
  }
  return { ...existing, update: incoming.update };
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
  // The active chat shows exactly the displayed thread (focus is user-owned). Apply an
  // event to it only when the event is FOR that thread — regardless of where it came from.
  // A late command response for a thread the user already left, or a background broadcast,
  // never touches the current chat. No displayed thread (New Thread composer) → nothing.
  const surfaceThreadId = activeSurfaceThreadId(state);
  if (surfaceThreadId === undefined) {
    return false;
  }
  const eventThreadId = threadIdFromBackendEvent(event);
  if (eventThreadId === undefined) {
    return true;
  }
  return eventThreadId === surfaceThreadId;
}

function threadIdFromBackendEvent(event: AgentChatBackendEvent): string | undefined {
  switch (event.kind) {
    case "agentRuntime.stateChanged":
    case "agentRuntime.usageChanged":
    case "agentRuntime.activityChanged":
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
    case "thread.hydrated":
    case "thread.goalSet": {
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
  const unreadThreadIds = new Set(
    state.threads
      .filter((thread) => thread.unread === true && thread.threadId !== state.activeThreadId)
      .map((thread) => thread.threadId),
  );
  const previousThreads = new Map(state.threads.map((thread) => [thread.threadId, thread] as const));
  const threads = (payload.threads ?? [])
    .filter((thread) => !thread.archived)
    .map(toProductShellThreadFromSummary)
    .map((thread) => {
      const previous = previousThreads.get(thread.threadId);
      const withWorkbench =
        previous === undefined
          ? thread
          : {
              ...thread,
              workbenchPanes: previous.workbenchPanes,
              activeWorkbenchPaneId: previous.activeWorkbenchPaneId,
            };
      return unreadThreadIds.has(thread.threadId)
        ? { ...withWorkbench, unread: true }
        : withWorkbench;
    });
  const activeThreadIsListed =
    state.activeThreadId !== null &&
    threads.some((thread) => thread.threadId === state.activeThreadId);
  const activeThreadIsDraft =
    state.activeThreadId !== null &&
    state.draftThreadId !== null &&
    state.activeThreadId === state.draftThreadId;
  const activeThreadId = activeThreadIsListed || activeThreadIsDraft
    ? state.activeThreadId
    : null;
  const activeContextPreserved = activeThreadId !== null && activeThreadId === state.activeThreadId;

  return {
    ...state,
    activeThreadId,
    projects: projectsFromThreads(threads),
    threads,
    threadsLoaded: true,
    leftRailMenu: null,
    archiveConfirmThreadId: null,
    fileTree: activeContextPreserved ? state.fileTree : null,
    editorDrafts: activeContextPreserved ? state.editorDrafts : {},
  };
}
