import type { ProviderCliAgentId } from "../../../application/domains/thread/thread.ts";
import type { ProviderSetupSurfaceAction } from "../../../application/domains/provider-readiness/provider-readiness.ts";
import type { AgentCliUpdateChecker } from "../../../adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts";
import { semverLess } from "../../../adapters/outbound/agent-integrations/shared/semver-compare.ts";
import {
  executableForAgent,
  installPackageForAgent,
  latestPublishedVersion,
  npmUpdateSetupAction,
  providerVersionForExecutable,
} from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";

// How often the background probe re-reads installed + latest versions.
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Background agent-CLI update detection (spec: version-management.md, Lane 2).
// Holds the last-known installed and latest-published version per agent and
// answers `advisoryFor` synchronously from that cache, so the readiness check
// (a hot path) never spawns a subprocess or touches the network. `refresh` does
// the I/O off the critical path (startup + a periodic timer in live-backend).

export interface AgentUpdateCheckerDeps {
  agentIds: ProviderCliAgentId[];
  // Installed version of the agent's CLI (`<exe> --version`), or undefined when
  // not installed / unreadable. Spawns the CLI, so async — keeps the startup refresh
  // off the backend event loop (a sync probe of all providers froze it ~1s at boot).
  readInstalledVersion: (agentId: ProviderCliAgentId) => Promise<string | undefined>;
  // Latest published version (`npm view <pkg> version`), or undefined on failure.
  // Network I/O, so asynchronous — refresh awaits all agents in parallel.
  readLatestVersion: (agentId: ProviderCliAgentId) => Promise<string | undefined>;
  // The in-place update Setup Surface action (npm install -g <pkg>@latest).
  buildUpdateSetup: (agentId: ProviderCliAgentId, cwd: string) => ProviderSetupSurfaceAction;
}

export interface RefreshableAgentCliUpdateChecker extends AgentCliUpdateChecker {
  // Re-read installed + latest versions for every known agent. Returns the agents
  // whose advisory state changed, so the caller can push a live readiness re-emit.
  refresh(): Promise<ProviderCliAgentId[]>;
}

export function createAgentUpdateChecker(
  deps: AgentUpdateCheckerDeps,
): RefreshableAgentCliUpdateChecker {
  const installed = new Map<ProviderCliAgentId, string>();
  const latest = new Map<ProviderCliAgentId, string>();

  const hasAdvisory = (agentId: ProviderCliAgentId): boolean => {
    const current = installed.get(agentId);
    const newest = latest.get(agentId);
    return current !== undefined && newest !== undefined && semverLess(current, newest);
  };

  return {
    advisoryFor(agentId, cwd) {
      const current = installed.get(agentId);
      const newest = latest.get(agentId);
      if (current === undefined || newest === undefined || !semverLess(current, newest)) {
        return undefined;
      }
      return {
        currentVersion: current,
        latestVersion: newest,
        setup: deps.buildUpdateSetup(agentId, cwd),
      };
    },
    async refresh() {
      const before = new Map(deps.agentIds.map((id) => [id, hasAdvisory(id)]));
      await Promise.all(
        deps.agentIds.map(async (agentId) => {
          const current = await deps.readInstalledVersion(agentId);
          if (current === undefined) {
            // Not installed (or unreadable): drop any stale versions so no advisory
            // lingers for an agent the user just uninstalled.
            installed.delete(agentId);
            latest.delete(agentId);
            return;
          }
          installed.set(agentId, current);
          const newest = await deps.readLatestVersion(agentId);
          if (newest === undefined) {
            latest.delete(agentId);
            return;
          }
          latest.set(agentId, newest);
        }),
      );
      return deps.agentIds.filter((id) => (before.get(id) ?? false) !== hasAdvisory(id));
    },
  };
}

// Live wiring for the composition root: builds the checker with the real
// spawn/npm-backed readers and kicks off the background refresh (startup, then
// periodic) so live-backend just constructs and injects it. The interval is
// unref'd so it never keeps the backend process alive on its own.
export function createLiveAgentUpdateChecker(input: {
  agentIds: ProviderCliAgentId[];
  resolveExecutable: (command: string) => string | undefined;
}): RefreshableAgentCliUpdateChecker {
  const npmPath = input.resolveExecutable("npm") ?? "npm";
  const checker = createAgentUpdateChecker({
    agentIds: input.agentIds,
    readInstalledVersion: (agentId) => {
      const exe = input.resolveExecutable(executableForAgent(agentId));
      return exe === undefined ? Promise.resolve(undefined) : providerVersionForExecutable(exe);
    },
    readLatestVersion: (agentId) => latestPublishedVersion(installPackageForAgent(agentId), npmPath),
    buildUpdateSetup: (agentId, cwd) => npmUpdateSetupAction({ npmPath, agentId, cwd }),
  });
  // Populate off the startup critical path; the advisory then surfaces on the next
  // readiness check (agent select / thread open). Refresh periodically to stay fresh.
  setImmediate(() => {
    void checker.refresh();
  });
  setInterval(() => {
    void checker.refresh();
  }, REFRESH_INTERVAL_MS).unref?.();
  return checker;
}
