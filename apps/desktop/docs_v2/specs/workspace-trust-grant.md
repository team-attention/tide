# Spec: Workspace Trust Grant

## Scope

Turn the `directory_trust_required` Provider Readiness blocker into a one-click
in-app "Trust this folder" action for provider CLIs that expose provider-owned
workspace trust. On confirm, Tide writes the provider's own trust
record for the Execution Context cwd, re-checks Provider Readiness, and — if the
provider is now ready — proceeds with any pending Composer input. No terminal drop.

In scope:
- A `provider.trustWorkspace` BackendCommand carrying the Thread.
- Backend service: resolve the Thread's Agent + cwd, write provider trust, re-check
  readiness, emit `provider_readiness_changed`, flush pending input if now ready.
- An outward `ProviderTrustPort` + node adapter that writes each provider's trust
  store.
- Desktop: the `directory_trust_required` readiness row offers "Trust this folder"
  which dispatches the command (the generic "Open provider setup" stays for other
  blockers / as a fallback).

## Evidence

- Provider integrations that require directory trust emit
  `kind: "directory_trust_required"` when the cwd is absent from
  `providerState.trustedCwds`.
- Trust is read from disk per provider (`live-backend.ts`):
  - claude `~/.claude.json` → `projects[cwd].hasTrustDialogAccepted === true`.
  - codex `~/.codex/config.toml` → `[projects."<cwd>"]` with `trust_level = "trusted"`.
- Readiness blockers surface today as a `provider_readiness` composer choice
  surface; the trust blocker currently only offers "Open provider setup"
  (a provider-native terminal), `agent-chat-shell-state.ts:507`.
- Decision (user): Tide writes the provider trust config directly on confirm.

## Decisions

- Trust grant writes the provider's native store so the provider itself treats the
  cwd as trusted on next launch (equivalent to the user accepting the provider's
  own trust dialog).
- The write preserves all other config (other projects, other settings keys).
- After writing, the service re-runs the existing Provider Readiness check; the UI
  updates from the real re-check, not an optimistic guess.

## Out Of Scope

- A standalone ModalStack component (v2 desktop has none; the readiness surface is
  reused). Worktree UX (separate spec).
- Revoking trust.

## Domain Model

- **Workspace Trust** (glossary): the provider-owned record that an Execution
  Context cwd is trusted to run the Agent. Tide can grant it on the user's behalf.

## Contracts

- New command `provider.trustWorkspace`: `{ threadId: ThreadId }`.

## Flow

1. Readiness shows `directory_trust_required`; the row offers "Trust this folder".
2. User confirms → `provider.trustWorkspace { threadId }`.
3. Service resolves Agent + cwd, calls `ProviderTrustPort.trust({ agentId, cwd })`.
4. Service re-checks Provider Readiness and emits `provider_readiness_changed`.
5. If now ready and a pending Composer input exists, it proceeds as usual.

## Invariants

- Trust is granted only for the Thread's own Execution Context cwd.
- Scratch / non-cwd Threads cannot grant trust (no-op failure).
- Writing trust never removes existing trusted entries or unrelated config.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 Grant trust | BR-1 writes provider trust for the Thread cwd | `trusting_a_workspace_writes_provider_trust_for_the_thread_cwd` |
| UC-1 Grant trust | BR-2 re-checks readiness and reports the new result | `trusting_a_workspace_rechecks_provider_readiness` |
| UC-1 Grant trust | BR-3 a Thread without a cwd cannot be trusted | `trusting_a_workspace_without_a_cwd_fails` |
| UC-2 Desktop row | BR-4 the trust blocker row emits provider.trustWorkspace | `directory_trust_blocker_offers_a_trust_this_folder_action` |

## Implementation Notes

- Contract: `shared/contracts/commands.ts` + envelope passthrough.
- Backend: `ProviderTrustPort` (outward) + `node-provider-trust` adapter writing the
  three stores; `thread-runtime-service.ts` `trustWorkspace()`; inward adapter case.
- Desktop: `agent-chat-shell-state.ts` trust row + `provider.trustWorkspace` command;
  product-shell delegation + handler wiring.

## Location

- `src/shared/contracts/commands.ts`
- `src/backend/application/ports/outbound/provider-trust-port.ts`
- `src/backend/adapters/outbound/provider-trust/node-provider-trust-port.ts`
- `src/backend/application/services/thread-runtime-service.ts`
- `src/desktop/application/domains/agent-chat/agent-chat.ts`
