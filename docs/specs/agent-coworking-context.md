# Spec: Agent Coworking Context

## Overview

### As-Is

- Tide's Agent Gateway already lets external processes observe and act on panes, but `capture-pane` only reads `Terminal` and `Editor` panes today.
- `Diff` panes already have internal selection extraction, while `Browser` panes currently only expose URL-bar selection state; arbitrary page selection is not exposed through the Agent Gateway.
- There is no first-class `Context Artifact` concept for an optional captured selection plus comment, no explicit list/read/send flow, and no paired-agent delivery contract.
- Session persistence saves workspace layout and pane wiring, but not coworking artifacts.
- `Browser` panes track URL-bar state and render-mode HTML, but arbitrary page selection capture is not yet part of the gateway contract.
- Tide's vision mentions ambient context, but V1 should avoid automatic prompt injection in favor of explicit artifact pull.
- The explicit add-comment badge is currently rendered from shared header code without `Dock` versus `Stage` context, so the affordance can appear in `Stage` even though delivery is bound to a Pane's `Associated Terminal`.
- Immediate `Context Artifact` delivery is currently event-only. The owner-scoped `context-artifact-delivered` notification contains metadata such as `artifact_id`, but it does not inject artifact text into the paired `Terminal` or place the artifact body directly into the event payload.
- The add-comment flow already captures `Editor` Pane selection through `capture_context_comment_snapshot()`, but the spec does not yet lock `Markdown Pane` behavior in `LivePreviewMode`, where the visible selection content can differ from the raw Markdown buffer.

### To-Be

- A user can add a comment from a `Dock` Pane and create a `Context Artifact`, with captured selection content included when available.
- `Context Artifact` state is Workspace-local and session-local for V1.
- The paired agent for the source `Pane` can explicitly list and read available artifacts through MCP.
- New artifacts are delivered immediately to the paired agent when the user creates or explicitly sends them.
- Immediate delivery includes two surfaces: owner-scoped gateway notification for explicit subscribers, and formatted `Terminal` input injection when the paired `Terminal` is live in the active `Workspace`.
- All artifact create/read/send operations are authorized by the source Pane's `Associated Terminal`.
- `Browser` selection capture works for both normal navigation panes and render-mode `Browser` panes.
- Tide does not auto-inject ambient context in V1; agents pull context explicitly when they need it.
- The explicit add-comment affordance appears only for `Dock` panes whose paired agent is currently gateway-connected.
- A `Dock` `Markdown Pane` in `LivePreviewMode` can open the `Context Comment Composer` without leaving authoring mode.
- When the source `Pane` is a `Markdown Pane` in `LivePreviewMode`, the captured selection content matches the visible selection text shown to the human.
- The `Context Comment Composer` accepts multiline comments without sacrificing the existing explicit submit flow.

### Approach

1. Define the missing glossary terms so the workspace-local artifact model uses Tide's domain language consistently.
2. Add a Workspace-local `Context Artifact` store that lives in memory and swaps with the active Workspace, but is not serialized into session persistence.
3. Extend the Agent Gateway and MCP bridge with explicit artifact create, list, read, and send operations.
4. Capture selection data from `Terminal`, `Editor`, `Diff`, and `Browser` panes, including browser-page selection from normal navigation mode.
5. Enforce `Associated Terminal` authorization on every artifact flow so delivery stays bound to the source Pane's paired agent.
6. Keep the explicit add-comment badge `Dock`-scoped and tied to paired-agent availability so `Stage` panes and disconnected agent sessions do not advertise a paired-agent action outside the `Dock` context.
7. Format delivery text once per artifact and write it into the paired `Terminal` using the same bracketed-paste safety rules Tide already uses for explicit paste.
8. Include artifact body fields in the owner-scoped delivery event so explicit gateway subscribers can react without a separate immediate read.
9. Lock `Markdown Pane` `LivePreviewMode` artifact capture so add-comment uses the human-visible selection content without forcing preview-only mode.
10. Preserve the explicit submit gesture while allowing multiline comment input and a visible composer caret as the comment grows.

## Bounded Contexts

| Context | Role |
|---------|------|
| `cli_adapter` | Defines the Agent Gateway command surface and MCP bridge for explicit artifact flows. |
| `pane` | Provides selection extraction for `Terminal`, `Editor`, `Diff`, and `Browser` panes. |
| `browser` | Captures URL-bar selection state for Browser panes and normalizes browser-specific selection state. |
| `webview_bridge` | Moves Browser-originated selection data through the macOS WKWebView bridge into Tide. |
| `event_loop_adapter` | Drains Browser-originated bridge messages and hands them to the Agent Gateway command path. |
| `workspace_infra_service` | Keeps the live Workspace-local artifact store aligned with workspace switching. |
| `associations` | Resolves the source Pane's `Associated Terminal` for authorization and delivery. |
| `terminal` | Hosts the paired agent session that receives immediate artifact delivery. |

## Use Cases

### UC-1: PaneSelectionCapture

- **Actor**: Human or agent
- **Trigger**: A selection is requested from a `Terminal`, `Editor`, or `Diff` Pane
- **Precondition**: The Pane has a current selection or a selection range
- **Flow**:
  1. Tide reads the selected text and selection metadata from the Pane
  2. Tide returns the source `PaneId`, range, and selected content
  3. The caller can use the result to create or send a `Context Artifact`
- **Postcondition**: Selection data is available to the explicit artifact flow
- **Business Rules**:
  - BR-1: `Terminal`, `Editor`, and `Diff` Pane selection capture is supported
  - BR-2: Selection data includes source `PaneId` and range metadata

### UC-2: BrowserPaneSelectionCapture

- **Actor**: Human or agent
- **Trigger**: A selection is requested from a normal or render-mode `Browser` Pane
- **Precondition**: The `Browser` Pane has a visible page selection
- **Flow**:
  1. Tide reads the selected page content and browser-specific selection metadata
  2. Tide normalizes the result into the same artifact input shape used by other Pane kinds
  3. The caller can use the result to create or send a `Context Artifact`
- **Postcondition**: Browser selection data is available to the explicit artifact flow
- **Business Rules**:
  - BR-3: Both normal navigation `Browser` panes and render-mode `Browser` panes are supported
  - BR-4: Browser selection results are normalized into the shared artifact input shape

### UC-3: AddCommentCreatesContextArtifact

- **Actor**: Human
- **Trigger**: The human opens the add-comment flow from a `Dock` Pane and submits a comment
- **Precondition**: The source `Dock` Pane has a gateway-connected paired agent
- **Flow**:
  1. Tide captures the current selection when the source Pane has one, or falls back to an empty selection preview when it does not
  2. Tide combines the captured content, comment, and source `PaneId`
  3. Tide creates a Workspace-local `Context Artifact`
  4. Tide marks the artifact as pinned when requested
  5. Tide makes the artifact available for explicit agent read and delivery
- **Postcondition**: A `Context Artifact` exists in the current Workspace
- **Business Rules**:
  - BR-5: The artifact stores source `PaneId`, optional selection data, and comment text
  - BR-6: The artifact is Workspace-local and session-local in V1
  - BR-17: The explicit add-comment affordance appears only for `Dock` panes with a gateway-connected paired agent
  - BR-18: The explicit add-comment affordance can remain visible and open the `Context Comment Composer` even when no text selection is active
  - BR-21: A `Dock` `Markdown Pane` in `LivePreviewMode` can open the `Context Comment Composer` while remaining in authoring mode
  - BR-22: `Markdown Pane` artifact capture in `LivePreviewMode` uses the visible selected text rather than hidden Markdown syntax markers
  - BR-23: The `Context Comment Composer` accepts multiline comment text from `Shift+Enter` and pasted newline content while keeping plain `Enter` as the submit gesture
  - BR-24: The `Context Comment Composer` keeps the active caret visible inside the composer input viewport as multiline text grows

### UC-4: ArtifactReadAndList

- **Actor**: Paired agent or human
- **Trigger**: An explicit MCP or CLI read/list request
- **Precondition**: The caller is operating from the same Workspace as the artifact
- **Flow**:
  1. Tide lists artifacts visible to the caller's Workspace
  2. Tide returns an individual artifact when the caller requests a specific one
  3. Tide never exposes artifacts from other Workspaces
- **Postcondition**: The caller can explicitly inspect available artifacts
- **Business Rules**:
  - BR-7: Read/list operations are Workspace-local
  - BR-8: Read/list operations do not expose artifacts from other Workspaces

### UC-5: ImmediateArtifactDelivery

- **Actor**: Tide
- **Trigger**: A `Context Artifact` is created or explicitly sent
- **Precondition**: The source Pane has a valid `Associated Terminal`
- **Flow**:
  1. Tide resolves the source Pane's `Associated Terminal`
  2. If the paired `Terminal` is live, Tide formats the artifact as explicit coworking input and writes it to that `Terminal`
  3. Tide emits an owner-scoped `context-artifact-delivered` event containing the artifact body
  4. Tide keeps both delivery surfaces scoped to that one paired agent
- **Postcondition**: The paired agent receives the artifact without cross-terminal fanout
- **Business Rules**:
  - BR-9: Immediate delivery targets only the paired agent for the source Pane
  - BR-10: Artifact delivery never crosses terminal boundaries
  - BR-19: Owner-scoped delivery events include the artifact body needed for explicit subscriber handling
  - BR-20: Live paired-terminal delivery uses formatted `Terminal` input injection

### UC-6: AssociatedTerminalAuthorization

- **Actor**: Human or agent
- **Trigger**: A create, read, list, or send request references an artifact from another terminal boundary
- **Precondition**: The request does not match the source Pane's `Associated Terminal`
- **Flow**:
  1. Tide resolves the artifact's source Pane and paired terminal
  2. Tide compares the request against the source Pane's `Associated Terminal`
  3. Tide rejects the request if the terminal does not match
- **Postcondition**: Only the paired agent can operate on the artifact
- **Business Rules**:
  - BR-11: Artifact flows require the source Pane's `Associated Terminal`
  - BR-12: Mismatched terminal requests are denied

### UC-7: WorkspaceLocalNonPersistentLifecycle

- **Actor**: Tide
- **Trigger**: The user switches Workspaces or restarts the app
- **Precondition**: Context Artifacts exist in one or more Workspaces
- **Flow**:
  1. Tide keeps artifacts attached to the active Workspace while the app is running
  2. Tide swaps the live artifact store with the active Workspace during Workspace switches
  3. Tide does not serialize artifacts into restart session files in V1
  4. Restarting the app clears the live artifact store
- **Postcondition**: Artifacts are Workspace-local during the session and are not restored after restart
- **Business Rules**:
  - BR-13: Context Artifacts are session-local and Workspace-local only
  - BR-14: Context Artifacts are not persisted to restart session files in V1

### UC-8: MCPCommandSurfaceExposure

- **Actor**: Human or agent
- **Trigger**: The caller lists MCP tools to discover the explicit coworking surface
- **Precondition**: Tide's Agent Gateway is running
- **Flow**:
  1. Tide advertises the explicit artifact tools in the MCP tool list
  2. The caller can discover the selection, create, list, read, and send commands
  3. The caller can use those tools to drive the explicit artifact flow
- **Postcondition**: The MCP surface exposes the coworking commands required by V1
- **Business Rules**:
  - BR-15: MCP exposes explicit Context Artifact tools in its tool list
  - BR-16: The explicit artifact tool names remain stable and match the behavior tests

## Invariants

1. A `Context Artifact` is always bound to exactly one source `PaneId`.
2. Every `Context Artifact` is bound to exactly one `Associated Terminal`.
3. A `Context Artifact` is visible only inside its owning Workspace during the current app session.
4. Immediate delivery goes only to the paired agent for the source Pane.
5. V1 does not auto-inject ambient context into agent prompts.
6. Browser selection capture must work for both normal `Browser` panes and render-mode `Browser` panes.

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1, BR-2 | `capture_selection_returns_editor_text_and_range_metadata` |
| UC-1 | BR-1, BR-2 | `capture_selection_returns_diff_text_and_range_metadata` |
| UC-1 | BR-1, BR-2 | `capture_selection_supports_terminal_pane` |
| UC-2 | BR-3, BR-4 | `capture_selection_supports_navigation_and_render_browser_panes` |
| UC-3 | BR-5, BR-6 | `add_comment_creates_workspace_local_contextartifact` |
| UC-3 | BR-17 | `dock_selection_with_gateway_connected_paired_agent_opens_context_comment_composer` |
| UC-3 | BR-17 | `stage_selection_does_not_open_context_comment_composer` |
| UC-3 | BR-17 | `dock_selection_without_gateway_connected_paired_agent_does_not_open_context_comment_composer` |
| UC-3 | BR-18 | `dock_pane_with_gateway_connected_paired_agent_opens_context_comment_composer_without_selection` |
| UC-3 | BR-21 | `dock_live_preview_selection_opens_context_comment_composer` |
| UC-3 | BR-22 | `live_preview_context_artifact_capture_uses_visible_selected_text` |
| UC-3 | BR-23 | `shift_enter_in_context_comment_composer_inserts_newline` |
| UC-3 | BR-23 | `pasted_newlines_are_preserved_in_context_comment_composer` |
| UC-3 | BR-24 | `context_comment_composer_keeps_caret_visible_when_comment_wraps` |
| UC-4 | BR-7, BR-8 | `contextartifact_list_and_read_are_workspace_scoped` |
| UC-5 | BR-9, BR-10 | `send_contextartifact_targets_only_the_paired_agent` |
| UC-5 | BR-19 | `submit_context_comment_composer_delivery_event_includes_artifact_body` |
| UC-5 | BR-20 | `contextartifact_terminal_input_is_formatted_for_paired_agent_injection` |
| UC-6 | BR-11, BR-12 | `contextartifact_requests_require_the_source_associated_terminal` |
| UC-7 | BR-13, BR-14 | `contextartifacts_are_workspace_local_and_not_persisted_to_session` |
| UC-8 | BR-15, BR-16 | `mcp_tools_list_exposes_contextartifact_commands` |

## Location

| Layer | Key Files |
|-------|-----------|
| **Spec** | `docs/specs/agent-coworking-context.md` |
| **Glossary** | `docs/glossary.md` |
| **Gateway surface** | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs`, `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs` |
| **Workspace-local state** | `crates/tide-app/src/application/services/workspace_infra_service/mod.rs` |
| **Association checks** | `crates/tide-app/src/domain/state/associations.rs`, `crates/tide-app/src/application/services/pane_create_service/mod.rs` |
| **Pane selection capture** | `crates/tide-app/src/domain/pane/mod.rs`, `crates/tide-app/src/domain/pane/editor.rs`, `crates/tide-app/src/domain/pane/diff.rs`, `crates/tide-app/src/domain/pane/browser.rs` |
| **Browser page selection bridge** | `crates/tide-app/src/adapter/outward/platform_adapter/macos/webview.rs`, `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` |
| **Behavior tests** | `crates/tide-app/src/application/behavior_tests/agent_coworking_context.rs` |
