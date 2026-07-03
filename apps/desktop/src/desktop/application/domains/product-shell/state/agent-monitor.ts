import type { AgentChatShellState } from "../../agent-chat/agent-chat.ts";
import { createAgentChatUsageView } from "../../agent-chat/agent-chat.ts";
import { worktreeRepoRootForCwd } from "../../../../../shared/worktree/path.ts";
import type { ProductShellAgentMonitorSession, ProductShellState } from "./types.ts";
import { activeSurfaceThreadId } from "./start.ts";

export function deriveAgentMonitorSessions(state: ProductShellState): ProductShellAgentMonitorSession[] {
  const surfaceThreadId = activeSurfaceThreadId(state);
  const sessions = state.threads.reduce<ProductShellAgentMonitorSession[]>((items, thread) => {
    const chatState =
      surfaceThreadId === thread.threadId
        ? state.agentChat
        : state.agentChatByThreadId[thread.threadId];
    const runtimeState =
      chatState?.runtimeState ??
      (thread.running === true
        ? "running"
        : thread.attention === true
          ? "waiting_for_input"
          : thread.live === true
            ? "idle"
            : "stopped");
    const live =
      thread.live === true ||
      thread.running === true ||
      thread.attention === true ||
      runtimeState === "running" ||
      runtimeState === "starting" ||
      runtimeState === "waiting_for_input" ||
      runtimeState === "waiting_for_approval" ||
      (chatState?.queuedInputs.length ?? 0) > 0;
    if (!live) {
      return items;
    }
    const cwd = thread.scope.kind === "project" ? thread.scope.cwd : thread.scope.scratchCwd;
    const worktree =
      thread.scope.kind === "project" && worktreeRepoRootForCwd(thread.scope.cwd) !== null
        ? thread.scope.cwd
        : undefined;
    const projectName = projectNameForCwd(state, cwd);
    const usage = createAgentChatUsageView(chatState?.usage ?? null);
    const activity = chatState?.liveActivityEnrichment;
    const promptKind = chatState?.promptState?.kind;
    const activityLabel = monitorActivityLabel(activity);
    const usageLabel = usage?.tokensLabel ?? usage?.contextDetailLabel ?? usage?.contextPercentLabel;
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
      ...(thread.runtimeStartedAt !== undefined ? { startedAt: thread.runtimeStartedAt } : {}),
      ...(thread.updatedAt !== undefined ? { changedAt: thread.updatedAt } : {}),
      ...(chatState !== undefined ? { queuedInputCount: chatState.queuedInputs.length } : {}),
      ...(promptKind !== undefined && monitorPromptKind(promptKind) !== undefined
        ? { pendingPromptKind: monitorPromptKind(promptKind) }
        : {}),
      ...(activityLabel !== undefined ? { activityLabel } : {}),
      ...(activity?.planCompleted !== undefined ? { planCompleted: activity.planCompleted } : {}),
      ...(activity?.planTotal !== undefined ? { planTotal: activity.planTotal } : {}),
      ...(activity?.nestedAgents !== undefined ? { nestedAgents: activity.nestedAgents } : {}),
      ...(activity?.nestedToolCalls !== undefined ? { nestedToolCalls: activity.nestedToolCalls } : {}),
      ...(usageLabel !== undefined ? { usageLabel } : {}),
      ...(chatState?.thread?.agentBinding.providerSessionRef?.value !== undefined
        ? { providerSessionRef: chatState.thread.agentBinding.providerSessionRef.value }
        : {}),
    });
    return items;
  }, []);
  return sessions.sort(
    (a, b) =>
      monitorSortRank(a) - monitorSortRank(b) ||
      (Date.parse(b.changedAt ?? "") - Date.parse(a.changedAt ?? "")),
  );
}

function monitorPromptKind(
  promptKind: NonNullable<AgentChatShellState["promptState"]>["kind"],
): ProductShellAgentMonitorSession["pendingPromptKind"] | undefined {
  if (promptKind === "approval" || promptKind === "permission") {
    return "approval";
  }
  if (promptKind === "question" || promptKind === "choice") {
    return "question";
  }
  return promptKind === "command_picker" ? "mcp_elicitation" : undefined;
}

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
