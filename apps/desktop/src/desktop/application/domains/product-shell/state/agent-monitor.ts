import type { AgentChatShellState } from "../../agent-chat/agent-chat.ts";
import { createAgentChatUsageView } from "../../agent-chat/agent-chat.ts";
import { worktreeRepoRootForCwd } from "../../../../../shared/worktree/path.ts";
import type { ProductShellAgentMonitorSession, ProductShellAgentRuntimeSnapshot, ProductShellState } from "./types.ts";
import { activeSurfaceThreadId } from "./start.ts";
import { monitorPromptKindFromPrompt, monitorPromptSnapshot } from "./agent-monitor-prompt.ts";

export function deriveAgentMonitorSessions(state: ProductShellState): ProductShellAgentMonitorSession[] {
  const surfaceThreadId = activeSurfaceThreadId(state);
  const sessions = state.threads.reduce<ProductShellAgentMonitorSession[]>((items, thread) => {
    const chatState =
      surfaceThreadId === thread.threadId
        ? state.agentChat
        : state.agentChatByThreadId[thread.threadId];
    const snapshot = state.runtimeSnapshotsByThreadId[thread.threadId];
    const providerSessionRef =
      chatState?.thread?.agentBinding.providerSessionRef?.value ??
      snapshot?.providerSessionRef ??
      thread.providerSessionRef?.value;
    const providerOwned =
      isExternalSessionThread(thread.threadId) || thread.providerSessionRef !== undefined;
    const includeProviderOwnedIdle = providerOwned && state.listSettings.showExternalSessions;
    const runtimeState =
      chatState?.runtimeState ??
      snapshot?.state ??
      (thread.running === true
        ? "running"
        : thread.attention === true
          ? "waiting_for_input"
          : thread.live === true
            ? "idle"
            : includeProviderOwnedIdle
              ? "idle"
              : "stopped");
    const queuedInputCount = chatState !== undefined ? chatState.queuedInputs.length : snapshot?.queuedInputCount;
    const live =
      thread.live === true ||
      thread.running === true ||
      thread.attention === true ||
      runtimeState === "running" ||
      runtimeState === "starting" ||
      runtimeState === "waiting_for_input" ||
      runtimeState === "waiting_for_approval" ||
      (queuedInputCount ?? 0) > 0 ||
      monitorSnapshotLive(snapshot);
    if (!live && !includeProviderOwnedIdle) {
      return items;
    }
    const cwd = thread.scope.kind === "project" ? thread.scope.cwd : thread.scope.scratchCwd;
    const worktree =
      thread.scope.kind === "project" && worktreeRepoRootForCwd(thread.scope.cwd) !== null
        ? thread.scope.cwd
        : undefined;
    const projectName = projectNameForCwd(state, cwd);
    const usage = createAgentChatUsageView(chatState?.usage ?? null);
    const activity = chatState?.liveActivityEnrichment ?? snapshot;
    const promptKind = chatState?.promptState?.kind;
    const pendingPromptKind =
      promptKind !== undefined ? monitorPromptKind(promptKind) : snapshot?.pendingPromptKind;
    const prompt = monitorPromptSnapshot(chatState?.promptState) ?? snapshot?.prompt;
    const activityLabel = monitorActivityLabel(activity);
    const usageLabel = usage?.tokensLabel ?? usage?.contextDetailLabel ?? usage?.contextPercentLabel ?? snapshot?.usageLabel;
    const startedAt = chatState?.thread?.runtimeStartedAt ?? thread.runtimeStartedAt ?? snapshot?.startedAt;
    const changedAt = chatState?.thread?.updatedAt ?? snapshot?.changedAt ?? thread.updatedAt;
    items.push({
      threadId: thread.threadId,
      agentId: thread.agentId,
      title: thread.title,
      cwd,
      state: runtimeState,
      active: thread.threadId === state.activeThreadId,
      ...(projectName !== undefined ? { projectName } : {}),
      ...(worktree !== undefined ? { worktree } : {}),
      ...(worktree !== undefined
        ? { branch: worktree.split("/").filter((part) => part.length > 0).pop() }
        : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(changedAt !== undefined ? { changedAt } : {}),
      ...(queuedInputCount !== undefined ? { queuedInputCount } : {}),
      ...(pendingPromptKind !== undefined
        ? { pendingPromptKind }
        : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(activityLabel !== undefined ? { activityLabel } : {}),
      ...(activity?.planCompleted !== undefined ? { planCompleted: activity.planCompleted } : {}),
      ...(activity?.planTotal !== undefined ? { planTotal: activity.planTotal } : {}),
      ...(activity?.nestedAgents !== undefined ? { nestedAgents: activity.nestedAgents } : {}),
      ...(activity?.nestedToolCalls !== undefined ? { nestedToolCalls: activity.nestedToolCalls } : {}),
      ...(usageLabel !== undefined ? { usageLabel } : {}),
      ...(providerSessionRef !== undefined
        ? { providerSessionRef }
        : {}),
      ...(providerOwned ? { providerOwned } : {}),
    });
    return items;
  }, []);
  return sessions.sort(
    (a, b) =>
      monitorSortRank(a) - monitorSortRank(b) ||
      (Date.parse(b.changedAt ?? "") - Date.parse(a.changedAt ?? "")),
  );
}

function monitorSnapshotLive(snapshot: ProductShellAgentRuntimeSnapshot | undefined): boolean {
  return snapshot !== undefined && (
    snapshot.state === "running" ||
    snapshot.state === "starting" ||
    snapshot.state === "waiting_for_input" ||
    snapshot.state === "waiting_for_approval" ||
    (snapshot.queuedInputCount ?? 0) > 0 ||
    snapshot.pendingPromptKind !== undefined
  );
}

const monitorPromptKind = monitorPromptKindFromPrompt;

function monitorActivityLabel(
  activity: AgentChatShellState["liveActivityEnrichment"] | undefined,
): string | undefined {
  if (activity === undefined) {
    return undefined;
  }
  if ((activity.nestedAgents ?? 0) > 0) {
    const agents = activity.nestedAgents ?? 0;
    const tools = activity.nestedToolCalls ?? 0;
    return tools > 0 ? `${agents} agents, ${tools} tools` : `${agents} agents running`;
  }
  if ((activity.planTotal ?? 0) > 0) {
    return `${activity.planCompleted ?? 0}/${activity.planTotal ?? 0} steps`;
  }
  return undefined;
}

function monitorSortRank(session: ProductShellAgentMonitorSession): number {
  if (session.state === "waiting_for_input" || session.state === "waiting_for_approval") {
    return 0;
  }
  if (session.state === "running" || session.state === "starting") {
    return 1;
  }
  if (session.state === "failed") {
    return 2;
  }
  return 3;
}

function projectNameForCwd(state: ProductShellState, cwd: string): string | undefined {
  return [...state.registeredProjects, ...state.projects].find((project) => project.cwd === cwd)?.name;
}

function isExternalSessionThread(threadId: string): boolean {
  return threadId.startsWith("adopted-");
}
