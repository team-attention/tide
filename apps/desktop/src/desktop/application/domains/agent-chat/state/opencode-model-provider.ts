import type {
  AgentChatChoiceSurfaceRowView,
  AgentChatChoiceSurfaceView,
  AgentChatOpencodeModelProviderFlowState,
  AgentChatOpencodeModelProviderStep,
  AgentChatProviderCatalog,
  AgentChatProviderModelOption,
} from "./types.ts";
import { REASONING_LEVELS } from "./agent-vocab.ts";
import {
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

function unavailableOpencodeCatalogSurface(
  currentModel: string,
  currentEffort: string,
  catalog?: AgentChatProviderCatalog,
): AgentChatChoiceSurfaceView {
  const status = catalog?.status ?? "loading";
  const detail =
    status === "error"
      ? catalog?.error?.message ?? "Provider catalog failed."
      : status === "unavailable"
        ? catalog?.error?.message ?? "opencode is not available."
        : "Loading provider catalog";
  const rowId =
    status === "error"
      ? "provider-catalog-error"
      : status === "unavailable"
        ? "provider-catalog-unavailable"
        : "provider-catalog-loading";
  const effortRows = opencodeEffortRows(currentEffort);
  return {
    surfaceKind: "opencode_model_provider",
    title: "Provider",
    sourceLabel: "opencode",
    rows: [
      row(
        rowId,
        status === "loading" ? "Loading provider catalog" : "Provider catalog unavailable",
        detail,
        status === "error" && catalog?.error?.retryable ? "Retry" : undefined,
        status === "error" ? "!" : "source",
        false,
        status === "error",
        true,
      ),
      ...effortRows,
    ],
    opencodeModelProvider: {
      step: "provider_list",
      version: catalog?.environment?.version,
      zenFreeCount: 0,
      connectedCount: 0,
      currentModel,
      currentEffort,
      providers: [],
      models: [],
      effortRows,
    },
  };
}

export function buildOpencodeModelProviderSurface(
  currentModel: string,
  currentEffort: string,
  inputFlowState?: AgentChatOpencodeModelProviderFlowState,
  catalog?: AgentChatProviderCatalog,
): AgentChatChoiceSurfaceView {
  if (catalog?.status !== "ready") {
    return unavailableOpencodeCatalogSurface(currentModel, currentEffort, catalog);
  }
  const flowState = normalizeFlowState(inputFlowState, currentModel, catalog);
  const step = flowState.step ?? "provider_list";
  const providerId = selectedProviderId(currentModel, flowState, catalog);
  const providers = providerViewModels(catalog);
  const provider = providers.find((candidate) => candidate.id === providerId);
  const models = modelViewsForProvider(providerId, currentModel, catalog);
  const effortRows = opencodeEffortRows(currentEffort);
  const rows = rowsForStep(step, providerId, providers, models, effortRows, catalog);

  return {
    surfaceKind: "opencode_model_provider",
    title: titleForStep(step, providerId, provider?.label, catalog),
    sourceLabel: step === "provider_list" || step === "connect_vendor" ? "Model chip" : "opencode",
    rows,
    opencodeModelProvider: {
      step,
      version: catalog.environment?.version,
      zenFreeCount: zenFreeModelCount(catalog),
      connectedCount: getOpencodeVendors(catalog).filter((vendor) => vendor.connected).length,
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
      connection: connectionRowForProvider(providerId, provider, catalog),
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
  catalog?: AgentChatProviderCatalog,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = normalizeFlowState(inputFlowState, currentModel, catalog);
  return {
    ...flowState,
    selectedProviderId: providerId,
    methodReturnStep: flowState.step === "connect_vendor" ? "connect_vendor" : "provider_list",
    step: providerHasModelRows(providerId, catalog) ? "model_list" : "vendor_method",
  };
}

export function openOpencodeModelProviderConnection(
  inputFlowState: AgentChatOpencodeModelProviderFlowState | undefined,
  currentModel: string,
  providerId: string,
  catalog?: AgentChatProviderCatalog,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = normalizeFlowState(inputFlowState, currentModel, catalog);
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
  catalog?: AgentChatProviderCatalog,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = normalizeFlowState(inputFlowState, currentModel, catalog);
  return {
    ...flowState,
    selectedProviderId: providerId,
    step: "api_key",
  };
}

export function finishOpencodeModelProviderApiKey(
  inputFlowState: AgentChatOpencodeModelProviderFlowState | undefined,
  currentModel: string,
  catalog?: AgentChatProviderCatalog,
): AgentChatOpencodeModelProviderFlowState {
  return {
    ...normalizeFlowState(inputFlowState, currentModel, catalog),
    step: "provider_list",
  };
}

export function backOpencodeModelProvider(
  inputFlowState: AgentChatOpencodeModelProviderFlowState | undefined,
  currentModel: string,
  catalog?: AgentChatProviderCatalog,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = normalizeFlowState(inputFlowState, currentModel, catalog);
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
          ? providerIdFromModel(currentModel, catalog)
          : flowState.selectedProviderId,
    };
  }
  return flowState;
}

export function selectedOpencodeModelProviderId(
  currentModel: string,
  inputFlowState?: AgentChatOpencodeModelProviderFlowState,
  catalog?: AgentChatProviderCatalog,
): string {
  return selectedProviderId(currentModel, normalizeFlowState(inputFlowState, currentModel, catalog), catalog);
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
  catalog?: AgentChatProviderCatalog,
): AgentChatOpencodeModelProviderFlowState {
  const flowState = inputFlowState ?? initialOpencodeModelProviderFlowState();
  let step = flowState.step;
  if (step === null) {
    step = isOpencodeUsable(catalog) ? "provider_list" : "connect_vendor";
  } else if (!isOpencodeUsable(catalog) && step === "provider_list") {
    step = "connect_vendor";
  }
  return {
    ...flowState,
    step,
    selectedProviderId: flowState.selectedProviderId ?? providerIdFromModel(currentModel, catalog),
  };
}

function selectedProviderId(
  currentModel: string,
  flowState: AgentChatOpencodeModelProviderFlowState,
  catalog?: AgentChatProviderCatalog,
): string {
  return flowState.selectedProviderId ?? providerIdFromModel(currentModel, catalog);
}

function providerIdFromModel(currentModel: string, catalog?: AgentChatProviderCatalog): string {
  if (currentModel !== OPENCODE_DEFAULT_MODEL && currentModel.includes("/")) {
    return currentModel.split("/", 1)[0] || ZEN_PROVIDER_ID;
  }
  const firstConcrete = concreteOpencodeModels(catalog)[0]?.vendor;
  return firstConcrete ?? ZEN_PROVIDER_ID;
}

function concreteOpencodeModels(catalog?: AgentChatProviderCatalog): AgentChatProviderModelOption[] {
  return catalog?.status === "ready"
    ? catalog.models.filter((model) => model.value !== OPENCODE_DEFAULT_MODEL)
    : [];
}

function providerViewModels(catalog?: AgentChatProviderCatalog): ProviderViewModel[] {
  const models = concreteOpencodeModels(catalog);
  const modelVendors = new Set(models.flatMap((model) => model.vendor === undefined ? [] : [model.vendor]));
  const vendors = getOpencodeVendors(catalog);
  const providers: ProviderViewModel[] = [
    ...(zenFreeModelCount(catalog) > 0
      ? [{
          id: ZEN_PROVIDER_ID,
          label: "OpenCode Zen",
          detail: `${zenFreeModelCount(catalog)} free models`,
          monogram: "Z",
          connected: true,
          needsReconnect: false,
        }]
      : []),
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
  catalog?: AgentChatProviderCatalog,
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
      ...(connectionRowForProvider(providerId, providers.find((provider) => provider.id === providerId), catalog) === undefined
        ? []
        : [row(connectionRowId(providerId), "Connection", providerStatus(providerId, catalog), "Update", "tool")]),
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

function modelViewsForProvider(
  providerId: string,
  currentModel: string,
  catalog?: AgentChatProviderCatalog,
) {
  return concreteOpencodeModels(catalog)
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

function providerHasModelRows(providerId: string, catalog?: AgentChatProviderCatalog): boolean {
  return concreteOpencodeModels(catalog).some((model) => model.vendor === providerId);
}

function connectionRowForProvider(
  providerId: string,
  provider: ProviderViewModel | undefined,
  catalog?: AgentChatProviderCatalog,
) {
  if (providerId === ZEN_PROVIDER_ID || provider === undefined || !provider.connected) {
    return undefined;
  }
  return {
    rowId: connectionRowId(providerId),
    label: "Connection",
    detail: `${provider.label} · ${providerStatus(providerId, catalog)} · opencode`,
  };
}

function providerStatus(providerId: string, catalog?: AgentChatProviderCatalog): string {
  const vendor = getOpencodeVendors(catalog).find((candidate) => candidate.id === providerId);
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
  catalog?: AgentChatProviderCatalog,
): string {
  switch (step) {
    case "model_list":
      return providerLabel ?? "Models";
    case "vendor_method":
      return `${providerMethodVerb(providerId, catalog)} ${providerLabel ?? "Provider"}`;
    case "api_key":
      return `API key ${providerLabel ?? "Provider"}`;
    case "connect_vendor":
      return "Provider";
    case "provider_list":
      return "Provider";
  }
}

function providerMethodVerb(
  providerId: string | undefined,
  catalog?: AgentChatProviderCatalog,
): "Connect" | "Reconnect" | "Update" {
  const status = providerStatus(providerId ?? "", catalog);
  if (status === "Reconnect") {
    return "Reconnect";
  }
  if (status === "Connect") {
    return "Connect";
  }
  return "Update";
}

function zenFreeModelCount(catalog?: AgentChatProviderCatalog): number {
  return concreteOpencodeModels(catalog).filter((model) => model.vendor === ZEN_PROVIDER_ID).length;
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
