# Spec: Start Composer Provider CLI Update Refresh

## Scope

Fix the provider CLI update path from the Start Composer:

- Clicking the non-blocking `Update <Agent>` chip from the Start Composer must open
  a Provider Readiness Terminal Pane in the Composer Draft Thread.
- When that update terminal exits with `retry_preflight`, Tide must refresh the
  update advisory and the provider model catalog for the updated agent, so Codex
  model rows such as GPT-5.6 appear after the local CLI reports them.

This spec is the missing connection between:

- `version-management.md` Lane 2.
- `composer-draft-thread.md`.
- `codex-cli-version-catalog-defaults.md`.
- `provider-catalog-ownership-and-model-selection.md`.

## Evidence

- The composer renders the update chip on the Start Composer and promises a
  terminal handoff: `composer.tsx:203-217` dispatches
  `provider_readiness / update_available:terminal`.
- The Agent Chat row handler can open the update terminal only when it receives a
  thread id: `choice-surfaces.ts:50-55` returns `command: null` when both
  `state.thread?.threadId` and `activeThreadId` are absent.
- `selectProductShellChoiceSurfaceRow` forwards `state.activeThreadId` into Agent
  Chat, but it does not create a Draft Thread: `composer-bridge.ts:79-99`.
- Product Shell already has the correct Start Composer host primitive:
  `ensureComposerDraftThreadActive` lazily creates a Draft Thread, makes it the
  active backend Workbench target, and returns a `thread.createDraft` command:
  `workbench.ts:309-360`.
- The agent menu path already uses that primitive before readiness handoff:
  `composer-handlers.ts:342-360` selects the agent, ensures a Draft Thread, and
  dispatches `provider.checkReadiness`.
- Provider CLI update completion already refreshes cached versions before
  readiness re-check: `thread-runtime-service.ts:1486-1503` calls
  `providerReadinessPort.refreshUpdateAdvisories?.()` and then re-checks
  readiness even when there is no pending input.
- That same completion path only requests a provider catalog refresh for opencode:
  `thread-runtime-service.ts:1490-1495`.
- The async event type hard-codes the catalog refresh request to opencode:
  `thread-runtime-events.ts:25-28`.
- Live Backend handles any catalog-refresh async event by calling the opencode-only
  emitter: `live-backend.ts:410-413`, and that emitter always calls
  `detection.getProviderCatalog({ agentId: "opencode" })`: `live-backend.ts:461-472`.
- Codex catalog reads are already local-CLI based:
  `provider-detection.ts:136-161` returns `codexCatalog.get()`, and
  `codex-model-catalog.ts:82-86` runs `codex debug models` against the resolved
  executable.
- Model menu opening also requests a provider catalog on demand:
  `composer-handlers.ts:280-296`. This is a fallback refresh point, but it is not
  enough for the promised update flow because the completed update should push
  fresh state without requiring the user to know to reopen the menu.

## Decisions

1. **Start Composer update uses the Composer Draft Thread.** The update chip is
   allowed to render before a Thread starts, but clicking it must first ensure a
   Draft Thread when no active thread host exists.

2. **Draft Thread creation stays in Product Shell.** Agent Chat remains a pure
   surface reducer that can return `command: null` without a host. Product Shell
   owns `ensureComposerDraftThreadActive` and should wrap Start Composer
   provider-readiness terminal rows before calling the Agent Chat selector.

3. **The update terminal runs in the Workbench, not a modal and not silently.**
   It uses the existing `workbench.command / open_terminal` path with
   `terminalRole: "provider_readiness"` and `expectedCompletion:
   "retry_preflight"`.

4. **No app reload.** After the provider-native update command exits, Tide updates
   state through backend events. The app window is not reloaded and the backend
   process is not restarted as part of this slice.

5. **Catalog refresh is provider-general.** Replace the opencode-only async event
   with a provider-id catalog refresh request. Live Backend should call
   `detection.getProviderCatalog({ agentId })` and emit `providerCatalog.changed`
   for that agent.

6. **Codex update completion pushes a fresh catalog.** A Codex update terminal
   exit should re-read `codex debug models` and emit `providerCatalog.changed`
   for Codex, so the Product Shell catalog/default model state can update
   without waiting for a manual model-menu open.

7. **Provider readiness remains the update chip source.** `providerReadiness.changed`
   clears or updates the advisory for the active Draft Thread/Start Composer.
   `providerInventory.changed` remains the startup/background advisory source.

## Out Of Scope

- Auto-installing or auto-updating CLIs without a user click.
- Reloading the Tide app or restarting the backend after provider CLI update.
- Hard-coding Codex version thresholds or GPT-5.6 availability tables.
- Changing the local-Codex-catalog policy: installed `codex debug models` remains
  the runnable source of truth.
- App self-update behavior.

## Domain Model

No new user-facing entity is needed.

Existing model pieces:

- **Composer Draft Thread**: backend Thread host created before send for visible
  Workbench panes.
- **Provider Update Advisory**: `ProviderReadiness.update`, including
  `terminalAction`.
- **Provider Catalog Snapshot**: `ProviderCatalogSnapshotDto` emitted via
  `providerCatalog.changed`.

The existing async event should become provider-general:

```ts
type ThreadRuntimeAsyncEvent =
  | {
      kind: "provider_catalog_refresh_requested";
      agentId: ProviderCliAgentId;
    }
```

## Contracts

No shared renderer/backend command or event shape change is required.

Internal backend event change:

- `provider_catalog_refresh_requested.agentId` broadens from `"opencode"` to
  `ProviderCliAgentId`.

Existing contracts reused:

- `thread.createDraft`
- `workbench.command` with `command: "open_terminal"`
- `providerReadiness.changed`
- `providerCatalog.changed`

## Flow

### Start Composer Update Click

1. Product Shell receives `onChoiceSurfaceRowSelect("provider_readiness",
   "update_available:terminal")`.
2. If the Start Composer has no active thread host, Product Shell calls
   `ensureComposerDraftThreadActive`.
3. Product Shell dispatches `thread.createDraft` first when a draft was newly
   created.
4. Product Shell calls `selectProductShellChoiceSurfaceRow` with the ensured state.
   The Agent Chat selector now receives `activeThreadId` and returns
   `workbench.command / open_terminal`.
5. Product Shell dispatches the terminal command. The Workbench opens beside the
   Start Composer and runs the update action.

### Update Terminal Exit

1. Workbench terminal exits.
2. `expectedCompletion: "retry_preflight"` triggers backend readiness completion
   handling.
3. Backend awaits `refreshUpdateAdvisories()`.
4. Backend emits `provider_catalog_refresh_requested` for the thread's agent.
5. Backend re-checks provider readiness and emits `providerReadiness.changed`.
6. Live Backend handles the catalog refresh request by calling
   `detection.getProviderCatalog({ agentId })` and emitting
   `providerCatalog.changed`.
7. Product Shell folds the provider readiness and catalog updates into state. For
   Codex, if the updated CLI now reports GPT-5.6 rows, the model menu/defaults use
   that fresh catalog.

## Invariants

- Clicking `Update <Agent>` from the Start Composer never no-ops solely because no
  Thread has been sent yet.
- Draft Thread creation precedes any pre-send provider-readiness terminal command.
- The visible chat remains the Start Composer after Draft Thread creation;
  `agentChat.thread` stays `null` until send.
- Provider CLI update is advisory-only: it does not block sending and does not
  force app reload.
- The Codex model menu only shows GPT-5.6 after the installed Codex CLI reports
  those rows through `codex debug models`.
- Update terminal completion refreshes both version/advisory evidence and provider
  catalog evidence for agents whose catalogs can depend on the local CLI.

## Tests

- Product Shell: selecting `provider_readiness / update_available:terminal` on a
  Start Composer with `draftThreadId === null` returns/dispatches
  `thread.createDraft` followed by `workbench.command / open_terminal` for the
  draft thread.
- Product Shell: selecting the same row when a Draft Thread already exists reuses
  that draft and dispatches only `workbench.command / open_terminal`.
- Product Shell: selecting the same row from an existing Thread does not create a
  Draft Thread and uses the active Thread id.
- Agent Chat: the lower-level selector may still return `command: null` when no
  thread id is supplied; Product Shell is responsible for supplying one.
- Backend service: a Codex provider-readiness terminal exit with
  `retry_preflight` emits `provider_catalog_refresh_requested` with
  `agentId: "codex"` before/alongside the readiness re-check events.
- Backend service: opencode still emits the same catalog refresh request through
  the generalized event.
- Live Backend: handling `provider_catalog_refresh_requested` for Codex emits a
  `providerCatalog.changed` event whose catalog comes from
  `detection.getProviderCatalog({ agentId: "codex" })`.
- Integration: after a fake Codex update changes `codex debug models` from
  `gpt-5.5` to `gpt-5.6-sol`, terminal exit causes Product Shell to receive the
  new Codex catalog without reopening the model menu.

## Implementation Notes

- The smallest renderer fix is a special branch in
  `composer-handlers.ts` for
  `surfaceKind === "provider_readiness" && rowId === "update_available:terminal"`.
  It should mirror the agent-menu handoff shape: ensure draft, dispatch
  `thread.createDraft`, then dispatch the selected terminal command.
- If broader cleanup is desired, Product Shell can provide a helper for all
  provider-readiness terminal rows from the Start Composer. Keep direct trust
  rows separate because they issue `provider.trustWorkspace`, not
  `open_terminal`.
- Generalize `emitOpencodeProviderCatalogChanged` into an
  `emitProviderCatalogChanged(agentId)` helper in Live Backend.
- Generalize `ThreadRuntimeAsyncEvent.provider_catalog_refresh_requested.agentId`
  to `ProviderCliAgentId`.
- In `replayPendingInputIfProviderReady`, keep opencode's existing readiness
  catalog refresh, and emit provider-general catalog refresh for
  `providerReadinessKind === "update_available"` so Codex update completion re-reads
  `codex debug models` without changing unrelated Codex readiness terminal event
  ordering.
- Do not add a forced app reload. If the updated CLI executable path changes in a
  way `which` cannot see from the current backend environment, the terminal output
  and remaining advisory are the honest state. Installed provider CLI updates
  should run the resolved executable's own update command only when that command
  is advertised.
