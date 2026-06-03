// Outward port: grant a provider's own Workspace Trust for an Execution Context
// cwd, so the provider CLI treats it as trusted on next launch.
// See docs_v2/specs/workspace-trust-grant.md.

export interface ProviderTrustPort {
  /**
   * Write the provider's trust record for `cwd`. Idempotent; preserves any other
   * trusted entries and unrelated config. Unknown agents are a no-op.
   */
  trust(input: { agentId: string; cwd: string }): Promise<void>;
}
