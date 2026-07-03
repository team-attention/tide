import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  startNewProductShellThread,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { AgentChatBackendEvent } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

// Spec: docs_v2/specs/provider-catalog-ownership-and-model-selection.md

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("providerCatalog.changed folds into Product Shell providerCatalogs, not thread list state", () => {
  const catalogEvent: AgentChatBackendEvent = {
    kind: "providerCatalog.changed",
    payload: {
      catalog: {
        agentId: "opencode",
        status: "ready",
        models: [{ value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" }],
        vendors: [{ id: "openai", label: "OpenAI", connected: true, popular: true }],
        environment: { version: "1.17.3", executablePath: "/bin/opencode" },
        defaultModel: "opencode default",
      },
    },
  };

  const withCatalog = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    catalogEvent,
  );
  assert.deepEqual(
    withCatalog.providerCatalogs.opencode?.models.map((model) => model.value),
    ["openai/gpt-5.5"],
  );

  const afterThreadList = applyProductShellBackendEvent(withCatalog, {
    kind: "thread.listed",
    payload: { threads: [], availableAgents: ["codex"] },
  });
  assert.deepEqual(
    afterThreadList.providerCatalogs.opencode?.models.map((model) => model.value),
    ["openai/gpt-5.5"],
  );
});

test("providerInventory.changed owns available provider agents outside thread.listed", () => {
  const state = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "providerInventory.changed",
      payload: {
        agents: [
          { agentId: "codex", installed: true },
          { agentId: "claude", installed: false },
          { agentId: "opencode", installed: true },
        ],
      },
    },
  );

  assert.deepEqual(
    state.providerInventory?.agents.map((agent) => [agent.agentId, agent.installed]),
    [
      ["codex", true],
      ["claude", false],
      ["opencode", true],
    ],
  );
});

test("agentRuntime.modelCatalogChanged updates the same provider catalog slice", () => {
  const state = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "agentRuntime.modelCatalogChanged",
      payload: {
        agentId: "opencode",
        models: [{ value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" }],
      },
    },
  );

  assert.equal(state.providerCatalogs.opencode?.status, "ready");
  assert.deepEqual(
    state.providerCatalogs.opencode?.models.map((model) => model.value),
    ["openai/gpt-5.5"],
  );
});

test("new thread resets preserve provider catalog state", () => {
  const withCatalog = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "providerCatalog.changed",
      payload: {
        catalog: {
          agentId: "opencode",
          status: "ready",
          models: [{ value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" }],
          defaultModel: "opencode default",
        },
      },
    },
  );

  const next = startNewProductShellThread(withCatalog);
  assert.deepEqual(
    next.providerCatalogs.opencode?.models.map((model) => model.value),
    ["openai/gpt-5.5"],
  );
});

test("provider catalog state has no agent-chat module-global mutation API", () => {
  const agentVocab = readRepoFile("src/desktop/application/domains/agent-chat/state/agent-vocab.ts");
  const opencodeOnramp = readRepoFile("src/desktop/application/domains/agent-chat/state/opencode-onramp.ts");
  const opencodeProvider = readRepoFile("src/desktop/application/domains/agent-chat/state/opencode-model-provider.ts");

  assert.doesNotMatch(agentVocab, /setProviderModelCatalog|setOpencodeModelCatalog|setAvailableProviderAgents|providerModelCatalogs/);
  assert.doesNotMatch(opencodeOnramp, /setOpencodeVendors|setOpencodeEnvironment|let opencodeVendors|let opencodeEnvironment/);
  assert.match(opencodeProvider, /catalog\?: AgentChatProviderCatalog/);
  assert.doesNotMatch(opencodeProvider, /cliModelOptionsForAgent\("opencode"\)|getOpencodeVendors\(\)/);
});
