import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpencodeAgentIntegration,
  opencodeConfigOptions,
} from "../src/backend/adapters/outbound/agent-integrations/opencode/opencode-agent-integration.ts";
import { parseOpencodeModels } from "../src/backend/infrastructure/node/provider/opencode-model-catalog.ts";
import {
  cliModelOptionsForAgent,
  isAgentComingSoon,
  permissionConfigForAgent,
  setAvailableProviderAgents,
  setOpencodeModelCatalog,
} from "../src/desktop/application/domains/agent-chat/state/agent-vocab.ts";

// Spec: docs_v2/specs/opencode-model-vendor-selection.md

function opencodeIntegration(overrides?: { executable?: string | undefined; authenticated?: boolean }) {
  return createOpencodeAgentIntegration({
    resolveExecutable: () =>
      overrides !== undefined && "executable" in overrides ? overrides.executable : "/opt/homebrew/bin/opencode",
    readProviderState: () => ({ authenticated: overrides?.authenticated ?? true }),
    defaultCwd: "/repo",
  });
}

const projectScope = { kind: "project", cwd: "/repo" } as const;

test("parseOpencodeModels splits provider/model ids into vendor + model, skips noise", () => {
  const models = parseOpencodeModels(
    "openai/gpt-5.5\nopencode/big-pickle\n\nError: not authed\nmoonshotai/kimi-k2-thinking\n",
  );
  assert.deepEqual(models, [
    { value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" },
    { value: "opencode/big-pickle", label: "big-pickle", vendor: "opencode" },
    { value: "moonshotai/kimi-k2-thinking", label: "kimi-k2-thinking", vendor: "moonshotai" },
  ]);
});

test("opencodeConfigOptions maps model/effort/permission to set_config_option entries", () => {
  assert.deepEqual(
    opencodeConfigOptions(
      { model: "openai/gpt-5.5", reasoning: "high", permission: "plan" },
      ["model", "reasoning", "permission"],
    ),
    [
      { configId: "model", value: "openai/gpt-5.5" },
      { configId: "effort", value: "high" },
      { configId: "mode", value: "plan" },
    ],
  );
  // The "opencode default" sentinel sets no model (honor opencode's own default);
  // any non-plan permission is the "build" mode.
  assert.deepEqual(
    opencodeConfigOptions({ model: "opencode default", permission: "build" }, ["model", "permission"]),
    [{ configId: "mode", value: "build" }],
  );
});

test("opencode preflight reports not_installed and not_authenticated", async () => {
  const missing = await opencodeIntegration({ executable: undefined }).preflight({ agentId: "opencode" });
  assert.equal(missing.ready, false);
  assert.equal(missing.blockers[0]?.kind, "not_installed");

  const signedOut = await opencodeIntegration({ authenticated: false }).preflight({ agentId: "opencode" });
  assert.equal(signedOut.ready, false);
  assert.equal(signedOut.blockers[0]?.kind, "not_authenticated");
});

test("opencode start plan carries the chosen config as ACP configOptions", async () => {
  const plan = await opencodeIntegration().buildStartPlan({
    agentId: "opencode",
    scope: projectScope,
    launchOptions: { model: "openai/gpt-5.5", reasoning: "high", permission: "plan" },
  });
  assert.equal(plan.transport, "acp");
  assert.deepEqual(plan.args, ["acp"]);
  const configOptions = (plan.protocolParams as { configOptions?: unknown }).configOptions;
  assert.deepEqual(configOptions, [
    { configId: "model", value: "openai/gpt-5.5" },
    { configId: "effort", value: "high" },
    { configId: "mode", value: "plan" },
  ]);
});

test("opencode mid-thread config update is live (never restart)", () => {
  const plan = opencodeIntegration().buildSessionConfigUpdate({
    launchOptions: { model: "openai/gpt-5.5" },
    changedKeys: ["model"],
  });
  assert.equal(plan.kind, "live");
  assert.deepEqual((plan as { protocolParams: { configOptions: unknown } }).protocolParams.configOptions, [
    { configId: "model", value: "openai/gpt-5.5" },
  ]);
});

test("opencode is no longer coming-soon and its permission modes are Build/Plan", () => {
  assert.equal(isAgentComingSoon("opencode"), false);
  const permission = permissionConfigForAgent("opencode");
  assert.deepEqual(
    permission.options.map((option) => option.value),
    ["build", "plan"],
  );
  assert.equal(permission.default, "build");
});

test("cliModelOptionsForAgent('opencode') reflects the backend-enumerated catalog", () => {
  setAvailableProviderAgents(["opencode"]);
  setOpencodeModelCatalog(null);
  // No catalog yet → sentinel default only.
  assert.deepEqual(cliModelOptionsForAgent("opencode"), [
    { value: "opencode default", label: "Default", detail: "opencode config" },
  ]);

  setOpencodeModelCatalog([
    { value: "openai/gpt-5.5", label: "gpt-5.5", vendor: "openai" },
    { value: "opencode/big-pickle", label: "big-pickle", vendor: "opencode" },
  ]);
  const options = cliModelOptionsForAgent("opencode");
  assert.equal(options[0]?.value, "opencode default");
  assert.deepEqual(options.slice(1).map((option) => option.value), [
    "openai/gpt-5.5",
    "opencode/big-pickle",
  ]);
  assert.equal(options[1]?.vendor, "openai");
  // Reset module state so other tests are unaffected.
  setOpencodeModelCatalog(null);
});
