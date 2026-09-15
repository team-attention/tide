import assert from "node:assert/strict";
import test from "node:test";
import { parseOpencodeModels, createOpencodeModelCatalog } from "../src/backend/infrastructure/node/provider/opencode-model-catalog.ts";
import { createAgentChatShellState, createAgentChatShellViewModel, setComposerActiveSurface, selectAgentChatChoiceSurfaceRow } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import { opencodeConfigOptions } from "../src/backend/adapters/outbound/agent-integrations/opencode/opencode-agent-integration.ts";

const verbose = ["custom/native", JSON.stringify({ id: "native", variants: { none: {}, "future-effort": {} }, api: { url: "https://example.com/model" } }, null, 2), "custom/plain", JSON.stringify({ id: "plain", variants: {} }, null, 2)].join("\n");
test("OpenCode verbose metadata supplies per-model native efforts without parsing metadata as model IDs", () => {
  const models = parseOpencodeModels(verbose);
  assert.deepEqual(models.map(m => [m.value, m.effortOptions]), [["custom/native", ["none", "future-effort"]], ["custom/plain", []]]);
  assert.throws(() => parseOpencodeModels('custom/broken\n{\n"variants": {'), /metadata|JSON/i);
});
test("OpenCode menu and ACP preserve unfamiliar effort and do not invent options for other models", () => {
  let state = createAgentChatShellState({ startOptions: { agentBinding: { agentId: "opencode" }, launchOptions: { model: "custom/native" } } });
  state.availableProviderCatalogs = { opencode: { agentId: "opencode", status: "ready", defaultModel: "custom/native", models: parseOpencodeModels(verbose), vendors: [{ id: "custom", label: "Custom", connected: true, usable: true }] } };
  state = setComposerActiveSurface(state, "opencode_model_provider").state;
  state = selectAgentChatChoiceSurfaceRow(state, "opencode_model_provider", "opencode-provider:custom").state;
  const surface = createAgentChatShellViewModel(state).composer.activeSurface;
  assert.deepEqual(surface?.opencodeModelProvider?.effortRows.map(row => row.rowId), ["reasoning-none", "reasoning-future-effort"]);
  state = selectAgentChatChoiceSurfaceRow(state, "opencode_model_provider", "reasoning-future-effort").state;
  assert.equal(state.composer.startOptions.launchOptions?.reasoning, "future-effort");
  assert.deepEqual(opencodeConfigOptions(state.composer.startOptions.launchOptions, ["reasoning"]), [{ configId: "effort", value: "future-effort" }]);
  state.composer.startOptions.launchOptions = { model: "custom/plain" };
  state = setComposerActiveSurface(state, "opencode_model_provider").state;
  assert.deepEqual(createAgentChatShellViewModel(state).composer.activeSurface?.opencodeModelProvider?.effortRows, []);
});
test("OpenCode queries verbose metadata in the requested project and separates concurrent projects", async () => {
  const seen: Array<string | undefined> = [];
  const catalog = createOpencodeModelCatalog(() => "/fake/opencode", async (_executable, args, cwd) => { assert.deepEqual(args, ["models", "--verbose"]); seen.push(cwd); return verbose; });
  await Promise.all([catalog.get("/project-a"), catalog.get("/project-b")]);
  assert.deepEqual(seen.sort(), ["/project-a", "/project-b"]);
});

test("ACP current-model effort never overwrites other models' choices", async () => {
  const { parseAcpModelCatalog } = await import("../src/backend/adapters/outbound/agent-runtime/structured/acp-client-shared.ts");
  const parsed = parseAcpModelCatalog({ configOptions: [
    { id: "model", currentValue: "custom/native", options: [{ value: "custom/native" }, { value: "custom/plain" }] },
    { id: "effort", options: [{ value: "future-effort" }] },
  ] });
  assert.deepEqual(parsed?.models.map(model => model.effortOptions), [["future-effort"], undefined]);
});

test("ACP model-only updates retain CLI per-model effort metadata", async () => {
  const { createProductShellState, applyProductShellBackendEvent } = await import("../src/desktop/application/domains/product-shell/product-shell.ts");
  const state = createProductShellState();
  state.providerCatalogs.opencode = { agentId: "opencode", status: "ready", defaultModel: "custom/native", models: parseOpencodeModels(verbose) };
  const updated = applyProductShellBackendEvent(state, { kind: "agentRuntime.modelCatalogChanged", payload: { agentId: "opencode", currentModel: "custom/native", models: [{ value: "custom/native", label: "Native" }, { value: "custom/plain", label: "Plain", effortOptions: [] }] } });
  assert.deepEqual(updated.providerCatalogs.opencode?.models.map(model => model.effortOptions), [["none", "future-effort"], []]);
});
