import assert from "node:assert/strict";
import test from "node:test";

import {
  installPackageForAgent,
  npmInstallSetupAction,
} from "../src/backend/adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";

// Spec: docs_v2/specs/provider-cli-setup-handoff.md
// The install counterpart of executableForAgent: which npm package provides each
// provider CLI, and the Setup Surface action that installs a missing one.

test("installPackageForAgent maps every provider CLI to its npm package", () => {
  assert.equal(installPackageForAgent("claude"), "@anthropic-ai/claude-code");
  assert.equal(installPackageForAgent("codex"), "@openai/codex");
  assert.equal(installPackageForAgent("gemini"), "@google/gemini-cli");
  assert.equal(installPackageForAgent("opencode"), "opencode-ai");
});

test("npmInstallSetupAction builds a global npm install that re-runs preflight", () => {
  const action = npmInstallSetupAction({
    npmPath: "/usr/local/bin/npm",
    agentId: "codex",
    cwd: "/repo",
  });
  assert.equal(action.command, "/usr/local/bin/npm");
  assert.deepEqual(action.args, ["install", "-g", "@openai/codex"]);
  assert.equal(action.cwd, "/repo");
  assert.equal(action.expectedCompletion, "retry_preflight");
});
