import type {
  AgentChatProviderInventory,
  AgentChatProviderReadiness,
  AgentChatProviderReadinessBlocker,
  AgentChatProviderReadinessTerminalAction,
  AgentChatProviderUpdateAdvisory,
} from "../../agent-chat/agent-chat.ts";
import { isProductShellAgentIdentity } from "./start.ts";
import type { ProductShellProviderUsage } from "./types.ts";

export function providerInventoryFromPayload(payload: unknown): AgentChatProviderInventory | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const raw = payload as { agents?: unknown };
  if (!Array.isArray(raw.agents)) {
    return null;
  }
  const agents = raw.agents
    .map((entry): AgentChatProviderInventory["agents"][number] | null => {
      const candidate = entry as { agentId?: unknown; installed?: unknown };
      if (
        typeof candidate.agentId !== "string" ||
        !isProductShellAgentIdentity(candidate.agentId) ||
        typeof candidate.installed !== "boolean"
      ) {
        return null;
      }
      return { agentId: candidate.agentId, installed: candidate.installed };
    })
    .filter((entry): entry is AgentChatProviderInventory["agents"][number] => entry !== null);
  return { agents };
}

export function providerReadinessFromInventoryPayload(
  payload: unknown,
  agentId: ProductShellProviderUsage["agentId"],
): AgentChatProviderReadiness | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const raw = payload as { agents?: unknown };
  if (!Array.isArray(raw.agents)) {
    return null;
  }
  const agent = raw.agents.find((entry) => {
    const candidate = entry as { agentId?: unknown };
    return candidate.agentId === agentId;
  }) as { readiness?: unknown } | undefined;
  if (agent === undefined) {
    return null;
  }
  const readiness = agent.readiness as {
    agentId?: unknown;
    ready?: unknown;
    blockers?: unknown;
    update?: unknown;
  } | undefined;
  if (
    typeof readiness !== "object" ||
    readiness === null ||
    readiness.agentId !== agentId ||
    typeof readiness.ready !== "boolean" ||
    !Array.isArray(readiness.blockers)
  ) {
    return null;
  }
  const blockers = readiness.blockers
    .map(providerReadinessBlockerFromPayload)
    .filter((entry): entry is AgentChatProviderReadinessBlocker => entry !== null);
  const update = providerUpdateAdvisoryFromPayload(readiness.update);
  return {
    agentId,
    ready: readiness.ready,
    blockers,
    ...(update !== null ? { update } : {}),
  };
}

function providerUpdateAdvisoryFromPayload(payload: unknown): AgentChatProviderUpdateAdvisory | null {
  const raw = payload as {
    currentVersion?: unknown;
    latestVersion?: unknown;
    terminalAction?: unknown;
  } | undefined;
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.currentVersion !== "string" ||
    typeof raw.latestVersion !== "string"
  ) {
    return null;
  }
  const terminalAction = providerReadinessTerminalActionFromPayload(raw.terminalAction);
  return {
    currentVersion: raw.currentVersion,
    latestVersion: raw.latestVersion,
    ...(terminalAction !== null ? { terminalAction } : {}),
  };
}

function providerReadinessBlockerFromPayload(payload: unknown): AgentChatProviderReadinessBlocker | null {
  const raw = payload as {
    kind?: unknown;
    message?: unknown;
    scope?: unknown;
    action?: unknown;
    terminalAction?: unknown;
  };
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.kind !== "string" ||
    typeof raw.message !== "string"
  ) {
    return null;
  }
  const terminalAction = providerReadinessTerminalActionFromPayload(raw.terminalAction);
  return {
    kind: raw.kind,
    message: raw.message,
    ...(typeof raw.scope === "string" ? { scope: raw.scope } : {}),
    ...(typeof raw.action === "string" ? { action: raw.action } : {}),
    ...(terminalAction !== null ? { terminalAction } : {}),
  };
}

function providerReadinessTerminalActionFromPayload(
  payload: unknown,
): AgentChatProviderReadinessTerminalAction | null {
  const raw = payload as {
    command?: unknown;
    args?: unknown;
    env?: unknown;
    cwd?: unknown;
    expectedCompletion?: unknown;
  };
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.command !== "string" ||
    !Array.isArray(raw.args) ||
    !raw.args.every((arg): arg is string => typeof arg === "string") ||
    typeof raw.cwd !== "string" ||
    (raw.expectedCompletion !== "process_exit" && raw.expectedCompletion !== "retry_preflight")
  ) {
    return null;
  }
  const env = providerReadinessTerminalEnvFromPayload(raw.env);
  return {
    command: raw.command,
    args: raw.args,
    cwd: raw.cwd,
    expectedCompletion: raw.expectedCompletion,
    ...(env !== undefined ? { env } : {}),
  };
}

function providerReadinessTerminalEnvFromPayload(
  payload: unknown,
): Record<string, string> | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const entries = Object.entries(payload);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) {
    return undefined;
  }
  return Object.fromEntries(entries);
}
