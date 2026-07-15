import assert from "node:assert/strict";
import test from "node:test";

import {
  helpOutputAdvertisesProviderNativeUpdate,
  installPackageForAgent,
  npmInstallReadinessTerminalAction,
  updateReadinessTerminalActionForAgent,
} from "../src/backend/adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";

// Spec: docs_v2/specs/provider-cli-setup-handoff.md
// The install counterpart of executableForAgent: which npm package provides each
// provider CLI, and the readiness terminal action that installs a missing one.

test("installPackageForAgent maps every provider CLI to its npm package", () => {
  assert.equal(installPackageForAgent("claude"), "@anthropic-ai/claude-code");
  assert.equal(installPackageForAgent("codex"), "@openai/codex");
  assert.equal(installPackageForAgent("opencode"), "opencode-ai");
});

test("npmInstallReadinessTerminalAction builds a global npm install that re-runs preflight", () => {
  const action = npmInstallReadinessTerminalAction({
    npmPath: "/usr/local/bin/npm",
    agentId: "codex",
    cwd: "/repo",
  });
  assert.equal(action.command, "/usr/local/bin/npm");
  assert.deepEqual(action.args, ["install", "-g", "@openai/codex"]);
  assert.equal(action.cwd, "/repo");
  assert.equal(action.expectedCompletion, "retry_preflight");
});

test("update action targets the resolved provider executable in place", () => {
  const cases = [
    { agentId: "codex" as const, executablePath: "/Users/me/bin/codex", args: ["update"] },
    { agentId: "claude" as const, executablePath: "/Users/me/bin/claude", args: ["update"] },
    { agentId: "opencode" as const, executablePath: "/Users/me/bin/opencode", args: ["upgrade"] },
  ];

  for (const item of cases) {
    const action = updateReadinessTerminalActionForAgent({
      agentId: item.agentId,
      cwd: "/repo",
      executablePath: item.executablePath,
      nativeUpdateAvailable: true,
    });

    assert.equal(action?.command, item.executablePath);
    assert.deepEqual(action?.args, item.args);
    assert.equal(action?.cwd, "/repo");
    assert.equal(action?.expectedCompletion, "retry_preflight");
  }
});

test("update action does not assume the provider-native command exists", () => {
  const action = updateReadinessTerminalActionForAgent({
    agentId: "codex",
    cwd: "/repo",
    executablePath: "/Users/me/.local/bin/codex",
  });

  assert.equal(action, undefined);
});

test("provider native update probe reads top-level help output", () => {
  assert.equal(
    helpOutputAdvertisesProviderNativeUpdate({
      agentId: "codex",
      helpOutput: "Commands:\n  exec\n  update          Update Codex to the latest version\n",
    }),
    true,
  );
  assert.equal(
    helpOutputAdvertisesProviderNativeUpdate({
      agentId: "claude",
      helpOutput: "Commands:\n  update|upgrade                        Check for updates and install if available\n",
    }),
    true,
  );
  assert.equal(
    helpOutputAdvertisesProviderNativeUpdate({
      agentId: "opencode",
      helpOutput: "Commands:\n  opencode upgrade [target]    upgrade opencode to the latest or a specific version\n",
    }),
    true,
  );
  assert.equal(
    helpOutputAdvertisesProviderNativeUpdate({
      agentId: "codex",
      helpOutput: "Commands:\n  exec\n  doctor          Diagnose local installation\n",
    }),
    false,
  );
});
