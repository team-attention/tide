# Spec: Provider CLI Update And Codex Model Refresh

## Scope

This slice fixes the provider-CLI update path and the Codex model menu together:

- Tide must show a non-blocking CLI update advisory when the installed provider CLI
  is older than the latest npm package for `codex`, `claude`, or `opencode`.
- Codex model choices must match the latest Codex CLI catalog, including GPT-5.6-Sol,
  Terra, and Luna.
- A user on an old Codex CLI should understand why GPT-5.6 is missing: the local CLI
  is stale and Tide should offer the CLI update path.

This is not about the Tide app self-updater. The Tide app can be current while its
provider CLIs are stale.

## Evidence

- Current installed provider CLIs on this machine:
  - `codex --version` -> `codex-cli 0.141.0`
  - `claude --version` -> `2.1.202 (Claude Code)`
  - `opencode --version` -> `1.17.13`
- Current npm latest versions:
  - `npm view @openai/codex version` -> `0.144.4`
  - `npm view @anthropic-ai/claude-code version` -> `2.1.209`
  - `npm view opencode-ai version` -> `1.17.20`
- Therefore all three installed provider CLIs are stale and should produce update
  advisories.
- Installed `codex-cli 0.141.0` `codex debug models` lists only:
  `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`.
- Latest `@openai/codex@0.144.4` `debug models` lists:
  - `gpt-5.5` / `GPT-5.5` (`low,medium,high,xhigh`)
  - `gpt-5.6-sol` / `GPT-5.6-Sol` (`low,medium,high,xhigh,max,ultra`)
  - `gpt-5.6-terra` / `GPT-5.6-Terra` (`low,medium,high,xhigh,max,ultra`)
  - `gpt-5.6-luna` / `GPT-5.6-Luna` (`low,medium,high,xhigh,max`)
  - retained older GPT-5.4 and GPT-5.3 rows.
- Existing implementation already has the pieces:
  - `agent-update-checker.ts` compares installed vs latest versions from a cache.
  - `ProviderReadinessDto.update` carries the advisory.
  - Composer UI renders an `Update <Agent>` chip when `providerReadiness.update`
    exists.
  - Tests cover the chip rendering and update-terminal dispatch.
- The likely missing behavior is propagation: `createLiveAgentUpdateChecker()` runs
  `refresh()` in the background, but the live wiring ignores the returned
  changed-agent list and does not proactively re-emit provider readiness for the
  visible start composer/default agent. Ready threads also only receive the advisory
  after a readiness check occurs.

## Decisions

- **D1. Provider CLI update is independent of Tide app update.** A current Tide app
  can still need `codex`, `claude`, or `opencode` updates.
- **D2. Local installed CLI controls the user's available provider behavior.** If the
  installed Codex CLI is old, Tide should surface "Update Codex" rather than silently
  pretending the old CLI supports new models.
- **D3. Codex static catalog follows the latest Codex CLI catalog for fallback/menu
  rows.** Latest verified source for this slice is `npx -y @openai/codex@latest
  debug models`, not the stale globally installed `codex`.
- **D4. Default Codex model becomes `gpt-5.6-sol` after the catalog update.**
  Existing explicit older/custom model selections remain preserved.
- **D5. Codex reasoning menu gains `max` for GPT-5.6 rows, but `ultra` is not shipped
  as a plain reasoning row until Tide has an explicit runtime mapping for it.**
  Latest CLI reports `ultra` as a supported effort for Sol/Terra, but Tide currently
  models reasoning as a single `model_reasoning_effort` string shared with older
  Codex models. Treat `ultra` as a follow-up unless the app-server accepts it through
  the same field in a smoke test.
- **D6. Codex default reasoning follows the selected model's CLI default when Tide has
  no explicit reasoning launch option.** `gpt-5.6-sol` defaults to `low`; older
  `gpt-5.5`/`gpt-5.4` rows default to `medium`; `gpt-5.3-codex-spark` defaults to
  `high`.
- **D7. The update advisory must appear before send.** Users should not need to start
  a thread or hit a readiness blocker to learn that their provider CLI is stale.

## Out Of Scope

- Tide app self-update UI or release-feed behavior.
- Homebrew/curl/native installer detection. This slice keeps the existing npm
  `install -g <pkg>@latest` path.
- A full Providers & Models settings hub.
- Dynamic per-account Codex entitlement gating beyond what the CLI reports.
- Codex `ultra` mode UI unless a provider smoke proves the exact app-server launch
  option shape.

## Domain Model

- `AgentUpdateChecker` is the cached source of installed/latest provider CLI versions.
- `ProviderReadinessDto.update` is the renderer contract for a non-blocking CLI update
  advisory.
- `AgentChatShellState.providerReadiness.update` drives the composer update chip.
- `CODEX_MODELS` and `STATIC_PROVIDER_MODELS.codex` are the curated Codex fallback
  catalog used before a dynamic catalog exists.

## Contracts

- No shared contract shape changes are required.
- Existing `ProviderUpdateAdvisoryDto` remains:
  `{ currentVersion, latestVersion, terminalAction }`.
- Existing `providerReadiness.changed` remains the thread-scoped readiness event.
- If proactive start-composer advisories need a non-thread-scoped event, prefer
  extending an existing provider inventory/catalog event rather than overloading
  `providerReadiness.changed` without a thread id. The renderer can then derive a
  start-composer advisory for the selected agent.

## Flow

### CLI Update Advisory

1. On backend startup, `AgentUpdateChecker.refresh()` reads installed and latest npm
   versions for `codex`, `claude`, and `opencode`.
2. If installed `<` latest, the checker stores an advisory with an npm update terminal
   action.
3. Tide must surface that advisory for the selected provider in the start composer
   without requiring a send.
4. Clicking the chip runs the existing readiness terminal handoff:
   `npm install -g <package>@latest`, `expectedCompletion: "retry_preflight"`.
5. When the terminal completes, `refreshUpdateAdvisories()` re-reads versions before
   readiness is rechecked, clearing the chip once installed `===` latest.

### Codex Model Menu

1. Tide updates its Codex catalog to match latest Codex CLI visible rows.
2. The Codex model menu shows GPT-5.6 rows before older models.
3. New Codex threads default to `gpt-5.6-sol`.
4. With no explicit reasoning option, the default Sol chip/menu reads `Low`.
5. Older/custom model ids still render and remain valid if already stored.
6. If the installed Codex CLI is stale, Tide also shows `Update Codex` so the user can
   move to the CLI version whose catalog includes GPT-5.6.

## Invariants

- Outdated provider CLI never blocks starting a thread. It is advisory-only.
- The update chip is not gated on `ready === false`; ready-but-outdated providers
  still show it.
- Update detection never blocks the readiness hot path; network/subprocess work stays
  in the background refresh.
- Stale installed versions must not linger after an update terminal completes.
- Codex model values are provider-native ids (`gpt-5.6-sol`), not display labels.
- The app must not conflate Tide app version with provider CLI versions in UI copy,
  tests, or specs.

## Tests

- Live-ish version fixture: installed Codex `0.141.0` vs latest `0.144.4` produces an
  advisory for Codex; equal versions clear it.
- Backend propagation: when `AgentUpdateChecker.refresh()` changes an advisory from
  absent to present, the selected start-composer agent can receive/render that advisory
  without sending a message.
- Product shell/start composer: with Codex selected and `providerReadiness.update`
  present, the composer shows `Update Codex`.
- Existing chip click test remains: clicking the update chip dispatches
  `update_available:terminal`.
- Codex catalog: menu includes `model:gpt-5.6-sol`, `model:gpt-5.6-terra`,
  `model:gpt-5.6-luna`, and retained older rows.
- Codex default: `defaultModelValueForAgent("codex") === "gpt-5.6-sol"`.
- Codex default reasoning: no explicit reasoning on `gpt-5.6-sol` labels/selects
  `low`; explicit older model `gpt-5.5` still labels/selects `medium`.
- Provider detection catalog: Codex static catalog exposes GPT-5.6 rows and default
  model `gpt-5.6-sol`.

## Implementation Notes

1. Fix advisory propagation first. The current checker has correct comparison logic,
   but the background refresh result is not enough unless the renderer gets a fresh
   selected-agent advisory.
2. Keep the update chip renderer and terminal handoff; they already match the desired
   interaction.
3. Update Codex catalog/defaults from latest CLI output:
   - `gpt-5.6-sol` -> `GPT-5.6-Sol`
   - `gpt-5.6-terra` -> `GPT-5.6-Terra`
   - `gpt-5.6-luna` -> `GPT-5.6-Luna`
4. Make Codex reasoning rows model-sensitive enough for this slice: show `max`
   when the selected model starts with `gpt-5.6-`; do not show `ultra` until the
   runtime option mapping is explicitly smoke-tested.
5. After implementation, update the desktop version and release a new build only if
   the user wants the fix shipped immediately.
