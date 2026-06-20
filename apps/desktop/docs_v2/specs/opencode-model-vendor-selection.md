# Spec: opencode Model, Vendor & Effort Selection

## Scope

Make opencode's **vendor + model + reasoning effort + mode** real, selectable Launch
Options — at New Thread time and live on an active Thread — and un-gate opencode from
"coming soon".

opencode is unlike Tide's other provider CLIs. It is a **multi-vendor router** (models.dev
catalog, 141 providers; model id is `provider/model`, e.g. `openai/gpt-5.5`), the usable set
depends on which providers the user authenticated, and — decisively — opencode describes its
own knobs over ACP as a **dynamic, self-describing `configOptions` surface** that changes
with the selected model. So opencode cannot use a hand-curated static model/effort list
(claude/codex/gemini style); Tide must **project opencode's reported configOptions** onto its
chips and send changes back via one uniform setter.

The opencode model menu is a **Full model browser** (search box + vendor filter + model rows),
not a flat curated list — opencode's value is breadth (Qwen/Kimi/etc. once authed), so the
picker must scale. Built as a reusable component whose catalog contract is the **general**
`ProviderModelCatalogDto` from `cross-provider-model-catalog-and-hub.md` (P2) — so gemini
(ACP `models`), claude, and codex slot into the same browser + hub without rework. The only
first-run touch in this slice: the agent menu shows **undetected
providers as disabled with a "Not installed" detail** (today they wrongly read "Agent
Integration"). A full onboarding / providers hub is explicitly deferred.

This is the follow-up to the two items `mid-thread-launch-option-changes.md` left out of
scope ("opencode model/permission consumption", "runtime-accurate model menus").

## Evidence

Live-probed against opencode-ai 1.17.1 (`opencode acp`) + the installed binary +
`~/.cache/opencode/models.json` (models.dev cache).

- **Catalog source.** `opencode models` prints the **authed** `provider/model` list, instant
  and local. Current machine (anthropic+openai OAuth): 13 — `openai/gpt-5.*` (8) +
  `opencode/*` Zen free (5). `opencode run -m provider/model --variant high|max|minimal`
  confirms the CLI format.
- **Qwen / Kimi etc. are first-class — gated by auth.** models.dev carries `moonshotai`,
  `alibaba`/`alibaba-cn`, `kimi-for-coding`, `openrouter`, `deepinfra`, `togetherai`,
  `groq`, `deepseek`, `fireworks-ai`, … Qwen3/Kimi-K2(.5/.6, thinking) models live under
  several of them. They appear in opencode's selectable set **only after**
  `opencode auth login <provider>`. Tide shows exactly what opencode reports, so a new
  vendor login surfaces automatically.
- **ACP `configOptions` is dynamic and self-describing (NOT ACP-standard `models`/`modes`).**
  `session/new` returns `configOptions: [...]`; the set changes with the current model.
  - default model `opencode/big-pickle` (Zen free, non-reasoning) →
    `[{id:"model",category:"model",currentValue:"opencode/big-pickle",options:[…13]},
      {id:"mode",category:"mode",currentValue:"build",options:["build","plan"]}]`.
    **No effort** (this is why a naive first probe concludes "no effort").
  - after selecting a reasoning model →
    `[{id:"model",…,currentValue:"openai/gpt-5.5"},
      {id:"effort",category:"thought_level",currentValue:"none",
       options:["none","low","medium","high","xhigh"]},
      {id:"mode",category:"mode",options:["build","plan"]}]`.
    The effort values match models.dev `reasoning_options` for that model exactly (per-model:
    some are `low/medium/high`, some add `xhigh`/`max`, anthropic-style use `budget_tokens`).
- **Source-confirmed** (`packages/opencode/src/acp/config-option.ts`, `session.ts` @ sst/opencode):
  ACP configOptions are exactly three categories — `model`, `thought_level` (wire configId
  `"effort"`), `mode` — no temperature/agent/top_p dimension. The effort option is built by
  `buildEffortSelectOption({ variants: variantsForModel(providers, currentModel) })` and is
  `undefined` when the model has **no `variants`** (opencode's internal name for reasoning/effort
  levels; `--variant` CLI flag, `setVariant` session field). So effort is conditional on the
  model carrying variants, surfaced on the wire as `configId "effort"`.
- **opencode ACP ignores the config default model** (issue sst/opencode#4001): ACP hardcodes
  `opencode/big-pickle` and does not honor `opencode.json` `model`. ⇒ Tide cannot rely on
  opencode's own default; it MUST set the model explicitly over the protocol.
- **Uniform setter `session/set_config_option {sessionId, configId, value}`** — confirmed
  live for `configId ∈ {model, effort, mode}`. Its **response returns the full refreshed
  `configOptions`** (so applying a model surfaces the now-present effort option in the same
  round-trip). Invalid effort → `-32602 "effort not found: <v>"`; unknown id → `-32602
  "unknown config option: <id>"`. Binary also has `config_option_update` (a session/update
  push), `ACPInvalidEffortError`, `ACPInvalidConfigOptionError`. `session/set_model
  {modelId}` and `session/set_mode {modeId}` also work but return `{}` (no refreshed
  options) — set_config_option is strictly better for Tide.
- **anthropic OAuth quirk (observed).** Anthropic is OAuth-authed (`opencode auth list`) yet
  absent from `opencode models` and the ACP model options; `opencode models anthropic` →
  "Provider not found". opencode-side state, not a Tide gap — Tide must not fabricate models
  opencode won't run.
- **Our code today.** opencode ACP wired + registered, but `buildSessionConfigUpdate()` is a
  live no-op and the launch plan args are just `["acp"]`. `acp-client.adoptSession` reads
  only `sessionId` (ignores `configOptions`); `applyConfig` handles only `modeId`→
  `session/set_mode`. `cliModelOptionsForAgent("opencode")` = single "opencode default";
  opencode is in `COMING_SOON_AGENTS`; its descriptor permission options are a verbatim copy
  of gemini's four modes (reality is build/plan). Channel
  `thread.listed.availableAgents: ProviderCliAgentId[]` carries no model data. The mid-thread
  machine already exists (`SessionConfigUpdatePlan`, `buildSessionConfigUpdate`,
  `applySessionConfig`, `applyConfig`, `thread.setLaunchOptions`,
  `thread.launchOptionsChanged`).

## Decisions

0. **Transport: stay on ACP (alignment decision).** opencode has a first-class HTTP server API
   (`opencode serve` + `@opencode-ai/sdk`, what palot/iOS/.NET clients use). Evaluated and
   **rejected for the runtime**: claude (stream-json), codex (app-server JSON-RPC), gemini (ACP)
   are all stdio, one process per thread — a long-running HTTP server would make opencode a
   lifecycle outlier. ACP keeps opencode shaped exactly like gemini (same shared client, same
   per-thread process, same `StructuredRuntimeClient` port). The server API's only real edge is
   one typed catalog call, and **the same data is available from opencode's CLI/config**
   (verified: `opencode models --verbose` (+cost, `--refresh`), `opencode agent list`,
   `opencode auth list`, `opencode.json` `model`). So: **ACP runtime + CLI/config catalog** —
   richness without divergence. Only palot's *UX pattern* is borrowed (searchable cross-provider
   picker + variant + recently-used + favorites), not its transport.
1. **opencode's configOptions is the single source of truth for its knobs.** Tide projects
   the reported configOptions onto chips and never hardcodes opencode's model/effort/mode
   vocab: `category "model"` → model chip (vendor-grouped), `category "thought_level"` →
   effort chip (present only when reported), `category "mode"` → permission chip
   (Build/Plan). New/unknown categories degrade to hidden, never crash. The compose-time catalog
   is enriched from the CLI (`opencode models --verbose` + `opencode agent list` +
   `opencode auth list`) and the config default (`opencode.json` `model`, honored explicitly via
   set_config_option to work around #4001); live refinement still comes from configOptions.
2. **One uniform setter.** All opencode knob changes go through `session/set_config_option
   {sessionId, configId, value}`; Tide reads the returned `configOptions` to refresh chips
   (and also honors `config_option_update` pushes). set_model/set_mode are not used for
   opencode.
3. **Compose-time picking (user decision).** The New Thread page offers vendor→model from
   `opencode models` (enumerated at detection). Effort at compose time is **best-effort from
   the models.dev cache** for the chosen model (read `~/.cache/opencode/models.json`
   `reasoning_options` if present); if unavailable it degrades to "adjust once running". The
   chosen model+effort+mode are applied via set_config_option right after `session/new`,
   before the first prompt.
4. **Un-gate opencode (user decision).** Remove from `COMING_SOON_AGENTS`; verify one real
   turn end-to-end with a selected non-default model (and an effort if the model reasons).
5. **Effort is in scope** (corrects the prior draft). It is model-conditional and its allowed
   values come from opencode (live) / models.dev (compose-time), never a fixed Tide list.
6. **Model id is opaque `provider/model`.** Tide splits on the first `/` only for display
   grouping. Sentinel `"opencode default"` ⇒ send no model set (use opencode's own default).
7. **All opencode knob changes are live** (set_config_option mid-session) — opencode never
   restarts for model/effort/permission, unlike gemini's `--model` argv restart.
8. **Permission honesty.** opencode permission options become the two real modes Build /
   Plan; map Tide permission → mode `plan→"plan"`, else `"build"`; legacy gemini values
   (auto_edit/yolo) → `"build"`.
9. **Full model browser (user decision).** opencode's model row group is a searchable,
   vendor-filterable browser (not a flat list), so it scales to authed breadth. Reusable
   component so a future hub can lift it. claude/codex/gemini menus are unchanged.
10. **"Not installed" chip (user decision, replaces the broader onboarding).** The agent menu
    labels undetected providers disabled + "Not installed" (`agentMenuRow` detail, currently
    "Agent Integration"). No install guidance, no providers hub this slice.

## Out Of Scope

- Authenticating new vendors from inside Tide (`opencode auth login`). The picker shows only
  authed models; a footer hint points to the CLI. (Surfacing Qwen/Kimi requires the user to
  auth those providers in opencode first.)
- Fixing the anthropic-OAuth-not-listed quirk (opencode-side).
- `budget_tokens`-style reasoning controls rendered as a numeric slider — if a model reports
  effort as `budget_tokens` rather than discrete values, show opencode's discrete fallback or
  hide; no custom slider this slice.
- claude/codex/gemini menus (stay static, accurate as-is).
- A unified **Providers & Models hub** + first-run onboarding (install guidance,
  proactive no-provider on-ramp) — deferred; this slice ships only the
  opencode picker + the "Not installed" chip label.
- `session/fork`/`list` multi-session features.

## Domain Model

- `AgentConfigOptionDto { id; category; currentValue; options: {value; name?}[] }` — shared
  contract mirroring an opencode configOption; carried on session/runtime events so the
  desktop can project chips. (Generic, not opencode-specific in shape.)
- `AgentModelCatalogDto { agentId; default; models: {value; name?}[];
  effortByModel?: Record<string, string[]> }` — on `thread.listed` for compose-time menus.
  `effortByModel` is the best-effort models.dev annotation (decision 3); absent ⇒ effort
  deferred to live.
- `listOpencodeModels(executablePath, cwd) → string[]` + optional
  `opencodeEffortFromCache(modelId) → string[] | undefined` — a dedicated enumerator owning
  the `opencode models` subprocess (cached per detection) and the cache read; **not** folded
  into the disk-only `readOpencodeProviderStateFromHome`.
- Reused unchanged: `SessionConfigUpdatePlan {live|restart}`, `applySessionConfig`,
  `applyConfig`, `thread.setLaunchOptions`, `thread.launchOptionsChanged`,
  `ThreadRecord.launchOptions`.

## Contracts

- `thread.listed` gains `agentModelCatalogs?: AgentModelCatalogDto[]` (backward compatible;
  absent ⇒ desktop keeps single "opencode default").
- A session config event carries `configOptions?: AgentConfigOptionDto[]` so the desktop
  reflects opencode's live current values + available options (model chip = currentValue,
  effort chip appears/disappears per model).
- `launchOptions` for opencode reuse existing keys: `model` (= `provider/model` or sentinel),
  `reasoning` (= effort value), `permission` (→ mode). Same `thread.setLaunchOptions` path.
- opencode launch plan `protocolParams.configOptions?: {configId; value}[]` (the chosen
  model/effort/mode to apply after session/new); plus existing cwd/mcpServers.

## Flow

**Catalog (compose time)** — detection runs `listOpencodeModels` (cached) + optional
effort-from-cache → `thread.listed.agentModelCatalogs`. Desktop stores it;
`cliModelOptionsForAgent("opencode")` returns the catalog (sentinel first); the model menu
renders vendor section headers + model rows; if `effortByModel[selected]` exists, an effort
sub-row group is shown.

**Start** — `buildStartPlan` puts the chosen `{model?, effort?, mode}` as
`protocolParams.configOptions`. `acp-client.adoptSession`: after `sessionId`, send
`set_config_option` for each (model first — its response reveals the effort option), then
flush the first prompt. The returned `configOptions` are emitted so chips reflect reality.

**Mid-thread (live)** — picking a model/effort/permission row on an active opencode Thread →
`thread.setLaunchOptions` → `applySessionConfig` → `buildSessionConfigUpdate` returns
`{kind:"live", protocolParams:{configOptions:[…changed]}}` → `acp-client.applyConfig` sends
`set_config_option` per change (stashing until the session is adopted, like the existing
modeId path) and emits the refreshed `configOptions`. No restart. Selecting a reasoning model
makes the effort chip appear in the same round-trip.

## Invariants

- A model/effort/permission chosen for a thread is applied before that thread's first turn
  (set_config_option precedes the first `session/prompt`).
- A mid-thread opencode change applies live and is never silently dropped; an in-flight turn
  is never interrupted; opencode never restarts for these.
- The menu shows only models opencode can actually run (the authed set); effort options are
  exactly opencode's reported/known values for the selected model — Tide never invents either.
- The effort chip is present iff the current model reports an effort dimension.
- Absent `agentModelCatalogs` (older backend) ⇒ single "opencode default" row, never empty.
- opencode permission options are exactly Build/Plan.
- The Start Composer remembers the last-picked agent + model/effort/permission across New
  Threads and app restarts for EVERY offered agent (opencode and gemini included), exactly
  like codex/claude. The localStorage preference is gated by `isProductShellAgentIdentity`
  (the four real agents), never a hardcoded codex/claude allowlist that silently
  drops opencode/gemini.

## Tests

- enumerator: parses `opencode models`; cache returns same array without re-spawn; empty/error
  → `[]`; `opencodeEffortFromCache` reads models.dev `reasoning_options.effort` values, returns
  undefined for non-reasoning / unreadable cache.
- contract: `thread.listed` round-trips `agentModelCatalogs` (incl. `effortByModel`); session
  event round-trips `configOptions`; absent fields tolerated.
- agent-vocab: `cliModelOptionsForAgent("opencode")` reflects injected catalog (sentinel
  first); no catalog ⇒ single default; `isAgentComingSoon("opencode") === false`.
- choice-surfaces: opencode model menu renders one vendor header per distinct vendor with its
  rows; selecting `model:openai/gpt-5.5` ⇒ `launchOptions.model==="openai/gpt-5.5"`; an effort
  group renders iff `effortByModel`/live configOptions report it; selecting effort sets
  `launchOptions.reasoning`.
- opencode integration: `buildStartPlan` emits `protocolParams.configOptions` for chosen
  model/effort/mode, omits model for the sentinel; `buildSessionConfigUpdate` returns live
  `{configOptions:[changed]}` (no restart); permission `plan→"plan"` else `"build"`.
- acp client: `adoptSession` sends `set_config_option(model)` then `(effort)`/`(mode)` before
  the first `session/prompt`; emits returned `configOptions`; `applyConfig` sends
  `set_config_option` per change, deferring until adopted; ignores opencode path for gemini
  (gemini still uses modes/set_mode).
- descriptor boundary: opencode permission options === Build/Plan.
- start-composer preference: `persistPreferredStartComposer` + `loadPreferredStartComposer`
  round-trip a `{agentId:"opencode", model:"openai/gpt-5.5", …}` (and gemini); an unknown
  agentId loads as null; `isProductShellAgentIdentity` is true for all five agents, false
  for undefined/unknown.
- live verification (user-approved real turn): `opencode acp`, `session/new`,
  `set_config_option(model=openai/gpt-5.5)`, `set_config_option(effort=high)`, one
  `session/prompt`; assert turn completes and the answer comes from the selected model/effort.

## Implementation Notes

- `opencode models` is local+fast but a subprocess — enumerate once per detection, cache;
  never per menu open.
- Vendor display: split `value` on first `/`; title-case the vendor (`openai→"OpenAI"`,
  `opencode→"OpenCode Zen"`, `moonshotai→"Moonshot"`, `alibaba→"Qwen / Alibaba"` via a small
  prettify map); live `configOptions` `name` ("OpenAI/GPT-5.5") overrides the derived label.
- effort categories seen: discrete `category:"thought_level"` with a `values`-style option
  list. Render as the existing effort/reasoning chip, but with **opencode's values for this
  model**, not Tide's fixed `REASONING_LEVELS`. Default is whatever opencode reports
  (`"none"` for gpt-5.5).
- `adoptSession`/`applyConfig` already stash `modeId` (`pendingModeId`) until adoption; add a
  symmetric `pendingConfigOptions` so a pre-adoption change isn't lost.
- The acp-client is shared with gemini: gemini returns ACP-standard `modes`/`models` and uses
  `--model` argv + restart; opencode returns `configOptions` + set_config_option. Branch on
  which the session advertises; keep gemini behavior unchanged (gemini sets no
  `protocolParams.configOptions`).
- Un-gating: opencode is registered + ACP-verified; removing it from `COMING_SOON_AGENTS` is
  the only menu change, gated on the live turn passing.

## Open Questions

- **Compose-time effort coupling.** Decision 3 reads opencode's cache file for compose-time
  effort. If that path/format is unstable, fall back to effort-after-start (live configOptions
  remain authoritative). Acceptable to ship the live path first and add the cache annotation
  second.
- **anthropic OAuth not listed.** Worth a separate look (does opencode need an API key or a
  config entry to expose Claude-subscription models?) — but Tide's design already degrades
  correctly (shows opencode's real set).
- **`budget_tokens` reasoning.** Some models express reasoning as a token budget, not discrete
  effort. This slice renders discrete effort only; budget models show no effort chip (or
  opencode's discrete fallback if it provides one).
