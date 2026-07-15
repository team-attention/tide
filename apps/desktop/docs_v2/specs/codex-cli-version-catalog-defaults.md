# Spec: Codex CLI Version Catalog Defaults

Status: Draft

## Scope

Prevent Tide from automatically launching Codex with a model that the installed
local Codex CLI cannot run.

This is the Codex-specific implementation slice under
`provider-discovery-resilience.md`.

In scope:

- Reading the resolved Codex executable version.
- Reading the resolved Codex executable model catalog from `codex debug models`.
- Keeping Codex CLI update advisory visible when the CLI is stale.
- Choosing automatic Codex defaults from the local runnable catalog.

Out of this spec:

- Thread Row "Review changes" / Changes pane routing.
- Codex review provider methods.
- Auto-installing or auto-upgrading Codex.
- Entitlement-specific server-side model gating beyond local CLI evidence.

## Evidence

- User screenshot shows a failed Codex turn:
  `The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to
  the latest app or CLI and try again.`
- Local evidence from this machine:
  - `codex --version` is `codex-cli 0.141.0`.
  - `codex debug models` lists `gpt-5.5`, `gpt-5.4`,
    `gpt-5.4-mini`, `gpt-5.3-codex-spark`, and
    `codex-auto-review`.
  - That local catalog does not list `gpt-5.6-sol`, `gpt-5.6-terra`, or
    `gpt-5.6-luna`.
- `src/desktop/application/domains/agent-chat/state/agent-vocab.ts` still uses
  a static latest-Codex catalog and `defaultModelValueForAgent("codex")` returns
  `gpt-5.6-sol`.
- `src/backend/infrastructure/node/provider/provider-detection.ts` mirrors the
  same static Codex catalog and `DEFAULT_PROVIDER_MODEL.codex = "gpt-5.6-sol"`.
- `provider-cli-update-and-codex-model-refresh.md` already decided that local
  installed CLI behavior controls available provider behavior, and stale CLIs
  should surface update advisory rather than pretending new models are runnable.
- `version-management.md` already defines provider CLI installed/latest version
  detection and a non-blocking update advisory path.
- `provider-discovery-resilience.md` defines the cross-provider rule: observed
  provider facts beat static app knowledge, and version is advisory rather than
  a model-support oracle.

## Decisions

1. **Local catalog is the runnable source.** When Codex is installed, Tide must
   prefer model rows from `codex debug models` executed through the resolved
   Codex executable.

2. **Version is diagnostic, not the model source.** Tide records
   `codex --version` and the resolved executable path, but it must not infer
   model support from version thresholds such as `version >= X`.

3. **Version and catalog come from the same executable.** The version shown in
   UI/debug state and the model catalog used for defaults must be produced by
   the same resolved Codex executable path.

4. **Automatic default follows the ready local catalog.** If the local catalog is
   ready and the user has not explicitly selected a different model, the Codex
   default model comes from the local catalog's default. For `codex-cli 0.141.0`
   evidence, that means `gpt-5.5`.

5. **Internal review models are not chat defaults.** Rows such as
   `codex-auto-review` are excluded from normal chat model defaults and normal
   model picker rows until a dedicated review-model surface is specified.

6. **Explicit user choice is preserved.** If the user deliberately selected or
   persisted a custom/unsupported model id, Tide may show update/unavailable
   context, but it must not silently rewrite that explicit value.

7. **Update advisory remains non-blocking.** A stale installed Codex CLI still
   shows `Update Codex`, but the model picker and automatic default should use
   the local runnable catalog so work can continue before updating.

8. **Update refresh re-reads both signals.** After an update terminal completes,
   Tide re-reads both `codex --version` and `codex debug models` before clearing
   stale-version warnings or changing automatic defaults.

9. **No Codex-only global workaround.** The implementation should use the shared
   provider catalog path. Codex may have a provider-specific reader, but Product
   Shell should consume the normalized provider snapshot in the same way it does
   for other agents.

## Out Of Scope

- Tide app self-update behavior.
- Automatically running `npm install -g @openai/codex@latest`.
- Mapping Codex package version to model availability by hard-coded table.
- Showing model prices, account entitlements, or server-side feature flags.
- Reworking Claude or opencode model catalogs.

## Domain Model

### Provider Environment

Provider inventory already has the generic environment shape:

```ts
interface ProviderEnvironmentDto {
  version?: string;
  testedWith?: string;
  executablePath?: string;
}
```

For Codex, provider inventory should include:

- `environment.version` from `codex --version`;
- `environment.executablePath` from the executable resolver;
- existing readiness/update advisory when installed version is older than
  latest-known npm version.

### Codex Catalog Snapshot

Codex uses existing provider catalog contracts:

```ts
interface ProviderCatalogSnapshotDto {
  agentId: "codex";
  status: "ready" | "unavailable" | "error";
  models: ProviderModelDto[];
  environment?: ProviderEnvironmentDto;
  currentModel?: string;
  defaultModel: string;
  error?: ProviderCatalogErrorDto;
}
```

Rules:

- `models` contains normal user-selectable chat models from local
  `debug models`.
- `defaultModel` is a locally runnable chat model id.
- `environment` identifies the executable/version that produced the catalog.
- Static latest catalog rows are fallback/reference only when local catalog
  cannot be read; they must not override a ready local catalog.

### Selected Launch Options

Thread/Composer still owns the selected launch values:

```ts
interface ThreadLaunchOptionsDto {
  model?: string;
  reasoning?: string;
  permission?: string;
}
```

Automatic defaults can adopt the local catalog default. Explicit selections are
preserved.

## Contracts

No new shared contract shape is required.

Existing contracts used:

- `provider.inventory.get`
- `providerInventory.changed`
- `provider.catalog.get`
- `providerCatalog.changed`
- `ProviderEnvironmentDto`
- `ProviderCatalogSnapshotDto`

Contract interpretation:

- `provider.inventory.get` for Codex should include version/executable path when
  readable.
- `provider.catalog.get` for Codex should include a locally runnable catalog
  when `codex debug models` succeeds.
- `providerCatalog.changed.catalog.defaultModel` is the preferred automatic
  Codex default once the user has not explicitly chosen another model.

## Flow

### Startup

1. Renderer requests provider inventory and Codex provider catalog.
2. Backend resolves the Codex executable.
3. Backend reads `codex --version`.
4. Backend reads `codex debug models`.
5. Backend emits provider inventory with environment/update evidence.
6. Backend emits provider catalog with local model rows and local default.
7. Product Shell folds both into provider state.

### Automatic Codex Default

1. New Thread composer starts with an automatic Codex default.
2. A ready local Codex catalog arrives.
3. If the current Codex model is still automatic, Product Shell changes it to
   `catalog.defaultModel`.
4. If the user already changed the model, Product Shell preserves that value.

### Update Completion

1. User runs the existing update terminal action.
2. Terminal completion triggers provider refresh.
3. Backend re-reads installed version and debug model catalog.
4. Update advisory and automatic defaults are recomputed from fresh evidence.

## Invariants

- Ready local Codex catalog beats latest static catalog.
- Version and model catalog evidence are tied to the same executable path.
- Version never determines model rows by itself.
- Automatic Codex defaults must be runnable by the installed CLI when local
  catalog is available.
- Stale Codex CLI warning does not block use of older supported models.
- Explicit model choices are never silently rewritten.
- Internal review-only models are not normal chat defaults.

## Tests

- `codex_provider_catalog_uses_installed_debug_models`: fake `debug models`
  output without GPT-5.6 produces a ready catalog with older local rows and no
  GPT-5.6 rows.
- `codex_provider_catalog_default_excludes_auto_review_model`: a catalog with
  `codex-auto-review` does not choose it as `defaultModel` and excludes it from
  normal chat rows.
- `codex_inventory_and_catalog_share_resolved_executable_version`: fake
  executable path/version evidence is surfaced alongside a catalog built from
  that executable.
- `codex_start_composer_adopts_local_catalog_default_when_automatic`: after
  `providerCatalog.changed` with `defaultModel: "gpt-5.5"`, untouched Codex
  Start Composer stops using `gpt-5.6-sol`.
- `codex_start_composer_preserves_explicit_custom_model`: an explicit selected
  model survives a later local catalog snapshot.
- `codex_stale_cli_shows_update_but_keeps_local_runnable_models`: update
  advisory and local runnable catalog coexist.
- `codex_update_refresh_rereads_version_and_catalog`: after update terminal
  completion, Tide re-reads both `--version` and `debug models` before clearing
  update state or changing automatic defaults.

## Implementation Notes

- Add a small Codex catalog reader under provider detection using structured
  JSON from `codex debug models`.
- Do not scrape text output.
- Filter internal review-only models explicitly until Codex exposes a clearer
  field.
- Avoid broad synchronous startup blocking: use the existing provider catalog
  request path as correctness path.
- The safest first implementation can leave static UI rows in place until local
  catalog arrives, but send/default behavior must prefer local catalog once
  ready.
- Keep this slice aligned with `provider-discovery-resilience.md`; do not add a
  new static Codex release table as the fix.
