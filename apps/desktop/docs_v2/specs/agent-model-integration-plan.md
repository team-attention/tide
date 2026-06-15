# Implementation Plan: Agent · Vendor · Model · Auth Integration

Execution roadmap for the design in `agent-vendor-model-selection.md` (capstone) +
`opencode-model-vendor-selection.md` (P1) + `cross-provider-model-catalog-and-hub.md` (P2).
All four providers, ACP-aligned, catalog-driven, with accurate first-connection wrapping.

## Ground rules

- Work in a **git worktree** (the running Tide app auto-commits `main`).
- Each phase is independently shippable. Tests precede code per slice.
- One shared contract (`ProviderModelCatalogDto`) renders every provider; **no component
  keeps a hardcoded per-agent model list** (enforced by a boundary test).
- Onboarding stays **minimal** (a "Not installed" chip); no welcome/installer/zero-install.

## Auth reality (sets Phase 3 scope honestly)

Auth cannot be *uniformly* "fully in-app" — it is a spectrum, wrapped to the max accurate
extent per provider; OAuth handshakes are **driven, never reimplemented**:

| provider | API-key path | OAuth/subscription path | status |
|----------|--------------|-------------------------|--------|
| codex | **fully in-app** — key field → `codex login --with-api-key` (stdin) | launch `codex login` (browser), detect | read `~/.codex/auth.json` |
| opencode | vendor pre-selected in-app (`auth login -p <vendor> -m <method>`), **key entered in Setup Surface terminal** | launch same, browser | read `~/.local/share/opencode/auth.json` (`connected`) |
| claude | key via `ANTHROPIC_API_KEY` (env/field) | launch `claude` login (browser), detect | read `~/.claude.json` (`oauthAccount`) |
| gemini | key via `GEMINI_API_KEY` (env/field) | launch `gemini` (Google OAuth), detect | read `~/.gemini/oauth_creds.json` |

Vendor + model + effort selection, by contrast, is **100% in-app** for all four (proven).

## Contracts (the shared foundation)

```ts
// src/shared/contracts
interface ProviderModelDto {
  value: string;            // native id: claude --model / gemini modelId / codex free-form /
                            //   opencode "provider/model"; or a "provider default" sentinel
  label: string;
  vendor?: string;          // only opencode → vendor grouping
  effortOptions?: string[]; // present iff the model exposes effort (provider-native values)
  detail?: string;          // "Legacy" / "free" / cost / context
}
interface ProviderModelCatalogDto {
  agentId: ProviderCliAgentId;
  source: "dynamic" | "static";
  models: ProviderModelDto[];
  currentModel?: string;    // provider-reported (gemini currentModelId / opencode currentValue)
  defaultModel: string;     // Tide-resolved
}
interface AgentConfigOptionDto { id: string; category: string; currentValue: string; options: { value: string; name?: string }[]; }
```
- `thread.listed` gains `providerModelCatalogs?: ProviderModelCatalogDto[]` (static/compose).
- A session/runtime event gains `modelCatalog?: ProviderModelCatalogDto` (dynamic refresh).

## Phase 0 — De-risk (live, first)

- **0.1** One real opencode turn: `session/new` → `set_config_option(model, effort)` →
  `session/prompt` → assert the answer comes from the chosen model/effort. Confirms the one
  unproven assumption before any UI. (1 credit.)

## Phase 1 — Foundation + opencode (proves the general contract)

- **1.1** Contracts above + round-trip tests; boundary test scaffold.
- **1.2** opencode catalog producer (backend): `opencode models --verbose` (+cost) +
  `opencode agent list` + `opencode auth list` (`connected`) + `opencode.json` default →
  `ProviderModelCatalogDto`; cached per detection. Unit tests with a fake exec.
- **1.3** opencode integration: `buildStartPlan`/`buildSessionConfigUpdate` carry chosen
  model/effort/mode as `protocolParams.configOptions`; descriptor permission → Build/Plan;
  emit catalog at detection. Honor config default explicitly (set it; #4001). Tests.
- **1.4** acp-client (opencode path): `adoptSession` applies model→effort→mode via
  `set_config_option` before the first `session/prompt`; `applyConfig` sends per change (live);
  emit returned `configOptions` as `modelCatalog`; `pendingConfigOptions` stash. Tests.
- **1.5** desktop state/vocab: catalog-driven `cliModelOptionsForAgent("opencode")`;
  `setProviderModelCatalog`; **un-gate opencode** (drop `COMING_SOON`); **"Not installed"**
  chip label. Tests.
- **1.6** Full model browser UI: searchable, vendor-grouped, **recently-used** (from Tide
  thread history) + **favorites** (Tide pref), conditional effort sub-rows, Build/Plan. Reusable
  component. Component tests.
- **1.7** Live verify: real opencode turn picking a non-default vendor/model/effort end-to-end.

## Phase 2 — Generalize to gemini / claude / codex (+ fix drift)

- **2.1** gemini catalog from ACP `models` (`availableModels`/`currentModelId`) in acp-client →
  fixes the drifted static list; **upgrade gemini model change to live** (`set_model` in
  `applyConfig`, verified). Tests.
- **2.2** claude/codex curated catalogs behind the contract (one static-catalog module, single
  drift owner; codex keeps "Custom id…"). Replace the `switch(agentId)` model menu with a single
  catalog renderer. Tests.
- **2.3** All four render through the one model browser (vendor grouping only when models carry
  `vendor`; effort per `effortOptions`). Boundary test: no hardcoded model array survives.

## Phase 3 — First-connection / auth wrapping (max-accurate, per the table)

- **3.1** Auth status: per-agent Installed / Signed in / Not installed / Not signed in from
  Provider Readiness; shown on the chip and in the hub.
- **3.2** In-app API-key auth where fully accurate: codex key field → `codex login
  --with-api-key` (stdin); claude/gemini env-key field. Tests.
- **3.3** Launch-OAuth wrap (reuse Setup Surface): for OAuth paths run the provider's own login
  (`claude` / `codex login` / `gemini` / `opencode auth login -p <vendor>`), detect completion,
  re-read status, replay pending input.
- **3.4** opencode vendor auth: "+ Add vendor" in the browser → `opencode auth login -p <vendor>
  -m <method>` (pre-selected) → key in Setup Surface or OAuth launch; vendor list refreshes from
  `connected`.

## Phase 4 — Providers & Models hub (Settings)

- **4.1** New Settings section: all four agents with status, the model browser, a persisted
  **default model** per agent (seeds new threads; fixes opencode's `big-pickle` default), and the
  auth actions from Phase 3. Composer chips link here ("Manage models…"). Component tests.

## Phase 5 — Polish & full verification

- **5.1** Default resolution per provider (opencode → first authed non-free); recent/favorites.
- **5.2** Live pass: one real turn per provider (selected model/effort/permission, start +
  mid-runtime); auth flows (key + OAuth) per provider.

## Dependency order

0.1 → 1.1 → {1.2,1.3,1.4} → 1.5 → 1.6 → 1.7 → 2.1 (early: fixes a live bug) → 2.2 → 2.3 →
3.1 → {3.2,3.3,3.4} → 4.1 → 5.x. Phases 1, 2, 3, 4 each ship on their own.

## Definition of done

Every provider's vendor/model/effort/permission is picked from one catalog-driven surface,
accurate to what the provider actually runs; changes apply at start and live mid-runtime
(restart only where unavoidable); first-connection is wrapped to the max accurate extent
(in-app keys where possible, driven OAuth otherwise); undetected providers read "Not installed".
Verified by tests at every layer + one live turn per provider.
