import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentChatShellState,
  createAgentChatShellViewModel,
  selectAgentChatChoiceSurfaceRow,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import type { AgentChatShellState } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

// Spec: version-management.md (Lane 2). The renderer nudge is a non-blocking
// affordance: it surfaces whenever readiness carries an `update`, even when the
// agent is ready, and a click runs the in-place CLI update Setup Surface.

const advisorySetup = {
  command: "npm",
  args: ["install", "-g", "@anthropic-ai/claude-code@latest"],
  cwd: ".",
  expectedCompletion: "retry_preflight" as const,
};

function stateWithReadiness(
  ready: boolean,
  update?: { currentVersion: string; latestVersion: string; setup: typeof advisorySetup },
): AgentChatShellState {
  return {
    ...createAgentChatShellState(),
    providerReadiness: { agentId: "claude", ready, blockers: [], update },
  };
}

test("view model exposes the update advisory even when the agent is ready", () => {
  const vm = createAgentChatShellViewModel(
    stateWithReadiness(true, { currentVersion: "1.0.0", latestVersion: "1.2.0", setup: advisorySetup }),
  );
  // Ready ⇒ no blocking readiness card, but the nudge advisory is still present.
  assert.equal(vm.providerReadinessBlockers.length, 0);
  assert.equal(vm.providerUpdateAdvisory?.agentLabel, "Claude Code");
  assert.equal(vm.providerUpdateAdvisory?.currentVersion, "1.0.0");
  assert.equal(vm.providerUpdateAdvisory?.latestVersion, "1.2.0");
});

test("view model has no advisory when readiness carries no update", () => {
  const vm = createAgentChatShellViewModel(stateWithReadiness(true));
  assert.equal(vm.providerUpdateAdvisory, undefined);
});

test("selecting the update row dispatches the in-place update Setup Surface", () => {
  const state = stateWithReadiness(true, {
    currentVersion: "1.0.0",
    latestVersion: "1.2.0",
    setup: advisorySetup,
  });
  const result = selectAgentChatChoiceSurfaceRow(
    state,
    "provider_readiness",
    "update_available:setup",
    "thread-1",
  );
  assert.equal(result.command?.kind, "workbench.command");
  const payload = result.command?.payload as {
    threadId: string;
    command: string;
    data: { blockerKind: string; setup: { args: string[] } };
  };
  assert.equal(payload.command, "open_provider_setup_surface");
  assert.equal(payload.threadId, "thread-1");
  assert.equal(payload.data.setup.args.at(-1), "@anthropic-ai/claude-code@latest");
});

test("the update row is a no-op without a thread to host the Setup Surface", () => {
  const state = stateWithReadiness(true, {
    currentVersion: "1.0.0",
    latestVersion: "1.2.0",
    setup: advisorySetup,
  });
  // No active thread id passed and no thread on state ⇒ nothing to host the terminal.
  const result = selectAgentChatChoiceSurfaceRow(state, "provider_readiness", "update_available:setup");
  assert.equal(result.command, null);
});
