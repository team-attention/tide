# Design Overview: Agent · Vendor · Model Selection (all four providers)

> Goal: claude code, codex, gemini, opencode 모두를 명확한 형태로 연동하고, 사용자 경험이
> 망가지지 않으면서 원하는 **벤더 · 에이전트 · 모델**로 작업할 수 있게 한다.

This is the north-star that frames two implementable specs:
- `opencode-model-vendor-selection.md` (P1) — opencode's dynamic model/vendor/effort, the first
  consumer of the general catalog + the reusable model browser.
- `cross-provider-model-catalog-and-hub.md` (P2) — the one catalog contract for all providers +
  the Providers & Models hub.

It adds what neither narrow spec owns: the **agent axis**, the **three selection surfaces seen as
one experience**, and the **UX-integrity guarantees** (no broken states).

## The three axes (and how they collapse per agent)

Selection has three axes, but they are **not** three equal menus for every agent:

| axis | meaning | who exposes it |
|------|---------|----------------|
| **Agent** | which runtime/CLI drives the thread | always: claude / codex / gemini / opencode (+ openai_api) |
| **Vendor** | which model provider serves the model | **explicit only for opencode** (a multi-vendor router: openai/anthropic/qwen/kimi/…). For claude/codex/gemini the agent *is* the vendor (claude=anthropic, gemini=google, codex=openai) — implicit, never a menu. |
| **Model (+effort)** | the concrete model and its reasoning effort | every agent; effort only where the model supports it |

So the UX is **one shape with a conditional middle layer**: pick Agent → (opencode only: pick
Vendor) → pick Model → (if supported: effort) + permission. The model browser renders a vendor
grouping **only when the catalog's models carry a `vendor`** — which only opencode does. Nobody
builds an opencode-special UI; the same component degrades to a flat list for the others.

## Per-agent integration — the clear form

Grounded in the integrations + live ACP probes. This is the "명확한 형태" for all four:

| agent | vendor | model source | model id | effort | permission | live change |
|-------|--------|--------------|----------|--------|------------|-------------|
| **claude** | anthropic (implicit) | curated catalog (no enumeration) | `--model` alias | `--effort` low–max | 5 modes (`--permission-mode`) | model/permission live (`set_model`/`set_permission_mode`); effort → restart |
| **codex** | openai (implicit) | curated + "Custom id…" (free-form) | free-form `--model` | `turn/start` low–xhigh | 3 approval modes | model + effort live (`turn/start`); permission → restart |
| **gemini** | google (implicit) | **provider-reported** (ACP `models.availableModels` + `currentModelId`) | `modelId` | none | 4 modes (ACP `session/set_mode`, live) | permission live; model **also live** (`session/set_model` verified `{}`) — Tide currently restarts → upgrade |
| **opencode** | **explicit (multi-vendor)** | **provider-reported** (ACP `configOptions` model + `opencode models`) | `provider/model` | **per-model** (ACP effort configOption, live) | Build / Plan (ACP) | model + effort + permission all live (`set_config_option`) |
| openai_api | openai (Tide-native) | curated | model id | n/a | Tide tool policy | restart |

All of this is already produced/applied by existing code (`buildStartPlan`,
`buildSessionConfigUpdate` → `applySessionConfig` → `applyConfig`). The new work is **uniform
catalog production + one rendering path**, not new runtime mechanisms.

**Verification (start + mid-runtime model/permission change), done 2026-06-14:**
- claude — `applyConfig` writes `control_request {subtype:"set_model"|"set_permission_mode"}`;
  both subtypes present in the claude 2.1.177 binary (`set_model`×22, `set_permission_mode`×23).
  Start: `--model`/`--permission-mode` argv. Effort + "Claude default" sentinel → restart.
- codex — `applyConfig` stashes `turnOverrides` (model/effort) re-sent on every `turn/start`;
  binary has `turn/start`, `approval_policy`, `reasoning_effort`, `sandbox_policy`. Start:
  `thread/start` (model/approvalPolicy/sandbox). Permission change → restart (can't safely
  build a live structured SandboxPolicy).
- gemini — **live-probed**: `session/set_mode {modeId:"plan"} → {}` and
  `session/set_model {modelId:"gemini-2.5-pro"} → {}` both succeed. Permission already live;
  **model can be live too** though Tide currently restarts it (`--model` argv) — see open
  question / decision 3 in P2.
- opencode — **live-probed**: `session/set_config_option {model|effort|mode}` and
  `session/set_model`/`session/set_mode` all succeed `{}`; every knob is live (no restart).

Net: every provider supports live mid-runtime model + permission at the protocol level (codex
permission excepted by Tide choice). The design's "apply" claims are evidence-backed, not
assumed.

## Transport alignment (why opencode stays ACP, not its server API)

opencode uniquely also offers a first-class HTTP server (`opencode serve` + `@opencode-ai/sdk`)
— what the palot/iOS/.NET desktop clients use. The others have **no** equivalent: claude
(stream-json), codex (app-server JSON-RPC), gemini (ACP) are all **stdio, one process per
thread**. Adopting opencode's server would make it a lifecycle outlier (long-running HTTP
server, one-server-many-sessions). So the runtime stays **ACP** — opencode is then shaped exactly
like gemini (same `StructuredRuntimeClient` port, same per-thread process). Alignment lives at
two levels and is preserved either way: the **port** (`AgentIntegrationPort` /
`StructuredRuntimeClient`) and the **catalog contract** (`ProviderModelCatalogDto`) are uniform
across all four regardless of transport. The rich data the server API would give
(providers/models/defaults/connected/agents) is fully available from opencode's **CLI/config**
(`opencode models --verbose`, `opencode agent list`, `opencode auth list`, `opencode.json`) — so
we get the richness without the divergence. From palot we borrow only the **UX pattern**
(searchable cross-provider picker + reasoning variant + recently-used + favorites), not the
transport.

## The three selection surfaces, as one experience

1. **Start Composer (New Thread)** — Agent chip → Model chip (+ effort + permission). Defaults
   resolved per agent (sentinel "provider default"; opencode → first authed non-free model, never
   `big-pickle`). For opencode the Model chip opens the **Full browser** (search + vendor filter).
2. **Mid-thread** — the same chips on a running thread; a change applies **live** where the
   provider supports it, else a transparent restart at the next turn (existing machine). Never
   interrupts an in-flight turn.
3. **Settings → Providers & Models hub** — the management home: every agent with install/auth
   **status** (from Provider Readiness), its **model browser**, a persisted **default model**, and
   an **auth/setup** button (the existing Provider Setup Surface). The composer chip links here.

The chip and the hub read the **same catalog** and the **same readiness** — they cannot disagree.

## UX-integrity — what's broken today → how it's fixed

The goal's "사용자경험이 망가지지 않게" is concrete. Today's broken/awkward states and their fix:

| broken today | fix | where |
|--------------|-----|-------|
| opencode is "Coming soon" — unusable though fully wired | un-gate (ACP verified) | P1 |
| opencode silently runs `opencode/big-pickle` (Zen free junk; #4001) | Tide sets the model explicitly; sensible default | P1/P2 |
| opencode has no vendor/model/effort choice at all | Full browser + per-model effort | P1 |
| opencode permission menu copies gemini's 4 modes (only Build/Plan exist) | accurate Build/Plan | P1 |
| gemini model list is **drifted** (`gemini-3-pro` vs real `gemini-3-pro-preview`; 2.5 models missing) → a pick can send an id gemini won't accept | consume gemini's ACP `models` (provider-reported) | P2 |
| every model menu is a hardcoded `switch(agentId)` that silently goes stale | one catalog contract; no hardcoded model arrays | P2 |
| an undetected agent is disabled but mislabeled "Agent Integration" | "Not installed" label | P1 |
| a not-signed-in agent blocks send with no path | Provider Setup Surface (exists) surfaced from the hub too | P2 |
| no single place to see/manage what you can run | Providers & Models hub | P2 |

Invariants that keep it unbroken:
- No component reads a hardcoded per-agent model list; every menu renders a `ProviderModelCatalogDto`.
- A dynamic agent's menu equals what it reports — a stale/invalid id can't be offered.
- The model menu is never empty (a sentinel default is always present).
- Effort appears only for models that support it; vendor grouping only for opencode.
- Status/auth come from Provider Readiness — the UI never fabricates availability.
- An in-flight turn is never interrupted by a selection change.

## How it sequences (design done up front, ship incrementally)

- **P1** builds the **general** catalog contract (`ProviderModelCatalogDto`) + the reusable Full
  browser, with **opencode** as the first dynamic consumer, and un-gates opencode. (Hardest agent
  first; proves the contract.)
- **P2** then: consume **gemini** ACP `models` (accuracy), put **claude/codex** curated lists
  behind the same contract, and add the **Providers & Models hub** in Settings. Each ships alone.
- **P3** stays minimal per the user: just the "Not installed" chip; no onboarding/installer.

The result: one coherent surface where Agent is primary, Vendor appears exactly when it's real
(opencode), Model + effort are always accurate to what the chosen agent can actually run, and
every reachable state is either runnable or guides you to make it runnable.
