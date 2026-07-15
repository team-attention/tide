# Spec: Provider Discovery Resilience

Status: Draft

## Scope

Make Tide resilient to provider CLI changes without hand-updating the app every
time a coding agent adds, renames, hides, or removes models/capabilities.

This spec governs all provider CLI agents: Codex, Claude, and opencode.

In scope:

- Provider model/capability discovery policy.
- Runtime launch guardrails for provider-specific options.
- Provenance for provider facts: executable, version, command/protocol source,
  observed time, and error state.
- Static fallback limits.

Out of scope:

- Implementing a full Providers & Models settings hub.
- Automatically updating provider CLIs.
- Predicting account/entitlement behavior that the local provider CLI does not
  report.

## Problem

Tide currently depends too much on hand-maintained provider facts. That creates
three fragile failure modes:

- A provider ships a new default model, and Tide keeps sending an old explicit
  model.
- Tide adds a latest model row, but the user's installed CLI cannot run it.
- A provider changes catalog/capability shape, and Tide silently falls back to a
  fake or stale option list.

The root issue is not one Codex model id. The issue is treating provider specs
as static app knowledge instead of observed runtime evidence.

## Evidence

- Local Codex evidence: `codex-cli 0.141.0` does not list GPT-5.6 models in
  `codex debug models`, but Tide static defaults can still send `gpt-5.6-sol`.
- `provider-catalog-ownership-and-model-selection.md` already separates selected
  Thread launch values from available provider options.
- `agent-vendor-model-selection.md` says opencode/gemini-style providers can
  report models dynamically, while Claude/Codex have historically used curated
  lists.
- `version-management.md` already models installed/latest provider CLI versions
  as advisory evidence.
- `provider-cli-update-and-codex-model-refresh.md` shows why latest static rows
  are insufficient: a current Tide build can run against stale provider CLIs.

## Decisions

1. **Observed provider facts beat app knowledge.** If a provider can report a
   model list, command list, permission modes, config options, or capabilities,
   Tide must use that observed data as the source of truth.

2. **Static catalogs are hints, not proof.** Static provider rows may help labels,
   documentation, legacy display, or custom input examples. They must not prove a
   model is runnable and must not seed an automatic explicit launch model when
   dynamic/local evidence is absent or contradicts them.

3. **Provider default is safer than stale explicit default.** When Tide cannot
   prove a local explicit model is runnable, automatic defaults should prefer the
   provider-native default/sentinel path where the provider supports it. Tide
   should avoid inventing an explicit latest model id as the automatic default.

4. **Every provider fact has provenance.** A catalog/capability snapshot should
   carry enough evidence to explain where it came from:
   executable path, installed version when known, source command/protocol,
   observed time, source kind, and error state.

5. **Version is advisory.** Installed/latest versions explain stale behavior and
   drive update nudges. They do not determine model support by threshold tables.

6. **Launch validation is explicit.** Before Tide sends an automatic selected
   model, it must be one of:
   - provider default/sentinel;
   - present in the current ready provider catalog;
   - a user-explicit custom value.

7. **Unknown is a state, not a fake default.** Missing/loading/error catalog
   states must remain visible as unknown/loading/error. They must not collapse to
   a one-row fake model menu that looks authoritative.

8. **Provider adapters own provider quirks.** Each provider integration owns how
   to discover facts from its CLI/protocol. Shared Product Shell code consumes
   normalized provider snapshots and should not encode provider-specific model
   release timelines.

9. **Provider change handling is testable without a live release.** Parser tests
   use fixtures for current, old, empty, malformed, and future-shaped provider
   outputs. Runtime UI tests assert graceful unknown/error behavior, not just
   happy-path rows.

## Domain Model

### Provider Fact Snapshot

Provider facts should be represented as observed data:

```ts
interface ProviderFactProvenanceDto {
  sourceKind: "provider_reported" | "local_cli" | "static_fallback";
  executablePath?: string;
  installedVersion?: string;
  sourceCommand?: string;
  protocol?: "codex_app_server" | "claude_stream_json" | "acp" | "cli";
  observedAt: string;
}
```

`ProviderCatalogSnapshotDto` can carry this provenance directly or through its
existing `environment` plus a follow-up provenance field. Until the contract is
extended, the minimum required evidence is:

- `environment.executablePath`
- `environment.version`
- `status`
- `error`

### Catalog Status

Catalog status must distinguish:

- `ready`: provider facts were read successfully.
- `unavailable`: provider is not installed/authenticated/usable.
- `error`: Tide tried to read provider facts and failed.
- future `loading` or stale state only if a separate UI spec defines it.

### Selected Model State

Selected launch values remain separate from available options:

```ts
interface ThreadLaunchOptionsDto {
  model?: string;
  reasoning?: string;
  permission?: string;
}
```

The selected model additionally has an implicit source:

- automatic provider default;
- automatic catalog default;
- user-selected catalog row;
- user-entered custom value.

That source can be stored explicitly later. Until then, reducers must avoid
overwriting values after user interaction.

## Contracts

Existing contracts remain valid:

- `provider.inventory.get`
- `providerInventory.changed`
- `provider.catalog.get`
- `providerCatalog.changed`
- `agentRuntime.modelCatalogChanged`

Future contract extension candidates:

```ts
interface ProviderCatalogSnapshotDto {
  provenance?: ProviderFactProvenanceDto;
}

interface ProviderModelDto {
  source?: "provider_reported" | "local_cli" | "static_fallback" | "custom";
}
```

No implementation should block on these extensions if existing
`environment/status/error` fields can carry the necessary safety behavior.

## Flow

### Provider Catalog Read

1. Product Shell requests provider inventory/catalog for the selected agent.
2. Backend resolves the provider executable.
3. Provider adapter reads version/environment.
4. Provider adapter reads model/capability facts through the provider-native
   command or protocol.
5. Backend emits a normalized provider snapshot with status, rows, default, and
   provenance.
6. Product Shell renders picker rows from the snapshot, not module globals.

### Automatic Model Selection

1. Composer starts with provider default/sentinel or previous user preference.
2. Ready provider catalog arrives.
3. If selection is still automatic and catalog provides a local default, Tide may
   adopt it.
4. If user changed selection, Tide preserves it.
5. If catalog is unavailable/error, Tide avoids switching to a latest static
   explicit model.

### Send Guard

1. User sends a composer message.
2. Before building provider launch options, Tide classifies the selected model:
   provider default, catalog row, or explicit custom.
3. Automatic unsupported values are replaced by provider default or local catalog
   default.
4. Explicit custom values are sent only because the user chose them.
5. If the provider rejects the value, the error should mention the local version
   and current catalog provenance when available.

## Invariants

- No automatic launch uses a static latest model id when local provider evidence
  contradicts it.
- Static provider rows never mask a failed provider catalog read.
- Version does not imply model availability.
- Provider default/sentinel is preferred over stale explicit defaults.
- User-explicit custom selections are preserved.
- UI can explain where model rows came from.
- Provider parsers tolerate extra future fields and fail closed on missing
  required fields.

## Tests

- `provider_catalog_static_rows_do_not_override_ready_dynamic_catalog`
- `provider_catalog_error_does_not_render_fake_default_only_menu`
- `automatic_model_selection_prefers_provider_default_when_catalog_unknown`
- `send_guard_replaces_automatic_unsupported_model_with_local_default`
- `send_guard_preserves_user_explicit_custom_model`
- `provider_catalog_provenance_includes_executable_version_and_source`
- `provider_catalog_parser_tolerates_future_fields`
- `provider_catalog_parser_fails_closed_on_malformed_required_fields`

## Implementation Notes

- Start with Codex because it has the live regression, but implement through the
  general provider catalog path.
- Avoid a new provider-specific global model table in Desktop.
- Use provider-native structured outputs where possible:
  - Codex: `codex debug models`.
  - opencode: ACP config options / `opencode models`.
  - Claude: provider default plus any provider-reported model/control support
    available; curated rows are hints until Claude exposes a reliable catalog.
- Prefer explicit UI states over silent fallback.
