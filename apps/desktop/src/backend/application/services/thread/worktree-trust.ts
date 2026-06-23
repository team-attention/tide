import type { ProviderReadinessPort } from "../../ports/outbound/provider-readiness-port.ts";
import type { ProviderTrustPort } from "../../ports/outbound/provider-trust-port.ts";
import type { ThreadRecord } from "../../domains/thread/thread.ts";

export async function autoTrustDefaultWorktreeFromTrustedRepo(input: {
  thread: ThreadRecord;
  providerReadinessPort: ProviderReadinessPort;
  providerTrustPort?: ProviderTrustPort;
}): Promise<void> {
  const { thread, providerReadinessPort, providerTrustPort } = input;
  if (providerTrustPort === undefined || thread.scope?.kind !== "project") {
    return;
  }
  const repoCwd = defaultWorktreeRepoRootForCwd(thread.scope.cwd);
  if (repoCwd === null) {
    return;
  }

  try {
    const repoReadiness = await providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: { kind: "project", projectId: repoCwd, cwd: repoCwd },
      launchOptions: thread.launchOptions,
    });
    if (
      repoReadiness.blockers.some((blocker) =>
        blocker.kind === "directory_trust_required" ||
        blocker.kind === "not_installed" ||
        blocker.kind === "unknown"
      )
    ) {
      return;
    }

    await providerTrustPort.trust({
      agentId: thread.agentBinding.agentId,
      cwd: thread.scope.cwd,
    });
  } catch {
    // Trust inheritance is best-effort; normal readiness will surface any
    // provider setup or trust prompt.
  }
}

function defaultWorktreeRepoRootForCwd(cwd: string): string | null {
  const separator = cwd.includes("\\") ? "\\" : "/";
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const match = normalized.match(/^(.*)\.worktree\/[^/]+$/);
  if (match === null) {
    return null;
  }
  return separator === "\\" ? match[1].replace(/\//g, "\\") : match[1];
}
