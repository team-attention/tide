# Spec: Workspace Sidebar Enhancement

## Overview

### As-Is

The Workspace sidebar shows minimal information per workspace:
- Workspace name ("Workspace 1", "Workspace 2", ...)
- CWD of the focused terminal — **only for the active workspace**
- Agent notification dot — only for inactive workspaces
- Compact mode ("W1", "W2") when sidebar is narrow

Inactive workspaces show only a name. The user cannot see what terminals are running in each workspace without switching to it. This makes the sidebar a navigation tool but not an awareness tool.

### To-Be

Each workspace sidebar item shows a summary of its Stage terminals below the workspace name. The item has a **fixed height** — content that doesn't fit is truncated.

Layout per item (fixed height, 3 content lines):
- **Line 1**: Workspace name
- **Line 2**: First terminal summary — `basename  branch` (or `basename` if not a git repo)
- **Line 3**: Second terminal summary, or `+N more` if 3+ terminals exist

Width overflow is handled by **ellipsis truncation** — the combined `basename  branch` string is truncated to fit the available width. If width is very narrow (compact mode), only `W1` is shown (same as current behavior).

```
┌──────────────────────┐
│ ■ Workspace 1        │  ← active
│   tide  main         │  ← terminal 1
│   api-server  dev    │  ← terminal 2
│                      │
│ Workspace 2          │
│   scripts            │  ← no git, basename only
│   +2 more            │  ← 4 terminals, 2 hidden
│                      │
│ Workspace 3          │
│   my-project  feat…  │  ← ellipsis: branch truncated
│                      │
│ + New Workspace      │
└──────────────────────┘
```

### Approach

1. Add a method to collect terminal summaries (cwd basename + git branch) from a workspace's panes
2. For active workspace: read from live `App.panes` + `TerminalContext`
3. For inactive workspace: read from cold-stored `Workspace.panes` + `TerminalContext`
4. Fixed item height accommodates name + 2 summary lines; render first 2 terminals, overflow as `+N more`
5. Width overflow: ellipsis truncate the `basename  branch` string to fit available width

## Bounded Contexts

| Context | Role |
|---------|------|
| `view` (adapter/outward) | Renders terminal summaries in sidebar items |
| `workspace_infra_service` | Provides terminal summary data from active/inactive workspaces |
| `domain/pane` | `TerminalContext` holds cached cwd + git_info |

## Use Cases

### UC-5: DisplayWorkspaceTerminalSummaries

- **Actor**: System (render cycle)
- **Trigger**: Workspace sidebar is visible and needs rendering
- **Precondition**: `ws.show_sidebar == true`
- **Flow**:
  1. For each workspace, collect Stage terminal panes
  2. For each terminal pane, extract: CWD basename from `TerminalContext.cwd`, git branch from `TerminalContext.git_info`
  3. Build a `TerminalSummary { basename: String, branch: Option<String> }` for each
  4. Render up to `MAX_VISIBLE_TERMINALS` summaries below the workspace name
  5. If more terminals exist, render "+N more" text
  6. Adjust item height based on number of visible lines
- **Postcondition**: Each workspace sidebar item shows its terminal summaries
- **Business Rules**:
  - BR-13: Each workspace item shows CWD basename of its Stage terminals
  - BR-14: If `TerminalContext.git_info` is Some, the git branch name is shown after the basename
  - BR-15: If `TerminalContext.git_info` is None (not a git repo), only basename is shown
  - BR-16: Item height is fixed. First 2 terminals are shown; if 3+ terminals, second line becomes `+N more`
  - BR-17: If `TerminalContext.cwd` is None, the terminal is skipped in the summary
  - BR-18: Active workspace reads terminal info from live `App.panes`; inactive reads from cold-stored `Workspace.panes`
  - BR-19: In compact mode, terminal summaries are hidden (only workspace name shown)
  - BR-20: Terminal summary text is ellipsis-truncated to fit the available sidebar width

## Invariants

1. **No I/O for inactive workspaces**: Terminal summaries for inactive workspaces come from cached `TerminalContext`, never from live filesystem or git queries
2. **Stage-only**: Only terminals in the Stage area are shown, not Dock terminals
3. **Existing invariants preserved**: All workspace invariants from `docs/specs/workspace.md` still hold

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-5 | BR-13 | `workspace_sidebar_shows_terminal_cwd_basename` |
| UC-5 | BR-14 | `workspace_sidebar_shows_git_branch_when_available` |
| UC-5 | BR-15 | `workspace_sidebar_hides_branch_when_not_git_repo` |
| UC-5 | BR-16 | `workspace_sidebar_shows_overflow_when_three_or_more_terminals` |
| UC-5 | BR-17 | `workspace_sidebar_skips_terminals_without_cwd` |
| UC-5 | BR-18 | `inactive_workspace_sidebar_reads_from_cold_storage` |

## Location

| Layer | Key Files |
|-------|-----------|
| View | `adapter/outward/view/chrome/titlebar.rs` (sidebar rendering) |
| Geometry | `domain/state/drag_types.rs` (`WsSidebarGeometry` — fixed item height) |
| Data | `domain/pane/mod.rs` (`TerminalContext`, `TerminalPane`) |
| Service | `application/services/workspace_infra_service/mod.rs` (workspace data access) |
| Tests | `application/behavior_tests/workspace_behavior.rs` |
