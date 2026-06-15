# Spec: opencode Vendor On-Ramp (natural, in-context)

## Scope

Let a user who reaches for **opencode** connect a vendor and pick a model **at the moment
they intend to use it** — in-context, with no forced first-run wizard and no drop to a raw
terminal. This is P3 of the model-integration arc, descoped from "first-run onboarding" to a
**just-in-time on-ramp** per the product decision: *"강제 가이드는 필요없고 오픈코드를 쓰려는
사람들만 자연스럽게 연동할 수 있으면 돼."*

Two surfaces share one panel — the **Connect a model** panel:

1. **In-context (point of intent).** When a Thread is being started/configured with opencode
   and there is no usable vendor/model yet, the composer/start surfaces the panel inline
   instead of offering a dead "opencode default" or failing a turn into a terminal.
2. **Settings → Providers & Models (management).** The same panel is reachable from the
   opencode row, upgrading today's read-only hint into an actionable "Add vendor / change
   model" surface.

The panel = **OpenCode Zen card** + **vendor grid** (connected-state from `opencode auth
list`) + **per-vendor auth-method sheet** (drives opencode's own `opencode auth login -p
<provider> [-m <method>]` through the existing **Provider Setup Surface**) + the existing
**Full model browser** to pick model/effort/default after a vendor is connected.

This borrows palot's *UX pattern* (Zen card, vendor grid, method sheet) but maps it onto
opencode's own CLI verbs — Tide never reimplements auth, OAuth, or key storage.

## Prerequisite (branch base) — RESOLVED

Builds directly on **PR #105** (`cross-provider-model-catalog-and-hub.md` +
`opencode-model-vendor-selection.md`): the unified `ProviderModelCatalogDto`, the Full model
browser, opencode's dynamic catalog, opencode **un-gated** from `COMING_SOON_AGENTS`, and the
Provider Setup Surface. `onboarding` was fast-forwarded to `origin/main` (`8419f2ff`,
2026-06-15) — it was 17 commits behind / 0 ahead, a clean FF, nothing lost. The foundation is
now present in-tree: `COMING_SOON_AGENTS` is `new Set([])`, the opencode readiness message is
the corrected `opencode auth login`, and `provider-model-catalog.ts` / `providers-hub.ts` /
`opencode-model-catalog.ts` / `provider-detection.ts` all exist. (PR #106 multitask-navigation
rode along in the same FF.) Remaining net-new for this slice: `provider-detection.ts` still
records install presence only — no `opencode --version` capture yet.

## Evidence

Live-probed against the installed `opencode` 1.17.1 (read-only).

- **Connected-state source.** `opencode auth list` prints authed providers with method, e.g.
  `● Anthropic  oauth` / `● OpenAI  oauth` / `2 credentials`. This is the truth for the
  grid's "Connected ✓" badge — parse it, never fabricate.
- **Auth is INHERITED from the terminal — zero import.** opencode stores credentials in one
  machine-global file, `~/.local/share/opencode/auth.json` (verified present: 2 oauth creds,
  perms 600). It is not per-project and not Tide-specific. Tide runs the *same* opencode binary,
  so `opencode auth list` / `opencode models` already report whatever the user authed in their
  terminal — no copy, sync, or import step exists or is needed. (Verified: this machine's
  terminal sign-ins yield 13 ready models in Tide with zero setup.) opencode additionally honors
  recognized env keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …) as credentials, so those are
  inherited too. ⇒ A returning opencode-CLI user is *already connected* in Tide.
- **palot's vendor grid + method sheet maps 1:1 onto opencode.** `opencode auth login`
  accepts `-p, --provider <id>` (skips provider selection) and `-m, --method <label>` (skips
  method selection). So "click OpenAI → pick API key" = `opencode auth login -p openai -m
  <method>`; "click OpenAI → sign in via browser" = `opencode auth login -p openai` driven in
  the visible Setup Surface (opencode handles the OAuth callback).
- **OpenCode Zen.** `opencode models` lists the authed `provider/model` set; the `opencode/*`
  rows are Zen's free tier — count → the "Included · N free models" card. (This machine:
  `openai/*` + `opencode/*` Zen.)
- **Version.** `opencode --version` → `1.17.1` — trivial to surface (today
  `provider-detection.ts` records install presence only, no version).
- **Auth mechanism already exists.** `Provider Setup Surface`
  (`provider-setup-surface-workbench-command.md`, `-terminal-lifecycle.md`,
  `-input-and-retry.md`) spawns an arbitrary command in a visible terminal, **preserves
  pending Composer input**, and re-runs Provider Readiness on completion
  (`expectedCompletion: "retry_preflight"`). opencode's `not_authenticated` readiness blocker
  already carries `setup: { command, args: ["auth","login"], expectedCompletion }` (PR #105
  corrected the verb from `providers login` → `auth login`).
- **Glossary alignment.** Connecting a vendor is **Provider Readiness** (provider-owned setup
  completed via the Provider Setup Surface), not a Tide-owned credential vault. opencode is a
  Provider CLI Agent; its vendor layer is opencode-internal.

## Decisions

1. **No forced first-run wizard** (user). No app-launch takeover, no progress-stepped
   sequence. The on-ramp appears only when opencode is being chosen and is not yet usable.
2. **Entry = point of intent** (user, "자연스럽게"). The composer/start agent selection is the
   natural trigger: choosing opencode with no usable vendor/model shows the panel inline; it
   never silently offers a non-working "opencode default" and never lets a turn fall into a
   raw terminal.
3. **Same panel in the Settings hub.** Upgrade the read-only "Providers & Models" opencode row
   (PR #105 P4) to open this panel for later management ("Add vendor", change default model).
4. **Auth = opencode's own credential mechanism, two paths (정석, like palot).** Clicking a
   vendor opens an in-panel method sheet with two choices:
   - **Sign in with browser** → `opencode auth login -p <vendor>` in the visible Provider Setup
     Surface (opencode drives the OAuth/browser flow + callback itself).
   - **Paste an API key** → an in-app `sk-…` field whose value is set the **server way** palot
     uses: the backend runs opencode's own headless server (`opencode serve`, 127.0.0.1) and
     `PUT /auth/{providerID}` with `{type:"api", key}` — the exact non-interactive credential
     write that lands in opencode's machine-global `auth.json`. NOT the interactive `auth login`
     TUI (which *hangs* for some providers when driven non-interactively — verified: anthropic
     hangs on a programmatic `-m` probe; openai lists `ChatGPT browser / headless / Manually
     enter API Key`). The server's `GET /provider/auth` is also the hang-free source of the real
     per-vendor method list. Tide stores no credentials itself; the server is one lazy
     127.0.0.1 singleton, separate from the per-thread ACP runtime.
   "All providers…" runs `opencode auth login` with no `-p` (opencode's full picker). The browser
   path needs a Thread to host the Setup Surface; the API-key path does not (pure server call).
5. **Connected-state and models come only from opencode** — `opencode auth list` for the grid,
   `opencode models` for the catalog. A vendor not authed in opencode is shown as not
   connected; a model opencode won't list is never offered.
5a. **Inherit terminal auth; the panel is gap-only (user q).** Because auth lives in opencode's
   global `auth.json` (Evidence), a user who signed in via the opencode CLI is *already
   connected* in Tide — surface that explicitly (an "inherited from your opencode CLI" cue +
   Connected ✓ tiles), never ask them to redo it. The on-ramp therefore appears **only for the
   gap**: opencode chosen with zero usable models / zero connected vendors. A fully-set-up
   opencode user never sees the panel and lands straight on the model browser. There is no
   import action — Tide reads, it does not copy.
6. **OpenCode Zen is a first-class card**, not a grid tile — "Included · N free models" + an
   "Enter API key" affordance for Zen's paid tier + "Get a key at opencode.ai ↗".
7. **Model/effort/default reuse the Full browser + catalog unchanged.** After a successful
   connect, re-enumerate `opencode models` so the new vendor's models appear; the user picks
   model + effort there and (optionally) sets the per-provider default (PR #105 hub default).
8. **Vendor grid = curated popular set + "All providers…"** Tiles for OpenAI, Anthropic,
   Google, GitHub Copilot, Groq, OpenRouter, xAI; an "All providers…" action runs
   `opencode auth login` with no `-p` (opencode's own full picker) so the long tail
   (Qwen/Kimi/DeepSeek/…) stays reachable without Tide curating 141 providers.
9. **Environment honesty (small).** Surface `opencode --version` where the panel/hub names
   opencode (e.g. "opencode 1.17.1"); a "tested with ~X.Y" note is optional and additive — no
   blocking gate, no wizard step.

## Out Of Scope

- A forced first-run / multi-step onboarding wizard (welcome, progress dots, finale).
- "Migrate from Claude Code / Cursor" and a quick-tips finale (palot screen 4) — separate.
- Auth onboarding for claude/codex/gemini — they have no vendor layer; each uses its own CLI
  login via its own readiness/Setup Surface. This slice is opencode-only.
- A Tide-owned API-key vault. Keys live in opencode's `auth.json` via `opencode auth login`.
- The anthropic-OAuth-not-listed-in-`opencode models` quirk (opencode-side; Tide degrades
  correctly by showing opencode's real set).
- `budget_tokens`-style effort sliders (PR #105 out-of-scope; unchanged).

## Domain Model

- `OpencodeVendorDto { id; label; connected: boolean; method?: string }` — one per grid tile;
  `connected`/`method` derived from `opencode auth list`. Tile metadata (label/icon, known
  auth methods) for the curated set lives in one module; unknown/long-tail vendors route
  through "All providers…".
- `OpencodeAuthMethodDto { id; label; kind: "oauth" | "api_key" }` — the method-sheet rows for
  a curated vendor (e.g. OpenAI: ChatGPT browser / headless / API key; Anthropic: API key).
  `kind:"oauth"` → Setup Surface terminal; `kind:"api_key"` → in-app key field then
  `auth login -p <id> -m <method>`.
- `OpencodeEnvironmentDto { version?: string; testedWith?: string }` — `opencode --version`
  + a Tide constant; additive on detection.
- Reused unchanged: `ProviderModelCatalogDto` + Full browser (model/effort/default),
  `ProviderSetupSurfaceStartInput` (command/args/cwd → the auth subprocess),
  `thread.setLaunchOptions` (model/effort apply), readiness `not_authenticated` blocker.

## Contracts

- Detection (`thread.listed`) gains, for opencode: `opencodeVendors?: OpencodeVendorDto[]`
  (connected set + curated tiles) and `opencodeEnvironment?: OpencodeEnvironmentDto`. Backward
  compatible (absent ⇒ panel shows curated tiles all "not connected", no version line).
- No new command for auth: connecting a vendor reuses the **Provider Setup Surface** start
  command with `args: ["auth","login","-p",<vendorId>, ...(method ? ["-m", method] : [])]`.
- No new command for models/default: reuse `thread.setLaunchOptions` and the PR #105 hub
  default. After a Setup Surface completes, the existing `retry_preflight` re-runs readiness;
  hook a catalog + vendor re-enumeration there so the panel reflects the new vendor live.

## Flow

1. **Select opencode** (composer or start). Desktop checks the opencode catalog: if it has no
   concrete (non-Zen) model **and** `opencodeVendors` shows nothing connected → render the
   **Connect a model** panel inline. If a vendor is connected → render the normal Full browser
   (existing). Zen-only is still "connect a real vendor or use Zen free".
2. **Panel.** Zen card (free-model count + Enter-key affordance) above a vendor grid (curated
   tiles with Connected ✓ badges from `auth list`) + "All providers…".
3. **Connect a vendor.** Tile → method sheet. OAuth → Setup Surface runs `auth login -p <id>`
   in a visible terminal; API key → in-app field → Setup Surface runs `auth login -p <id> -m
   <method>` with the key. "All providers…" → `auth login` (opencode's own picker).
4. **Completion.** Setup Surface exit → `retry_preflight` → re-enumerate `opencode models` +
   `auth list` → tile flips to Connected ✓, the new vendor's models populate the Full browser.
5. **Pick + start.** User picks model (+ effort if the model reports it) → `setLaunchOptions`
   → first turn runs on the chosen vendor/model (PR #105 apply path).
6. **Manage later.** Settings → Providers & Models → opencode row → opens the same panel.

## Invariants

- The on-ramp appears only for opencode and only when it is not yet usable; a connected
  opencode behaves exactly as PR #105 (Full browser, no on-ramp).
- Connected badges and model lists reflect `opencode auth list` / `opencode models` exactly;
  Tide never fabricates a vendor, credential, or model.
- Connecting a vendor never reimplements auth — it always runs `opencode auth login` via the
  Provider Setup Surface, which preserves pending Composer input and re-runs readiness.
- An opencode model/effort chosen for a Thread is applied before that Thread's first turn
  (unchanged from PR #105).
- Absent the new contract fields (older backend) ⇒ curated tiles render "not connected" and no
  version line; nothing crashes.

## Tests

- vendor parser: `opencode auth list` output → connected `OpencodeVendorDto[]` (handles the
  `●`/box-drawing lines, the trailing "N credentials", empty list); unknown provider id maps
  to a generic tile.
- environment: `opencode --version` → `version`; missing binary ⇒ undefined, no throw.
- panel render: shows the Zen card with the `opencode/*` free count; renders curated tiles
  with Connected ✓ for authed vendors and plain for the rest; "All providers…" present.
- connect action: choosing a vendor tile emits a Setup Surface start with
  `args:["auth","login","-p",<id>]`; choosing an api_key method appends `["-m",<method>]`;
  "All providers…" emits `["auth","login"]`.
- post-connect refresh: a `retry_preflight` re-enumerates the catalog so a newly-authed
  vendor's models appear in the Full browser (fake enumerator).
- in-context trigger: selecting opencode with no connected vendor + no concrete model shows
  the panel; with a connected vendor shows the Full browser (no panel).
- hub: the Settings opencode row opens the same panel (shared component, one code path).
- boundary: the panel reads vendor/model state only from contracts (no hardcoded vendor model
  lists); auth goes only through the Setup Surface port.
- live (user-approved): `opencode auth login -p <vendor>` from the panel completes, the tile
  flips Connected ✓, a model from that vendor appears and runs one turn.

## Implementation Notes

- **Base on `origin/main` first** (Prerequisite). On the current `onboarding` line opencode is
  `COMING_SOON` and the Full browser/catalog/hub don't exist — the on-ramp has nothing to sit
  on here.
- Parse `auth list` defensively (it is a TUI-styled box; match the `●  <Name>  <method>`
  rows, not the frame). Keep the curated-vendor metadata (id ↔ label/icon ↔ known methods) in
  one module so it has a single owner; everything else falls through to "All providers…".
- The Setup Surface already preserves pending input and re-runs readiness — wire the
  catalog/vendor refresh into that existing `retry_preflight`, don't invent a new completion
  signal.
- Reuse the Full browser and the PR #105 default-model persistence verbatim; the only net-new
  UI is the panel shell (Zen card + vendor grid + method sheet + key field) and the
  in-context trigger that decides "panel vs Full browser".
- Keep opencode-specific vendor logic inside the opencode integration / a desktop opencode
  module; do not leak vendor concepts into claude/codex/gemini (they have none).
- `opencode --version` is one cached subprocess at detection (like `opencode models`), never
  per panel-open.

## Open Questions

- **API-key handoff to `opencode auth login`.** Verify whether the key can be passed
  non-interactively (env / stdin / flag) or whether even the API-key method must complete in
  the visible Setup Surface terminal. If interactive-only, the in-app `sk-…` field becomes a
  pre-fill that is typed into the surface; functionally identical, slightly less seamless.
  (Live-probe before building the api_key path.)
- **Per-vendor method discovery.** Curate known methods for the popular tiles, or query
  opencode for a vendor's methods? Curated is simplest and matches palot; revisit if methods
  drift across opencode versions.
- **Zen "Enter API key".** Whether Zen's paid key uses `opencode auth login -p opencode` or a
  config field — confirm before wiring the Zen card's key affordance (the free tier needs no
  action). (v1 ships the free "Use a free model" action; the paid-key affordance is deferred.)

## Implementation Status

IMPLEMENTED end-to-end on branch `onboarding` (2026-06-15), including the **정석 server-API
auth path** (palot's mechanism). Typecheck clean, full suite **850 pass / 0 fail** (+17 new
on-ramp tests, incl. the opencode auth-server HTTP layer), `electron-vite build` green.

- **Contracts** — `shared/contracts/opencode-vendor.ts` (`OpencodeVendorDto`,
  `OpencodeEnvironmentDto`); `thread.listed` gains `opencodeVendors?` + `opencodeEnvironment?`.
- **Backend** — `opencode-vendor-catalog.ts` (parse `opencode auth list` → connected entries;
  curated tiles ⨉ connected merge; `opencode --version`; cached, bounded subprocess) →
  `provider-detection.ts` → `contract-message-adapter` → `thread.listed`. **정석 auth:**
  `opencode-auth-server.ts` (lazy `opencode serve` 127.0.0.1 singleton + `setApiKey` →
  `PUT /auth/{id} {type:"api",key}` + `listProviderAuth` → `GET /provider/auth`); the
  `provider.opencodeConnectApiKey` command (contract + adapter) calls it via
  `provider-detection.connectOpencodeApiKey` (sets the key, invalidates the model + vendor
  catalogs), then re-lists so the panel reflects the new vendor + models.
- **Desktop state** — `opencode-onramp.ts` (vendor/env module state, `isOpencodeUsable()` gate,
  `buildOpencodeConnectSurface`); consumed in product-shell `events.ts`; `choice-surfaces.ts`
  builds the surface + handles `connect-vendor:<id>` / `all-providers` / `use-free-model` /
  `add-vendor` / `back-to-models`; `view-model.ts` `modelChipSurface`; `providers-hub.ts`
  vendor/version summary.
- **Desktop UI** — `opencode-connect-panel.tsx` (a stateful FC) + `.css` (Zen card, inherited
  banner, vendor grid, "All providers…"; theme-aware via `--tide-*` + `--tide-diff-add` green).
  Clicking a vendor opens a **per-vendor method sheet** (Sign in with browser / Paste an API
  key); the **in-app `sk-…` field** (local component state — the key never enters the global
  store) submits via `onOpencodeConnectApiKey` → `provider.opencodeConnectApiKey`. Browser →
  the Setup Surface terminal. Branched in the chip popover; Model chip opens it via
  `modelChipSurface`; Settings hub row + hint.
- **Remaining** — live click-through in the running app (the API-key path spins up
  `opencode serve` + PUTs a real key — only a real key + run exercises the live server; the
  HTTP layer, command, dispatch, and panel are unit-tested, and the server endpoints were
  verified live via `opencode serve` + curl).
