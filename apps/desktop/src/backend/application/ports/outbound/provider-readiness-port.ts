import type {
  ProviderReadinessCheckInput,
  ProviderReadinessResult,
} from "../../domains/provider-readiness/provider-readiness.ts";

export interface ProviderReadinessPort {
  check(input: ProviderReadinessCheckInput): Promise<ProviderReadinessResult>;
  // Re-read the cached agent-CLI versions that back the non-blocking update advisory
  // (`check().update`). The advisory is answered synchronously from a cache that
  // otherwise only refreshes at boot + on a slow timer, so right after an in-place CLI
  // update the cache is stale and the next `check()` would still report the old version
  // (the update chip would linger). Callers await this before re-checking readiness
  // following a readiness terminal completion. No-op when no update checker is wired.
  // Spec: version-management.md (Lane 2).
  refreshUpdateAdvisories?(): Promise<void>;
}
