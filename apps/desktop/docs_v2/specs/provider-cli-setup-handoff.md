# Spec: Agent-Slot Setup Handoff (install / sign in from the existing 4 slots)

## Scope

Keep the **existing four agent slots** (claude / codex / gemini / opencode) exactly where they
are in the Composer agent menu. Make a slot whose CLI **isn't ready** stop being a dead end:
selecting it routes the user to **install** (if the CLI is missing) or **sign in** (if it's
installed but not authenticated), through the Provider Setup Surface that already exists. No new
panel, no account-first screen — the slot itself is the entry point.

This delivers the underlying goal (a ChatGPT / Claude / Google user gets working by installing
the matching CLI and signing in with their existing subscription — no API key) using only the UI
that's already there. It is the claude/codex/gemini piece `opencode-vendor-onramp.md` left as
out-of-scope, plus the universal install step.

Net-new is two small things; everything else is reuse:

1. **Install action** — the `not_installed` readiness blocker gains a `setup` action (run the
   CLI's install command in the Setup Surface). Today `not_installed` carries no action, so the
   slot is a dead end.
2. **Handoff on select** — selecting a not-ready slot (today a no-op) selects the agent and
   surfaces its readiness blockers so the install/sign-in rows appear, instead of waiting for a
   Send that can't happen.

## Evidence

- **The slots already render; not-ready ones are dead.** `choice-surfaces.ts:361–395` builds all
  four rows always (never removed); a missing CLI reads `"Not installed"` and is `disabled`. The
  select handler (`choice-surfaces.ts:90`) makes any not-available/coming-soon row a **no-op** —
  so a user who only has a ChatGPT account can see "codex · Not installed" but can do nothing.
- **The install handoff doesn't exist.** `claude-agent-integration.ts:122`,
  `codex…:111`, `gemini…:108` emit `not_installed` **without a `setup`** action;
  `grep -r "npm install" src` is empty. Sign-in, by contrast, already carries a `setup`
  (`claudeSetupAction`, etc.) and works.
- **The handoff UI is already built.** `readiness/readiness.ts:52` renders a
  "Set up in the provider terminal instead" row for every blocker that has a `setup`, dispatching
  the existing `open_provider_setup_surface`. Give `not_installed` a `setup` and the install row
  appears with zero new UI.
- **Readiness is Send-triggered today, not select-triggered.** `providerReadiness.changed` is
  emitted only from `threadStartedEvents` / `composerInputEvents` (on `provider_not_ready`) and
  `trustWorkspaceEvents` (re-check) — `contract-message-adapter.ts:606/649/698`. There is **no
  `checkReadiness` command** in `commands.ts`. So to surface install/sign-in *from the slot* we
  must run preflight on select.
- **Preflight needs no started thread.** `ProviderReadinessCheckInput` is `{ agentId, scope,
  launchOptions? }`; the integration preflight resolves the executable (`which`) and reads the
  provider's own credential files (`provider-state-readers.ts`). It can run on selection with the
  Composer's `startOptions.scope` — no agent spawn, no thread record.
- **The Setup Surface and Draft Thread host it pre-send.** `open_provider_setup_surface`
  (`workbench-command-handler.ts:390`) is thread-scoped; `ensureComposerDraftThreadActive`
  (`workbench.ts:325`, on main @ 0.1.62) makes the Draft Thread the active thread so its workbench
  hosts the install/sign-in terminal before any Send. `expectedCompletion:"retry_preflight"`
  re-runs readiness on exit, advancing install → sign-in → ready.
- **Registry has one owner for CLI facts.** `provider-cli-commands.ts` ("the only place
  infrastructure may know a provider-specific value") holds the executable names; the install
  package id belongs beside it.

## Decisions

1. **Existing 4 slots, unchanged placement** (user: "지금 있는 UI에 에이전트 슬롯 4개 걍 두고"). No new
   panel, no account-first screen. The agent menu stays; only its behavior for not-ready rows
   changes.
2. **A not-ready slot is selectable and hands off** (user: "cli 연동이 안되어있으면 설치 or 인증 …
   넘기는"). Selecting a `Not installed` (or installed-but-not-signed-in) slot selects the agent and
   surfaces its readiness blockers → the install / sign-in row. `Coming soon` stays a no-op.
3. **Install action runs in the visible Setup Surface, never silent** (earlier user decision).
   `not_installed`'s `setup` = `{ command:<npm>, args:["install","-g",<pkg>], cwd,
   expectedCompletion:"retry_preflight" }`. Install ids in `provider-cli-commands.ts`:
   claude→`@anthropic-ai/claude-code`, codex→`@openai/codex`, gemini→`@google/gemini-cli`,
   opencode→`opencode-ai`. **npm-only for v1**; npm/node absent ⇒ honest terminal error + a
   "install Node.js" hint. Package ids **verified live before hardcoding**.
4. **Sign-in reuses the existing per-CLI Setup Surface** — bare `claude`/`codex`/`gemini` drive
   each CLI's own OAuth (consumer subscription). Tide never reimplements auth, asks for an API
   key on this path, or stores a credential.
5. **Run preflight on select via a new `provider.checkReadiness` command.** It runs the
   integration preflight (no thread, no spawn) for `{ agentId, scope }` and emits the existing
   `providerReadiness.changed`. The readiness surface already renders nothing when there are no
   blockers, so a ready agent shows no card.
6. **The Draft Thread hosts the handoff.** Before emitting any `open_provider_setup_surface`, the
   slot path ensures a Draft Thread is active (`ensureComposerDraftThreadActive`) so `threadId` is
   non-null — the exact "dead row when threadId undefined" hazard the sign-in path documents.
7. **Honest slot detail.** A not-ready row keeps its short status ("Not installed" / a new "Sign
   in required"); the install/sign-in action lives in the readiness rows it opens. Optional: a
   one-line "uses your ChatGPT account" hint — additive, not required for v1.

## Out Of Scope

- A dedicated account-first connect panel / onboarding screen (explicitly dropped by the user).
- A Tide-owned API-key field for claude/codex/gemini (OAuth via the CLI only; opencode keeps its
  own key path).
- Homebrew / non-npm installers and a Node.js bootstrapper (v1 = npm-only, honest error).
- Changing opencode's vendor grid; it only gains the universal install action.
- Real terminal rendering / PTY routing (already specified by the Setup Surface lifecycle specs).
- A multi-step wizard or forced first-run takeover.

## Domain Model

- `installPackageForAgent(agentId) -> string` — registry datum beside `executableForAgent`.
- `ProviderSetupSurfaceAction` (existing shape) reused for install.
- Reused unchanged: readiness blockers (`not_installed`, `not_authenticated`,
  `onboarding_required`, `directory_trust_required`, `hook_bootstrap_required`), the readiness
  surface, `open_provider_setup_surface`, the Draft Thread, detection on `thread.listed`.

## Contracts

- **New command `provider.checkReadiness { agentId; scope?; launchOptions? }`** → runs preflight,
  emits `providerReadiness.changed` (existing event, existing DTO). No thread is started.
- **`not_installed` blocker gains `setup`** in all four integrations — additive; an older renderer
  that ignores it still shows the message (backward compatible).
- No other contract change: the install/sign-in handoff reuses `open_provider_setup_surface`; the
  rows reuse the existing readiness surface.

## Flow

1. **Open the agent menu** (existing). Slots show their status: ready / "Not installed" / signed-in.
2. **Select a not-ready slot** (e.g. codex, not installed). The slot is selected as the Composer
   agent (no longer a no-op); the path ensures a Draft Thread is active and dispatches
   `provider.checkReadiness` for codex.
3. **Readiness surfaces the gap.** `not_installed` → the readiness card shows an install row
   ("Install Codex"). Selecting it runs `npm install -g @openai/codex` in the visible Setup
   Surface (Draft Thread workbench). On exit → `retry_preflight`.
4. **Sign in.** Readiness now reports `not_authenticated` → a "Sign in" row runs bare `codex`
   (its ChatGPT OAuth). On exit → `retry_preflight`.
5. **Trust / bootstrap** — any remaining gates Tide already auto-grants or surfaces (unchanged).
6. **Ready → Send.** No blockers ⇒ no card; the user sends. `Send` starts the Draft Thread in
   place (`prepareStartInPlace`) on the chosen agent, keeping the panes opened during setup.

## Invariants

- The four slots are always present and unchanged in placement; only not-ready behavior changes.
- Tide never stores a claude/codex/gemini credential and never reimplements their auth — sign-in
  always runs the CLI's own command via the Setup Surface.
- Install always runs in a **visible** Setup Surface, only on explicit user action.
- `provider.checkReadiness` never starts a thread or spawns an agent — it only reads
  executable + provider credential state and emits readiness.
- A ready agent surfaces no readiness card (blockers empty ⇒ nothing renders).
- The handoff never emits a setup-surface command with a null `threadId` — a Draft Thread is
  ensured first.
- `Coming soon` slots remain no-ops; only not-installed/not-signed-in become actionable.
- Absent the new `setup` on `not_installed` (older backend) ⇒ the blocker still renders its
  message; nothing crashes.

## Tests

- registry: `installPackageForAgent` returns the right package per agent; unknown guarded.
- integrations: each of the four `not_installed` blockers now carries `setup` with
  `args:["install","-g",<pkg>]` + `retry_preflight` (fake `resolveExecutable`→undefined).
- command: `provider.checkReadiness` runs preflight and emits `providerReadiness.changed`
  without a `thread.started` / agent spawn (fake integration).
- select handoff: selecting a not-installed slot is no longer a no-op — it selects the agent,
  ensures a Draft Thread (`thread.createDraft`), and dispatches `provider.checkReadiness`.
- coming-soon: selecting a coming-soon slot stays a no-op.
- readiness rows: a `not_installed` blocker with `setup` renders an install row that emits
  `open_provider_setup_surface` with the install action (extends the existing sign-in row test).
- no-card: a ready agent (no blockers) renders no readiness surface after a check.
- boundary: the slot path drives setup only through `open_provider_setup_surface` and reads
  readiness/detection only from contracts (no direct PTY, no hardcoded credentials).
- live (user-approved): on a machine without `codex`, pick the codex slot → watch `npm i -g`
  run → readiness flips to not-authenticated → "Sign in" runs `codex` OAuth → ready → one turn.

## Implementation Notes

- **Verify package ids live before hardcoding** (`npm view @anthropic-ai/claude-code`,
  `@openai/codex`, `@google/gemini-cli`, `opencode-ai`).
- Resolve `npm` via `resolveExecutable("npm")`; undefined ⇒ `command:"npm"` and let the terminal
  surface the PATH error + hint. Do not gate the slot on npm detection.
- The install `setup` goes in each integration's `not_installed` branch (beside where sign-in
  `setup` already is), built from `installPackageForAgent`.
- The select handoff is a small `choice-surfaces.ts` change: for `!isAgentAvailable` (but not
  coming-soon), select the agent + `ensureComposerDraftThreadActive` + emit
  `provider.checkReadiness` instead of returning the no-op.
- The readiness row label currently reads "Set up in the provider terminal instead"; for
  install/sign-in (no in-app alternative) prefer "Install <Agent>" / "Sign in to <Agent>" derived
  from the blocker kind. Keep the trust blocker's in-app one-click action unchanged.
- Keep claude/codex/gemini and opencode logic separated; the only shared addition is the
  universal install action.

## Open Questions

- **Install robustness beyond npm** (Homebrew / Node bootstrap) — deferred.
- **API-key sign-in for these CLIs** — out of scope (OAuth-only); revisit on request.

## Resolved

- **Auto-run install vs one click (RESOLVED → click).** Selecting a "Not installed" slot surfaces
  the readiness card with an "Install <Agent>" row the user clicks; it does not jump straight into
  the install terminal. Consistent with the existing readiness UI (user choice, 2026-06-17).
- **Package ids (VERIFIED live, 2026-06-17, `npm view`):** `@anthropic-ai/claude-code` (2.1.179),
  `@openai/codex` (0.140.0), `@google/gemini-cli` (0.46.0), `opencode-ai` (1.17.7).

## Implementation Status

Slices 1–3 DONE + live-verified (onboard branch, 2026-06-17). Foundation on main @ 0.1.62
(Composer Draft Thread + Provider Setup Surface + readiness surface).

- **Slice 1 (install action).** `provider-cli-commands.ts` `installPackageForAgent` +
  `npmInstallSetupAction`; all four integrations' `not_installed` blocker carries the `npm install -g`
  Setup Surface (npm unresolved ⇒ `"npm"` fallback); resolver types widened to `"<agent>" | "npm"`.
- **Slice 2 (`provider.checkReadiness` + select handoff).** Not-installed agent rows are selectable
  (only coming-soon stays disabled). Selecting a slot ensures a Draft Thread + runs the new
  `provider.checkReadiness` command → backend preflight → the readiness card surfaces install/sign-in
  **immediately** (not only on Send). The Draft Thread rebinds to the picked agent; a Setup Surface
  completion re-emits readiness even with no pending input, so the card advances install → sign-in →
  ready during proactive onboarding.
- **Slice 3 (actionable labels).** The setup row reads "Install &lt;Agent&gt;" / "Sign in to
  &lt;Agent&gt;" / "Finish setting up &lt;Agent&gt;" / "Set up &lt;Agent&gt; for Tide" (kind-aware,
  agent-named) with a matching detail, instead of a generic prompt. `view-model` exposes
  `providerReadinessAgentLabel`; `readiness.ts` maps blocker kind → label.

### Startup race fix (no caching — proper decoupling)

The agent menu's "Not installed" label is driven by `thread.listed.availableAgents`, which was bundled
with opencode's slow catalog subprocesses (`opencode models`/`auth list`/`--version`, ~hundreds of ms
cold) in one synchronous event — so the menu showed the default "all available" for up to ~1s after
launch, then corrected. Fixed two ways (cache-warming was rejected as a timing band-aid):

1. **Decouple.** `thread.listed` now carries only `availableAgents` (fast, `which`-based). opencode's
   catalog moved to a new **`providerCatalog.changed`** event, pushed off the startup critical path
   (`setImmediate` in live-backend) and re-pushed by the adapter after a vendor connect. The agent
   menu never waits on opencode.
2. **Honest unknown state.** Until detection arrives, agent rows read **"Checking…"**
   (`isAgentAvailabilityKnown`) instead of a misleading "installed" label. With (1) this resolves in
   milliseconds, so it is sub-perceptible.

### Verification

- typecheck 0 errors; full suite **973 / 971 pass / 0 fail / 2 skip**.
- LIVE (`scripts/pw-setup-handoff-verify.cjs`, codex hidden via symlink rename → genuinely missing):
  codex slot selectable; selecting it surfaces the card with `Codex CLI executable was not found.` +
  **`Install Codex CLI`** ("installs the CLI in a terminal, then continues"); installed+authed
  opencode shows no card (ready). Race fix proven: immediate menu open 5/5 shows "Checking…" (never the
  misleading "Agent Integration"); after settle 3/3 shows "Not installed".

Remaining: a real end-to-end click-through that actually runs `npm i -g` + the CLI's OAuth (left
undriven — outward/global mutation; the command wiring + labels are verified).
