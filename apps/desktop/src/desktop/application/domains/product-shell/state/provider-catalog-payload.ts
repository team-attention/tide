import type {
  AgentChatProviderCatalog,
  AgentChatProviderCatalogVendor,
  AgentChatProviderModelOption,
  AgentChatProviderOption,
} from "../../agent-chat/agent-chat.ts";
import { isProductShellAgentIdentity } from "./start.ts";
import type { ProductShellAgentIdentity } from "./types.ts";

export function providerCatalogFromPayload(payload: unknown): AgentChatProviderCatalog | null {
  const rawPayload = payload as {
    catalog?: unknown;
    opencodeModels?: unknown;
    opencodeVendors?: unknown;
    opencodeEnvironment?: unknown;
  };
  const catalog = providerCatalogSnapshotFromPayload(rawPayload.catalog);
  if (catalog !== null) {
    return catalog;
  }
  if (
    rawPayload.opencodeModels !== undefined ||
    rawPayload.opencodeVendors !== undefined ||
    rawPayload.opencodeEnvironment !== undefined
  ) {
    return {
      agentId: "opencode",
      status: "ready",
      models: providerModelsFromPayload(rawPayload.opencodeModels),
      vendors: providerVendorsFromPayload(rawPayload.opencodeVendors),
      environment: providerEnvironmentFromPayload(rawPayload.opencodeEnvironment),
      defaultModel: "opencode default",
    };
  }
  return null;
}

export function providerModelsFromPayload(payload: unknown): AgentChatProviderModelOption[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((entry): AgentChatProviderModelOption | null => {
      const model = entry as {
        value?: unknown;
        label?: unknown;
        vendor?: unknown;
        effortOptions?: unknown;
        detail?: unknown;
      };
      if (typeof model.value !== "string" || typeof model.label !== "string") {
        return null;
      }
      return {
        value: model.value,
        label: model.label,
        vendor: typeof model.vendor === "string" ? model.vendor : undefined,
        effortOptions: Array.isArray(model.effortOptions)
          ? model.effortOptions.filter((effort): effort is string => typeof effort === "string")
          : undefined,
        detail: typeof model.detail === "string" ? model.detail : undefined,
      };
    })
    .filter((entry): entry is AgentChatProviderModelOption => entry !== null);
}

export function defaultModelForProvider(agentId: ProductShellAgentIdentity): string {
  switch (agentId) {
    case "claude":
      return "Claude default";
    case "opencode":
      return "opencode default";
    default:
      return "gpt-5.6-sol";
  }
}

function providerCatalogSnapshotFromPayload(payload: unknown): AgentChatProviderCatalog | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const raw = payload as {
    agentId?: unknown;
    status?: unknown;
    scope?: unknown;
    models?: unknown;
    vendors?: unknown;
    providerOptions?: unknown;
    environment?: unknown;
    currentModel?: unknown;
    defaultModel?: unknown;
    error?: unknown;
  };
  if (
    typeof raw.agentId !== "string" ||
    !isProductShellAgentIdentity(raw.agentId) ||
    (raw.status !== "ready" && raw.status !== "unavailable" && raw.status !== "error")
  ) {
    return null;
  }
  return {
    agentId: raw.agentId,
    status: raw.status,
    scope: providerScopeFromPayload(raw.scope),
    models: providerModelsFromPayload(raw.models),
    vendors: providerVendorsFromPayload(raw.vendors),
    providerOptions: providerOptionsFromPayload(raw.providerOptions),
    environment: providerEnvironmentFromPayload(raw.environment),
    currentModel: typeof raw.currentModel === "string" ? raw.currentModel : undefined,
    defaultModel:
      typeof raw.defaultModel === "string"
        ? raw.defaultModel
        : defaultModelForProvider(raw.agentId),
    error: providerCatalogErrorFromPayload(raw.error),
  };
}

function providerVendorsFromPayload(payload: unknown): AgentChatProviderCatalogVendor[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }
  return payload
    .map((entry): AgentChatProviderCatalogVendor | null => {
      const vendor = entry as {
        id?: unknown;
        label?: unknown;
        connected?: unknown;
        method?: unknown;
        popular?: unknown;
        usable?: unknown;
      };
      if (
        typeof vendor.id !== "string" ||
        typeof vendor.label !== "string" ||
        typeof vendor.connected !== "boolean"
      ) {
        return null;
      }
      return {
        id: vendor.id,
        label: vendor.label,
        connected: vendor.connected,
        method: typeof vendor.method === "string" ? vendor.method : undefined,
        popular: typeof vendor.popular === "boolean" ? vendor.popular : undefined,
        usable: typeof vendor.usable === "boolean" ? vendor.usable : undefined,
      };
    })
    .filter((entry): entry is AgentChatProviderCatalogVendor => entry !== null);
}

function providerOptionsFromPayload(payload: unknown): AgentChatProviderOption[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }
  return payload
    .map((entry): AgentChatProviderOption | null => {
      const option = entry as {
        id?: unknown;
        label?: unknown;
        source?: unknown;
        env?: unknown;
        modelCount?: unknown;
        connected?: unknown;
        authMethods?: unknown;
      };
      if (
        typeof option.id !== "string" ||
        typeof option.label !== "string" ||
        typeof option.modelCount !== "number" ||
        typeof option.connected !== "boolean"
      ) {
        return null;
      }
      return {
        id: option.id,
        label: option.label,
        source:
          option.source === "env" ||
          option.source === "config" ||
          option.source === "custom" ||
          option.source === "api"
            ? option.source
            : undefined,
        env: Array.isArray(option.env)
          ? option.env.filter((name): name is string => typeof name === "string")
          : undefined,
        modelCount: option.modelCount,
        connected: option.connected,
        authMethods: providerAuthMethodsFromPayload(option.authMethods),
      };
    })
    .filter((entry): entry is AgentChatProviderOption => entry !== null);
}

function providerAuthMethodsFromPayload(
  payload: unknown,
): AgentChatProviderOption["authMethods"] {
  if (!Array.isArray(payload)) {
    return undefined;
  }
  const methods = payload
    .map((entry): NonNullable<AgentChatProviderOption["authMethods"]>[number] | null => {
      const method = entry as { type?: unknown; label?: unknown; promptCount?: unknown };
      if ((method.type !== "oauth" && method.type !== "api") || typeof method.label !== "string") {
        return null;
      }
      return {
        type: method.type,
        label: method.label,
        promptCount: typeof method.promptCount === "number" ? method.promptCount : undefined,
      };
    })
    .filter((entry): entry is NonNullable<AgentChatProviderOption["authMethods"]>[number] => entry !== null);
  return methods.length > 0 ? methods : undefined;
}

function providerEnvironmentFromPayload(
  payload: unknown,
): AgentChatProviderCatalog["environment"] | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const environment = payload as {
    version?: unknown;
    testedWith?: unknown;
    executablePath?: unknown;
  };
  return {
    version: typeof environment.version === "string" ? environment.version : undefined,
    testedWith: typeof environment.testedWith === "string" ? environment.testedWith : undefined,
    executablePath:
      typeof environment.executablePath === "string" ? environment.executablePath : undefined,
  };
}

function providerScopeFromPayload(payload: unknown): AgentChatProviderCatalog["scope"] {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const scope = payload as { cwd?: unknown };
  return typeof scope.cwd === "string" ? { cwd: scope.cwd } : undefined;
}

function providerCatalogErrorFromPayload(
  payload: unknown,
): AgentChatProviderCatalog["error"] {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const error = payload as {
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
  };
  if (
    error.code !== "not_installed" &&
    error.code !== "not_authenticated" &&
    error.code !== "provider_failed" &&
    error.code !== "timed_out"
  ) {
    return undefined;
  }
  return {
    code: error.code,
    message: typeof error.message === "string" ? error.message : "Provider catalog failed.",
    retryable: error.retryable === true,
  };
}
