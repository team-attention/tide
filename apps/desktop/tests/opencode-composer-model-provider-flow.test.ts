import assert from "node:assert/strict";
import test from "node:test";

import {
  createActiveComposerSurface,
  createAgentChatShellState,
  resetOpencodeModelProviderSurface,
  selectAgentChatChoiceSurfaceRow,
  setComposerActiveSurface,
  setOpencodeEnvironment,
  setOpencodeModelCatalog,
  setOpencodeVendors,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

// Spec: docs_v2/specs/opencode-composer-model-provider-flow.md

function resetOpencodeState() {
  setOpencodeVendors(null);
  setOpencodeEnvironment(null);
  setOpencodeModelCatalog(null);
  resetOpencodeModelProviderSurface();
}

function opencodeState() {
  return createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "opencode" },
      scope: { kind: "project", projectId: "tide", cwd: "/repo" },
      launchOptions: { model: "openai/gpt-5.5", reasoning: "high" },
    },
  });
}

function codexState() {
  return createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "codex" },
      scope: { kind: "project", projectId: "tide", cwd: "/repo" },
      launchOptions: {},
    },
  });
}

test("opencode model chip opens provider root, not the flat model menu", () => {
  resetOpencodeState();
  setOpencodeVendors([
    { id: "openai", label: "OpenAI", connected: true, popular: true, method: "oauth", usable: true },
    { id: "anthropic", label: "Anthropic", connected: true, popular: true, method: "oauth", usable: false },
    { id: "google", label: "Google", connected: false, popular: true },
  ]);
  setOpencodeModelCatalog([
    { value: "opencode/big-pickle", label: "big-pickle", vendor: "opencode" },
    { value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" },
  ]);

  const opened = setComposerActiveSurface(opencodeState(), "model_menu").state;
  const surface = createActiveComposerSurface(opened);

  assert.equal(opened.composer.activeSurface, "opencode_model_provider");
  assert.equal(surface?.surfaceKind, "opencode_model_provider");
  assert.equal(surface?.opencodeModelProvider?.step, "provider_list");
  assert.ok(surface?.rows.some((row) => row.rowId === "opencode-provider:openai"));
  assert.ok(surface?.rows.some((row) => row.rowId === "opencode-provider:anthropic"));
  assert.ok(!surface?.rows.some((row) => row.rowId === "add-vendor"));
  assert.ok(!surface?.rows.some((row) => row.rowId === "all-providers"));
  assert.ok(!surface?.rows.some((row) => row.rowId === "opencode-back"));
  resetOpencodeState();
});

test("connected provider drilldown renders models, connection update row, and provider back", () => {
  resetOpencodeState();
  setOpencodeVendors([
    { id: "openai", label: "OpenAI", connected: true, popular: true, method: "oauth", usable: true },
  ]);
  setOpencodeModelCatalog([
    { value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" },
    { value: "openai/gpt-5.4-mini", label: "gpt-5.4-mini", vendor: "openai" },
  ]);

  const opened = setComposerActiveSurface(opencodeState(), "opencode_model_provider").state;
  const drilled = selectAgentChatChoiceSurfaceRow(
    opened,
    "opencode_model_provider",
    "opencode-provider:openai",
  ).state;
  const modelSurface = createActiveComposerSurface(drilled);
  assert.equal(modelSurface?.opencodeModelProvider?.step, "model_list");
  assert.ok(modelSurface?.rows.some((row) => row.rowId === "opencode-back"));
  assert.ok(modelSurface?.rows.some((row) => row.rowId === "opencode-connection:openai"));
  assert.ok(modelSurface?.rows.some((row) => row.rowId === "model:openai/gpt-5.5"));

  const back = selectAgentChatChoiceSurfaceRow(
    drilled,
    "opencode_model_provider",
    "opencode-back",
  ).state;
  const root = createActiveComposerSurface(back);
  assert.equal(root?.opencodeModelProvider?.step, "provider_list");
  assert.ok(!root?.rows.some((row) => row.rowId === "opencode-back"));
  resetOpencodeState();
});

test("connected provider connection update opens method sheet and backs to model list", () => {
  resetOpencodeState();
  setOpencodeVendors([
    { id: "openai", label: "OpenAI", connected: true, popular: true, method: "oauth", usable: true },
  ]);
  setOpencodeModelCatalog([{ value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" }]);

  const opened = setComposerActiveSurface(opencodeState(), "opencode_model_provider").state;
  const modelState = selectAgentChatChoiceSurfaceRow(
    opened,
    "opencode_model_provider",
    "opencode-provider:openai",
  ).state;
  const methodState = selectAgentChatChoiceSurfaceRow(
    modelState,
    "opencode_model_provider",
    "opencode-connection:openai",
  ).state;
  assert.equal(createActiveComposerSurface(methodState)?.opencodeModelProvider?.step, "vendor_method");

  const backState = selectAgentChatChoiceSurfaceRow(
    methodState,
    "opencode_model_provider",
    "opencode-back",
  ).state;
  assert.equal(createActiveComposerSurface(backState)?.opencodeModelProvider?.step, "model_list");
  resetOpencodeState();
});

test("unconnected provider opens auth method and backs to provider root", () => {
  resetOpencodeState();
  setOpencodeVendors([{ id: "google", label: "Google", connected: false, popular: true }]);
  setOpencodeModelCatalog([{ value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" }]);

  const opened = setComposerActiveSurface(opencodeState(), "opencode_model_provider").state;
  const methodState = selectAgentChatChoiceSurfaceRow(
    opened,
    "opencode_model_provider",
    "opencode-provider:google",
  ).state;
  assert.equal(createActiveComposerSurface(methodState)?.opencodeModelProvider?.step, "vendor_method");

  const rootState = selectAgentChatChoiceSurfaceRow(
    methodState,
    "opencode_model_provider",
    "opencode-back",
  ).state;
  assert.equal(createActiveComposerSurface(rootState)?.opencodeModelProvider?.step, "provider_list");
  resetOpencodeState();
});

test("browser auth dispatches opencode auth login for the selected provider", () => {
  resetOpencodeState();
  setOpencodeVendors([{ id: "google", label: "Google", connected: false, popular: true }]);
  setOpencodeEnvironment({ executablePath: "/bin/opencode", version: "1.17.3" });
  setOpencodeModelCatalog([{ value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" }]);

  const opened = setComposerActiveSurface(opencodeState(), "opencode_model_provider").state;
  const methodState = selectAgentChatChoiceSurfaceRow(
    opened,
    "opencode_model_provider",
    "opencode-provider:google",
  ).state;
  const result = selectAgentChatChoiceSurfaceRow(
    methodState,
    "opencode_model_provider",
    "connect-vendor:google",
    "thread-1",
  );

  assert.equal(result.command?.kind, "workbench.command");
  if (result.command?.kind === "workbench.command") {
    assert.equal(result.command.payload.data.command, "/bin/opencode");
    assert.deepEqual(result.command.payload.data.args, ["auth", "login", "-p", "google"]);
    assert.equal(result.command.payload.data.expectedCompletion, "retry_preflight");
  }
  assert.equal(result.state.composer.activeSurface, null);
  resetOpencodeState();
});

test("api key row stays local and returns to provider root after submit action", () => {
  resetOpencodeState();
  setOpencodeVendors([{ id: "google", label: "Google", connected: false, popular: true }]);
  setOpencodeModelCatalog([{ value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" }]);

  const opened = setComposerActiveSurface(opencodeState(), "opencode_model_provider").state;
  const methodState = selectAgentChatChoiceSurfaceRow(
    opened,
    "opencode_model_provider",
    "opencode-provider:google",
  ).state;
  const keyState = selectAgentChatChoiceSurfaceRow(
    methodState,
    "opencode_model_provider",
    "opencode-api-key:google",
  ).state;
  assert.equal(createActiveComposerSurface(keyState)?.opencodeModelProvider?.step, "api_key");

  const returned = selectAgentChatChoiceSurfaceRow(
    keyState,
    "opencode_model_provider",
    "opencode-api-key-finished",
  ).state;
  assert.equal(createActiveComposerSurface(returned)?.opencodeModelProvider?.step, "provider_list");
  resetOpencodeState();
});

test("model and effort rows update launch options through the existing command path", () => {
  resetOpencodeState();
  setOpencodeVendors([{ id: "openai", label: "OpenAI", connected: true, popular: true, usable: true }]);
  setOpencodeModelCatalog([
    { value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" },
    { value: "openai/gpt-5.4-mini", label: "gpt-5.4-mini", vendor: "openai" },
  ]);

  const opened = setComposerActiveSurface(opencodeState(), "opencode_model_provider").state;
  const modelState = selectAgentChatChoiceSurfaceRow(
    opened,
    "opencode_model_provider",
    "opencode-provider:openai",
  ).state;
  const selected = selectAgentChatChoiceSurfaceRow(
    modelState,
    "opencode_model_provider",
    "model:openai/gpt-5.4-mini",
  );
  assert.equal(selected.state.composer.startOptions.launchOptions?.model, "openai/gpt-5.4-mini");

  const reopened = setComposerActiveSurface(selected.state, "opencode_model_provider").state;
  const effortState = selectAgentChatChoiceSurfaceRow(
    reopened,
    "opencode_model_provider",
    "opencode-provider:openai",
  ).state;
  const effort = selectAgentChatChoiceSurfaceRow(
    effortState,
    "opencode_model_provider",
    "reasoning-max",
  );
  assert.equal(effort.state.composer.startOptions.launchOptions?.reasoning, "max");
  resetOpencodeState();
});

test("codex and claude keep the existing compact model menu", () => {
  resetOpencodeState();
  const codexOpened = setComposerActiveSurface(codexState(), "model_menu").state;
  assert.equal(codexOpened.composer.activeSurface, "model_menu");
  assert.equal(createActiveComposerSurface(codexOpened)?.surfaceKind, "model_menu");
  resetOpencodeState();
});
