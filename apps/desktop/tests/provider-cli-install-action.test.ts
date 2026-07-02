import assert from "node:assert/strict";
import test from "node:test";

import {
  installPackageForAgent,
  npmInstallReadinessTerminalAction,
} from "../src/backend/adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";

// Spec: docs_v2/specs/provider-cli-setup-handoff.md
// The install counterpart of executableForAgent: which npm package provides each
// provider CLI, and the readiness terminal action that installs a missing one.

test("installPackageForAgent maps every provider CLI to its npm package", () => {
  assert.equal(installPackageForAgent("claude"), "@anthropic-ai/claude-code");
  assert.equal(installPackageForAgent("codex"), "@openai/codex");
  assert.equal(installPackageForAgent("opencode"), "opencode-ai");
  assert.equal(installPackageForAgent("qwen"), "@qwen-code/qwen-code");
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
