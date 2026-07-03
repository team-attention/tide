# Spec: Provider Catalog Ownership And Model Selection

## Scope

Separate **selected Thread launch values** from **available provider options**.

The Composer chips show the current selected values for a Thread or Draft Thread:
agent, model, effort, permission, project, branch, and runtime locality. The popovers opened
from those chips show available options. Those are different domains.

This spec fixes the current leak where provider catalog data is mixed into Thread listing,
Desktop module globals, and fallback model vocabulary. It defines a provider-owned catalog
snapshot path that the Model chip / provider picker read directly.

Supersedes these earlier spec decisions:

- `cross-provider-model-catalog-and-hub.md`: `thread.listed` must not gain
  `providerModelCatalogs`.
- `opencode-model-vendor-selection.md`: `thread.listed` must not gain
  `agentModelCatalogs`.
- `provider-cli-setup-handoff.md`: `providerCatalog.changed` may remain as a push event, but
  startup push is not a correctness path.

## Evidence

- `thread.listed` is Thread metadata plus a provider leak. Current contract carries
  `threads` and `availableAgents`; it does not carry catalog data. Provider install state is
  still unrelated to Thread metadata.
- `providerCatalog.changed` is opencode-specific and push-only. `live-backend.ts` emits it
  once from startup `setImmediate`, and after an opencode API-key connect. If the renderer did
  not receive that push, there is no request/snapshot path to recover provider options.
- `agent-vocab.ts` stores provider catalogs in a module-level `Map` and uses
  `cliModelOptionsForAgent()` both for selected model labels and for available model options.
  For opencode, missing catalog becomes a single `"opencode default"` option. That collapses
  "unknown options" into "only default exists", which is false.
- `opencode-model-provider.ts` builds provider rows from `getOpencodeVendors()` plus model
  vendor segments. If both module globals are empty, the menu shows only OpenCode Zen /
  Free default. That matches the observed UI and points at missing catalog state, not a
  missing feature in the selected Thread launch options.
- `opencode-model-catalog.ts` wraps `opencode models` behind a 60s TTL. This avoids repeated
  subprocess spawn, but it also caches failed/empty reads as normal catalog state. Catalog
  failure must be explicit, not converted to an empty option list.
- `ProviderModelCatalogDto` already exists as a useful DTO, but the ownership is wrong:
  current code and specs route catalog state through Thread list / module globals instead of
  a Provider Catalog application slice.

## Decisions

1. **Thread owns selected values only.** Thread summaries, Thread records, and Composer Draft
   state may store the selected `agentId`, selected `model`, selected `reasoning`, and selected
   `permission`. They must not store or transport the provider's available model/vendor list.

2. **Provider Catalog owns available options.** Available agents, available models, opencode
   vendors, opencode environment, and provider-reported current catalog values are app/provider
   state. They live behind Provider Catalog commands/events, not `thread.listed`.

3. **No catalog fallback to fake options.** Missing catalog, loading catalog, and errored catalog
   are first-class states. They must never be represented as `"Default"` being the only model.
   A sentinel like `"opencode default"` is a selected launch value, not evidence that the option
   catalog has one row.

4. **No correctness cache.** The implementation must not add TTL cache or fallback cache to make
   the UI look populated. It may dedupe an in-flight catalog request so two simultaneous calls do
   not spawn the same provider process twice. It must not reuse stale or failed results unless a
   future spec adds an explicit stale state and UI.

5. **Renderer requests a provider catalog snapshot.** Startup push may remain for preloading, but
   the renderer must explicitly request catalog snapshots for the active/new-thread provider and
   when a catalog popover opens. Snapshot response is the correctness path.

6. **Model chip label and Model picker use different inputs.** The chip label uses the selected
   model value from Thread/Composer state, optionally decorated by a ready catalog. The picker
   rows use only Provider Catalog state.

7. **Catalog state is Product Shell state, not module global state.** Remove module-level mutable
   catalog stores from `agent-vocab.ts` / `opencode-onramp.ts` as the source of truth. Product
   Shell owns provider catalog slices and passes the relevant snapshot into view-model builders.

8. **Provider inventory is separate from Thread list.** `availableAgents` should move out of
   `thread.listed` into provider inventory state. During migration, old `availableAgents` may be
   read for backward compatibility, but new code must request provider inventory directly.

## Out Of Scope

- Changing how a selected model is applied to a running provider session.
- Adding a providers hub redesign.
- Adding model costs, context windows, favorites, or search ranking.
- Adding cache policy for provider catalogs. If caching is needed later, it requires a separate
  spec with explicit freshness and stale UI.
- Reworking provider auth flows except where auth state is read as provider inventory/catalog.

## Domain Model

### Thread Selection State

Owned by Thread / Composer:

```ts
interface ThreadLaunchOptionsDto {
  model?: string;
  reasoning?: string;
  permission?: string;
}

interface AgentBindingDto {
  agentId: ProviderCliAgentId;
  runtimeSource: AgentRuntimeSourceDto;
}
```

These values answer: "What will this Thread use if started now?" or "What is this running
Thread configured to use?"

### Provider Inventory

Owned by Provider Catalog / Provider Readiness application state:

```ts
interface ProviderInventoryDto {
  agents: ProviderInventoryAgentDto[];
}

interface ProviderInventoryAgentDto {
  agentId: ProviderCliAgentId;
  installed: boolean;
  readiness?: ProviderReadinessDto;
  environment?: ProviderEnvironmentDto;
}
```

This answers: "Which provider agents are present and ready on this machine?"

### Provider Catalog Snapshot

Owned by Provider Catalog:

```ts
type ProviderCatalogStatusDto = "ready" | "unavailable" | "error";

interface ProviderCatalogSnapshotDto {
  agentId: ProviderCliAgentId;
  status: ProviderCatalogStatusDto;
  scope?: ProviderCatalogScopeDto;
  models: ProviderModelDto[];
  vendors?: OpencodeVendorDto[];
  environment?: OpencodeEnvironmentDto;
  currentModel?: string;
  defaultModel: string;
  error?: {
    code: "not_installed" | "not_authenticated" | "provider_failed" | "timed_out";
    message: string;
    retryable: boolean;
  };
}

interface ProviderCatalogScopeDto {
  cwd?: string;
}
```

Rules:

- `status: "ready"` means `models` is authoritative for this snapshot.
- `status: "unavailable"` means the provider cannot produce options until install/auth/setup
  changes. `models` must be empty.
- `status: "error"` means Tide attempted to read the catalog and failed. `models` must be empty
  unless a future stale-state spec explicitly permits stale data.
- `defaultModel` is a selected-value seed. It is not a fallback model list.
- opencode uses `vendors` and model `vendor` segments. Single-vendor providers omit `vendors`.

## Contracts

Add commands:

```ts
"provider.inventory.get": {};

"provider.catalog.get": {
  agentId: ProviderCliAgentId;
  scope?: ProviderCatalogScopeDto;
};
```

Add or generalize events:

```ts
"providerInventory.changed": ProviderInventoryDto;

"providerCatalog.changed": {
  catalog: ProviderCatalogSnapshotDto;
};
```

Contract rules:

- `thread.listed` must remain Thread metadata. New code must not add provider catalog fields to
  it. Provider install/readiness fields should migrate out of it.
- `provider.catalog.get` returns `command.accepted`, one `providerCatalog.changed` with the
  same `requestId`, and `command.completed` or `contract.error`.
- Startup/background `providerCatalog.changed` events may have no `requestId`, but they are
  opportunistic updates only.
- `agentRuntime.modelCatalogChanged` may remain for provider self-reported live catalog changes,
  but Desktop must fold it into the same Product Shell provider catalog slice. It must not write
  module globals.

## Flow

### App Startup

1. Renderer sends `thread.list` for Thread metadata.
2. Renderer sends `provider.inventory.get` for provider slot availability/readiness summary.
3. Renderer sends `provider.catalog.get` for the active Composer agent, initially the selected
   New Thread agent.
4. Optional backend startup pushes can arrive before or after those requests; reducer folds them
   into the same provider state.

### Opening The Model Chip

1. Chip label renders from selected launch option:
   - selected model value exists: show catalog label if the relevant catalog is ready; otherwise
     show the selected raw value or provider default label.
   - no selected model: show the provider default label.
2. Opening the popover requests `provider.catalog.get` for the selected agent/scope.
3. Picker renders:
   - `loading`: progress row, no fake model rows.
   - `ready`: rows from `catalog.models`.
   - `unavailable`: setup/readiness row.
   - `error`: retry row plus diagnostic message.
4. Selecting a row updates Thread/Composer launch options through existing launch-option paths.

### opencode Provider Picker

1. `provider.catalog.get({agentId:"opencode"})` runs opencode-owned catalog reads:
   - `opencode auth list` for vendors.
   - `opencode models` for models.
   - `opencode --version` for environment.
2. The response is one `ProviderCatalogSnapshotDto`.
3. Provider rows come from `snapshot.vendors` and model vendor segments. If snapshot is not
   ready, no provider rows are fabricated.
4. OpenCode Zen is rendered only when the ready snapshot includes Zen/default data or as a
   selected default affordance, not as a replacement for the whole catalog.

## Invariants

- Thread list never blocks on provider model/vendor enumeration.
- Thread list never transports provider model/vendor options.
- The Model picker never treats missing catalog as "Default is the only option".
- Provider catalog failure is visible as provider catalog failure.
- No provider catalog TTL cache is introduced in this slice.
- No Desktop module global is the source of truth for provider catalog state.
- A selected model may be displayed even when catalog is unavailable, but it must not imply that
  available options are known.
- opencode vendor/model availability comes only from opencode's own catalog reads.

## Tests

### Contract Tests

- `provider.catalog.get` for opencode emits `providerCatalog.changed` with a
  `ProviderCatalogSnapshotDto`, then `command.completed`.
- `thread.listed` contains no provider catalog fields.
- `provider.inventory.get` emits provider inventory independently from `thread.list`.
- `providerCatalog.changed` without `requestId` and with `requestId` fold into the same Desktop
  provider catalog reducer path.

### Backend Tests

- opencode catalog success maps `auth list`, `models`, and `--version` to one ready snapshot.
- opencode `models` failure returns `status:"error"` with a retryable error; it does not return
  a fake default-only model list.
- missing opencode executable returns `status:"unavailable"` and does not throw.
- concurrent `provider.catalog.get` calls for the same agent/scope share one in-flight read, but
  no completed result is cached for later calls.

### Desktop State Tests

- Product Shell stores provider catalogs in `ProductShellState`, not module globals.
- `thread.listed` does not mutate provider catalog state.
- `agentRuntime.modelCatalogChanged` updates the same provider catalog slice.
- New Thread state reset does not erase provider catalog state because catalog is app/provider
  state, not Draft Thread state.

### UI/View-Model Tests

- Chip label with selected `openai/gpt-5.5` and no catalog shows the selected raw value, not a
  default-only menu.
- Model picker with no catalog request completed shows loading/error state, not `"Default"` as
  the only option.
- Ready opencode snapshot with OpenAI models renders OpenAI rows and model rows.
- Error opencode snapshot renders a retry/diagnostic row and no provider/model rows.
- Changing selected model updates launch options only; it does not mutate catalog options.

### Boundary Tests

- `agent-vocab.ts` no longer exports or owns provider catalog mutation APIs.
- opencode model/provider view builders require catalog input; they do not read module globals.
- backend Thread services do not import provider catalog readers.

## Implementation Plan

1. **Contracts**
   - Add `ProviderCatalogSnapshotDto`, `ProviderInventoryDto`, and the two provider commands.
   - Generalize `providerCatalog.changed` payload to carry `catalog`.
   - Keep old opencode-specific fields only as temporary backward-compatible parsing inputs.

2. **Backend Provider Catalog Slice**
   - Create a Provider Catalog service/adapter outside Thread Runtime Service.
   - Move opencode `models`, `auth list`, and environment reads there.
   - Remove TTL result cache from the correctness path. Keep only request in-flight dedupe.

3. **Backend Commands**
   - Route `provider.inventory.get` and `provider.catalog.get` through the contract adapter.
   - Do not touch `thread.list` behavior except removing deprecated provider leakage after
     Desktop migration.

4. **Product Shell State**
   - Add `providerInventory` and `providerCatalogs` slices to `ProductShellState`.
   - Fold requested and pushed catalog events into those slices.
   - Stop using `setOpencodeModelCatalog`, `setOpencodeVendors`, and `setProviderModelCatalog`
     as authoritative state.

5. **View Models**
   - Pass catalog snapshots into model chip and opencode provider picker builders.
   - Split selected-value label helpers from option-list builders.
   - Make loading/error/unavailable states explicit surfaces.

6. **Cleanup**
   - Remove catalog module globals from `agent-vocab.ts` / `opencode-onramp.ts`.
   - Remove stale spec references that put catalog data on `thread.listed`.
   - Keep selected launch option persistence unchanged.

## Completion Condition

On Tide startup with opencode selected:

- `thread.list` can complete before opencode catalog reads.
- The opencode Model chip can show the selected/default value while catalog is loading.
- Opening the Model chip requests provider catalog.
- Once `provider.catalog.get` returns, the picker shows the actual opencode vendors/models.
- If opencode catalog read fails, the picker shows an explicit error/retry state, not a
  one-row Default menu.

No cache or fallback workaround is required for this behavior.

