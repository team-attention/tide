# Spec: Mid-Thread Launch Option Changes

## Scope

Make Model / Permission / Effort changes on an **active Thread** actually apply to the
Agent Runtime. Today they are cosmetic: the chip changes, the runtime keeps its
spawn-time settings forever. The glossary already states the intent ("Model Chip —
after launch it opens or mirrors the provider-native model In-Session Command when
supported").

UX requirement (user decision): seamless. A change applies **at the next turn at the
latest**, with no extra UI states — when a runtime restart is needed it happens under
the existing "Working…" spinner at send time. A turn already in flight is never killed.

## Evidence

- Renderer: `updateComposerLaunchOptions` (agent-chat-shell-state.ts) patches
  `thread.launchOptions` in renderer memory only and returns `command: null`. The next
  `composer.sendInput` carries `launchOptions`, but the backend uses them only for the
  readiness check and queue storage — never persists them, never tells the runtime.
- `AgentRuntimePort.resume()` does not even accept `launchOptions`
  (`AgentRuntimeResumeInput` lacks the field), so a respawned runtime also ignores
  changes. `AgentResumePlanInput.launchOptions` already exists and the claude / codex /
  gemini `buildResumePlan` implementations already consume it — the value just never
  arrives.
- The queue flush in `recordTurnComplete` drops `pendingInput.launchOptions` entirely.
- claude 2.1.173 binary contains the stream-json control subtypes
  `set_permission_mode` and `set_model` (the official Agent SDK's
  setPermissionMode/setModel path).
- codex-cli 0.136 app-server bindings: `TurnStartParams` accepts `model`, `effort`,
  `approvalPolicy`, `sandboxPolicy` as overrides "for this turn and subsequent turns";
  `ThreadResumeParams` accepts `model`, `approvalPolicy`, `sandbox` (simple
  `SandboxMode` string — unlike `TurnStartParams.sandboxPolicy`, which is a structured
  object Tide cannot safely construct).
- ACP: `session/set_mode` is callable any time (Tide already calls it once after
  `session/new`); gemini and opencode both support `session/load` resume (gemini
  `buildResumePlan` already rebuilds `--model` argv + `modeId` from launchOptions).
- Thread metadata persistence happens in live-backend `persistThreadEvents` for a
  fixed set of event kinds (`thread.started/hydrated/archived/pinChanged/renamed`).

## Decisions

1. Picking Model / Permission / Effort on an active Thread sends an explicit
   `thread.setLaunchOptions` command (Start Composer behavior unchanged). The
   renderer keeps its optimistic chip patch.
2. The backend merges + persists immediately (new `thread.launchOptionsChanged`
   event, added to the persisted-kind list), so the chip survives app restart even if
   the user never sends again.
3. Application strategy is integration-owned, two mechanisms:
   - **live**: the protocol can reconfigure the running session.
   - **restart**: defer a runtime restart; at the next send (idle or queue flush) the
     old process is stopped and the provider-native resume respawns with the new
     options. Never mid-turn.
4. Per-provider matrix:

   | change     | claude                                | codex                          | gemini                         | opencode |
   |------------|---------------------------------------|--------------------------------|--------------------------------|----------|
   | model      | live `set_model` (sentinel "Claude default" → restart) | live `turn/start` override     | restart (`--model` argv + `session/load`) | n/a (not consumed) |
   | permission | live `set_permission_mode`            | restart (`thread/resume` takes simple `sandbox`+`approvalPolicy`) | live `session/set_mode`        | n/a |
   | reasoning  | restart (`--effort` argv)             | live `turn/start` `effort` override | n/a                            | n/a |

   codex permission is restart-based because the live per-turn override would require
   constructing a structured `SandboxPolicy` (writableRoots, networkAccess, …) Tide
   would have to guess; `ThreadResumeParams.sandbox` takes the same simple string the
   start path already maps.
5. `composer.sendInput`'s piggybacked `launchOptions` keep working and route through
   the same merge/apply helper (covers races; queued sends need no special casing —
   the thread record is already updated when the flush runs).
6. codex `thread/resume` now re-sends the launch protocolParams (it currently sends
   only `{threadId}`), so post-restart codex sessions also honor options.

## Out Of Scope

- Interrupting an in-flight turn to apply a change immediately.
- opencode model/permission consumption (its launch plan consumes neither today).
- Runtime-accurate model menus (ACP session/new `models` — separate backlog item).
- Worktree/branch/scope changes on an active thread (still Start-Composer-only).

## Domain Model

- `ThreadRecord.pendingRuntimeRestart?: boolean` — in-memory only. Set when a change
  could not be applied live to a live runtime; consumed (stop + clear handle) right
  before the next turn starts. Not persisted: after an app restart there is no live
  process, and the fresh spawn reads the persisted launchOptions anyway.
- `SessionConfigUpdatePlan` (agent-integration domain):
  `{ kind: "live", protocolParams: Record<string, unknown> } | { kind: "restart" }`.
- `AgentIntegrationPort.buildSessionConfigUpdate?(input: { launchOptions, changedKeys })`
  — optional; absent ⇒ restart (conservative default).
- `AgentRuntimePort.applySessionConfig(handle, { agentId, launchOptions, changedKeys })`
  → `"applied" | "restart_required"`.
- `StructuredRuntimeClient.applyConfig?(protocolParams)` — provider-protocol delivery
  (claude control_request / codex turn-override stash / ACP session/set_mode).
- `AgentRuntimeResumeInput.launchOptions?` — wired through to `buildResumePlan`.

## Contracts

- Command `thread.setLaunchOptions` `{ threadId, launchOptions }` → result
  `{ thread }` (full merged summary).
- Event `thread.launchOptionsChanged` `{ thread }` — persisted (metadata save) and
  applied by the renderer (agent-chat thread + product-shell thread list).

## Flow

1. User picks a row in the Model/Permission menu on an active Thread.
   Renderer patches local state (instant chip) **and** emits
   `thread.setLaunchOptions` with the merged options. Only patches whose keys are
   ⊆ {model, permission, reasoning} are sent (worktree/branch menus stay local).
2. Backend `updateThreadLaunchOptions`:
   a. merge into `thread.launchOptions`, bump `updatedAt`, emit
      `thread_launch_options_changed` (→ persisted).
   b. diff old vs new on {model, permission, reasoning}; no diff → done.
   c. live runtime? → `applySessionConfig`. `"applied"` → done (next turn uses it).
      `"restart_required"` → `pendingRuntimeRestart = true`.
      No live runtime → nothing else (resume/start reads thread.launchOptions).
3. Next turn start (idle send path, queue flush in `recordTurnComplete`, and the
   pending-input replay paths): if `pendingRuntimeRestart` and a live handle exists →
   `stop(handle)`, clear handle + flag, then the existing `activeOrResumedHandle`
   respawns via provider-native resume (claude `--resume`, codex `thread/resume`,
   ACP `session/load`) with the new options. The spinner ("starting/running") covers
   the respawn — no new UI state.

## Invariants

- A model/permission/effort change on an active Thread is reflected in the provider
  turn that starts after the change (live) or in the next user-initiated turn
  (restart) — never silently dropped.
- An in-flight turn is never interrupted by a settings change.
- `thread.launchOptions` (backend record + persisted metadata) is the single source
  of truth after the command lands; chips re-derive from it.
- Spawn/resume paths always receive the thread's current launchOptions.
- Unknown providers / absent `buildSessionConfigUpdate` degrade to restart, never to
  silent no-op (except integrations that consume no options — they return live/{}).

## Tests

- service: setLaunchOptions persists + emits event; live-applied → no restart flag;
  restart_required → flag set, next send stops old handle and resumes with new
  options; queue-flush path honors the flag; resume passes launchOptions; sendInput
  piggyback routes through the same helper.
- runtime port: applySessionConfig routes integration plan → client.applyConfig;
  restart plan / missing hooks → restart_required.
- claude integration: model/permission → live params; reasoning or "Claude default"
  → restart. codex: model/reasoning → live {model, effort}; permission → restart.
  gemini: permission → live {modeId}; model → restart.
- claude client: applyConfig writes set_model / set_permission_mode control requests.
- codex client: applyConfig stashes overrides; next turn/start includes them;
  thread/resume includes protocolParams.
- acp client: applyConfig sends session/set_mode (deferred until session adopted).
- renderer: model/permission/effort row on an active thread emits
  thread.setLaunchOptions + keeps optimistic patch; Start Composer emits nothing;
  thread.launchOptionsChanged event updates chat + thread list state.

## Implementation Notes

- claude control requests: fire-and-forget like `interrupt()` (`control_response`
  success/error is logged under TIDE_DEBUG_STRUCTURED). LIVE-VERIFIED on claude
  2.1.173: both `{subtype:"set_permission_mode", mode}` and
  `{subtype:"set_model", model}` return `control_response success`
  (set_permission_mode also emits a `system status` line with the new mode).
  set_model additionally injects a `user` line with string content
  ("<local-command-stdout>Set model to …</local-command-stdout>") — harmless:
  emitContentRecords ignores non-array content, so no stray transcript block.
- codex turn overrides ride **every** subsequent `turn/start` once set (protocol says
  "this turn and subsequent turns"; re-sending is idempotent).
- codex `ReasoningEffort` accepts low/medium/high/xhigh — Tide's existing values.
- ACP set_mode before session adoption: stash and send right after `session/new`
  response (same place the initial set_mode happens).
- The restart stop() must clear `thread.activeRuntimeHandle` in the service — exit
  events do not clear it.
