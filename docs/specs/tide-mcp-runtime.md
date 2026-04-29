# Spec: Tide MCP Runtime

## Overview

### As-Is

Tide exposes Agent Gateway commands and MCP tools for Pane, layout, Browser Pane, Render Pane, and Context Artifact work, but the current surface is split by implementation detail. The MCP instruction string says the Stage holds Terminals and each Terminal owns a Dock as the Terminal Context Surface, then lists `tide_resize_pane` beside Browser Pane tools. In source, `tide_resize_pane` maps to `resize-pane`, which changes only the Stage `SplitLayout` parent ratio. Terminal Context Surface width is stored separately as Dock width and can currently be changed by mouse drag through `DockPort::set_dock_width`, but that product-level layout target is not exposed through a provider-neutral MCP action.

Repo evidence:

| Area | Evidence |
|------|----------|
| Agent Gateway MCP bridge | `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs` initializes MCP with one instruction string and maps `tide_*` tools to Agent Gateway methods. |
| Current low-level tools | `mcp.rs` exposes `tide_list_panes`, `tide_get_layout`, `tide_resize_pane`, `tide_open_browser`, BrowserSnapshot tools, Browser Pane action tools, and Context Artifact tools. |
| Stage resize behavior | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` handles `resize-pane` by calling `layout_set_split_ratio`, which mutates the Stage `SplitLayout` only. |
| Terminal Context Surface width | `crates/tide-app/src/domain/state/dock.rs` stores `dock_width`; `layout_compute.rs` uses it as the Terminal Context Surface width and clamps it against the available window width. |
| Existing port | `crates/tide-app/src/application/ports/inward/dock_port/mod.rs` already exposes `set_dock_width`, but no Agent Gateway command models this as a product-level Layout Target. |
| Provider neutrality | `docs/specs/open-terminal-codex-app.md` says wrapped-agent integration targets `claude`, `codex`, and `gemini`, and its invariants say no user-facing workflow may require Codex CLI specifically unless explicitly under the Codex wrapper path. |

### To-Be

Tide exposes a provider-neutral Tide MCP Runtime that agents can use before any Pane-specific work. It describes product surfaces, visible geometry, focus, and supported layout mutations in one place. Browser work inside Tide defaults to Tide Browser Pane Runtime for Codex, Claude, Gemini, and future Wrapped Agents. External Browser Runtime is an explicit fallback identity, not the default.

Browser work is modeled as a Browser Operation when a user asks an agent to operate a Browser Pane. The operation starts no later than the first Tide Browser Pane runtime tool, keeps Agent Browser Control Mode and Browser Automation Cursor visible during the task, and finishes after the final observation or the Wrapped Agent's idle signal.

The runtime must not add a one-off Dock resize tool. Instead, it must expose a general Layout Target action surface. Terminal Context Surface width, Stage Pane split ratio, and future FileTree View width are layout target mutations, not separate tool families.

### Approach

1. Add glossary terms for Tide MCP Runtime, Layout Target, Tide Browser Pane Runtime, External Browser Runtime, and Browser Runtime Router.
2. Add `tide_observe_workspace` as the provider-neutral preflight tool for visible surfaces, Pane geometry, focus, and Browser Pane visual fit.
3. Add `tide_layout_action` as the unified layout mutation tool. V1 supports `resize` for `terminal_context_surface` and `pane_split` Layout Targets.
4. Keep legacy `tide_resize_pane` for compatibility, but describe `tide_layout_action` as the preferred product-level layout path.
5. Update MCP instructions so Codex, Claude, Gemini, and other Wrapped Agents use the same Tide Browser Pane Runtime default and only use External Browser Runtime after explicit user request or unsupported fallback.
6. Disable Codex Browser Use plugin inside Tide-wrapped Codex launches so the provider-specific browser runtime remains an explicit External Browser Runtime fallback instead of a competing default.
7. Add `tide_browser_operation` as explicit Browser Operation transaction control and make `tide_open_browser`, `tide_browser_observe`, and `tide_browser_action` implicitly enter operation visuals for authorized Wrapped Agents. Agents still finish an operation after final observation.
8. Make Terminal Context Surface resize through `tide_layout_action` use the existing SurfaceVisibilityAnimation path so MCP-triggered layout correction is visually continuous instead of an instant Dock width jump.

## Bounded Contexts

| Context | Path | Responsibility |
|---------|------|----------------|
| Agent Gateway | `adapter/inward/cli_adapter/` | MCP tool definitions, provider-neutral instructions, command dispatch, and JSON responses. |
| Layout | `domain/layout/` | Stage and Terminal Context Surface `SplitLayout` ratio mutation. |
| Dock | `application/services/dock_service/` | Terminal Context Surface ownership and width mutation behind `DockPort`. |
| Pane | `domain/pane/` | PaneKind, Terminal Context Surface membership, Browser Pane runtime identity, and Browser visual fit reporting. |
| Workspace | `application/services/workspace_*` | Active Workspace, focus, and cross-workspace caller routing. |

## Use Cases

### UC-1: ObserveTideWorkspace

Actor: Wrapped Agent or external MCP client

Trigger: The agent needs to inspect Tide before browser, editor, diff, or layout work.

Precondition: Agent Gateway is connected to a Tide Instance.

Flow:

1. Agent calls `tide_observe_workspace`.
2. Tide computes current layout geometry.
3. Tide returns focus, Stage surface geometry, active Terminal Context Surface geometry when visible, Pane entries with surface membership, and Browser Pane visual fit.
4. Tide includes Browser Runtime Router policy with Tide Browser Pane Runtime as default and External Browser Runtime as explicit fallback only.

Postcondition: The agent can choose a Tide tool using product-level Tide state instead of guessing from text-only Pane snapshots.

Business Rules:

- BR-1: The response must use provider-neutral runtime names and must not require Codex, Claude, Gemini, or any provider-specific browser tool.
- BR-2: Pane entries must identify whether the Pane is in Stage or Terminal Context Surface.
- BR-3: Browser Pane entries must report `visual_fit` using their visible `Rect`.
- BR-4: The response must include the active Terminal Context Surface owner and resize capability when that surface is visible.
- BR-5: Browser Pane visual fit that is `too_small` or `not_visible` must include Tool Selection Guidance that selects `tide_layout_action` as the normal next tool and lists re-observation as the next step before Browser Pane content actions; app-internal API calls, URL parameter shortcuts, and BrowserSnapshot-only targeting must not be presented as equivalent substitutes.

### UC-2: ResizeLayoutTarget

Actor: Wrapped Agent or external MCP client

Trigger: A Tide surface is too small for the requested task.

Precondition: The target Layout Target exists in the active Workspace.

Flow:

1. Agent calls `tide_layout_action` with `action=resize`.
2. For `target.kind=terminal_context_surface`, Tide adjusts the Terminal Context Surface width through `DockPort`.
3. For `target.kind=pane_split`, Tide adjusts the owning Stage or Terminal Context Surface `SplitLayout` ratio for the target Pane.
4. Tide recomputes layout and returns the effective target geometry plus animation metadata when the target animates.

Postcondition: The layout changes through a product-level Layout Target action without adding implementation-shaped resize tools.

Business Rules:

- BR-1: `tide_layout_action` must reject unknown actions and unknown Layout Target kinds.
- BR-2: Terminal Context Surface resize must be expressed as a Layout Target mutation, not as a Dock-specific MCP tool.
- BR-3: Pane split resize must work for Stage Panes and Terminal Context Surface Panes.
- BR-4: The response must include the requested action, target, and effective target rect when available.
- BR-5: Terminal Context Surface resize initiated by `tide_layout_action` must start SurfaceVisibilityAnimation from the current rendered width to the requested width.

### UC-3: RouteBrowserRuntime

Actor: Wrapped Agent running Codex, Claude, Gemini, or another agent CLI

Trigger: User asks the agent to inspect or operate a browser.

Precondition: The agent is running inside Tide with Agent Gateway MCP available.

Flow:

1. The wrapper and MCP instructions define Browser Runtime Router policy.
2. The agent uses Tide Browser Pane Runtime by default for local preview, file-backed preview, public page review, visual verification, and Browser Pane comments.
3. The agent uses External Browser Runtime only after Tide reports unsupported capability or the user explicitly asks for an external browser runtime.
4. Tool responses identify runtime as `tide_browser_pane` or `external_browser_runtime`.

Postcondition: Browser work stays human-visible in Tide by default across Codex, Claude, and Gemini.

Business Rules:

- BR-1: MCP instructions must say agents must use Tide Browser Pane Runtime as the first runtime for supported browser work inside Tide.
- BR-2: MCP instructions must keep the default browser guidance focused on Tide Browser Pane Runtime and avoid naming fallback runtimes in the normal browser path.
- BR-3: Tide Browser Pane Runtime responses must identify themselves as shared and human-visible.
- BR-4: The Codex wrapper must disable Codex Browser Use plugin for Tide-wrapped sessions so Browser Use remains an explicit External Browser Runtime fallback.

### UC-4: HoldBrowserOperation

Actor: Wrapped Agent running Codex, Claude, Gemini, or another agent CLI

Trigger: User asks the agent to use a Browser Pane for a bounded task such as opening a page, inspecting the rendered result, searching on a page, or filling a form.

Precondition: The target Browser Pane exists and the Caller Pane belongs to the Wrapped Agent's active Terminal boundary.

Flow:

1. Agent opens, focuses, observes, acts on, or explicitly starts the Browser Pane through Tide Browser Pane Runtime.
2. Tide checks the same wrapper-managed caller gates used by Agent Browser Control Mode.
3. Tide enters Agent Browser Control Mode for authorized Wrapped Agents and makes Browser Automation Cursor visible without rendering tool-label text beside it.
4. Agent operates through `tide_browser_observe` and `tide_browser_action`, using `tide_layout_action` first when Tool Selection Guidance reports poor Browser Pane visual fit.
5. Agent calls `tide_browser_operation` with `action=finish` after the final observation, or Tide clears the operation when the Wrapped Agent reports Idle or NeedsInput.

Postcondition: The Browser tab/header and Browser Automation Cursor visibly communicate that the Wrapped Agent is operating the Browser Pane for the whole task, not only for individual clicks.

Business Rules:

- BR-1: `tide_browser_operation` must expose `start` and `finish` actions through the provider-neutral MCP tool surface.
- BR-2: Starting a Browser Operation through `tide_browser_operation`, `tide_open_browser`, or `tide_browser_observe` for an authorized Wrapped Agent must enter Agent Browser Control Mode and keep Browser Automation Cursor visible even before the first click.
- BR-3: Finishing a Browser Operation must clear Agent Browser Control Mode and Browser Automation Cursor for that Browser Pane.
- BR-4: MCP instructions must tell agents to prefer human-like Browser Pane observe/action work inside a Browser Operation and not replace it with shell/backend/API shortcuts, credential-bearing URL shortcuts, URL parameter shortcuts, or DOM mutation shortcuts unless the user explicitly asked to test that internal route.
- BR-5: Repeated Browser Pane runtime calls in the same Browser Operation must keep the operation stable instead of regenerating Agent Browser Control Mode.
- BR-6: Wrapped Agent Idle or NeedsInput lifecycle signals must clear Browser Operation visual state for Browser Panes owned by that Terminal.

## Invariants

1. Tide MCP Runtime is provider-neutral. It can describe Codex, Claude, or Gemini as a Wrapped Agent, but its layout and Browser Pane tools do not require any one provider.
2. Layout Target names are product concepts. MCP callers should not need to know `dock_width`.
3. Terminal Context Surface remains attached to the focused Stage Terminal and backed by that Terminal's context `SplitLayout`.
4. Legacy tools can remain for compatibility, but new agent guidance prefers product-level runtime tools.
5. Browser work inside Tide defaults to Tide Browser Pane Runtime and must remain human-visible when the target is supported.
6. Browser Operation state is per Browser Pane and does not create a second browser runtime.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1: ObserveTideWorkspace | BR-1, BR-2, BR-4 | `tide_mcp_runtime` | `observing_workspace_reports_provider_neutral_surfaces_and_panes` |
| UC-1: ObserveTideWorkspace | BR-3 | `tide_mcp_runtime` | `observing_workspace_reports_browser_visual_fit` |
| UC-1: ObserveTideWorkspace | BR-5 | `tide_mcp_runtime` | `observing_workspace_guides_layout_correction_before_browser_workarounds` |
| UC-2: ResizeLayoutTarget | BR-1, BR-2, BR-4, BR-5 | `tide_mcp_runtime` | `layout_action_resizes_terminal_context_surface_target` |
| UC-2: ResizeLayoutTarget | BR-3 | `tide_mcp_runtime` | `layout_action_resizes_terminal_context_surface_pane_split` |
| UC-3: RouteBrowserRuntime | BR-1, BR-2, BR-3 | `tide_mcp_runtime` | `mcp_instructions_route_browsers_provider_neutrally` |
| UC-3: RouteBrowserRuntime | BR-4 | `agent_gateway` | `codex_wrapper_disables_browser_use_plugin_inside_tide` |
| UC-4: HoldBrowserOperation | BR-1, BR-4 | `tide_mcp_runtime` | `mcp_instructions_route_browsers_provider_neutrally` |
| UC-4: HoldBrowserOperation | BR-2, BR-3 | `browser_agent_runtime` | `browser_operation_transaction_keeps_agent_indicator_and_cursor_visible_until_finish` |
| UC-4: HoldBrowserOperation | BR-2, BR-5 | `browser_agent_runtime` | `browser_observe_starts_operation_visuals_and_keeps_generation_stable` |
| UC-4: HoldBrowserOperation | BR-6 | `browser_agent_runtime` | `wrapped_agent_idle_clears_browser_operation_visuals` |

## Location

| Layer | Path | Notes |
|-------|------|-------|
| Spec | `docs/specs/tide-mcp-runtime.md` | This file. |
| Glossary | `docs/glossary.md`, `.krow/language.md` | Provider-neutral runtime terms. |
| MCP bridge | `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs` | Tool definitions, mapping, and instructions. |
| Gateway commands | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | `observe-workspace`, `layout-action`, and `browser-operation`. |
| Dock port/service | `crates/tide-app/src/application/ports/inward/dock_port/mod.rs`, `crates/tide-app/src/application/services/dock_service/mod.rs` | Terminal Context Surface width and split ratio mutations. |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/tide_mcp_runtime.rs` | Living spec coverage. |
