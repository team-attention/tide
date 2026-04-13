# Spec: Agent Auto-Integration

## Overview

### As-Is

- `TideSettings.auto_integration` is persisted in `crates/tide-app/src/domain/state/settings.rs` and defaults to `true`.
- `discover_agent_resources()` in `crates/tide-app/src/domain/terminal/mod.rs` discovers bundled resources for the fixed Wrapped Agent set: `claude`, `codex`, and `gemini`.
- Every new `Terminal` exports `TIDE_SOCKET`, `TIDE_PANE`, `TIDE_WORKSPACE`, and `TIDE_BIN`. When auto-integration is enabled, the PTY environment also injects `__TIDE_WRAPPER_DIR` and overrides `ZDOTDIR` so Tide's shell integration can place the bundled wrappers ahead of the real commands.
- The checked-in Claude and Gemini wrappers currently map their documented hook names into `tide notify` lifecycle events, but they do not yet forward the hook `stdin` JSON that already contains response text for `Notification` and `AfterAgent`.
- The checked-in Codex wrapper now uses the official Codex `notify` config to invoke `tide notify codex-turn-complete --pane ... --agent codex`, with the completed-turn JSON payload appended by Codex as the final argv item, and keeps a shell `EXIT` fallback lifecycle path.
- The checked-in Codex-specific spec already requires a documented `UserPromptSubmit` hook so each new Codex turn can return the source `Pane` to `Running`, while wrapper launch only marks `Wrapped Agent Presence`.
- There is still no checked-in Tide integration for a Codex `NeedsInput` lifecycle signal.

### To-Be

- Keep auto-integration zero-config for the fixed Wrapped Agent set: `claude`, `codex`, and `gemini`.
- Keep the Codex wrapper aligned with the official Codex turn-complete notification contract and the documented `UserPromptSubmit` hook instead of treating Codex as launch/exit-only.
- Let wrapper launch mark `Wrapped Agent Presence` without forcing `Running`, so Tide chrome can distinguish connected-idle from an active turn.
- Forward documented hook `stdin` JSON from the checked-in Claude and Gemini wrappers so Tide can derive a `Notification Snippet` from official hook payload fields instead of guessing from shell output alone.
- Continue to treat wrapper-managed lifecycle signals as the only source of Wrapped Agent attention.

### Approach

1. Keep resource discovery and PTY environment injection as the only auto-integration boundary inside Tide.
2. Treat `tide notify` as the primary wrapper signal path, with wrapped-agent OSC 9 fallback only where the checked-in wrapper actually implements it.
3. Keep the supported Wrapped Agent list fixed to `claude`, `codex`, and `gemini`.
4. Use the official Codex `notify` config to forward the completed-turn payload into Tide's Codex-specific classifier without guessing unofficial Codex behavior.
5. Let checked-in wrappers opt into `tide notify --payload-stdin` when their official hook docs guarantee JSON on `stdin`.
6. Verify bundled wrapper contracts with behavior tests that read the checked-in wrapper resources instead of guessing external coding-agent configuration.

## Adapter Contracts

The wrapper scripts are the agent-specific translation layer. They own the hook, event, and payload names for their agent, then Tide translates the result into the shared `AgentStatus` lifecycle state before UI or routing reads it.

| Agent | Checked-in wrapper inputs | Shared state mapping | Tide entrypoints that own translation |
|-------|--------------------------|----------------------|---------------------------------------|
| `claude` | launch-time `agent-attached`, `Notification` -> `agent-needs-input` with forwarded hook `stdin` JSON, `Stop` -> `agent-idle` with forwarded hook `stdin` JSON, `UserPromptSubmit` -> `agent-running`, `EXIT` -> `agent-detached`, plus OSC 9 fallback `tide:wrapped-agent:claude:<event>` | launch -> presence only, `Notification` -> `NeedsInput`, `Stop` -> `Idle`, `UserPromptSubmit` -> `Running`, `EXIT` -> clear presence | `crates/tide-app/resources/bin/claude`, `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs::run_notify`, `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs::cli_notify`, `crates/tide-app/src/app.rs::handle_terminal_notification`, `crates/tide-app/src/app.rs::route_agent_notification`, `crates/tide-app/src/application/services/workspace_infra_service/mod.rs::refresh_workspace_agent_notification`, `crates/tide-app/src/application/services/workspace_service/mod.rs::activate_notification_target` |
| `codex` | launch-time `agent-attached`, `UserPromptSubmit` -> `agent-running`, official `notify` completed-turn `codex-turn-complete` with appended JSON payload, `EXIT` -> `agent-detached`, plus OSC 9 fallback `tide:wrapped-agent:codex:<event>` | launch -> presence only, `agent-running` -> `Running`, completed-turn payload -> `Idle` or `NeedsInput` via the Codex-specific helper in `docs/specs/codex-needs-input-attention.md`, `EXIT` -> clear presence | `crates/tide-app/resources/bin/codex`, `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs::run_notify`, `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs::cli_notify`, `crates/tide-app/src/app.rs::handle_terminal_notification`, `crates/tide-app/src/app.rs::route_agent_notification` |
| `gemini` | launch-time `agent-attached`, `BeforeAgent` -> `agent-running`, `AfterAgent` -> `agent-idle` with forwarded hook `stdin` JSON, `Notification` -> `agent-needs-input` with forwarded hook `stdin` JSON, `EXIT` -> `agent-detached`, plus OSC 9 fallback `tide:wrapped-agent:gemini:<event>` | launch -> presence only, `BeforeAgent` -> `Running`, `AfterAgent` -> `Idle`, `Notification` -> `NeedsInput`, `EXIT` -> clear presence | `crates/tide-app/resources/bin/gemini`, `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs::run_notify`, `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs::cli_notify`, `crates/tide-app/src/app.rs::handle_terminal_notification`, `crates/tide-app/src/app.rs::route_agent_notification`, `crates/tide-app/src/application/services/workspace_infra_service/mod.rs::refresh_workspace_agent_notification`, `crates/tide-app/src/application/services/workspace_service/mod.rs::activate_notification_target` |

The common routing rule is the same for all three agents: macOS notification routing consumes only the normalized `AgentStatus`, while chrome derives `AgentChromeState` from `AgentStatus` plus `Wrapped Agent Presence`.

## Bounded Contexts

| Context | Role |
|---------|------|
| `terminal` | Discovers bundled wrapper resources and injects wrapper-related environment into each `Terminal` PTY |
| `gateway` | Receives wrapper-managed lifecycle reports through `notify` and stores `AgentStatus` |
| `wrapper` | Encodes the evidence-backed agent-specific launch contract for `claude`, `codex`, and `gemini` |

## Use Cases

### UC-1: DiscoverAgentResources

- **Actor**: Tide App
- **Trigger**: App startup after the Agent Gateway socket path is ready
- **Precondition**: The app bundle resources are available under `Contents/Resources`
- **Flow**:
  1. Tide resolves the bundled wrapper directory
  2. Tide resolves the bundled shell-integration directory
  3. Tide caches those paths for later `Terminal` creation
- **Postcondition**: Future `Terminal` spawns can opt into Tide-managed wrapper integration
- **Business Rules**:
  - BR-1: Auto-integration resource discovery is limited to the bundled `claude`, `codex`, and `gemini` wrapper set
  - BR-2: Missing resource directories leave wrapper injection disabled instead of guessing external locations

### UC-2: InjectWrapperEnvironment

- **Actor**: `Terminal`
- **Trigger**: A `Terminal` PTY is created
- **Precondition**: Tide knows the current Gateway socket path and Pane identity
- **Flow**:
  1. Tide exports `TIDE_SOCKET`, `TIDE_PANE`, `TIDE_WORKSPACE`, and `TIDE_BIN`
  2. If auto-integration is enabled, Tide also exports wrapper and shell-integration environment
  3. The child shell starts with Tide's wrapper path available
- **Postcondition**: A Wrapped Agent launched from that `Terminal` can discover Tide without manual setup
- **Business Rules**:
  - BR-3: `TIDE_BIN` is exported even when wrapper auto-integration is disabled
  - BR-4: Wrapper path injection only happens while auto-integration is enabled

### UC-3: ReportWrappedAgentLifecycle

- **Actor**: Wrapped Agent
- **Trigger**: A bundled wrapper emits a lifecycle report
- **Precondition**: The child process inherited Tide's environment
- **Flow**:
  1. The wrapper calls `tide notify` when available
  2. If the checked-in wrapper supports it, the wrapper may fall back to wrapped-agent OSC 9
  3. Tide updates `AgentStatus` through the Gateway path
- **Postcondition**: Tide receives only wrapper-managed lifecycle state
- **Business Rules**:
  - BR-5: Wrapper-managed lifecycle reports must carry a Pane identity
  - BR-6: Wrapper transport details must stay grounded in the checked-in wrapper resources, not assumed from external coding-agent docs

### UC-4: PreserveCodexWrapperContract

- **Actor**: Tide wrapper maintainer
- **Trigger**: The bundled Codex wrapper changes
- **Precondition**: `crates/tide-app/resources/bin/codex` is the source of truth
- **Flow**:
  1. The Codex wrapper injects Tide MCP server config into the real `codex` command
  2. The Codex wrapper reports `agent-attached` before exec
  3. The Codex wrapper configures Codex `notify` to forward the completed-turn payload into Tide's Codex-specific classifier
  4. The Codex wrapper keeps an `EXIT` fallback for `agent-detached`
  5. Tide does not assume an unsupported Codex `NeedsInput` signal beyond the checked-in script
- **Postcondition**: Codex integration remains evidence-backed and stable
- **Business Rules**:
  - BR-7: The Codex wrapper injects Tide MCP server config and nothing broader than the checked-in `mcp_servers.tide.*` overrides
  - BR-8: The Codex wrapper reports `agent-attached` on launch
  - BR-9: The Codex wrapper forwards the official Codex completed-turn payload through the checked-in `notify` config
  - BR-10: The Codex wrapper keeps an `EXIT` fallback for `agent-detached`
  - BR-11: The Codex wrapper does not claim a Codex `NeedsInput` signal without checked-in Tide integration
  - BR-12: The Codex `NeedsInput` decision belongs to the Tide-side helper documented in `docs/specs/codex-needs-input-attention.md`, not to the wrapper script

### UC-5: ForwardStructuredHookPayloads

- **Actor**: Tide wrapper maintainer
- **Trigger**: A checked-in Claude or Gemini wrapper hook needs Tide-visible response text
- **Precondition**: The official hook contract provides JSON on `stdin`
- **Flow**:
  1. The wrapper calls `tide notify ... --payload-stdin`
  2. `tide notify` forwards the raw hook `stdin` JSON into the Gateway request payload
  3. Tide derives a `Notification Snippet` from documented payload fields when routing attention
- **Postcondition**: Tide can build a notification body from official wrapper payload fields without shell-side JSON parsing
- **Business Rules**:
  - BR-13: Claude `Notification` and `Stop` hook commands forward their hook `stdin` JSON through `tide notify --payload-stdin`
  - BR-14: Gemini `Notification` and `AfterAgent` hook commands forward their hook `stdin` JSON through `tide notify --payload-stdin`
  - BR-15: `tide notify --payload-stdin` must be additive to the existing explicit event and `PaneId` arguments

## Invariants

1. Auto-integration stays limited to the bundled `claude`, `codex`, and `gemini` wrappers.
2. Tide does not guess coding-agent hook APIs or config keys beyond what the checked-in wrapper resources prove.
3. PTY environment injection remains the only auto-integration path Tide owns directly.
4. Wrapper payload forwarding uses only documented hook `stdin` JSON or checked-in official agent payloads.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-4 | BR-7 | `codex_wrapper_injects_tide_mcp_and_turn_complete_notify` |
| UC-4 | BR-8 | `codex_wrapper_injects_tide_mcp_and_turn_complete_notify` |
| UC-4 | BR-9 | `codex_wrapper_injects_tide_mcp_and_turn_complete_notify` |
| UC-4 | BR-10 | `codex_wrapper_injects_tide_mcp_and_turn_complete_notify` |
| UC-4 | BR-11 | `codex_wrapper_injects_tide_mcp_and_turn_complete_notify` |
| UC-4 | BR-12 | `codex_completed_turn_payload_classifies_idle_or_needs_input` |
| UC-1 | BR-1 | `wrapper_scripts_are_generated_at_known_path` |
| UC-5 | BR-13 | `claude_wrapper_forwards_hook_stdin_payloads_for_notification_and_stop` |
| UC-5 | BR-14 | `gemini_wrapper_forwards_hook_stdin_payloads_for_notification_and_after_agent` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Settings | `crates/tide-app/src/domain/state/settings.rs` | Persists the auto-integration toggle with a `true` default |
| Terminal | `crates/tide-app/src/domain/terminal/mod.rs` | Discovers wrapper resources and injects wrapper-related PTY environment |
| Wrapper | `crates/tide-app/resources/bin/codex` | Defines the evidence-backed Codex wrapper contract |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verifies the checked-in wrapper contract without guessing external agent config |
