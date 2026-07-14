# Spec: Cross-Provider Model Catalog & Providers Hub (P2)

## Scope

Make **model + effort selection accurate and coherent across all four providers**, behind one
catalog contract, and give it a home: a **Providers & Models** surface in Settings.

This is P2 of the model-integration arc (P1 = `opencode-model-vendor-selection.md`). It is
designed **before** P1 ships so P1's catalog contract + Full-browser component are built as the
**general** ones and gemini/claude/codex slot in with no rework. P3 (first-run onboarding)
stays minimal (the "Not installed" chip from P1); not covered here.

Two deliverables:
1. **Unified model catalog** — one `ProviderModelCatalog` shape for every provider, populated
   *dynamically* where the provider self-reports (gemini ACP, opencode ACP) and *statically*
   where it cannot (claude, codex). Fixes today's silent drift.
2. **Providers & Models hub** — a Settings surface listing every provider with install/auth
   status, its model browser (the reused Full browser), default-model pick, and an auth action
   (reused Provider Setup Surface).

## Evidence

Grounded in the integrations + live ACP probes (opencode 1.17.1, gemini 0.46-class).

- **Per-provider runtime mechanism (model / effort / enumeration):**

  | provider | model at start | effort | live model change | **enumerates?** |
  |----------|----------------|--------|-------------------|-----------------|
  | claude   | `--model` argv (sentinel "Claude default"→none) | `--effort` argv | `set_model` control_req (live); effort/sentinel → restart | ❌ |
  | codex    | `thread/start` model; free-form `-c model_reasoning_effort` | `turn/start` effort | `turn/start` override (live) | ❌ (free-form `--model`) |
  | gemini   | `--model` argv (restart) | none | restart (`--model`+`session/load`) | ✅ **ACP `session/new.models`** |
  | opencode | ACP configOptions | per-model variants (live) | `set_config_option` (live) | ✅ ACP configOptions + `opencode models` |

- **gemini self-reports models over ACP and we ignore it (live-probed):**
  `session/new.models = { availableModels:[{modelId,name,description}], currentModelId }` →
  `auto, gemini-3-pro-preview, gemini-3-flash-preview, gemini-2.5-pro, gemini-2.5-flash,
  gemini-3.1-flash-lite`, current `gemini-3-flash-preview`. `acp-client.adoptSession` reads
  only `sessionId`. (Same blind spot opencode's `configOptions` has — fixed by P1.)
- **Drift is real today.** `agent-vocab.cliModelOptionsForAgent("gemini")` returns
  `Gemini default / gemini-3-pro / gemini-3-flash` — **wrong ids** (real ones carry `-preview`)
  and **missing** the 2.5 models + `auto`. A user picking "gemini-3-pro" sends an id gemini does
  not list. claude/codex lists are likewise hand-maintained (e.g. memory: "Fable 5 just added").
- **The apply path is already unified.** `AgentIntegrationPort.buildSessionConfigUpdate` →
  `AgentRuntimePort.applySessionConfig` → `StructuredRuntimeClient.applyConfig`
  (`mid-thread-launch-option-changes.md`) routes a model/effort/permission change to each
  provider's live-or-restart mechanism. **P2 adds no runtime plumbing** — only a catalog
  contract + a UI.
- **gemini permission modes are accurate** (default/autoEdit/yolo/plan, live-probed) — unlike
  opencode's (build/plan only, fixed by P1). So permission shape is already per-provider data
  (`AGENT_DESCRIPTORS[].permission`); the hub reads it, no new model.
- Provider install/auth status already exists as **Provider Readiness** blockers + the
  **Provider Setup Surface** (`provider-setup-surface-workbench-command.md`) — the hub reuses
  both; it does not invent auth.
- Settings today (`settings.tsx`) is renderer-local prefs only (theme/list/worktree/last
  composer); no provider/model surface — the hub is a new section.

## Decisions

1. **One catalog contract for all providers** — `ProviderModelCatalogDto` (below).
   `source: "dynamic" | "static"`. Dynamic = provider-reported (gemini ACP `models`, opencode
   `configOptions`/`opencode models`); static = Tide-curated (claude, codex). The desktop renders
   the same way regardless of source.
2. **P1's opencode catalog IS this contract.** `opencode-model-vendor-selection.md`'s
   `AgentModelCatalogDto`/`AgentConfigOptionDto` are renamed/shaped to the general
   `ProviderModelCatalogDto` here; the Full browser renders any provider's catalog (vendor
   grouping shown only when a model carries a `vendor`). No opencode-specific UI.
3. **Consume gemini ACP `models` now (accuracy win).** `acp-client.adoptSession` emits the
   reported `availableModels` + `currentModelId` as the gemini catalog. The **menu becomes
   accurate immediately**. gemini model *switching* also upgrades to **live** — `session/set_model`
   is confirmed (live-probed `{}`), so `applyConfig` sends it alongside `set_mode` and gemini's
   model change stops restarting. (Permission was already live via `set_mode`.)
4. **claude/codex stay static but behind the contract**, and are *verifiable*: Codex can be
   checked against `codex debug models`; Claude is checked against the installed `claude --help`
   aliases/full-name examples plus Claude Code/model overview docs until a real enumeration path
   exists. codex keeps its "Custom model id…" escape.
5. **Effort is per-model catalog data**, not a fixed Tide list:
   `models[].effortOptions?: string[]`. opencode = reported variants (dynamic); codex =
   `[low,medium,high,xhigh]`; claude = `[low,medium,high,xhigh,max]`; gemini = none. The effort
   chip renders from this; apply routes through the existing per-provider mechanism.
6. **Providers & Models hub lives in Settings** as a new section. Per provider: status chip
   (Installed / Signed in / Not installed / Not signed in) from Provider Readiness; the model
   browser; a **default model** pick (persisted, seeds new threads — also fixes opencode's bad
   `big-pickle` default); an **auth/setup** button → existing Provider Setup Surface. The composer
   model chip stays for quick switching and links to the hub ("Manage models…").
7. **Default-model policy.** Each provider gets a Tide-resolved default: claude/codex/gemini keep
   their sentinel ("provider default"); opencode picks the first authed non-free model (not
   `big-pickle`). User override persists per provider.

## Out Of Scope

- Real enumeration for claude/codex (impossible) — they stay curated.
- Authenticating providers from scratch beyond launching the existing Setup Surface; no
  generic in-app API-key vault.
- Live gemini model switching (stays restart) and any new live mechanism — apply path unchanged.
- First-run onboarding beyond P1's "Not installed" chip.
- A models.dev-style cost/context column in the hub (nice-to-have; later).

## Domain Model

```ts
// shared/contracts — generalizes P1's opencode DTO to every provider.
interface ProviderModelDto {
  value: string;            // provider-native model id (claude --model, gemini modelId,
                            //   codex free-form, opencode "provider/model"); or a sentinel.
  label: string;
  vendor?: string;          // only opencode populates this (→ vendor grouping in the browser)
  effortOptions?: string[]; // present iff this model exposes effort; values are provider-native
  detail?: string;          // "Legacy", "free", context note, …
}
interface ProviderModelCatalogDto {
  agentId: ProviderCliAgentId;
  source: "dynamic" | "static";
  models: ProviderModelDto[];
  currentModel?: string;    // provider-reported (gemini currentModelId / opencode currentValue)
  defaultModel: string;     // Tide-resolved default (sentinel or concrete)
}
```

- Dynamic catalogs ride a session/runtime event (gemini/opencode adopt → emit catalog);
  static catalogs ride `thread.listed` (claude/codex/opencode-compose-time, enumerated/ curated
  at detection). Both fill the same desktop `setProviderModelCatalog(agentId, catalog)` store.
- `ProviderModelCatalogPort` (optional per integration): `produceStaticCatalog?()` for
  claude/codex; dynamic providers emit via the runtime client instead.
- Hub state is renderer-local prefs (`tide.defaultModels` per agentId) + the live readiness +
  catalogs already in the store. No new backend persistence beyond what P1 adds.

## Contracts

- `thread.listed` gains `providerModelCatalogs?: ProviderModelCatalogDto[]` (generalizes P1's
  `agentModelCatalogs`; static + compose-time catalogs). Backward compatible.
- A runtime/session event carries `modelCatalog?: ProviderModelCatalogDto` so gemini/opencode
  refresh their catalog live (current model + available list).
- No new command: model/default changes reuse `thread.setLaunchOptions`; the hub's default-model
  pick is a renderer pref that seeds the Start Composer (like `preferredStartComposer`).

## Flow

1. **Detection** → backend emits static/compose catalogs (claude/codex curated, opencode
   `opencode models`) on `thread.listed`. Desktop stores per agent.
2. **Session adopt** (gemini/opencode) → `acp-client` emits `modelCatalog` from the ACP
   `models`/`configOptions`; the chip + hub reflect the real current model and full list.
3. **Composer model chip** → renders that agent's catalog via the **Full browser**
   (vendor-grouped only when models carry `vendor`; effort sub-rows only when `effortOptions`).
   Selection → `thread.setLaunchOptions` (existing live/restart apply).
4. **Settings → Providers & Models** → lists all four: status (readiness), model browser,
   default-model pick (persists, seeds new threads), auth button (Setup Surface). The composer
   chip links here.

## Invariants

- Every provider's model menu is rendered from a `ProviderModelCatalogDto`; no component reads a
  hardcoded per-provider model list.
- A dynamic provider's menu equals what it reports (gemini `availableModels`, opencode
  `configOptions`); a wrong/stale id can't be offered.
- The current-model chip reflects the provider-reported `currentModel` once a session exists.
- Effort options shown for a model are exactly that model's `effortOptions`; absent ⇒ no effort
  chip.
- The hub never fabricates auth/install — status and actions come from Provider Readiness /
  Setup Surface.
- claude/codex remain selectable offline (static catalog needs no session).

## Tests

- contract: `ProviderModelCatalogDto` round-trips on `thread.listed` + session event; absent
  tolerated; P1's opencode catalog validates as the general shape.
- acp client: gemini `adoptSession` emits a catalog from `models.availableModels` +
  `currentModelId`; opencode from `configOptions`; gemini path unaffected by opencode logic.
- agent-vocab: `cliModelOptionsForAgent` for every agent derives from the stored catalog; no
  hardcoded list remains; gemini list reflects injected catalog (proves drift fixed).
- Full browser: renders a vendor-grouped catalog (opencode) and a flat catalog (gemini/claude)
  from the same component; effort sub-rows appear per `effortOptions`.
- hub: lists four providers with readiness-derived status; default-model pick persists + seeds
  Start Composer; auth button emits the Setup Surface workbench command.
- boundary: no module imports a static model array except the curated claude/codex catalog
  source.

## Implementation Notes

- Sequencing: P1 builds the general contract + Full browser (opencode as first dynamic
  consumer). P2 then = (a) gemini catalog from ACP `models` (small acp-client add, mirrors the
  opencode configOptions path), (b) claude/codex curated catalogs behind the contract, (c) the
  Settings hub. Each ships independently.
- gemini `models` shape is ACP-standard (`availableModels/currentModelId`); opencode's is its
  `configOptions` extension — the acp-client already must branch on which a session advertises
  (P1 note), so emitting a unified catalog from either is localized there.
- Keep the curated claude/codex lists in ONE module (the static catalog source) so drift has a
  single owner; annotate each with a "verify against `claude`/`codex` —version" reminder.
- The hub reuses: Full browser (model rows), Provider Readiness (status), Setup Surface (auth),
  `preferredStartComposer`-style persistence (defaults). Net-new UI is the section shell + status
  chips + default pick.

## Open Questions

- **Live gemini model switch — RESOLVED (yes).** Live-probed 2026-06-14:
  `session/set_model {modelId:"gemini-2.5-pro"} → {}`. So gemini model change upgrades from
  restart to live — a small `acp-client.applyConfig` add (send `session/set_model` alongside the
  existing `session/set_mode`), and gemini's `buildSessionConfigUpdate` returns `{kind:"live",
  protocolParams:{modelId}}` for a model change instead of `{kind:"restart"}`. Folded into
  decision 3.
- **claude/codex accuracy.** Codex drift can be detected from `codex debug models`. Claude still
  lacks a non-interactive list command in the installed CLI, so the maintained list should be
  reviewed against `claude --help`, Claude Code model configuration docs, and the provider app
  model picker when changed.
- **codex `auto` / aliases.** gemini exposes an `auto` model; codex/claude have implicit
  defaults. Represent "auto/default" uniformly as a sentinel `ProviderModelDto` across providers.
