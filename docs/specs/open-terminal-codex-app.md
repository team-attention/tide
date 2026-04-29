# Spec: Open Terminal Codex App

## Overview

### As-Is

Codex app provides a strong command-center experience around local coding threads. The official Codex app docs expose these user-facing axes:

| Codex app axis | Evidence | Tide translation |
|----------------|----------|------------------|
| Thread navigation | Codex app commands include new thread, previous thread, next thread, find in thread, terminal toggle, diff panel toggle, and sidebar toggle. See <https://developers.openai.com/codex/app/commands>. | A `Workspace` must read as the user's task entry in the left rail, while `Terminal` remains the active task surface and Terminal Context Surface Panes stay attached to it. |
| Integrated terminal | Codex app commands include `Toggle terminal`; local environment actions run inside the integrated terminal. See <https://developers.openai.com/codex/app/commands> and <https://developers.openai.com/codex/app/local-environments>. | Tide should keep `Terminal` as the source-of-truth process host. Agent CLI products remain real terminal programs. |
| Review pane | Codex review docs describe reviewing comments and changed files, asking Codex to fix comments, inspecting the diff, then staging, committing, and pushing. See <https://developers.openai.com/codex/app/review>. | `Diff` must become a first-class Terminal Context Surface Pane attached to the active Stage `Terminal`, not a secondary one-off Pane. |
| Local and worktree handoff | Codex worktree docs describe staying on a worktree, handing a thread off to Local, and returning a thread to the same associated worktree. See <https://developers.openai.com/codex/app/worktrees>. | Tide should model task execution mode on `Workspace` and `TerminalContext`, while preserving the existing `GitSwitcher` and worktree primitives. |
| Browser review and browser use | Codex browser docs describe previewing local pages, leaving browser comments, and letting Codex operate the in-app browser after allow/block decisions. See <https://developers.openai.com/codex/app/browser>. | `Browser Pane` should be one of the active Terminal's Terminal Context Surface Panes, with comments delivered as `Context Artifact`s to the `Associated Terminal`. |
| Local environment setup and actions | Codex local environments docs describe setup scripts for worktrees and top-bar actions for common project tasks. See <https://developers.openai.com/codex/app/local-environments>. | Tide should expose per-Workspace run/test/dev-server actions that execute in the active `Terminal` or an explicitly selected `Terminal`. |

Tide already has the important raw materials, but they are not composed into the same product hierarchy:

1. `Workspace` is already the closest Tide equivalent to a Codex thread because it is an isolated set of panes, layout, and focus. `Pane` is only the content container. See [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:11) and [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:15).
2. `WorkspaceManager` owns the Workspace list and active index, and `save_active_workspace()` / `load_active_workspace()` swap `layout`, `focused`, `panes`, Dock extras, focus state, and `Context Artifact`s. This spec reuses that stored Dock machinery as the implementation substrate while presenting a simpler active-Terminal Terminal Context Surface product model. See [workspace_infra_service/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/application/services/workspace_infra_service/mod.rs:211).
3. Tide's current vision already says the right unit is a task that may include commands, code editing, a web page, a diff, and an agent-generated dashboard. See [docs/vision.md](/Users/eatnug/Workspace/tide/docs/vision.md:34).
4. Tide already positions `Terminal` as the substrate, not the final product, and says Tide is not an AI product because users bring their own agent. See [docs/vision.md](/Users/eatnug/Workspace/tide/docs/vision.md:79) and [docs/vision.md](/Users/eatnug/Workspace/tide/docs/vision.md:81).
5. `Associated Terminal` already makes a `Terminal` the cwd context provider for non-terminal Panes. See [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:74).
6. `Browser Pane`, `Diff`, `Editor`, `Terminal`, and `Launcher` are already the five `PaneKind`s. `FileTreeModel` is separate chrome state rather than a `PaneKind`. See [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:90) and [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md:98).
7. `Wrapped Agent` auto-integration already targets `claude`, `codex`, and `gemini` through PTY environment injection and wrapper-managed lifecycle signals. See [docs/specs/agent-auto-integration.md](/Users/eatnug/Workspace/tide/docs/specs/agent-auto-integration.md:17) and [docs/specs/agent-auto-integration.md](/Users/eatnug/Workspace/tide/docs/specs/agent-auto-integration.md:27).
8. `Browser Pane UX` already scopes Browser Pane behavior around truthful URL state, modal layering, loading feedback, unsupported flow boundaries, and explicit external handoff. See [docs/specs/browser-pane-ux.md](/Users/eatnug/Workspace/tide/docs/specs/browser-pane-ux.md:29).
9. Current `Worktree UX` already identifies weak Workspace identity, missing fuzzy switching, disconnected `GitSwitcher`, and inactive Workspace metadata gaps. See [docs/specs/worktree-ux.md](/Users/eatnug/Workspace/tide/docs/specs/worktree-ux.md:13).
10. Current visual hierarchy is too implementation-shaped: the titlebar shows only `Tide` or `Tide . N`-style numbering, inactive Workspaces lack useful metadata, every normal `Pane` gets similar chrome weight, and the current Dock empty state renders as a small command hint rather than a meaningful context area. See [titlebar.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs:99), [titlebar.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs:552), [tab_bar.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs:159), and [tab_bar.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs:106).

The product gap is not that Tide lacks agent internals. The gap is that Tide does not yet present its existing open-terminal model as a Codex-app-like work surface for every coding-agent CLI.

### To-Be

Tide becomes an open-terminal Codex app: a native macOS task environment where each `Workspace` feels like a Codex thread, but the main session is a real `Terminal` that can host Claude Code, Codex CLI, Gemini CLI, another terminal-first coding-agent CLI, or a normal shell.

The design target is:

1. `Workspace` is the task boundary. It owns the visible task identity, compact monitoring state, the Stage `SplitLayout`, the active Terminal's Terminal Context Surface, `Context Artifact`s, and execution metadata.
2. `Terminal` is the main session. Tide does not replace coding-agent CLIs; it makes them observable, addressable, and surrounded by useful `Pane`s.
3. `Workspace` rail is the monitoring surface. It should be only slightly richer than the Codex app left column: compact rows, live status, needs-input state, and a short output or action hint when useful.
4. `Stage` is for the selected task's primary live surface. It normally contains one dominant `Terminal`. Stage terminal splits remain available as a power-user layout operation, but they are not the primary way to monitor multiple tasks.
5. The active Stage `Terminal` owns one Terminal Context Surface. It starts in Stacked view for each newly created Stage `Terminal`, and can contain `Browser Pane`, `Diff`, `Editor`, `Launcher`, secondary `Terminal`, and Render Pane surfaces attached to the selected task.
6. `FileTree View` is a right-side sibling view, not a Terminal Context Surface Pane. It can be visible at the same time as Terminal Context Surface and should occupy the outer-right side.
7. `Diff` is the review surface. It supports review loops that match the Codex app pattern: inspect changes, comment, ask the agent in the `Associated Terminal`, then stage/commit/push through existing Git flows.
8. `Browser Pane` is the verification surface. It supports local preview, browser comments, and browser-use routing where the Browser plugin can operate the in-app browser.
9. Visual hierarchy follows product hierarchy: left rail is task navigation and monitoring, Stage is selected-task execution, the Terminal Context Surface is supporting context, FileTree View is an outer right-side tree view, and per-Pane chrome is quiet until it is useful.

This spec intentionally does not create a new `Thread` aggregate. `Workspace` remains the internal consistency boundary because the current `Workspace` already owns panes, layout, focus, context extras, and `Context Artifact`s.

### Approach

The change should land as a sequence of product layers. Each layer is useful alone and keeps existing domain boundaries intact.

1. Establish the Workspace-as-task shell.
   - Continue using `Workspace` as the task boundary.
   - Rename the user-facing concept in chrome copy from generic Workspace numbering toward task identity, while keeping code-level domain terms as `Workspace`.
   - Reuse and extend `docs/specs/worktree-ux.md` for auto-naming, visual identity, richer sidebar rows, and Workspace fuzzy switching.
   - Keep Workspace rows compact enough to show many concurrent tasks without turning the rail into a card list.

2. Make the open `Terminal` the first-class session.
   - The active Stage `Terminal` is the default owner of task execution.
   - `Wrapped Agent Presence` and `AgentChromeState` stay terminal-owned.
   - Unwrapped agent CLIs and normal shell programs must still work; wrappers only add richer lifecycle state when available.
   - The top bar and Workspace rail should never imply that Tide owns the agent model or transcript unless the signal comes from a `Wrapped Agent`.
   - Do not present ordinary Stage terminal TabGroups as a multi-task monitoring model. Monitoring belongs in the Workspace rail; Stage split is for active comparison or local layout needs, and `ViewMode::Stacked` is the only tab-like Stage view.
   - Keep worktree, branch, cwd, and execution-mode affordances in Pane headers, Workspace rows, the titlebar, or `GitSwitcher`. Do not inject them into the Terminal grid.

3. Simplify context into one active Terminal Context Surface plus one independent FileTree View.
   - Browser, Diff, Editor, Launcher, secondary Terminal, and generated Render Panes attach to the active Stage `Terminal` inside one Terminal Context Surface.
   - The Terminal Context Surface follows the Stage mental model: Split view allows visible splits, while Stacked view shows one active context Pane with a flat tab bar over all context Panes.
   - Context panes should be easy to switch and close, but should not compete with the raw Terminal for primary space.
   - Switching the focused Stage `Terminal` switches the Terminal Context Surface to that Terminal's context layout. If the new Stage `Terminal` has no context panes, the right region collapses or renders an empty context state.
   - FileTree View is not a context pane. It is a separately toggled right-side view that can coexist with Terminal Context Surface as `Stage | Terminal Context Surface | FileTree View`.

4. Make review a product loop.
   - Put `Diff` creation and refresh in the active Terminal's Terminal Context Surface action path.
   - Allow `Context Comment Composer` to attach comments to `Diff`, `Browser Pane`, `Editor`, and `Terminal` selections.
   - Deliver comments to the `Associated Terminal` as `Context Artifact`s.
   - Stage/commit/push remains outside this spec unless an existing Git service already exposes a valid inward port.

5. Make browser verification a product loop.
   - Keep Browser Pane UX hardening rules from `docs/specs/browser-pane-ux.md`.
   - Add a browser comment lane that creates `Context Artifact`s from page selections or screen areas.
   - Keep browser-use explicit and permissioned through the existing Browser plugin surface; Tide should expose the Browser Pane and state, not invent a second browser automation stack.

6. Add local actions as Terminal-bound shortcuts.
   - Define per-project or per-Workspace actions such as run dev server, test, build, lint, and open preview.
   - Execute actions in a selected `Terminal` or a dedicated action `Terminal` in Stage.
   - Surface action state in the titlebar or Terminal Pane header without turning the top bar into a dense toolbar.

7. Fix visual hierarchy by reducing equal-weight chrome.
   - Workspace rail gets stronger identity and status.
   - Stage gets the strongest active surface treatment.
   - The Terminal Context Surface gets a distinct but lightweight treatment so it reads as attached support for the selected Terminal.
   - Inactive Pane headers become quieter; repeated `HeaderActionStrip` actions appear on hover, focus, or empty states.
   - The active `Associated Terminal` relationship should be visible as a subtle affordance when a context tab is focused.
   - Workspace rows stay line-dense. They may show status, branch/cwd, and a short last-event hint, but should not become large preview cards.
   - Major region seams should be compact. Workspace rail, Stage, Terminal Context Surface, and FileTree View should use thin resize/drop affordances instead of thick gutters.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/state/workspace_mgr.rs` | Owns the Workspace list, active index, sidebar state, and future task identity metadata. |
| `application/services/workspace_infra_service/` | Saves, loads, switches, creates, and closes Workspaces; remains the boundary for Workspace hot/cold storage. |
| `domain/layout/` | Keeps `SplitLayout` and `TabGroup` as layout primitives. Stage and Terminal Context Surface both use `SplitLayout`; Stacked view is presentation state, not a second layout owner. |
| `domain/pane/` | Keeps `PaneKind` as the Pane surface model: `Terminal`, `Editor`, `Diff`, `Browser`, `Launcher`. FileTree View is backed by `FileTreeModel`, not `PaneKind`, in V1. |
| `domain/state/file_tree_model.rs` | Owns FileTree View state, root, scroll, cursor, and git-status data. |
| `domain/state/associations.rs` | Keeps `Associated Terminal` as the context owner for non-terminal Panes. |
| `domain/state/context_artifact.rs` | Stores task-local comments and selected context that should be delivered to the paired agent. |
| `application/services/dock_service/` | Owns Dock Pane creation, split, stacked presentation, pin no-op compatibility, and focus behavior for Terminal Context Surface. |
| `application/services/action_service/` | Owns `Context Comment Composer` creation, `Context Artifact` creation, and paired-agent delivery. |
| `adapter/outward/view/chrome/titlebar.rs` | Renders Workspace rail, titlebar identity, status, and local action affordances. |
| `adapter/outward/view/chrome/tab_bar.rs` | Renders Stage chrome, Terminal Context Surface chrome, Pane backgrounds, empty context state, and Browser nav bar. |
| `adapter/outward/view/header.rs` | Renders Pane header content, action tiles, status dots, and TabGroup bars. |
| `adapter/inward/keyboard_adapter/` | Routes command menu, Workspace switching, Terminal Context Surface focus, review shortcuts, and local actions through `GlobalAction`. |
| `adapter/inward/click_adapter/` | Routes Workspace rail clicks, context tab clicks, header action clicks, FileTree View clicks, and Browser/Diff comment interactions through inward ports. |
| `adapter/outward/platform_adapter/macos/webview.rs` | Keeps native `WKWebView` ownership for Browser Pane and BrowserSnapshot capture. |
| `resources/bin/*` | Keeps agent wrapper scripts as optional lifecycle translators for supported `Wrapped Agent`s. |

## Use Cases

### UC-1: NavigateWorkspaceTasks

- **Actor**: User
- **Trigger**: User opens the Workspace rail, command menu, or Workspace picker
- **Precondition**: Tide has one or more Workspaces
- **Flow**:
  1. Tide renders each Workspace as a compact task row with name, cwd or branch, agent status, and a short last-event hint when useful.
  2. User selects a Workspace by click, keyboard navigation, or fuzzy search.
  3. Tide calls the existing Workspace switch path.
  4. The selected Workspace restores its Stage layout, active Terminal Context Surface, focus, and `Context Artifact`s.
- **Postcondition**: The chosen Workspace is active and visually identified in the titlebar and rail.
- **Business Rules**:
  - BR-1: The left rail must use `Workspace` identity, not `Pane` identity, as the top-level task list.
  - BR-2: Switching Workspaces must continue to use `save_active_workspace()` and `load_active_workspace()`.
  - BR-3: Inactive Workspace rows must show enough identity to distinguish task, branch or cwd, and status.
  - BR-4: Workspace visual identity must not create a second state boundary beyond `WorkspaceManager`.
  - BR-5: Workspace rows must remain compact enough to monitor many tasks at once.
  - BR-6: Workspace rows may summarize live task state, but must not become large embedded terminal previews.
  - BR-7: Inactive Workspace rows must derive cwd metadata from their cold-stored Stage `Terminal`.

### UC-2: UseTerminalAsMainSession

- **Actor**: User
- **Trigger**: User runs a coding-agent CLI or shell command in a Stage Terminal
- **Precondition**: A `Terminal` exists in the active Workspace
- **Flow**:
  1. User starts Claude Code, Codex CLI, Gemini CLI, another terminal-first coding-agent CLI, or a normal shell command.
  2. Tide keeps the PTY grid as the source-of-truth session and does not draw task metadata inside it.
  3. If the process is a `Wrapped Agent`, Tide derives `Wrapped Agent Presence` and `AgentChromeState`.
  4. If the process is not wrapped, Tide still allows the user and external MCP clients to observe and operate the Terminal normally.
- **Postcondition**: The task remains usable even when Tide cannot classify the running CLI as a `Wrapped Agent`.
- **Business Rules**:
  - BR-1: The active Stage `Terminal` remains the primary execution surface.
  - BR-2: Lifecycle chrome may use wrapper-managed signals only when a `Wrapped Agent` reports them.
  - BR-3: Tide must not hide or replace the real CLI session with an internal chat transcript.
  - BR-4: Non-terminal Panes created from the task must record an `Associated Terminal`.
  - BR-5: Stage terminal splits are optional layout tools, not the default multi-task monitoring surface. Ordinary Stage `TabGroup`s must not be exposed.
  - BR-6: Worktree, branch, cwd, execution mode, and local action state belong in surrounding chrome, not inside the Terminal grid.

### UC-3: ShowTaskMetadataInChrome

- **Actor**: User
- **Trigger**: User changes worktree, branch, cwd, execution mode, or local action state
- **Precondition**: A Workspace has a Stage `Terminal`
- **Flow**:
  1. Tide derives current metadata from `TerminalContext`, git state, Workspace identity, and local action state.
  2. Tide renders durable task metadata in Workspace rows, the titlebar, or the Terminal Pane header.
  3. Tide leaves the Terminal grid controlled by the running shell or coding-agent CLI.
  4. User can open `GitSwitcher` or an equivalent action from the metadata affordance when a valid inward port exists.
- **Postcondition**: Users see worktree and task context without Tide altering the terminal application UI.
- **Business Rules**:
  - BR-1: Worktree, branch, cwd, and execution-mode metadata must be rendered outside the Terminal grid.
  - BR-2: Terminal Pane header is the preferred place for selected-task metadata that directly describes the active Terminal.
  - BR-3: Workspace row metadata must stay compact and monitoring-oriented.
  - BR-4: Metadata affordances that mutate git or worktree state must route through valid inward ports.

### UC-4: AttachContextToTerminal

- **Actor**: User or agent
- **Trigger**: User opens Browser, Diff, Editor, Launcher, or Render Pane context from the active task, splits context, or toggles Stacked view
- **Precondition**: The active Workspace has a Stage `Terminal`
- **Flow**:
  1. Tide creates the requested Pane inside the active Stage Terminal's Terminal Context Surface.
  2. Tide records the `Associated Terminal`.
  3. Tide focuses the new context tab when immediate user input is expected.
  4. Tide keeps the Terminal visible while switching, splitting, or stacking context Panes.
  5. A newly created Stage `Terminal` starts its Terminal Context Surface in Stacked view; explicit Dock split actions can switch that Terminal Context Surface to Split view.
- **Postcondition**: The active Terminal has supporting task context without being displaced.
- **Business Rules**:
  - BR-1: Supporting Browser, Diff, Editor, Launcher, and Render Panes default to the active Terminal's Terminal Context Surface when opened from a Terminal task.
  - BR-2: Terminal Context Surface Split view must allow multiple visible context Panes through the owning Terminal's context `SplitLayout`.
  - BR-3: Empty context state must invite useful context creation, not merely show a shortcut hint.
  - BR-4: Terminal Context Surface Stacked view must show one active context Pane with a flat tab bar over all context Panes without flattening the stored `SplitLayout`.
  - BR-5: Secondary Terminal panes inside the Terminal Context Surface are subordinate panels and do not create Workspace rows unless explicitly promoted to a Task.
  - BR-6: FileTree View is independent from Terminal Context Surface. It remains visible when Terminal Context Surface is visible and occupies the outer-right region.
  - BR-7: Split actions invoked for Dock must split the Terminal Context Surface, not Stage.
  - BR-8: Each newly created Stage `Terminal` starts with its Terminal Context Surface in Stacked view, independent of another Stage `Terminal`'s current Dock Split/Stacked choice.

### UC-5: SwitchStageTerminalContext

- **Actor**: User
- **Trigger**: User focuses a different Stage `Terminal` inside the active Workspace
- **Precondition**: The active Workspace has more than one Stage `Terminal`, and at least one Stage `Terminal` has context tabs
- **Flow**:
  1. Tide records which Stage `Terminal` is now focused.
  2. Tide switches the right region to that Terminal's Terminal Context Surface.
  3. If the focused Stage `Terminal` has no context tabs, Tide collapses the right region or shows an empty context state.
  4. Tide keeps the previous Stage Terminal's context tabs stored with that Terminal.
- **Postcondition**: Context surfaces always follow the focused Stage Terminal task session.
- **Business Rules**:
  - BR-1: Terminal Context Surface state is attached to the owning Stage Terminal, not globally to the Workspace.
  - BR-2: Switching Stage Terminal must hide the previous Terminal's context tabs from the right region.
  - BR-3: Returning focus to a Stage Terminal restores its prior Terminal Context Surface.
  - BR-4: FileTree View root is recalculated from the focused Stage Terminal's working directory.

### UC-6: ReviewChangesInContextTab

- **Actor**: User
- **Trigger**: User opens review mode, a Diff Pane, or asks an agent to inspect changes
- **Precondition**: The active Workspace has repository changes or a base branch to compare
- **Flow**:
  1. Tide opens or refreshes a `Diff` Pane in the active Terminal's Terminal Context Surface.
  2. User inspects changes alongside the Stage Terminal.
  3. User creates comments on selected diff lines or visible regions.
  4. Tide creates `Context Artifact`s bound to the `Diff` Pane and its `Associated Terminal`.
  5. User asks the agent in the Terminal to address the comments.
- **Postcondition**: Review feedback stays attached to the task and can be delivered to the paired agent.
- **Business Rules**:
  - BR-1: Review surfaces must live inside the active Workspace.
  - BR-2: Diff comments must be representable as `Context Artifact`s.
  - BR-3: Comment delivery must target the paired agent through the `Associated Terminal`.
  - BR-4: Stage/commit/push actions require valid inward ports before implementation.

### UC-7: VerifyInBrowserPane

- **Actor**: User or Browser-capable agent
- **Trigger**: User opens a local route, file-backed preview, or public page in Browser Pane
- **Precondition**: Browser Pane is available and Browser Pane UX invariants hold
- **Flow**:
  1. User or agent starts a dev server in the Terminal or runs a local action.
  2. Tide opens the page in Browser Pane in the active Terminal's Terminal Context Surface.
  3. User reviews rendered state next to the Diff or Terminal.
  4. User leaves comments on elements, screen areas, or page states.
  5. Browser-use may operate the Browser Pane when explicitly requested and allowed.
- **Postcondition**: Browser verification produces precise task-local context for the agent.
- **Business Rules**:
  - BR-1: Browser Pane comments must become `Context Artifact`s.
  - BR-2: Browser-use must operate the in-app Browser Pane, not an unrelated external browser surface.
  - BR-3: Browser Pane unsupported auth, download, and passkey boundaries remain explicit Browser Pane V2 work unless separately specified.
  - BR-4: Browser Pane state must stay truthful when the native `WKWebView` is hidden by `ModalStack` popups.

### UC-8: RunLocalActions

- **Actor**: User
- **Trigger**: User invokes a local action such as run, test, build, lint, or preview
- **Precondition**: The active Workspace has a selected `Terminal` or an action Terminal policy
- **Flow**:
  1. User selects an action from titlebar, command menu, or Workspace action list.
  2. Tide chooses the target Terminal according to action policy.
  3. Tide sends the action command to that Terminal.
  4. Tide surfaces action status without hiding the Terminal output.
- **Postcondition**: Common project commands are repeatable without replacing the open Terminal model.
- **Business Rules**:
  - BR-1: Local actions execute in a real `Terminal`.
  - BR-2: Local actions must not assume a specific coding-agent CLI.
  - BR-3: Action status is visual chrome over Terminal output, not a separate execution state.
  - BR-4: Platform-specific action definitions are configuration, not hard-coded UI behavior.

### UC-9: PreserveVisualHierarchy

- **Actor**: User
- **Trigger**: User works in a Workspace with Stage, a Terminal Context Surface, Browser, Diff, FileTree View, and multiple Panes
- **Precondition**: Multiple surfaces are visible
- **Flow**:
  1. Tide renders Workspace rail as the strongest navigation identity.
  2. Tide renders Workspace rows as compact monitoring surfaces for concurrent tasks.
  3. Tide renders Stage Terminal as the selected task's primary live surface.
  4. Tide renders the Terminal Context Surface as an attached supporting region with lightweight treatment.
  5. Tide renders inactive Pane chrome quietly.
  6. Tide reveals repeated Pane action controls only when the user is focused, hovering, or in an empty creation state.
  7. Tide keeps seams between Workspace rail, Stage, Terminal Context Surface, and FileTree View compact enough that they read as resize/drop affordances, not wasted gutters.
  8. Tide resizes major regions from the rendered seam so the first drag movement does not jump away from the cursor.
  9. Tide renders Stage-to-Terminal Context Surface and Terminal Context Surface-to-FileTree View boundaries as single hairlines, not shadow gutters.
  10. Tide gives the Terminal Context Surface enough default width for Browser Pane work while keeping FileTree View compact.
  11. When FileTree View opens beside an already-open Terminal Context Surface, Tide keeps the right-side support surface budget stable by taking FileTree View width from the Terminal Context Surface first.
  12. Tide preserves minimum usable widths for Terminal Context Surface and FileTree View; only after those minimums are reached may Stage width shrink.
- **Postcondition**: The screen communicates task, execution, context, and Pane details in that order.
- **Business Rules**:
  - BR-1: Workspace identity must be visible even when the rail is collapsed.
  - BR-2: Stage and Terminal Context Surface must be visually distinct, but the Terminal Context Surface must read as attached to the active Terminal.
  - BR-3: Active Terminal and active context tab must not compete at equal visual weight.
  - BR-4: HeaderActionStrip must not create persistent repeated noise across every Pane.
  - BR-5: Ordinary Stage Terminal TabGroups must not be rendered; Stage grouped viewing belongs only to `ViewMode::Stacked`.
  - BR-6: Major region seams must use compact spacing and thin hover/drop affordances.
  - BR-7: Border resize for Workspace rail, Terminal Context Surface, and FileTree View must preserve the current region width when the cursor is on the rendered seam.
  - BR-8: Terminal Context Surface seams must not draw multi-strip shadow gutters.
  - BR-9: New Workspaces must default to a wide Terminal Context Surface and a compact FileTree View so Browser Pane verification is readable without manual resizing.
  - BR-10: Opening FileTree View while Terminal Context Surface is visible must reduce Terminal Context Surface width before reducing Stage width.
  - BR-11: Terminal Context Surface and FileTree View must keep minimum usable widths; once those minimums are reached, Stage may absorb the remaining size pressure.

## Invariants

1. **Workspace boundary**: `Workspace` remains the task boundary. No new `Thread` aggregate may own its own independent pane set, layout, or focus.
2. **PaneId sync**: Every `PaneId` in every loaded `SplitLayout` or Terminal Context Surface must exist in `App.panes`, and every loaded `App.panes` entry must be represented in Stage or an owning Terminal Context Surface even when that context surface is hidden.
3. **Single active Workspace**: Only the active Workspace is loaded into App fields; inactive Workspaces stay cold-stored in `WorkspaceManager`.
4. **Terminal source of truth**: Coding-agent CLIs run as real child processes inside `Terminal` PTYs.
5. **Terminal grid purity**: Tide chrome may surround the Terminal, but must not draw worktree, branch, cwd, action state, or agent transcript UI inside the Terminal grid.
6. **Agent neutrality**: No user-facing workflow may require Codex CLI specifically unless that workflow is explicitly under the Codex wrapper path.
7. **Associated Terminal context**: Every non-terminal task-context Pane created from a Terminal must preserve its `Associated Terminal`; FileTree View derives its root from the focused Stage Terminal's working directory instead of a `PaneId`.
8. **Context locality**: Terminal Context Surface state and `Context Artifact`s remain Workspace-local and attached to the owning Stage Terminal.
9. **Context layout**: Terminal Context Surface split and stacked presentation must be backed by the owning Stage Terminal's context `SplitLayout`; pinned groups remain legacy-only and must not become a second Dock hierarchy.
10. **Wrapper evidence**: `Wrapped Agent` lifecycle UI may only reflect wrapper-managed signals or explicit connected presence.
11. **Browser capability boundary**: Browser Pane remains explicit about unsupported auth, download, passkey, and external handoff behavior.
12. **Visual hierarchy**: Workspace, Stage, Terminal Context Surface, FileTree View, and Pane chrome must not share equal emphasis by default.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1: NavigateWorkspaceTasks | BR-1 | `open_terminal_codex_app` | `workspace_rail_lists_workspaces_not_panes` |
| UC-1: NavigateWorkspaceTasks | BR-2 | `open_terminal_codex_app` | `switching_task_workspace_restores_stage_dock_focus_and_artifacts` |
| UC-1: NavigateWorkspaceTasks | BR-3 | `open_terminal_codex_app` | `inactive_workspace_row_shows_identity_metadata` |
| UC-1: NavigateWorkspaceTasks | BR-5 | `open_terminal_codex_app` | `workspace_rows_stay_compact_for_many_concurrent_tasks` |
| UC-1: NavigateWorkspaceTasks | BR-6 | `open_terminal_codex_app` | `workspace_rows_do_not_render_large_terminal_previews` |
| UC-1: NavigateWorkspaceTasks | BR-7 | `open_terminal_codex_app` | `inactive_workspace_rows_show_terminal_cwd_metadata` |
| UC-2: UseTerminalAsMainSession | BR-1 | `open_terminal_codex_app` | `stage_terminal_is_primary_execution_surface` |
| UC-2: UseTerminalAsMainSession | BR-2 | `open_terminal_codex_app` | `unwrapped_terminal_does_not_show_wrapper_lifecycle_status` |
| UC-2: UseTerminalAsMainSession | BR-4 | `open_terminal_codex_app` | `context_pane_created_from_terminal_records_associated_terminal` |
| UC-2: UseTerminalAsMainSession | BR-5 | `open_terminal_codex_app` | `stage_terminal_tab_group_is_not_default_monitoring_surface` |
| UC-2: UseTerminalAsMainSession | BR-6 | `open_terminal_codex_app` | `terminal_grid_does_not_render_task_metadata` |
| UC-3: ShowTaskMetadataInChrome | BR-1 | `open_terminal_codex_app` | `worktree_branch_and_cwd_render_outside_terminal_grid` |
| UC-3: ShowTaskMetadataInChrome | BR-2 | `open_terminal_codex_app` | `active_terminal_header_shows_selected_task_metadata` |
| UC-3: ShowTaskMetadataInChrome | BR-3 | `open_terminal_codex_app` | `workspace_row_metadata_stays_compact` |
| UC-4: AttachContextToTerminal | BR-1 | `open_terminal_codex_app` | `supporting_context_panes_open_in_active_terminal_context_surface` |
| UC-4: AttachContextToTerminal | BR-2 | `open_terminal_codex_app` | `terminal_context_surface_split_view_allows_context_splits` |
| UC-4: AttachContextToTerminal | BR-3 | `open_terminal_codex_app` | `empty_context_state_renders_context_creation_affordance` |
| UC-4: AttachContextToTerminal | BR-4 | `open_terminal_codex_app` | `terminal_context_stacked_view_hides_sibling_splits_without_flattening_layout` |
| UC-4: AttachContextToTerminal | BR-5 | `open_terminal_codex_app` | `secondary_terminal_context_tab_does_not_create_workspace_row` |
| UC-4: AttachContextToTerminal | BR-6 | `open_terminal_codex_app` | `file_tree_view_coexists_with_terminal_context_surface` |
| UC-4: AttachContextToTerminal | BR-7 | `open_terminal_codex_app` | `dock_split_action_splits_terminal_context_surface_not_stage` |
| UC-4: AttachContextToTerminal | BR-8 | `open_terminal_codex_app` | `new_stage_terminal_defaults_terminal_context_surface_to_stacked_mode` |
| UC-5: SwitchStageTerminalContext | BR-1 | `open_terminal_codex_app` | `terminal_context_surface_is_attached_to_owning_stage_terminal` |
| UC-5: SwitchStageTerminalContext | BR-2 | `open_terminal_codex_app` | `switching_stage_terminal_hides_previous_terminal_context_tabs` |
| UC-5: SwitchStageTerminalContext | BR-3 | `open_terminal_codex_app` | `returning_to_stage_terminal_restores_its_context_tab_group` |
| UC-5: SwitchStageTerminalContext | BR-4 | `open_terminal_codex_app` | `file_tree_view_stays_right_side_when_stage_terminal_switches` |
| UC-6: ReviewChangesInContextTab | BR-1 | `open_terminal_codex_app` | `review_diff_opens_inside_active_terminal_context_surface` |
| UC-6: ReviewChangesInContextTab | BR-2 | `open_terminal_codex_app` | `diff_comment_creates_context_artifact` |
| UC-7: VerifyInBrowserPane | BR-1 | `open_terminal_codex_app` | `browser_comment_creates_context_artifact` |
| UC-7: VerifyInBrowserPane | BR-2 | `open_terminal_codex_app` | `browser_use_targets_in_app_browser_pane` |
| UC-8: RunLocalActions | BR-1 | `open_terminal_codex_app` | `local_action_sends_command_to_terminal` |
| UC-8: RunLocalActions | BR-2 | `open_terminal_codex_app` | `local_action_does_not_require_wrapped_agent` |
| UC-9: PreserveVisualHierarchy | BR-1 | `open_terminal_codex_app` | `collapsed_workspace_rail_keeps_active_workspace_identity_visible` |
| UC-9: PreserveVisualHierarchy | BR-2 | `open_terminal_codex_app` | `stage_and_terminal_context_surface_have_distinct_region_chrome` |
| UC-9: PreserveVisualHierarchy | BR-4 | `open_terminal_codex_app` | `inactive_pane_header_actions_are_not_persistently_emphasized` |
| UC-9: PreserveVisualHierarchy | BR-5 | `open_terminal_codex_app` | `ordinary_stage_tab_groups_are_not_rendered` |
| UC-9: PreserveVisualHierarchy | BR-6 | `open_terminal_codex_app` | `major_region_seams_stay_compact` |
| UC-9: PreserveVisualHierarchy | BR-7 | `open_terminal_codex_app` | `region_border_drag_preserves_width_at_current_seams` |
| UC-9: PreserveVisualHierarchy | BR-8 | `open_terminal_codex_app` | `terminal_context_surface_seam_uses_single_hairline_without_shadow_strips` |
| UC-9: PreserveVisualHierarchy | BR-9 | `open_terminal_codex_app` | `default_support_surface_widths_prioritize_terminal_context_surface` |
| UC-9: PreserveVisualHierarchy | BR-10 | `open_terminal_codex_app` | `file_tree_view_reduces_terminal_context_surface_before_stage` |
| UC-9: PreserveVisualHierarchy | BR-11 | `open_terminal_codex_app` | `support_surfaces_keep_minimum_widths_before_pushing_stage` |

## Location

| Item | Path |
|------|------|
| Spec | `docs/specs/open-terminal-codex-app.md` |
| Workspace identity and rail | `crates/tide-app/src/domain/state/workspace_mgr.rs`, `crates/tide-app/src/application/services/workspace_infra_service/`, `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs` |
| Stage and context visual hierarchy | `crates/tide-app/src/layout_compute.rs`, `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs`, `crates/tide-app/src/adapter/outward/view/header.rs`, `crates/tide-app/src/theme.rs` |
| Context tab creation | `crates/tide-app/src/application/services/dock_service/`, `crates/tide-app/src/adapter/inward/click_adapter/`, `crates/tide-app/src/adapter/inward/keyboard_adapter/` |
| Associated Terminal and comments | `crates/tide-app/src/domain/state/associations.rs`, `crates/tide-app/src/domain/state/context_artifact.rs`, `crates/tide-app/src/application/services/action_service/` |
| Browser Pane verification | `crates/tide-app/src/domain/pane/browser.rs`, `crates/tide-app/src/adapter/outward/platform_adapter/macos/webview.rs`, `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` |
| Diff review surface | `crates/tide-app/src/domain/pane/diff.rs`, `crates/tide-app/src/application/services/file_ops_service/`, `crates/tide-app/src/application/services/action_service/` |
| Wrapped Agent neutrality | `crates/tide-app/resources/bin/claude`, `crates/tide-app/resources/bin/codex`, `crates/tide-app/resources/bin/gemini`, `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/open_terminal_codex_app.rs` |
