# Spec: Provider CLI Update And Codex Model Refresh

## Scope

This slice fixes the provider-CLI update path and the Codex model menu together:

- Tide must show a non-blocking CLI update advisory when the installed provider CLI
  is older than the latest npm package for `codex`, `claude`, or `opencode`.
- Codex model choices must match the shell-resolved Codex CLI catalog. If that
  executable is new enough to list GPT-5.6-Sol, Terra, and Luna, Tide shows them;
  if it is stale, Tide shows the stale local catalog plus an update advisory.
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
- A real failing local state showed two Codex installs on PATH:
  - `~/.local/bin/codex -> ~/.codex/packages/standalone/current/bin/codex`
    reported `codex-cli 0.141.0` and was the executable Tide actually used.
  - `~/.nvm/versions/node/v22.20.0/bin/codex` reported `codex-cli 0.144.4`
    after the update button ran npm.
  - Because `~/.local/bin` precedes nvm on PATH, `npm install -g
    @openai/codex@latest` succeeded but updated a lower-priority executable; the
    advisory and old model catalog correctly reappeared on restart.
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
- **D3. Codex catalog follows the shell-resolved Codex CLI.** The runtime source
  of truth is the same executable Tide launches, queried with `codex debug
  models`. Static desktop rows are fallback-only and must not pretend a stale
  local CLI can launch latest-only models.
- **D4. Default Codex model comes from the local catalog.** The default is the
  first selectable row returned by the resolved CLI. Existing explicit older or
  custom model selections remain preserved.
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
- **D8. The update action is the resolved executable's native updater.** Tide
  must not update a different provider CLI than the one it launches. If the
  resolved executable advertises a provider-native updater, the update terminal
  runs that exact executable (`codex update`, `claude update`, or `opencode
  upgrade`). If native update is not advertised, Tide keeps the stale-version
  advisory internally but does not show a one-click update action. Missing-CLI
  setup still uses npm as the best-effort bootstrap path.
- **D9. MCP attachment must not become a provider wrapper.** Tide's Browser MCP
  and Workbench MCP tools are attached to the resolved provider executable through
  provider-native launch configuration (`codex app-server -c mcp_servers...`,
  `claude --mcp-config ...`, `opencode acp` `mcpServers`). The provider process
  command remains the same executable Tide found on the user's shell PATH; Tide
  must not insert a separate wrapper binary between the user-selected provider
  and the runtime.

## Out Of Scope

- Tide app self-update UI or release-feed behavior.
- Homebrew/curl/native installer detection. This slice keeps npm
  `install -g <pkg>@latest` as the missing-CLI bootstrap path; installed provider
  CLI updates target only a proven updater for the resolved executable.
- Replacing the provider launch mechanism with Tide-owned provider wrapper scripts.
  MCP/tool integration stays a launch-plan concern, not a binary-substitution
  concern.
- A full Providers & Models settings hub.
- Dynamic per-account Codex entitlement gating beyond what the CLI reports.
- Codex `ultra` mode UI unless a provider smoke proves the exact app-server launch
  option shape.

## Domain Model

- `AgentUpdateChecker` is the cached source of installed/latest provider CLI versions.
- `ProviderReadinessDto.update` is the renderer contract for a non-blocking CLI update
  advisory.
- `AgentChatShellState.providerReadiness.update` drives the composer update chip.
- `CODEX_MODELS` and `STATIC_PROVIDER_MODELS.codex` are fallback rows only; the
  live Codex catalog and default come from the resolved executable's `debug
  models` output.

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
2. If installed `<` latest, the checker stores an advisory. A one-click terminal
   action is attached only when the resolved executable advertises a native
   updater.
3. Tide must surface that advisory for the selected provider in the start composer
   without requiring a send.
4. Clicking the chip runs the existing readiness terminal handoff:
   `<resolved codex> update`, `<resolved claude> update`, or `<resolved
   opencode> upgrade`, `expectedCompletion: "retry_preflight"` when that
   provider-native updater is advertised. If it is not advertised, no one-click
   update chip is surfaced.
5. When the terminal completes, `refreshUpdateAdvisories()` re-reads versions before
   readiness is rechecked, clearing the chip once installed `===` latest.

### Codex Model Menu

1. Tide queries the shell-resolved Codex CLI with `debug models`.
2. The Codex model menu shows exactly the selectable local rows reported by that
   executable.
3. New Codex threads default to the first selectable local row.
4. Older/custom model ids still render and remain valid if already stored.
5. If the installed Codex CLI is stale, Tide also shows `Update Codex` so the user can
   move to the CLI version whose catalog includes GPT-5.6.

## Invariants

- Outdated provider CLI never blocks starting a thread. It is advisory-only.
- The update chip is not gated on `ready === false`; ready-but-outdated providers
  still show it.
- Update detection never blocks the readiness hot path; network/subprocess work stays
  in the background refresh.
- Stale installed versions must not linger after an update terminal completes.
- Codex model values are provider-native ids, not display labels.
- Codex latest-only rows must not be shown unless the resolved executable reports
  them.
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
- Update action targeting: resolved provider executables build provider-native
  update terminal actions only after probing the native updater; unknown install
  methods produce no one-click action.
- Codex catalog: menu rows match the resolved CLI's `debug models` output.
- Codex catalog: when the local CLI does not list `gpt-5.6-sol`, Tide does not
  show `model:gpt-5.6-sol`.
- Codex default: the provider catalog default is the first selectable local
  Codex model, not a hard-coded latest model.
- Codex default reasoning: explicit older model `gpt-5.5` still labels/selects
  `medium`; new models use the reasoning levels reported by the local catalog.
- Provider detection catalog: Codex readiness/catalog environment carries the
  resolved executable path and version when available.

## Implementation Notes

1. Fix advisory propagation first. The current checker has correct comparison logic,
   but the background refresh result is not enough unless the renderer gets a fresh
   selected-agent advisory.
2. Keep the update chip renderer and terminal handoff; they already match the desired
   interaction.
3. Keep the desktop fallback Codex catalog conservative; dynamic local catalog
   rows replace it when the resolved CLI reports them.
4. After implementation, update the desktop version and release a new build only if
   the user wants the fix shipped immediately.
