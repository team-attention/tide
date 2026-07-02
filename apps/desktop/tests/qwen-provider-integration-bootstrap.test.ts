import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createQwenAgentIntegration,
  qwenConfigOptions,
  qwenProtocolParams,
} from "../src/backend/adapters/outbound/agent-integrations/qwen/qwen-agent-integration.ts";
import { readQwenProviderStateFromHome } from "../src/backend/infrastructure/node/provider/provider-state-readers.ts";

// Spec: Qwen Code is an ACP-backed provider CLI. Tide owns the generic ACP
// runtime; Qwen owns only launch/readiness/config specifics.

const projectScope = { kind: "project", projectId: "tide", cwd: "/repo" } as const;

function qwenIntegration(overrides?: { executable?: string | undefined; authenticated?: boolean }) {
  return createQwenAgentIntegration({
    resolveExecutable: (command) => {
      if (command === "npm") {
        return "/usr/local/bin/npm";
      }
      return overrides !== undefined && "executable" in overrides
        ? overrides.executable
        : "/opt/homebrew/bin/qwen";
    },
    readProviderState: () => ({ authenticated: overrides?.authenticated ?? true }),
    defaultCwd: "/repo",
    tideMcp: { command: "/Applications/Tide.app/tide-mcp", args: ["mcp"], env: { TIDE_SOCKET: "/tmp/tide.sock" } },
  });
}

test("qwenConfigOptions maps explicit model and skips the Qwen default sentinel", () => {
  assert.deepEqual(
    qwenConfigOptions({ model: "qwen3-coder-plus" }, ["model"]),
    [{ configId: "model", value: "qwen3-coder-plus" }],
  );
  assert.deepEqual(qwenConfigOptions({ model: "Qwen default" }, ["model"]), []);
  assert.deepEqual(qwenConfigOptions({ model: "qwen3-coder-plus" }, ["permission"]), []);
});

test("qwenProtocolParams carries ACP config options and modeId together", () => {
  assert.deepEqual(
    qwenProtocolParams(
      { model: "qwen3-coder-plus", permission: "plan" },
      ["model", "permission"],
    ),
    {
      configOptions: [{ configId: "model", value: "qwen3-coder-plus" }],
      modeId: "plan",
    },
  );
});

test("qwen preflight reports install and auth blockers with provider-native terminal actions", async () => {
  const missing = await qwenIntegration({ executable: undefined }).preflight({
    agentId: "qwen",
    scope: projectScope,
  });
  assert.equal(missing.ready, false);
  assert.equal(missing.blockers[0]?.kind, "not_installed");
  assert.equal(missing.blockers[0]?.terminalAction?.command, "/usr/local/bin/npm");
  assert.deepEqual(missing.blockers[0]?.terminalAction?.args, [
    "install",
    "-g",
    "@qwen-code/qwen-code",
  ]);
  assert.equal(missing.blockers[0]?.terminalAction?.expectedCompletion, "retry_preflight");

  const signedOut = await qwenIntegration({ authenticated: false }).preflight({
    agentId: "qwen",
    scope: projectScope,
  });
  assert.equal(signedOut.ready, false);
  assert.equal(signedOut.blockers[0]?.kind, "not_authenticated");
  assert.equal(signedOut.blockers[0]?.terminalAction?.command, "/opt/homebrew/bin/qwen");
  assert.deepEqual(signedOut.blockers[0]?.terminalAction?.args, []);
  assert.match(signedOut.blockers[0]?.message ?? "", /\/auth/);
});

test("qwen start plan launches ACP stdio with Tide MCP and launch config", async () => {
  const plan = await qwenIntegration().buildStartPlan({
    agentId: "qwen",
    scope: projectScope,
    launchOptions: { model: "qwen3-coder-plus", permission: "yolo" },
  });

  assert.equal(plan.command, "/opt/homebrew/bin/qwen");
  assert.deepEqual(plan.args, ["--acp"]);
  assert.equal(plan.transport, "acp");
  assert.equal(plan.cwd, "/repo");
  assert.deepEqual(plan.env, {});
  assert.deepEqual(plan.protocolParams, {
    cwd: "/repo",
    configOptions: [{ configId: "model", value: "qwen3-coder-plus" }],
    modeId: "yolo",
    mcpServers: [
      {
        name: "tide",
        command: "/Applications/Tide.app/tide-mcp",
        args: ["mcp"],
        env: [{ name: "TIDE_SOCKET", value: "/tmp/tide.sock" }],
      },
    ],
  });
});

test("qwen provider-state reader accepts env, settings env, and cwd dotenv credentials", () => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "tide-qwen-state-home-"));
  const cwd = path.join(home, "work", "repo", "nested");
  fs.mkdirSync(cwd, { recursive: true });

  assert.equal(readQwenProviderStateFromHome(home, cwd, {}).authenticated, false);
  assert.equal(
    readQwenProviderStateFromHome(home, cwd, { GITHUB_TOKEN: "ghp-not-qwen" }).authenticated,
    false,
  );
  assert.equal(
    readQwenProviderStateFromHome(home, cwd, { DASHSCOPE_API_KEY: "sk-real" }).authenticated,
    true,
  );

  writeFile(
    path.join(home, ".qwen", "settings.json"),
    JSON.stringify({ env: { OPENAI_API_KEY: "sk-settings" } }),
  );
  assert.equal(readQwenProviderStateFromHome(home, cwd, {}).authenticated, true);

  const dotenvHome = fs.mkdtempSync(path.join(tmpdir(), "tide-qwen-dotenv-home-"));
  const dotenvCwd = path.join(dotenvHome, "project", "src");
  writeFile(path.join(dotenvHome, "project", ".qwen", ".env"), "DASHSCOPE_API_KEY=sk-dotenv\n");
  assert.equal(readQwenProviderStateFromHome(dotenvHome, dotenvCwd, {}).authenticated, true);

  const shadowHome = fs.mkdtempSync(path.join(tmpdir(), "tide-qwen-shadow-env-home-"));
  const shadowCwd = path.join(shadowHome, "project", "src");
  writeFile(path.join(shadowHome, "project", ".qwen", ".env"), "GITHUB_TOKEN=ghp-not-qwen\n");
  writeFile(path.join(shadowHome, ".qwen", ".env"), "DASHSCOPE_API_KEY=sk-home\n");
  assert.equal(readQwenProviderStateFromHome(shadowHome, shadowCwd, {}).authenticated, false);

  const customHome = fs.mkdtempSync(path.join(tmpdir(), "tide-qwen-custom-env-home-"));
  const customCwd = path.join(customHome, "project");
  writeFile(
    path.join(customHome, ".qwen", "settings.json"),
    JSON.stringify({
      modelProviders: {
        openai: {
          models: [{ id: "local-qwen", envKey: "CUSTOM_QWEN_KEY" }],
        },
      },
    }),
  );
  assert.equal(
    readQwenProviderStateFromHome(customHome, customCwd, { CUSTOM_QWEN_KEY: "sk-custom" }).authenticated,
    true,
  );
});

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}
