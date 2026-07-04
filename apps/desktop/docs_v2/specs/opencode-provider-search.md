# Spec: opencode Provider Search

## Scope

Add the missing opencode provider-search flow to the Composer Model Chip.

The existing opencode Model Chip already opens a provider-first composer popover,
but it only shows OpenCode Zen, curated/connected vendors, and provider groups
that already have models. opencode itself has a much larger provider catalog.
Tide must let the user search that provider catalog inside the same Model Chip
flow, select a provider such as `302.AI`, `Abacus`, `Alibaba`, or `Kimi For
Coding`, then connect it through opencode-owned auth paths.

This spec is investigation-only plus implementation contract. It does not
implement the code.

## Evidence

- `apps/desktop/src/desktop/application/domains/agent-chat/state/opencode-model-provider-types.ts`
  currently defines only `provider_list`, `model_list`, `connect_vendor`,
  `vendor_method`, and `api_key`. There is no provider-search step.
- `apps/desktop/src/desktop/application/domains/agent-chat/state/opencode-model-provider.ts`
  builds provider rows from `catalog.vendors` plus model vendor segments. That
  means only curated, connected, or already-usable providers can appear.
- `apps/desktop/src/desktop/adapters/inbound/react-renderer/agent-chat/composer/opencode-model-provider-panel.tsx`
  renders rows, model drilldown, method drilldown, and API-key entry. It has no
  search input for providers.
- `apps/desktop/src/desktop/adapters/inbound/react-renderer/product-shell/handlers/composer-handlers.ts`
  already requests `provider.catalog.get` whenever the Model Chip opens, so the
  correctness path is already in place.
- `apps/desktop/src/shared/contracts/provider-model-catalog.ts` has
  `ProviderCatalogSnapshotDto.models`, `vendors`, and `environment`, but no
  field for opencode's searchable provider catalog.
- `apps/desktop/src/backend/infrastructure/node/provider/opencode-auth-server.ts`
  already starts `opencode serve` and implements `GET /provider/auth` and
  `PUT /auth/{providerID}`, but `listProviderAuth()` is not folded into the
  provider catalog snapshot.
- Local probe against opencode `1.17.13`: `GET /provider` returns
  `{ all, default, connected }`. `all` contained 150 providers, and its first
  rows matched the screenshot-style list: `302.AI`, `Abacus`,
  `abliteration.ai`, `AIHubMix`, `Alibaba`, and `Alibaba (China)`.
- Local probe against opencode `1.17.13`: `GET /provider/auth` returned auth
  methods for 10 special providers (`openai`, `github-copilot`, `xai`,
  `azure`, etc.). It is auth-method metadata, not the full provider list.
- Local probe against opencode `1.17.13`: `GET /provider` reported
  `connected: ["kimi-for-coding", "openai", "opencode"]` while
  `opencode auth list` still showed an expired/ unusable Anthropic OAuth
  credential. This makes `/provider.connected` useful for actual provider
  availability, while `auth list` remains credential-existence evidence.
- Local probe in a temporary `HOME`/`XDG_DATA_HOME`: `PUT /auth/{providerID}`
  with `{ type: "api", key }` succeeded for long-tail providers not present in
  `/provider/auth`, including `abacus`, `alibaba`, `openrouter`, and
  `kimi-for-coding`. It wrote only to the temporary opencode auth store.
- opencode OpenAPI (`GET /doc`) defines:
  - `/provider`: list all available providers and connected provider ids.
  - `/provider/auth`: provider auth methods with `type`, `label`, and optional
    prompts.
  - `/auth/{providerID}`: set auth credentials. `ApiAuth` supports
    `{ type: "api", key, metadata? }`.

## Decisions

1. **Use opencode's server API as the provider-search source.**
   Tide should read `opencode serve` `GET /provider`, not parse
   `~/.cache/opencode/models.json` directly in the correctness path. The cache
   file explains where the data comes from, but `/provider` is the provider-owned
   API surface with the same 150-provider catalog.

2. **Keep provider options separate from connected vendor tiles.**
   `vendors` remains the compact connected/curated status list used by today's
   root surface. Add a separate `providerOptions` catalog field for searchable
   opencode providers.

3. **Fold auth methods into provider options.**
   For each provider option, include auth methods from `/provider/auth` when
   present. Absence of a method list does not mean the provider is unavailable;
   long-tail providers can still be connected through API-key auth.

   `/provider/auth` is metadata, not the source of truth for the provider list.
   If it fails, Tide should keep `/provider` search rows available and simply
   omit method metadata.

4. **Use `/provider.connected` as the primary connected signal for provider
   search rows.** The older `auth list` parser may remain for compatibility and
   method labels, but provider-search rows should prefer `/provider.connected`
   because it excludes at least some credential-exists-but-unusable cases.

5. **Search is local to the popover.**
   The backend returns the provider catalog snapshot. The renderer filters it by
   query over provider label, id, env names, and model count metadata. No new
   backend search command is needed.

6. **The Model Chip owns the everyday flow.**
   In `opencode_model_provider`, selecting the search entry opens a
   `provider_search` step. Selecting a provider from search routes to the same
   provider drilldown rules as a curated provider row:
   - connected and has models: `model_list`
   - connected but needs update/reconnect: `vendor_method`
   - unconnected: `vendor_method`

7. **API-key inline connect is supported for promptless API-key providers.**
   If a provider has no `/provider/auth` methods, the method sheet offers the
   existing inline API-key entry. If a provider has an API method with no prompts,
   inline API-key entry is valid. If the method has prompts, Tide must not pretend
   a single key field is enough.

8. **Prompted auth methods degrade to provider-owned terminal auth for this
   slice.** opencode auth methods can require prompt metadata (for example
   GitHub Enterprise or Azure resource fields). Capturing those prompt forms in
   Tide is out of scope here. For prompted methods, use the existing visible
   provider-readiness terminal path (`opencode auth login -p <provider>`).

9. **Do not send users to a raw "All providers" picker as the primary path.**
   The old `all-providers` terminal handoff can remain as a compatibility escape
   in older `opencode_connect` paths, but the new Model Chip path should expose
   searchable provider rows in Tide.

## Out Of Scope

- Implementing provider-auth prompt forms for metadata-rich API/OAuth methods.
- Replacing the per-thread opencode ACP runtime with `opencode serve`.
- Adding provider cost/context/benchmark columns.
- Refreshing the remote models.dev catalog with `opencode models --refresh`.
- Tide-owned credential storage. Credentials remain in opencode's auth store.
- Reworking Codex or Claude model menus.
- Removing legacy `opencode_connect` compatibility paths.

## Domain Model

New shared opencode provider option:

```ts
interface OpencodeProviderOptionDto {
  id: string;
  label: string;
  source?: "env" | "config" | "custom" | "api";
  env?: string[];
  modelCount: number;
  connected: boolean;
  authMethods?: OpencodeProviderAuthMethodDto[];
}

interface OpencodeProviderAuthMethodDto {
  type: "oauth" | "api";
  label: string;
  promptCount?: number;
}
```

Desktop view state extends the existing opencode model/provider flow:

```ts
type OpencodeModelProviderStep =
  | "provider_list"
  | "provider_search"
  | "model_list"
  | "connect_vendor"
  | "vendor_method"
  | "api_key";
```

The search query is React-local component state, not global Product Shell state.
The selected provider id remains in `AgentChatOpencodeModelProviderFlowState`.

## Contracts

Extend `ProviderCatalogSnapshotDto`:

```ts
interface ProviderCatalogSnapshotDto {
  // existing fields...
  providerOptions?: OpencodeProviderOptionDto[];
}
```

Rules:

- Only opencode currently populates `providerOptions`.
- `provider.catalog.get({ agentId: "opencode" })` returns `providerOptions`
  from `GET /provider`.
- Existing `vendors` remains valid and should not be overloaded as the searchable
  150-provider catalog.
- Existing `provider.opencodeConnectApiKey` remains valid for promptless
  `{ type: "api", key }` writes through `/auth/{providerID}`.
- No new shared command is required for provider search.

## Flow

### Catalog Snapshot

1. Desktop requests `provider.catalog.get` for opencode on startup, agent change,
   cwd change, and Model Chip open.
2. Backend starts or reuses the opencode auth server singleton.
3. Backend reads:
   - `GET /provider` for `all` provider options and `connected` provider ids.
   - `GET /provider/auth` for provider auth method metadata.
   - existing `opencode models` for currently usable model rows.
   - existing opencode environment/version.
4. Backend emits one `providerCatalog.changed` snapshot.
   If provider-search metadata cannot be read, the opencode catalog should still
   remain usable with an empty `providerOptions` fallback rather than turning the
   existing model/vendor catalog into an error.

### Composer Provider Search

1. User opens opencode Model Chip.
2. Root `provider_list` shows current/root provider rows plus a compact
   `Search providers` row.
3. User selects `Search providers`.
4. Popover enters `provider_search` and renders an input plus filtered provider
   rows from `providerOptions`.
5. Query filters by label, id, and env names.
6. Selecting a provider:
   - if provider has usable models, opens `model_list`;
   - otherwise opens `vendor_method`.
7. Back returns from `provider_search` to `provider_list`.

### Connect From Search

1. In `vendor_method`, rows are derived from auth metadata:
   - OAuth method with no extra form in Tide: terminal/browser auth path.
   - API method with no prompts: inline API-key entry.
   - Any method with prompts: terminal auth path for this slice.
   - No method metadata: inline API-key entry using `/auth/{providerID}`.
2. Inline API-key submit dispatches `provider.opencodeConnectApiKey`.
3. Backend saves the credential through `PUT /auth/{providerID}`, invalidates
   opencode catalog reads, and emits a refreshed `providerCatalog.changed`.
4. The provider search row becomes connected, and the provider's model rows
   become available once opencode reports them.

## Invariants

- The opencode Model Chip never requires the user to leave Tide just to find a
  provider by name.
- Searchable provider rows come from opencode, not a Tide-curated static list.
- `vendors` and `providerOptions` are distinct: status tiles are not the full
  search catalog.
- A provider absent from `/provider/auth` can still be connected by API key.
- A method with required prompts is not represented as a simple key field.
- API keys never enter Product Shell state, Thread state, logs, or shared
  contracts beyond the existing one-shot command payload.
- Provider auth completion refreshes the provider catalog without app restart.
- Codex and Claude model menus are unchanged.

## Tests

Backend:

- `parseOpencodeProviderOptions` maps `/provider` `{ all, connected }` into
  provider options with id, label, env, model count, and connected state.
- Auth method merge attaches `/provider/auth` methods to matching provider
  options and leaves long-tail providers connectable when absent.
- `/provider/auth` failure does not prevent `/provider` rows from being returned
  by the opencode server catalog reader.
- `provider.catalog.get` for opencode includes `providerOptions` in the snapshot.
- `PUT /auth/{providerID}` remains usable for arbitrary provider ids in tests
  using a fake/local opencode server.

Contracts/Product Shell:

- `ProviderCatalogSnapshotDto.providerOptions` round-trips through
  `providerCatalog.changed`.
- Product Shell reducer stores `providerOptions` inside `providerCatalogs`
  without mutating Thread list state.

Agent Chat State:

- Opening `opencode_model_provider` renders a `Search providers` row.
- Selecting `Search providers` enters `provider_search`.
- Back from `provider_search` returns to `provider_list`.
- Selecting an unconnected search result opens `vendor_method`.
- Selecting a connected search result with models opens `model_list`.
- Selecting a promptless API method opens `api_key`.
- Selecting a prompted auth method dispatches the readiness terminal auth command.

Renderer:

- Provider search input filters by label (`Alibaba`), id (`alibaba-cn`), and env
  (`DASHSCOPE_API_KEY`).
- Rows stay inside the 384px chip popover and retain existing row rhythm.
- The API-key draft remains local React state.

Regression:

- Existing opencode provider-list/model-list tests still pass.
- Codex and Claude keep the compact `model_menu`.

## Implementation Notes

- Prefer extending the existing `OpencodeAuthServer` into a broader
  opencode-server catalog reader instead of spawning another server singleton.
- Keep direct `models.json` parsing out of the correctness path. It can remain a
  diagnostic fallback only if a later spec defines stale/offline catalog UI.
- Add pure parser/mapper helpers around raw `/provider` and `/provider/auth`
  shapes so contract tests do not need a real opencode server.
- The first implementation can cap rendered search results to a reasonable
  number after filtering, but the source catalog should retain all provider
  options in Product Shell state.
