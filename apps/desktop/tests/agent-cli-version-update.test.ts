import assert from "node:assert/strict";
import test from "node:test";

import { semverLess } from "../src/backend/adapters/outbound/agent-integrations/shared/semver-compare.ts";
import {
  createAgentIntegrationProviderReadinessPort,
  type AgentCliUpdateChecker,
  type AgentIntegrationRegistry,
} from "../src/backend/adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts";
import { createAgentUpdateChecker } from "../src/backend/infrastructure/node/provider/agent-update-checker.ts";
import { createProviderDetection } from "../src/backend/infrastructure/node/provider/provider-detection.ts";
import type {
  AgentIntegrationPort,
  AgentIntegrationPreflightResult,
} from "../src/backend/application/ports/outbound/agent-integration-port.ts";
import type { ProviderCliAgentId } from "../src/backend/application/domains/thread/thread.ts";

const fakeCapabilities = {
  supportsResume: false,
  supportsTideMcp: false,
  supportsHooks: false,
  supportsReadableHistory: false,
  supportsTurnSteer: false,
};

function fakeIntegration(
  result: Omit<AgentIntegrationPreflightResult, "capabilities">,
): AgentIntegrationPort {
  return {
    async preflight() {
      return { ...result, capabilities: fakeCapabilities };
    },
    async buildStartPlan() {
      throw new Error("not used");
    },
    async buildResumePlan() {
      throw new Error("not used");
    },
  };
}

function registryWith(agentId: ProviderCliAgentId, integration: AgentIntegrationPort): AgentIntegrationRegistry {
  return { [agentId]: integration } as unknown as AgentIntegrationRegistry;
}

const advisoryChecker: AgentCliUpdateChecker = {
  advisoryFor: (_agentId, cwd) => ({
    currentVersion: "1.0.0",
    latestVersion: "1.2.0",
    terminalAction: { command: "npm", args: ["install", "-g", "x@latest"], cwd, expectedCompletion: "retry_preflight" },
  }),
};

// Spec: version-management.md (Lane 2). semverLess answers only "is the installed
// CLI strictly older than the latest published one?" — uncomparable input must
// yield false so the UI never shows a phantom "update available".

test("semverLess: lower patch/minor/major is older", () => {
  assert.equal(semverLess("1.2.3", "1.2.4"), true);
  assert.equal(semverLess("1.2.3", "1.3.0"), true);
  assert.equal(semverLess("1.2.3", "2.0.0"), true);
});

test("semverLess: numeric segments compare numerically, not lexically", () => {
  // The classic string-compare bug: "1.2.10" must be newer than "1.2.3".
  assert.equal(semverLess("1.2.3", "1.2.10"), true);
  assert.equal(semverLess("1.2.10", "1.2.3"), false);
  assert.equal(semverLess("1.9.0", "1.10.0"), true);
});

test("semverLess: equal versions are not older", () => {
  assert.equal(semverLess("1.2.3", "1.2.3"), false);
  assert.equal(semverLess("0.1.63", "0.1.63"), false);
});

test("semverLess: newer installed is not older", () => {
  assert.equal(semverLess("2.0.0", "1.9.9"), false);
  assert.equal(semverLess("1.2.4", "1.2.3"), false);
});

test("semverLess: a release outranks its own prerelease", () => {
  assert.equal(semverLess("1.2.3-beta.1", "1.2.3"), true);
  assert.equal(semverLess("1.2.3", "1.2.3-beta.1"), false);
  assert.equal(semverLess("1.2.3-rc.1", "1.2.3-rc.2"), true);
  assert.equal(semverLess("1.2.3-rc", "1.2.3-rc.1"), true);
});

test("semverLess: tolerates a leading v and build metadata", () => {
  assert.equal(semverLess("v1.2.3", "v1.2.4"), true);
  assert.equal(semverLess("1.2.3+build.5", "1.2.4"), true);
  assert.equal(semverLess("1.2.3", "1.2.3+build.9"), false);
});

test("semverLess: shorter cores treat missing components as zero", () => {
  assert.equal(semverLess("1.2", "1.2.1"), true);
  assert.equal(semverLess("1", "1.0.1"), true);
  assert.equal(semverLess("1.2.0", "1.2"), false);
});

test("semverLess: uncomparable input yields false (no phantom advisory)", () => {
  assert.equal(semverLess("", "1.2.3"), false);
  assert.equal(semverLess("1.2.3", ""), false);
  assert.equal(semverLess("not-a-version", "1.2.3"), false);
  assert.equal(semverLess("1.2.3", "latest"), false);
  assert.equal(semverLess("unknown", "unknown"), false);
});

test("semverLess: empty or whitespace core segments are rejected, not coerced to 0", () => {
  // Number("")/Number(" ") are 0, so without digit validation "1..3" would parse as
  // 1.0.3 — these must be uncomparable (no false advisory).
  assert.equal(semverLess("1..3", "1.2.3"), false);
  assert.equal(semverLess("1.2.3", "1..3"), false);
  assert.equal(semverLess("1. .3", "1.2.3"), false);
  assert.equal(semverLess("1. .3", "1. .3"), false);
});

test("readiness port: a ready agent still carries a non-blocking update advisory", async () => {
  const port = createAgentIntegrationProviderReadinessPort({
    integrations: registryWith("claude", fakeIntegration({ agentId: "claude", ready: true, blockers: [] })),
    updateChecker: advisoryChecker,
  });
  const result = await port.check({ agentId: "claude" });
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.update?.currentVersion, "1.0.0");
  assert.equal(result.update?.latestVersion, "1.2.0");
  assert.equal(result.update?.terminalAction.args.at(-1), "x@latest");
});

test("readiness port: the advisory rides alongside blockers without changing them", async () => {
  const blockers = [
    { kind: "not_authenticated" as const, scope: "provider" as const, message: "sign in" },
  ];
  const withChecker = await createAgentIntegrationProviderReadinessPort({
    integrations: registryWith("codex", fakeIntegration({ agentId: "codex", ready: false, blockers })),
    updateChecker: advisoryChecker,
  }).check({ agentId: "codex" });
  const withoutChecker = await createAgentIntegrationProviderReadinessPort({
    integrations: registryWith("codex", fakeIntegration({ agentId: "codex", ready: false, blockers })),
  }).check({ agentId: "codex" });

  assert.equal(withChecker.ready, false);
  assert.equal(withChecker.update?.latestVersion, "1.2.0");
  // ready/blockers are identical with or without the advisory.
  assert.equal(withChecker.ready, withoutChecker.ready);
  assert.deepEqual(withChecker.blockers, withoutChecker.blockers);
  assert.equal(withoutChecker.update, undefined);
});

test("readiness port: no checker means no advisory", async () => {
  const port = createAgentIntegrationProviderReadinessPort({
    integrations: registryWith("opencode", fakeIntegration({ agentId: "opencode", ready: true, blockers: [] })),
  });
  const result = await port.check({ agentId: "opencode" });
  assert.equal(result.update, undefined);
});

test("update checker: advisory only after refresh, only when installed < latest", async () => {
  const checker = createAgentUpdateChecker({
    agentIds: ["claude", "codex"],
    readInstalledVersion: async (id) => (id === "claude" ? "1.0.0" : "2.0.0"),
    readLatestVersion: async (id) => (id === "claude" ? "1.2.0" : "2.0.0"),
    buildUpdateTerminalAction: (id, cwd) => ({
      command: "npm",
      args: ["install", "-g", `${id}@latest`],
      cwd,
      expectedCompletion: "retry_preflight",
    }),
  });

  // Cold cache: nothing yet.
  assert.equal(checker.advisoryFor("claude", "."), undefined);

  const changed = await checker.refresh();
  // claude went stale (1.0.0 < 1.2.0); codex is current (2.0.0 === 2.0.0).
  assert.deepEqual(changed, ["claude"]);
  const advisory = checker.advisoryFor("claude", "/work");
  assert.equal(advisory?.currentVersion, "1.0.0");
  assert.equal(advisory?.latestVersion, "1.2.0");
  assert.equal(advisory?.terminalAction.cwd, "/work");
  assert.equal(checker.advisoryFor("codex", "."), undefined);
});

test("readiness port: refreshUpdateAdvisories clears a stale advisory after an in-place update", async () => {
  // The bug: after an in-place CLI update completes, readiness re-checks but reads a
  // stale version cache, so the "Update <Agent>" chip lingers. The readiness terminal
  // completion path awaits port.refreshUpdateAdvisories() before re-checking, which
  // re-reads the (now newer) installed version and drops the advisory.
  let installedClaude = "1.0.0";
  const checker = createAgentUpdateChecker({
    agentIds: ["claude"],
    readInstalledVersion: async () => installedClaude,
    readLatestVersion: async () => "1.2.0",
    buildUpdateTerminalAction: (id, cwd) => ({
      command: "npm",
      args: ["install", "-g", `${id}@latest`],
      cwd,
      expectedCompletion: "retry_preflight",
    }),
  });
  await checker.refresh(); // seed the cache (installed 1.0.0 < latest 1.2.0)

  const port = createAgentIntegrationProviderReadinessPort({
    integrations: registryWith("claude", fakeIntegration({ agentId: "claude", ready: true, blockers: [] })),
    updateChecker: checker,
  });

  const before = await port.check({ agentId: "claude" });
  assert.ok(before.update, "precondition: advisory is present while installed < latest");

  // The user runs the update — the CLI is now at latest.
  installedClaude = "1.2.0";
  // Stale cache would still report an advisory until this refresh runs.
  await port.refreshUpdateAdvisories?.();

  const after = await port.check({ agentId: "claude" });
  assert.equal(after.update, undefined, "the advisory clears once the cache reflects the update");
});

test("readiness port: refreshUpdateAdvisories ignores advisory refresh failures", async () => {
  const port = createAgentIntegrationProviderReadinessPort({
    integrations: registryWith("claude", fakeIntegration({ agentId: "claude", ready: true, blockers: [] })),
    updateChecker: {
      advisoryFor: () => undefined,
      async refresh() {
        throw new Error("network unavailable");
      },
    },
  });

  await assert.doesNotReject(() => port.refreshUpdateAdvisories?.());
});

test("update checker: not installed or unknown latest yields no advisory", async () => {
  const checker = createAgentUpdateChecker({
    agentIds: ["claude", "codex"],
    readInstalledVersion: async (id) => (id === "claude" ? undefined : "1.0.0"),
    readLatestVersion: async (id) => (id === "claude" ? "9.9.9" : undefined),
    buildUpdateTerminalAction: (id, cwd) => ({ command: "npm", args: [`${id}@latest`], cwd, expectedCompletion: "retry_preflight" }),
  });
  const changed = await checker.refresh();
  assert.deepEqual(changed, []);
  assert.equal(checker.advisoryFor("claude", "."), undefined); // not installed
  assert.equal(checker.advisoryFor("codex", "."), undefined); // latest unknown
});

test("provider detection inventory carries non-blocking CLI update advisories", () => {
  const detection = createProviderDetection({
    hasIntegration: () => true,
    resolveExecutable: (command) => `/bin/${command}`,
    defaultCwd: "/repo",
    updateChecker: {
      advisoryFor: (agentId, cwd) =>
        agentId === "codex"
          ? {
              currentVersion: "0.141.0",
              latestVersion: "0.144.4",
              terminalAction: {
                command: "npm",
                args: ["install", "-g", "@openai/codex@latest"],
                cwd,
                expectedCompletion: "retry_preflight",
              },
            }
          : undefined,
    },
  });

  const codex = detection.getProviderInventory().agents.find((agent) => agent.agentId === "codex");
  const claude = detection.getProviderInventory().agents.find((agent) => agent.agentId === "claude");

  assert.equal(codex?.readiness?.ready, true);
  assert.equal(codex?.readiness?.update?.currentVersion, "0.141.0");
  assert.equal(codex?.readiness?.update?.latestVersion, "0.144.4");
  assert.equal(codex?.readiness?.update?.terminalAction.cwd, "/repo");
  assert.equal(claude?.readiness?.update, undefined);
});
