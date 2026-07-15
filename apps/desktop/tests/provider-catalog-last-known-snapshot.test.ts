import assert from "node:assert/strict";
import test from "node:test";

import { createProductShellState } from "../src/desktop/application/domains/product-shell/product-shell.ts";
import {
  PROVIDER_CATALOG_CACHE_STORAGE_KEY,
  loadPersistedProviderCatalogs,
  persistReadyProviderCatalogs,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/provider-catalog-cache.ts";
import type { AgentChatProviderCatalog } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

const uiPrefs: Record<string, string> = {};
(globalThis as { window?: unknown }).window = {
  tide: {
    uiPrefs,
    saveUiPref(key: string, value: string): void {
      uiPrefs[key] = value;
    },
  },
};

function clearPrefs(): void {
  for (const key of Object.keys(uiPrefs)) {
    delete uiPrefs[key];
  }
  // Reset the adapter's in-memory persistence mirror between cases.
  loadPersistedProviderCatalogs();
}

function readyCodexCatalog(
  models: AgentChatProviderCatalog["models"],
  scope?: { cwd?: string },
): AgentChatProviderCatalog {
  return {
    agentId: "codex",
    status: "ready",
    ...(scope === undefined ? {} : { scope }),
    models,
    defaultModel: models[0]?.value ?? "gpt-5.5",
  };
}

test("latest successful catalog seeds the next Product Shell launch", () => {
  clearPrefs();
  persistReadyProviderCatalogs({
    codex: readyCodexCatalog([
      { value: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
      { value: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
    ], { cwd: "/Users/you/Workspace/tide" }),
  });

  const restored = loadPersistedProviderCatalogs();
  const nextLaunch = createProductShellState({
    includeFixtureData: false,
    providerCatalogs: restored,
  });

  assert.deepEqual(
    nextLaunch.providerCatalogs.codex?.models.map((model) => model.value),
    ["gpt-5.6-sol", "gpt-5.6-terra"],
  );
  assert.equal(nextLaunch.providerCatalogs.codex?.scope, undefined);
});

test("only ready non-empty catalogs are retained as a last-known snapshot", () => {
  clearPrefs();
  persistReadyProviderCatalogs({
    codex: {
      agentId: "codex",
      status: "error",
      models: [],
      defaultModel: "gpt-5.5",
      error: { code: "timed_out", message: "Timed out", retryable: true },
    },
  });

  assert.equal(uiPrefs[PROVIDER_CATALOG_CACHE_STORAGE_KEY], undefined);

  uiPrefs[PROVIDER_CATALOG_CACHE_STORAGE_KEY] = JSON.stringify({
    schema: 1,
    catalogs: {
      codex: {
        agentId: "codex",
        status: "error",
        models: [],
        defaultModel: "gpt-5.5",
      },
      unknown: readyCodexCatalog([{ value: "gpt-5.6-sol", label: "GPT-5.6-Sol" }]),
    },
  });

  assert.deepEqual(loadPersistedProviderCatalogs(), {});
});

test("a later successful refresh replaces the persisted snapshot without errors erasing it", () => {
  clearPrefs();
  persistReadyProviderCatalogs({
    codex: readyCodexCatalog([{ value: "gpt-5.6-sol", label: "GPT-5.6-Sol" }]),
  });
  persistReadyProviderCatalogs({
    codex: {
      agentId: "codex",
      status: "error",
      models: [],
      defaultModel: "gpt-5.5",
      error: { code: "provider_failed", message: "Temporary failure", retryable: true },
    },
  });
  persistReadyProviderCatalogs({
    codex: readyCodexCatalog([{ value: "gpt-5.6-terra", label: "GPT-5.6-Terra" }]),
  });

  assert.deepEqual(
    loadPersistedProviderCatalogs().codex?.models.map((model) => model.value),
    ["gpt-5.6-terra"],
  );
});
