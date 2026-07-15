# Spec: Provider Catalog Last-Known Snapshot

## Scope

Restore the latest successful provider model catalog before the Renderer makes
its first catalog request. The restored snapshot makes the Start Composer's
Model menu useful immediately after an app relaunch; the normal provider
request remains the source of current truth and refreshes that snapshot in the
background.

## Evidence

- The Start Composer opens with no `providerCatalogs` entries on every app
  launch, so Codex falls back to the short static `CODEX_MODELS` list. That
  list intentionally omits account-specific models such as GPT-5.6-Sol.
- Codex CLI's `debug models` reports the locally selectable Sol, Terra, and
  Luna rows, but the renderer only receives those after a provider catalog
  request completes.
- Main already injects a small Main-owned UI-preference snapshot synchronously
  into the Renderer before first paint. This is the established zero-I/O boot
  path for renderer-local persisted state.

## Decisions

1. The cache stores the latest **ready, non-empty** catalog for each provider
   agent. It never stores unavailable, error, empty, or partial results.
2. A cache entry is keyed by agent id, not Thread, Project, or Scratch scope.
   Current model catalogs are provider-owned and scope does not alter their
   enumeration; the persisted scope is omitted to avoid presenting an old cwd
   as the active context.
3. The Renderer reads the cache synchronously during Product Shell creation and
   seeds `providerCatalogs` with it. The normal startup
   `provider.catalog.get` request still runs immediately and replaces the
   seeded entry when it returns a ready snapshot. A failed, unavailable, or
   empty live response does not replace the last successful option list.
4. The cache is a last-known UI snapshot, not a launch authorization or a
   backend correctness cache. A model remains provider-validated when a Thread
   starts; a cache read never changes selected launch values.
5. Corrupt, unknown, or outdated cache data is ignored. Persistence is
   best-effort and a write failure must not affect the live catalog path.

## Out Of Scope

- Caching failed or unavailable provider responses.
- Introducing a backend catalog TTL or altering provider catalog subprocess
  behavior.
- Showing cache age, offline state, or a manual catalog-refresh control.

## Domain Model

```ts
interface PersistedProviderCatalogsV1 {
  schema: 1;
  catalogs: Record<ProviderCliAgentId, ProviderCatalogSnapshot>;
}
```

Each stored snapshot contains only the existing serializable catalog fields and
is accepted only when it parses as `status: "ready"` with at least one model.

## Flow

```text
successful runtime catalog
  -> Product Shell providerCatalogs
  -> persist ready non-empty per-agent snapshot

next app launch
  -> synchronous UI-pref read
  -> Product Shell providerCatalogs seed
  -> Model menu renders last-known rows
  -> background provider.catalog.get
  -> live ready catalog replaces seed and persists
```

## Invariants

- Thread state and `thread.listed` never contain model catalog rows.
- Scratch and Project selection do not decide whether a cached agent catalog is
  available.
- Only a successful catalog replaces the persisted snapshot.
- A failed live refresh does not replace an in-memory last-known ready catalog.
- A cached catalog never suppresses the startup live-catalog request.

## Tests

- A ready Codex snapshot containing Sol persists and reloads into the next
  Product Shell state.
- Error, unavailable, empty, malformed, and unknown-agent snapshots are not
  restored or persisted.
- A runtime ready event replaces the restored catalog and persists the newer
  result.
- The startup Product Shell is seeded from the cached catalog without adding
  catalog data to `thread.listed`.

## Implementation Notes

- Keep parsing/persistence in the React Renderer adapter alongside the existing
  Main-owned UI-preference adapter.
- Keep `ProductShellState` pure: accept an optional catalog seed through
  `createProductShellState` rather than reading browser globals in state code.
