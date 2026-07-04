import type { AgentChatShellState, AgentChatShellUpdateResult } from "./types.ts";
import { defaultModelValueForAgent } from "./agent-vocab.ts";
import { setComposerActiveSurface } from "./composer.ts";
import { launchOptionsForState, updateComposerLaunchOptions } from "./launch-options.ts";
import {
  apiKeyFinishedRowId,
  backOpencodeModelProvider,
  connectVendorRowId,
  finishOpencodeModelProviderApiKey,
  openOpencodeModelProviderApiKey,
  openOpencodeModelProviderConnection,
  openOpencodeModelProviderForProvider,
  openOpencodeProviderSearch,
  opencodeApiKeyProviderIdFromRow,
  opencodeConnectionProviderIdFromRow,
  opencodeProviderIdFromRow,
  providerSearchRowId,
  selectedOpencodeModelProviderId,
} from "./opencode-model-provider.ts";
import { providerReadinessTerminalCommandData } from "./provider-readiness-terminal-command.ts";

export function selectOpencodeModelProviderSurfaceRow(
  state: AgentChatShellState,
  rowId: string,
  activeThreadId?: string,
): AgentChatShellUpdateResult {
  const launchOptions = launchOptionsForState(state);
  const currentModel = String(launchOptions?.model ?? defaultModelValueForAgent("opencode"));
  const flowState = state.composer.opencodeModelProvider;
  const catalog = state.availableProviderCatalogs?.opencode;
  if (rowId === "opencode-back") {
    return {
      state: withOpencodeModelProviderFlowState(
        state,
        backOpencodeModelProvider(flowState, currentModel, catalog),
      ),
      command: null,
    };
  }
  if (rowId === "use-free-model") {
    const updated = updateComposerLaunchOptions(state, { model: "opencode default" });
    return {
      state: { ...updated.state, composer: { ...updated.state.composer, activeSurface: null } },
      command: updated.command,
    };
  }
  if (rowId === apiKeyFinishedRowId()) {
    return {
      state: withOpencodeModelProviderFlowState(
        state,
        finishOpencodeModelProviderApiKey(flowState, currentModel, catalog),
      ),
      command: null,
    };
  }
  if (rowId === providerSearchRowId()) {
    return {
      state: withOpencodeModelProviderFlowState(
        state,
        openOpencodeProviderSearch(flowState, currentModel, catalog),
      ),
      command: null,
    };
  }
  const providerId = opencodeProviderIdFromRow(rowId);
  if (providerId !== undefined) {
    return {
      state: withOpencodeModelProviderFlowState(
        state,
        openOpencodeModelProviderForProvider(flowState, currentModel, providerId, catalog),
      ),
      command: null,
    };
  }
  const connectionProviderId = opencodeConnectionProviderIdFromRow(rowId);
  if (connectionProviderId !== undefined) {
    return {
      state: withOpencodeModelProviderFlowState(
        state,
        openOpencodeModelProviderConnection(flowState, currentModel, connectionProviderId, catalog),
      ),
      command: null,
    };
  }
  const apiKeyProviderId = opencodeApiKeyProviderIdFromRow(rowId);
  if (apiKeyProviderId !== undefined) {
    return {
      state: withOpencodeModelProviderFlowState(
        state,
        openOpencodeModelProviderApiKey(flowState, currentModel, apiKeyProviderId, catalog),
      ),
      command: null,
    };
  }
  const currentProviderId = selectedOpencodeModelProviderId(currentModel, flowState, catalog);
  if (rowId === connectVendorRowId(currentProviderId)) {
    return opencodeAuthTerminalCommand(state, currentProviderId, activeThreadId);
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
  const environment = state.availableProviderCatalogs?.opencode?.environment;
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

function withOpencodeModelProviderFlowState(
  state: AgentChatShellState,
  flowState: AgentChatShellState["composer"]["opencodeModelProvider"],
): AgentChatShellState {
  return {
    ...state,
    composer: {
      ...state.composer,
      opencodeModelProvider: flowState,
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
