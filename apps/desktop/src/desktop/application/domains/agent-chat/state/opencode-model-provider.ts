import type {
  AgentChatChoiceSurfaceRowView,
  AgentChatChoiceSurfaceView,
  AgentChatOpencodeModelProviderFlowState,
  AgentChatOpencodeModelProviderStep,
} from "./types.ts";
import { cliModelOptionsForAgent, REASONING_LEVELS } from "./agent-vocab.ts";
import {
  getOpencodeEnvironment,
  getOpencodeVendors,
  isOpencodeUsable,
  opencodeVendorMonogram,
} from "./opencode-onramp.ts";
import { row } from "./choice-row.ts";

interface ProviderViewModel {
  id: string;
  label: string;
  detail: string;
  monogram: string;
  connected: boolean;
  needsReconnect: boolean;
}

const OPENCODE_DEFAULT_MODEL = "opencode default";
const ZEN_PROVIDER_ID = "opencode";

export function initialOpencodeModelProviderFlowState(): AgentChatOpencodeModelProviderFlowState {
  return {
    step: null,
    methodReturnStep: "provider_list",
  };
}

export function buildOpencodeModelProviderSurface(
  currentModel: string,
  currentEffort: string,
  inputFlowState?: AgentChatOpencodeModelProviderFlowState,
): AgentChatChoiceSurfaceView {
  const flowState = normalizeFlowState(inputFlowState, currentModel);
  const step = flowState.step ?? "provider_list";
  const providerId = selectedProviderId(currentModel, flowState);
  const providers = providerViewModels();
  const provider = providers.find((candidate) => candidate.id === providerId);
  const models = modelViewsForProvider(providerId, currentModel);
  const effortRows = opencodeEffortRows(currentEffort);
  const rows = rowsForStep(step, providerId, providers, models, effortRows);

  return {
    surfaceKind: "opencode_model_provider",
    title: titleForStep(step, providerId, provider?.label),
    sourceLabel: step === "provider_list" || step === "connect_vendor" ? "Model chip" : "opencode",
    rows,
    opencodeModelProvider: {
      step,
      version: getOpencodeEnvironment()?.version,
      zenFreeCount: zenFreeModelCount(),
      connectedCount: getOpencodeVendors().filter((vendor) => vendor.connected).length,
      providerId,
      providerLabel: provider?.label,
      providerMonogram: provider?.monogram,
      providerStatus: provider?.detail,
      currentModel,
      currentEffort,
      providers: providers.map((candidate) => ({
        rowId: providerRowId(candidate.id, step),
        id: candidate.id,
        label: candidate.label,
        detail: candidate.detail,
        monogram: candidate.monogram,
        connected: candidate.connected,
        needsReconnect: candidate.needsReconnect,
        selected: candidate.id === providerId,
      })),
      models,
      effortRows,
      connection: connectionRowForProvider(providerId, provider),
      method: {
        browserRowId: connectVendorRowId(providerId),
        apiKeyRowId: apiKeyRowId(providerId),
      },
    },
  };
}

export function openOpencodeModelProviderForProvider(
  inputFlowState: AgentChatOpencodeModelProviderFlowState | undefined,
  currentModel: string,
  providerId: string,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = normalizeFlowState(inputFlowState, currentModel);
  return {
    ...flowState,
    selectedProviderId: providerId,
    methodReturnStep: flowState.step === "connect_vendor" ? "connect_vendor" : "provider_list",
    step: providerHasModelRows(providerId) ? "model_list" : "vendor_method",
  };
}

export function openOpencodeModelProviderConnection(
  inputFlowState: AgentChatOpencodeModelProviderFlowState | undefined,
  currentModel: string,
  providerId: string,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = normalizeFlowState(inputFlowState, currentModel);
  return {
    ...flowState,
    selectedProviderId: providerId,
    methodReturnStep: "model_list",
    step: "vendor_method",
  };
}

export function openOpencodeModelProviderApiKey(
  inputFlowState: AgentChatOpencodeModelProviderFlowState | undefined,
  currentModel: string,
  providerId: string,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = normalizeFlowState(inputFlowState, currentModel);
  return {
    ...flowState,
    selectedProviderId: providerId,
    step: "api_key",
  };
}

export function finishOpencodeModelProviderApiKey(
  inputFlowState: AgentChatOpencodeModelProviderFlowState | undefined,
  currentModel: string,
): AgentChatOpencodeModelProviderFlowState {
  return {
    ...normalizeFlowState(inputFlowState, currentModel),
    step: "provider_list",
  };
}

export function backOpencodeModelProvider(
  inputFlowState: AgentChatOpencodeModelProviderFlowState | undefined,
  currentModel: string,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = normalizeFlowState(inputFlowState, currentModel);
  if (flowState.step === "model_list") {
    return { ...flowState, step: "provider_list" };
  }
  if (flowState.step === "api_key") {
    return { ...flowState, step: "vendor_method" };
  }
  if (flowState.step === "vendor_method") {
    const step = flowState.methodReturnStep;
    return {
      ...flowState,
      step,
      selectedProviderId:
        step === "provider_list" || step === "connect_vendor"
          ? providerIdFromModel(currentModel)
          : flowState.selectedProviderId,
    };
  }
  return flowState;
}

export function selectedOpencodeModelProviderId(
  currentModel: string,
  inputFlowState?: AgentChatOpencodeModelProviderFlowState,
): string {
  return selectedProviderId(currentModel, normalizeFlowState(inputFlowState, currentModel));
}

export function connectVendorRowId(providerId: string): string {
  return `connect-vendor:${providerId}`;
}

export function apiKeyRowId(providerId: string): string {
  return `opencode-api-key:${providerId}`;
}

export function apiKeyFinishedRowId(): string {
  return "opencode-api-key-finished";
}

export function connectionRowId(providerId: string): string {
  return `opencode-connection:${providerId}`;
}

export function providerRowId(providerId: string, step: AgentChatOpencodeModelProviderStep): string {
  return step === "connect_vendor" && providerId === ZEN_PROVIDER_ID
    ? "use-free-model"
    : `opencode-provider:${providerId}`;
}

export function opencodeProviderIdFromRow(rowId: string): string | undefined {
  return rowId.startsWith("opencode-provider:")
    ? rowId.slice("opencode-provider:".length)
    : undefined;
}

export function opencodeConnectionProviderIdFromRow(rowId: string): string | undefined {
  return rowId.startsWith("opencode-connection:")
    ? rowId.slice("opencode-connection:".length)
    : undefined;
}

export function opencodeApiKeyProviderIdFromRow(rowId: string): string | undefined {
  return rowId.startsWith("opencode-api-key:")
    ? rowId.slice("opencode-api-key:".length)
    : undefined;
}

function normalizeFlowState(
  inputFlowState: AgentChatOpencodeModelProviderFlowState | undefined,
  currentModel: string,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = inputFlowState ?? initialOpencodeModelProviderFlowState();
  let step = flowState.step;
  if (step === null) {
    step = isOpencodeUsable() ? "provider_list" : "connect_vendor";
  } else if (!isOpencodeUsable() && step === "provider_list") {
    step = "connect_vendor";
  }
  return {
    ...flowState,
    step,
    selectedProviderId: flowState.selectedProviderId ?? providerIdFromModel(currentModel),
  };
}

function selectedProviderId(
  currentModel: string,
  flowState: AgentChatOpencodeModelProviderFlowState,
): string {
  return flowState.selectedProviderId ?? providerIdFromModel(currentModel);
}

function providerIdFromModel(currentModel: string): string {
  if (currentModel !== OPENCODE_DEFAULT_MODEL && currentModel.includes("/")) {
    return currentModel.split("/", 1)[0] || ZEN_PROVIDER_ID;
  }
  const firstConcrete = concreteOpencodeModels()[0]?.vendor;
  return firstConcrete ?? ZEN_PROVIDER_ID;
}

function concreteOpencodeModels() {
  return cliModelOptionsForAgent("opencode").filter((model) => model.value !== OPENCODE_DEFAULT_MODEL);
}

function providerViewModels(): ProviderViewModel[] {
  const models = concreteOpencodeModels();
  const modelVendors = new Set(models.flatMap((model) => model.vendor === undefined ? [] : [model.vendor]));
  const vendors = getOpencodeVendors();
  const providers: ProviderViewModel[] = [
    {
      id: ZEN_PROVIDER_ID,
      label: "OpenCode Zen",
      detail: zenFreeModelCount() > 0 ? `${zenFreeModelCount()} free models` : "Free default",
      monogram: "Z",
      connected: true,
      needsReconnect: false,
    },
  ];

  for (const vendor of vendors) {
    if (vendor.id === ZEN_PROVIDER_ID) {
      continue;
    }
    const connected = vendor.connected && vendor.usable !== false;
    const needsReconnect = vendor.connected && vendor.usable === false;
    providers.push({
      id: vendor.id,
      label: vendor.label,
      detail: needsReconnect
        ? "Reconnect"
        : connected
          ? vendor.method === undefined
            ? "Connected"
            : `${vendor.method} connected`
          : "Connect",
      monogram: opencodeVendorMonogram(vendor),
      connected,
      needsReconnect,
    });
    modelVendors.delete(vendor.id);
  }

  for (const vendorId of modelVendors) {
    if (vendorId === ZEN_PROVIDER_ID) {
      continue;
    }
    const label = vendorLabel(vendorId);
    providers.push({
      id: vendorId,
      label,
      detail: "Models available",
      monogram: opencodeVendorMonogram({ id: vendorId, label }),
      connected: true,
      needsReconnect: false,
    });
  }

  return providers;
}

function rowsForStep(
  step: AgentChatOpencodeModelProviderStep,
  providerId: string,
  providers: ProviderViewModel[],
  models: ReturnType<typeof modelViewsForProvider>,
  effortRows: AgentChatChoiceSurfaceRowView[],
): AgentChatChoiceSurfaceRowView[] {
  if (step === "provider_list" || step === "connect_vendor") {
    return providers.map((provider) =>
      row(
        providerRowId(provider.id, step),
        provider.label,
        provider.detail,
        provider.id === providerId ? "Current" : undefined,
        provider.id === providerId ? "check" : "",
        provider.id === providerId,
      ),
    );
  }
  if (step === "model_list") {
    return [
      row("opencode-back", "Back to providers", "opencode", "Esc", "back"),
      ...(connectionRowForProvider(providerId, providers.find((provider) => provider.id === providerId)) === undefined
        ? []
        : [row(connectionRowId(providerId), "Connection", providerStatus(providerId), "Update", "tool")]),
      ...models.map((model) =>
        row(model.rowId, model.label, model.detail, model.meta, model.selected ? "check" : "", model.selected),
      ),
      ...effortRows,
    ];
  }
  if (step === "vendor_method") {
    return [
      row("opencode-back", "Back", "opencode", undefined, "back"),
      row(connectVendorRowId(providerId), "Sign in with browser", "opens opencode auth in a readiness terminal", undefined, "panel"),
      row(apiKeyRowId(providerId), "Paste API key", "stored by opencode, not Tide", undefined, "tool"),
    ];
  }
  return [
    row("opencode-back", "Back", "opencode", undefined, "back"),
    row(apiKeyFinishedRowId(), "API key submitted", "return to providers", undefined, "check"),
  ];
}

function modelViewsForProvider(providerId: string, currentModel: string) {
  return concreteOpencodeModels()
    .filter((model) => model.vendor === providerId)
    .map((model) => ({
      rowId: `model:${model.value}`,
      value: model.value,
      label: model.label,
      detail: model.detail ?? model.value,
      monogram: providerId === ZEN_PROVIDER_ID ? "Z" : opencodeVendorMonogram({ id: providerId, label: vendorLabel(providerId) }),
      selected: model.value === currentModel,
      meta: model.value === currentModel ? "Current" : model.detail,
    }));
}

function opencodeEffortRows(currentEffort: string): AgentChatChoiceSurfaceRowView[] {
  return ["low", "medium", "high", "xhigh", "max"].map((level) =>
    row(
      `reasoning-${level}`,
      REASONING_LEVELS[level].label,
      REASONING_LEVELS[level].detail,
      undefined,
      currentEffort === level ? "check" : "",
      currentEffort === level,
    ),
  );
}

function providerHasModelRows(providerId: string): boolean {
  return concreteOpencodeModels().some((model) => model.vendor === providerId);
}

function connectionRowForProvider(
  providerId: string,
  provider: ProviderViewModel | undefined,
) {
  if (providerId === ZEN_PROVIDER_ID || provider === undefined || !provider.connected) {
    return undefined;
  }
  return {
    rowId: connectionRowId(providerId),
    label: "Connection",
    detail: `${provider.label} · ${providerStatus(providerId)} · opencode`,
  };
}

function providerStatus(providerId: string): string {
  const vendor = getOpencodeVendors().find((candidate) => candidate.id === providerId);
  if (vendor === undefined) {
    return "Models available";
  }
  if (vendor.connected && vendor.usable === false) {
    return "Reconnect";
  }
  if (vendor.connected) {
    return vendor.method === undefined ? "Connected" : `${vendor.method} connected`;
  }
  return "Connect";
}

function titleForStep(
  step: AgentChatOpencodeModelProviderStep,
  providerId: string | undefined,
  providerLabel: string | undefined,
): string {
  switch (step) {
    case "model_list":
      return providerLabel ?? "Models";
    case "vendor_method":
      return `${providerMethodVerb(providerId)} ${providerLabel ?? "Provider"}`;
    case "api_key":
      return `API key ${providerLabel ?? "Provider"}`;
    case "connect_vendor":
      return "Provider";
    case "provider_list":
      return "Provider";
  }
}

function providerMethodVerb(providerId: string | undefined): "Connect" | "Reconnect" | "Update" {
  const status = providerStatus(providerId ?? "");
  if (status === "Reconnect") {
    return "Reconnect";
  }
  if (status === "Connect") {
    return "Connect";
  }
  return "Update";
}

function zenFreeModelCount(): number {
  return concreteOpencodeModels().filter((model) => model.vendor === ZEN_PROVIDER_ID).length;
}

function vendorLabel(vendor: string): string {
  const map: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    opencode: "OpenCode Zen",
    moonshotai: "Moonshot",
    alibaba: "Qwen / Alibaba",
    "github-copilot": "GitHub Copilot",
    openrouter: "OpenRouter",
    deepseek: "DeepSeek",
    groq: "Groq",
    xai: "xAI",
  };
  return map[vendor] ?? vendor.replace(/(^|[-_/])([a-z])/g, (_match, sep, char) => `${sep ? " " : ""}${String(char).toUpperCase()}`).trim();
}
