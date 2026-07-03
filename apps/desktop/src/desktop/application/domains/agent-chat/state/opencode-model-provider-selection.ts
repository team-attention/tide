import type { AgentChatShellState, AgentChatShellUpdateResult } from "./types.ts";
import { defaultModelValueForAgent } from "./agent-vocab.ts";
import { setComposerActiveSurface } from "./composer.ts";
import { launchOptionsForState, updateComposerLaunchOptions } from "./launch-options.ts";
import {
  apiKeyFinishedRowId,
  apiKeyRowId,
  backOpencodeModelProvider,
  connectVendorRowId,
  connectionRowId,
  finishOpencodeModelProviderApiKey,
  openOpencodeModelProviderApiKey,
  openOpencodeModelProviderConnection,
  openOpencodeModelProviderForProvider,
  opencodeApiKeyProviderIdFromRow,
  opencodeConnectionProviderIdFromRow,
  opencodeProviderIdFromRow,
  selectedOpencodeModelProviderId,
} from "./opencode-model-provider.ts";
import { getOpencodeEnvironment } from "./opencode-onramp.ts";
import { providerReadinessTerminalCommandData } from "./provider-readiness-terminal-command.ts";

export function selectOpencodeModelProviderSurfaceRow(
  state: AgentChatShellState,
  rowId: string,
  activeThreadId?: string,
): AgentChatShellUpdateResult {
  const launchOptions = launchOptionsForState(state);
  const currentModel = String(launchOptions?.model ?? defaultModelValueForAgent("opencode"));
  if (rowId === "opencode-back") {
    backOpencodeModelProvider(currentModel);
    return { state: { ...state }, command: null };
  }
  if (rowId === "use-free-model") {
    const updated = updateComposerLaunchOptions(state, { model: "opencode default" });
    return {
      state: { ...updated.state, composer: { ...updated.state.composer, activeSurface: null } },
      command: updated.command,
    };
  }
  if (rowId === apiKeyFinishedRowId()) {
    finishOpencodeModelProviderApiKey();
    return { state: { ...state }, command: null };
  }
  const providerId = opencodeProviderIdFromRow(rowId);
  if (providerId !== undefined) {
    openOpencodeModelProviderForProvider(providerId);
    return { state: { ...state }, command: null };
  }
  const connectionProviderId = opencodeConnectionProviderIdFromRow(rowId);
  if (connectionProviderId !== undefined) {
    openOpencodeModelProviderConnection(connectionProviderId);
    return { state: { ...state }, command: null };
  }
  const apiKeyProviderId = opencodeApiKeyProviderIdFromRow(rowId);
  if (apiKeyProviderId !== undefined) {
    openOpencodeModelProviderApiKey(apiKeyProviderId);
    return { state: { ...state }, command: null };
  }
  const currentProviderId = selectedOpencodeModelProviderId(currentModel);
  if (rowId === connectVendorRowId(currentProviderId)) {
    return opencodeAuthTerminalCommand(state, currentProviderId, activeThreadId);
  }
  if (rowId === apiKeyRowId(currentProviderId) || rowId === connectionRowId(currentProviderId)) {
    return { state, command: null };
  }
  const reasoning = reasoningForOpencodeRow(rowId);
  if (reasoning !== undefined) {
    return updateComposerLaunchOptions(state, { reasoning });
  }
  const model = modelForOpencodeRow(rowId);
  return model ? updateComposerLaunchOptions(state, { model }) : { state, command: null };
}

export function opencodeAuthTerminalCommand(
  state: AgentChatShellState,
  vendorId: string | undefined,
  activeThreadId?: string,
): AgentChatShellUpdateResult {
  const environment = getOpencodeEnvironment();
  const threadId = state.thread?.threadId ?? activeThreadId;
  const scope = state.thread?.scope ?? state.composer.startOptions.scope;
  const cwd =
    scope === undefined ? undefined : scope.kind === "project" ? scope.cwd : scope.scratchCwd;
  if (environment?.executablePath === undefined || threadId === undefined || cwd === undefined) {
    return { state, command: null };
  }
  return {
    state: setComposerActiveSurface(state, null).state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId,
        command: "open_terminal",
        data: providerReadinessTerminalCommandData(
          "not_authenticated",
          {
            command: environment.executablePath,
            args: vendorId !== undefined ? ["auth", "login", "-p", vendorId] : ["auth", "login"],
            cwd,
            expectedCompletion: "retry_preflight",
          },
        ),
      },
    },
  };
}

function modelForOpencodeRow(rowId: string): string | undefined {
  return rowId.startsWith("model:") ? rowId.slice("model:".length) : undefined;
}

function reasoningForOpencodeRow(
  rowId: string,
): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  switch (rowId) {
    case "reasoning-low":
      return "low";
    case "reasoning-medium":
      return "medium";
    case "reasoning-high":
      return "high";
    case "reasoning-xhigh":
      return "xhigh";
    case "reasoning-max":
      return "max";
    default:
      return undefined;
  }
}
