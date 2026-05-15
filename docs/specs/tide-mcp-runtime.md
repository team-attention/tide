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
| Codex wrapper injection | `crates/tide-app/resources/bin/codex` creates a stable Tide-owned `CODEX_HOME`, symlinks the user's Codex home entries, and injects Tide MCP config with `mcp_servers.tide.*`. |
| Failed Codex open selection | `/Users/eatnug/.codex/sessions/2026/04/29/rollout-2026-04-29T17-49-26-019dd86d-c63d-7072-b456-6c6758650b44.jsonl` used `/private/tmp/tide-codex-home.azzYY8`, proving the wrapper was active, but called shell `open` for a YouTube URL without any `mcp__tide__` tool call. |
| Successful Codex open selection | `/Users/eatnug/.codex/sessions/2026/04/29/rollout-2026-04-29T14-35-43-019dd7bc-6c0d-7571-86ca-9a3bababa40c.jsonl` used `/private/tmp/tide-codex-home.GdnIaH` and called `tool_search` before using `mcp__tide__` `tide_open_browser`. |
| Claude wrapper injection | `crates/tide-app/resources/bin/claude` injects Tide MCP config with `--mcp-config "$MCP_FILE"` and hooks with stable `--settings "$HOOKS_FILE"`. `claude --help` shows `--append-system-prompt`, which is a non-mutating wrapper surface for additional startup guidance. |
| Gemini wrapper injection | `crates/tide-app/resources/bin/gemini` injects Tide MCP config and hooks through stable `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`. Gemini CLI source reads `context.includeDirectories` when `context.loadMemoryFromIncludeDirectories` is true and loads `GEMINI.md` files from those directories. |
| Gemini skill limitation | `gemini skills list --all` failed with `Agent skills is disabled by your administrator`, so Gemini skill injection is not a reliable Tide wrapper surface. |

### To-Be

Tide exposes a provider-neutral Tide MCP Runtime that agents can use before any Pane-specific work. It describes product surfaces, visible geometry, focus, and supported layout mutations in one place. Browser work inside Tide defaults to Tide Browser Pane Runtime for Codex, Claude, Gemini, and future Wrapped Agents. External Browser Runtime is an explicit fallback identity, not the default.

MCP startup instructions orient a Wrapped Agent to Tide's structure and available surfaces without encoding every routing decision as global policy. The instructions should describe that Tide is a terminal-centered task Workspace with a Stage Terminal, Terminal Context Surface, FileTree View, Workspace rail, and Pane kinds. Individual MCP tool descriptions then carry the exact intent and placement rules for opening files, Browser Panes, layout surfaces, Terminal commands, capture, selection, and Context Artifacts.

Wrapped Agents also receive Tide Tool Discovery Context through their native startup guidance surfaces. Codex gets a stable Tide-owned skill in its `CODEX_HOME` overlay, Claude gets appended system-prompt guidance, and Gemini gets a stable Tide-owned `GEMINI.md` memory file loaded through its context include directory. The context tells agents to prefer Tide MCP tools for open, show, view, browser, file, URL, and preview requests before using macOS default-app commands.

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
9. Keep startup MCP instructions as concise Tide structure and capability orientation, while moving specific open/show/view intent boundaries into the relevant tool descriptions.
10. Add Tide Tool Discovery Context to each checked-in Agent Wrapper using the agent's native non-mutating startup surface.
11. For Codex, inject a stable Tide skill into the wrapper-owned `CODEX_HOME` overlay so Codex can discover deferred Tide MCP tools through `tool_search`.
12. For Claude, append Tide Tool Discovery Context with `--append-system-prompt` while keeping the existing MCP and hooks flags.
13. For Gemini, create a stable Tide-owned `GEMINI.md` context file and load it through `context.includeDirectories` plus `context.loadMemoryFromIncludeDirectories` in the wrapper-owned system defaults file.
14. Preserve user Codex skills by creating a real wrapper-owned `skills/` directory in the overlay, symlinking user skill entries into it, and adding the wrapper-owned Tide skill there instead of mutating the user's real Codex home.
15. Route MCP-opened and MCP-closed Terminal Context Surface Panes through the same split transition animation paths used by human split and close actions.
16. Keep background Browser Panes live in an offscreen WKWebView frame computed from their owning Terminal Context Surface layout when that owner is not the active Stage Terminal, so browser load, snapshot, Page Map, and action flows continue without changing human-visible focus.
17. Forward `TIDE_WINDOW` through every Agent Wrapper MCP server configuration so Agent Gateway routes commands to the owning Tide Window before resolving Caller Pane placement.
18. Preserve Terminal text focus during Wrapped Agent Browser Pane setup: MCP `open-browser` may reveal and select the Browser Pane in the caller Terminal's Terminal Context Surface, but it must keep `FocusArea`, focused Pane, active Stage Terminal, and Router focus on the caller Terminal without exposing a Wrapped Agent text-focus transfer argument.
19. Scope `tide_observe_workspace` responses with Caller Pane identity to the caller Terminal boundary, so a Wrapped Agent sees its own Stage Terminal and Terminal Context Surface Panes as ordinary targets and does not receive another Terminal Context Surface's Browser PaneId.
20. Reject live Browser Pane observe, action, operation, and eval calls from a Caller Pane when the target Browser Pane's Associated Terminal is a different Terminal.
21. Keep `focus-pane` as an Agent Gateway CLI compatibility command, but remove `tide_focus_pane` from the Wrapped Agent MCP tool surface; Browser Pane visibility and background work must use open, observe, layout, and Browser Pane runtime tools.

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
- BR-5: Browser Pane visual fit that is `too_small` must include Tool Selection Guidance that selects `tide_layout_action`; Browser Pane visual fit that is `not_visible` because another Terminal Context Surface owner is active must report background Browser Pane runtime availability without selecting or naming a focus tool; both paths list re-observation as the next step before Browser Pane content actions, and app-internal API calls, URL parameter shortcuts, and BrowserSnapshot-only targeting must not be presented as equivalent substitutes.
- BR-6: When `tide_observe_workspace` is called from a Caller Pane, the returned Pane entries must be scoped to the caller Terminal boundary and must not expose other Terminal Context Surface Browser PaneIds as ordinary action targets.

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
- BR-6: Terminal Context Surface resize with an explicit `owner_terminal_id` must target that Terminal's Terminal Context Surface even when another Stage Terminal is focused at command start, without moving human-visible focus.

### UC-3: RouteBrowserRuntime

Actor: Wrapped Agent running Codex, Claude, Gemini, or another agent CLI

Trigger: User asks the agent to inspect or operate a browser.

Precondition: The agent is running inside Tide with Agent Gateway MCP available.

Flow:

1. The wrapper and MCP instructions define Browser Runtime Router policy.
2. The agent uses Tide Browser Pane Runtime by default for local preview, file-backed preview, public page review, visual verification, and Browser Pane comments.
3. The agent uses External Browser Runtime only after Tide reports unsupported capability or the user explicitly asks for an external browser runtime.
4. Tool responses identify runtime as `tide_browser_pane` or `external_browser_runtime`.

Postcondition: Browser work stays inside Tide Browser Pane Runtime by default across Codex, Claude, and Gemini. A Browser Pane is human-visible when its owning Terminal Context Surface is active, and remains background-capable without moving human-visible focus when its owner is inactive.

Business Rules:

- BR-1: MCP instructions must say agents must use Tide Browser Pane Runtime as the first runtime for supported browser work inside Tide.
- BR-2: MCP instructions must keep the default browser guidance focused on Tide Browser Pane Runtime and avoid naming fallback runtimes in the normal browser path.
- BR-3: Tide Browser Pane Runtime responses must identify themselves as shared, Tide-owned, and explicit about visible or background-capable state.
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
- BR-7: Caller-scoped live Browser Pane tools must reject targets whose Associated Terminal differs from the Caller Pane before returning live page state or mutating Browser Pane state.

### UC-5: OrientWrappedAgentToTideStructure

Actor: Wrapped Agent running Codex, Claude, Gemini, or another agent CLI

Trigger: The agent receives MCP initialization instructions, tool definitions, or wrapper-injected startup context.

Precondition: The agent is running inside Tide with Agent Gateway MCP available.

Flow:

1. Tide initializes the MCP server for the Wrapped Agent.
2. MCP startup instructions describe Tide as a terminal-centered task Workspace.
3. The instructions name the Stage Terminal, Terminal Context Surface, FileTree View, Workspace rail, and available Pane kinds.
4. The instructions describe broad MCP capabilities without overloading startup text with every open/show/view routing case.
5. The `tide_open_editor` and `tide_open_browser` tool descriptions state their exact content-opening intent and avoid claiming that every "open" request means a file or Browser Pane.
6. For Codex, the Agent Wrapper adds Tide Tool Discovery Context as a stable skill in the `CODEX_HOME` overlay.
7. For Claude, the Agent Wrapper adds Tide Tool Discovery Context through `--append-system-prompt`.
8. For Gemini, the Agent Wrapper adds Tide Tool Discovery Context through a stable Tide-owned `GEMINI.md` include directory.
9. The Tide Tool Discovery Context tells Wrapped Agents to prefer Tide MCP tools for open, show, view, browser, file, URL, and preview requests before using macOS default-app commands.

Postcondition: The agent starts with enough Tide structure to choose Tide MCP tools naturally, while precise intent selection remains local to tool descriptions.

Business Rules:

- BR-1: MCP startup instructions must describe Tide as a terminal-centered task Workspace.
- BR-2: MCP startup instructions must name Stage, Terminal Context Surface, FileTree View, Workspace rail, and the core Pane kinds.
- BR-3: MCP startup instructions must list available Tide MCP capability families at a high level.
- BR-4: MCP startup instructions must say tool descriptions define exact intent, placement, and limits.
- BR-5: `tide_open_editor` must describe opening an existing file path in an Editor Pane, defaulting to the caller Terminal's Terminal Context Surface and supporting explicit `owner_terminal_id` targeting without moving visible focus for background owners.
- BR-6: `tide_open_browser` must describe opening a URL or empty Browser Pane in Tide and must keep external/default browser behavior as explicit handoff.
- BR-7: The Codex Agent Wrapper must inject Tide Tool Discovery Context into the stable `CODEX_HOME` overlay without mutating the user's real Codex home.
- BR-8: The Claude Agent Wrapper must inject Tide Tool Discovery Context through `--append-system-prompt` without mutating the user's real Claude home.
- BR-9: The Gemini Agent Wrapper must inject Tide Tool Discovery Context through a stable Tide-owned `GEMINI.md` include directory without mutating the user's real Gemini home.
- BR-10: Tide Tool Discovery Context must tell Wrapped Agents to prefer Tide MCP tools before macOS default-app commands when the user asks to open, show, view, browse, inspect, preview, or display files, URLs, local servers, Panes, or Tide surfaces.
- BR-11: Agent Wrapper MCP server configuration must pass `TIDE_WINDOW` with `TIDE_SOCKET` and `TIDE_PANE` so Agent Gateway commands route to the owning Tide Window before resolving Caller Pane placement.
- BR-12: Wrapped Agent MCP tool definitions must not expose `tide_focus_pane` or a text-focus transfer flag; visibility and browser work remain on open, observe, layout, and Browser Pane runtime tools.

### UC-6: AnimateMcpPaneLifecycle

Actor: Wrapped Agent or external MCP client

Trigger: The agent opens or closes a Pane through Tide MCP Runtime.

Precondition: The target Workspace is active and the affected Pane is visible in Stage or Terminal Context Surface.

Flow:

1. Agent calls `tide_open_browser`, `tide_render_html`, or another MCP open tool that creates a Pane in Terminal Context Surface.
2. If Terminal Context Surface already has a visible split, Tide starts `SplitTransitionAnimation` for the new Pane.
3. Agent calls `tide_close_pane`.
4. If the target Pane is in a visible Stage or Terminal Context Surface split, Tide starts the closing `SplitTransitionAnimation` before removing the Pane.

Postcondition: Agent-driven Pane lifecycle changes use the same visible split transition grammar as human actions.

Business Rules:

- BR-1: MCP-opened Terminal Context Surface Panes must start `SplitTransitionAnimation` when they create a visible split in an existing Terminal Context Surface.
- BR-2: `tide_close_pane` must use the split close transition path for visible Stage or Terminal Context Surface splits.
- BR-3: MCP-opened Terminal Context Surface Panes must use Caller Pane context for placement even when another Stage Terminal is focused at command start, without moving human-visible focus.
- BR-4: `tide_open_browser` from an active Caller Pane must reveal the caller Terminal's Terminal Context Surface and make the Browser Pane the active context Pane without moving Terminal text focus away from the caller Terminal.
- BR-5: Agent Gateway `focus-pane` from a Caller Pane must preserve human-visible text focus even when the caller supplies a text-focus transfer flag; when preserving focus for a Terminal Context Surface Pane, it may update that owner's active context Pane. Human-visible text-focus transfer belongs to human UI or non-caller activation paths, not a Wrapped Agent's self-declared tool argument.

## Invariants

1. Tide MCP Runtime is provider-neutral. It can describe Codex, Claude, or Gemini as a Wrapped Agent, but its layout and Browser Pane tools do not require any one provider.
2. Layout Target names are product concepts. MCP callers should not need to know `dock_width`.
3. The visible Terminal Context Surface has one active owner, and Agent Gateway commands with explicit `owner_terminal_id` or Caller Pane context may target a Terminal Context Surface without depending on the human-focused Pane at command start.
4. Legacy tools can remain for compatibility, but new agent guidance prefers product-level runtime tools.
5. Browser work inside Tide defaults to Tide Browser Pane Runtime; active targets remain human-visible, and background targets preserve human-visible focus while structured browser data and actions continue.
6. Browser Operation state is per Browser Pane and does not create a second browser runtime.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1: ObserveTideWorkspace | BR-1, BR-2, BR-4 | `tide_mcp_runtime` | `observing_workspace_reports_provider_neutral_surfaces_and_panes` |
| UC-1: ObserveTideWorkspace | BR-3 | `tide_mcp_runtime` | `observing_workspace_reports_browser_visual_fit` |
| UC-1: ObserveTideWorkspace | BR-5 | `tide_mcp_runtime` | `observing_workspace_guides_layout_correction_before_browser_workarounds` |
| UC-1: ObserveTideWorkspace | BR-5 | `tide_mcp_runtime` | `observing_background_browser_reports_background_runtime_without_focus_tool` |
| UC-1: ObserveTideWorkspace | BR-6 | `tide_mcp_runtime` | `observing_workspace_from_caller_scopes_panes_to_caller_terminal_context_surface` |
| UC-2: ResizeLayoutTarget | BR-1, BR-2, BR-4, BR-5 | `tide_mcp_runtime` | `layout_action_resizes_terminal_context_surface_target` |
| UC-2: ResizeLayoutTarget | BR-3 | `tide_mcp_runtime` | `layout_action_resizes_terminal_context_surface_pane_split` |
| UC-2: ResizeLayoutTarget | BR-6 | `tide_mcp_runtime` | `layout_action_resizes_explicit_terminal_context_surface_owner_without_starting_focus` |
| UC-3: RouteBrowserRuntime | BR-1, BR-2, BR-3 | `tide_mcp_runtime` | `mcp_instructions_route_browsers_provider_neutrally` |
| UC-3: RouteBrowserRuntime | BR-4 | `agent_gateway` | `codex_wrapper_disables_browser_use_plugin_inside_tide` |
| UC-4: HoldBrowserOperation | BR-1, BR-4 | `tide_mcp_runtime` | `mcp_instructions_route_browsers_provider_neutrally` |
| UC-4: HoldBrowserOperation | BR-2, BR-3 | `browser_agent_runtime` | `browser_operation_transaction_keeps_agent_indicator_and_cursor_visible_until_finish` |
| UC-4: HoldBrowserOperation | BR-2, BR-5 | `browser_agent_runtime` | `browser_observe_starts_operation_visuals_and_keeps_generation_stable` |
| UC-4: HoldBrowserOperation | BR-6 | `browser_agent_runtime` | `wrapped_agent_idle_clears_browser_operation_visuals` |
| UC-4: HoldBrowserOperation | BR-7 | `browser_agent_runtime` | `browser_live_tools_reject_wrong_associated_terminal_for_caller` |
| UC-5: OrientWrappedAgentToTideStructure | BR-1, BR-2, BR-3, BR-4 | `tide_mcp_runtime` | `mcp_instructions_describe_tide_structure_and_capabilities` |
| UC-5: OrientWrappedAgentToTideStructure | BR-5, BR-6 | `tide_mcp_runtime` | `open_tool_descriptions_distinguish_content_from_surface_intent` |
| UC-5: OrientWrappedAgentToTideStructure | BR-7, BR-10 | `wrapped_agent_release_integration` | `codex_wrapper_injects_tide_tool_discovery_context` |
| UC-5: OrientWrappedAgentToTideStructure | BR-8, BR-10 | `wrapped_agent_release_integration` | `claude_wrapper_appends_tide_tool_discovery_context` |
| UC-5: OrientWrappedAgentToTideStructure | BR-9, BR-10 | `wrapped_agent_release_integration` | `gemini_wrapper_loads_tide_tool_discovery_context_from_stable_memory` |
| UC-5: OrientWrappedAgentToTideStructure | BR-11 | `wrapped_agent_release_integration` | `agent_wrappers_forward_tide_window_to_mcp_server` |
| UC-5: OrientWrappedAgentToTideStructure | BR-12 | `tide_mcp_runtime` | `mcp_tool_definitions_do_not_expose_focus_pane_or_text_focus_transfer` |
| UC-6: AnimateMcpPaneLifecycle | BR-1 | `tide_mcp_runtime` | `mcp_open_browser_in_terminal_context_surface_starts_split_transition_animation` |
| UC-6: AnimateMcpPaneLifecycle | BR-2 | `tide_mcp_runtime` | `mcp_close_pane_in_terminal_context_surface_starts_split_transition_animation` |
| UC-6: AnimateMcpPaneLifecycle | BR-3 | `tide_mcp_runtime` | `mcp_open_browser_uses_caller_terminal_context_surface_without_moving_focus` |
| UC-6: AnimateMcpPaneLifecycle | BR-4 | `tide_mcp_runtime` | `mcp_open_browser_from_active_caller_reveals_without_stealing_text_focus` |
| UC-6: AnimateMcpPaneLifecycle | BR-5 | `tide_mcp_runtime` | `mcp_focus_pane_from_caller_preserves_text_focus_without_explicit_transfer` |
| UC-6: AnimateMcpPaneLifecycle | BR-5 | `tide_mcp_runtime` | `mcp_focus_pane_from_caller_ignores_text_focus_transfer_flag` |

## Location

| Layer | Path | Notes |
|-------|------|-------|
| Spec | `docs/specs/tide-mcp-runtime.md` | This file. |
| Glossary | `docs/glossary.md`, `.krow/language.md` | Provider-neutral runtime terms. |
| MCP bridge | `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs` | Tool definitions, mapping, and instructions. |
| Agent Wrappers | `crates/tide-app/resources/bin/{codex,claude,gemini}` | Lifecycle hooks, Tide MCP config, and Tide Tool Discovery Context injection. |
| Gateway commands | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | `observe-workspace`, `layout-action`, and `browser-operation`. |
| Dock port/service | `crates/tide-app/src/application/ports/inward/dock_port/mod.rs`, `crates/tide-app/src/application/services/dock_service/mod.rs` | Terminal Context Surface width and split ratio mutations. |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/tide_mcp_runtime.rs` | Living spec coverage. |
| Wrapper behavior tests | `crates/tide-app/src/application/behavior_tests/wrapped_agent_release_integration.rs` | Agent Wrapper context injection coverage. |
