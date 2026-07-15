import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyProductShellBackendEvent,
  createProductShellViewModel,
  createProductShellState,
  setProductShellComposerActiveSurface,
  startNewProductShellThread,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import {
  providerInventoryFromPayload,
  providerReadinessFromInventoryPayload,
} from "../src/desktop/application/domains/product-shell/state/provider-inventory-payload.ts";
import type { AgentChatBackendEvent } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import { parseCodexDebugModels } from "../src/backend/infrastructure/node/provider/codex-model-catalog.ts";

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
        providerOptions: [
          {
            id: "abacus",
            label: "Abacus",
            source: "custom",
            env: ["ABACUS_API_KEY"],
            modelCount: 65,
            connected: false,
          },
        ],
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
  assert.equal(withCatalog.providerCatalogs.opencode?.providerOptions?.[0]?.id, "abacus");

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

test("providerInventory.changed surfaces provider CLI update advisory on the start composer", () => {
  const state = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "providerInventory.changed",
      payload: {
        agents: [
          {
            agentId: "codex",
            installed: true,
            readiness: {
              agentId: "codex",
              ready: true,
              blockers: [],
              update: {
                currentVersion: "0.141.0",
                latestVersion: "0.144.4",
                terminalAction: {
                  command: "npm",
                  args: ["install", "-g", "@openai/codex@latest"],
                  cwd: ".",
                  expectedCompletion: "retry_preflight",
                },
              },
            },
          },
          { agentId: "claude", installed: true },
          { agentId: "opencode", installed: true },
        ],
      },
    },
  );

  const view = createProductShellViewModel(state);

  assert.equal(view.agentChat.providerUpdateAdvisory?.agentLabel, "Codex CLI");
  assert.equal(view.agentChat.providerUpdateAdvisory?.currentVersion, "0.141.0");
  assert.equal(view.agentChat.providerUpdateAdvisory?.latestVersion, "0.144.4");
});

test("provider inventory payload parsers tolerate malformed payloads", () => {
  assert.equal(providerInventoryFromPayload(null), null);
  assert.equal(providerInventoryFromPayload(undefined), null);
  assert.equal(providerInventoryFromPayload("not an object"), null);
  assert.equal(providerReadinessFromInventoryPayload(null, "codex"), null);
  assert.equal(providerReadinessFromInventoryPayload(undefined, "codex"), null);
  assert.equal(providerReadinessFromInventoryPayload("not an object", "codex"), null);
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

test("codex debug models parser keeps only selectable local chat models", () => {
  const models = parseCodexDebugModels(JSON.stringify({
    models: [
      {
        slug: "gpt-5.5",
        display_name: "GPT-5.5",
        visibility: "list",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }],
      },
      {
        slug: "codex-auto-review",
        display_name: "Codex Auto Review",
        visibility: "hide",
        supported_reasoning_levels: [{ effort: "medium" }],
      },
    ],
  }));

  assert.deepEqual(models, [
    { value: "gpt-5.5", label: "GPT-5.5", effortOptions: ["low", "medium"] },
  ]);
});

test("codex model menu uses local provider catalog instead of latest static rows", () => {
  const withCatalog = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "providerCatalog.changed",
      payload: {
        catalog: {
          agentId: "codex",
          status: "ready",
          models: [
            { value: "gpt-5.5", label: "GPT-5.5" },
            { value: "gpt-5.4", label: "GPT-5.4" },
          ],
          environment: { version: "0.141.0", executablePath: "/bin/codex" },
          defaultModel: "gpt-5.5",
        },
      },
    },
  );
  const withMenu = setProductShellComposerActiveSurface(withCatalog, "model_menu");
  const view = createProductShellViewModel(withMenu);

  assert.deepEqual(
    view.agentChat.composer.activeSurface?.rows
      .filter((row) => row.rowId.startsWith("model:"))
      .map((row) => row.rowId),
    ["model:gpt-5.5", "model:gpt-5.4"],
  );
});

test("ready provider catalog updates untouched start composer default model", () => {
  const state = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    {
      kind: "providerCatalog.changed",
      payload: {
        catalog: {
          agentId: "codex",
          status: "ready",
          models: [{ value: "gpt-5.4", label: "GPT-5.4" }],
          defaultModel: "gpt-5.4",
        },
      },
    },
  );

  assert.equal(state.agentChat.composer.startOptions.launchOptions?.model, "gpt-5.4");
});

test("ready provider catalog preserves explicit custom start composer model", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const custom = {
    ...base,
    agentChat: {
      ...base.agentChat,
      composer: {
        ...base.agentChat.composer,
        startOptions: {
          ...base.agentChat.composer.startOptions,
          launchOptions: {
            ...base.agentChat.composer.startOptions.launchOptions,
            model: "custom-codex-model",
          },
        },
      },
    },
  };
  const state = applyProductShellBackendEvent(custom, {
    kind: "providerCatalog.changed",
    payload: {
      catalog: {
        agentId: "codex",
        status: "ready",
        models: [{ value: "gpt-5.4", label: "GPT-5.4" }],
        defaultModel: "gpt-5.4",
      },
    },
  });

  assert.equal(state.agentChat.composer.startOptions.launchOptions?.model, "custom-codex-model");
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
