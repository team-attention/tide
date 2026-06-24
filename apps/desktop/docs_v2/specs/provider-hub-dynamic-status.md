# Spec: Provider Hub Dynamic Status

## Scope

Settings -> Providers & Models must show the latest provider snapshot Tide can
observe, not only renderer-local static lists. The backend pushes a provider-wide
catalog event with one row for each Provider CLI Agent: installed state, sign-in
state when readable, model catalog source, and model rows.

## Evidence

- `thread.listed.availableAgents` already reports installed Provider CLI Agents.
- `providerCatalog.changed` already pushes opencode's slow dynamic catalog out of
  band so startup is not blocked.
- Codex and Claude auth/readiness state is already read from provider-owned files
  in `provider-state-readers.ts`.
- Codex cannot reliably enumerate models from the CLI; its model ids remain a
  curated static catalog, but installed/authenticated status is dynamic.

## Decisions

- Extend `providerCatalog.changed` with `providers`, an optional provider-wide
  snapshot. Keep existing opencode fields for backward compatibility.
- Each provider snapshot carries `source: "dynamic" | "static"` for its model
  list. opencode uses dynamic catalog data; codex/claude use static curated
  catalogs.
- Settings prefers the latest provider snapshot when present and falls back to
  existing local state when absent.
- Auth status is shown only when Tide can read it. Unknown auth keeps the existing
  "Installed" wording.

## Out Of Scope

- Real model enumeration for Codex or Claude.
- Quota/account scraping outside an active provider runtime.
- Provider login actions beyond existing readiness/on-ramp flows.

## Domain Model

```ts
interface ProviderCatalogAgentDto {
  agentId: ProviderCliAgentId;
  installed: boolean;
  authenticated?: boolean;
  source: "dynamic" | "static";
  models: ProviderModelDto[];
  connectedVendors?: number;
  totalVendors?: number;
  version?: string;
}
```

## Contracts

`providerCatalog.changed` gains:

```ts
providers?: ProviderCatalogAgentDto[];
```

Existing `opencodeModels`, `opencodeVendors`, and `opencodeEnvironment` remain.

## Flow

1. Backend starts and immediately answers `thread.listed` with fast installed
   agent detection.
2. Backend asynchronously builds the provider catalog snapshot.
3. Renderer stores the snapshot in the agent-chat provider catalog cache.
4. Settings renders installed/sign-in/model count from that snapshot.

## Invariants

- The provider catalog event must not block the initial thread list.
- A missing `providers` field preserves legacy behavior.
- Static model catalogs for codex/claude have a single shared source.
- Settings does not fabricate auth state when the backend did not report one.

## Tests

- Provider detection builds codex/claude/opencode snapshots with dynamic
  installed/authenticated status and static/dynamic source labels.
- Settings hub prefers the provider snapshot over fallback availability state.
- Existing opencode catalog behavior remains compatible.

## Implementation Notes

- Put curated codex/claude model rows in shared code so backend and desktop read
  the same static catalog.
- Keep opencode's existing legacy payload fields until the UI no longer needs
  them.
