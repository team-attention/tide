# Spec: Workbench Launcher Pane

## Scope

This spec adds a visible Launcher Workbench Pane for the case where a Thread has
no active Browser, Editor, Diff, or Terminal Pane yet.

It covers:

- Adding `launcher` as a Workbench Pane kind in Shared Contracts, Backend domain,
  Desktop App Chrome, and Product Shell rendering.
- Opening or revealing a Launcher Pane through a Thread-scoped
  `workbench.command`.
- Rendering a compact set of Workbench actions that make the right work area
  useful without inventing fake panes.
- Dispatching Browser, Terminal, and FileTree Launcher actions to real
  Thread-scoped Workbench commands.

It does not cover:

- Running a command palette search engine.
- Creating files, branches, worktrees, or projects directly from the Launcher.
- Agent-side launcher tools. Agents continue to use Tide MCP Workbench tools.
- Opening Editor or Diff Panes without a selected file or diff source.

## Evidence

- `docs_v2/implementation/electron-node-architecture-decisions.md` says
  Workbench is optional and opens when visible inspection, editing, verification,
  or direct commands are needed.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says
  Browser, Diff/File, and Terminal surfaces are first Workbench needs, while the
  hidden Agent Runtime is not a Workbench Terminal Pane.
- `docs_v2/specs/desktop-product-shell-visual-foundation.md` records V1 Dock
  evidence that an open Dock should not be empty and can use a placeholder
  Launcher before Browser or Editor content exists.
- `src/shared/contracts/workbench.ts` and
  `src/backend/application/domains/workbench/workbench.ts` currently allow
  Browser, Diff, Editor, and Terminal Pane kinds but no Launcher Pane kind.

## Decisions

### D1. Launcher is a real Workbench Pane

Launcher is represented by the same Pane contract as Browser, Editor, Diff, and
Terminal. It appears in the Workbench Tab Strip, can be focused, and can be
closed.

### D2. Launcher actions are visible affordances, not fake execution

The Launcher shows actions for opening Browser, Editor, Terminal, Diff, and
FileTree work. Actions that need later specs may render as disabled or as
future-command affordances, but the Pane itself must not fabricate Browser,
Editor, Diff, or Terminal state.

### D3. Empty Workbench opens Launcher

When the user opens Workbench for an active Thread with no visible Pane, Desktop
requests `open_launcher`. Backend creates or reveals a single Launcher Pane for
that Thread.

### D4. Visible Launcher actions must be real or disabled

Launcher actions that can be completed without more user input dispatch real
Workbench commands:

- Browser dispatches `workbench.command open_browser`.
- Terminal dispatches `workbench.command open_terminal`.
- FileTree opens the FileTree View column and dispatches
  `workbench.command refresh_file_tree`.

Editor and Diff remain disabled in this slice because they need a selected file
or diff source. They must not look like working controls until a concrete target
selection flow exists.

## Domain Model

```ts
type WorkbenchPaneKind =
  | "browser"
  | "diff"
  | "editor"
  | "terminal"
  | "launcher";

interface LauncherPaneState {
  paneId: WorkbenchPaneId;
  kind: "launcher";
  title: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
  actions: LauncherPaneAction[];
}

interface LauncherPaneAction {
  actionId: "open_browser" | "open_editor" | "open_terminal" | "open_diff" | "open_file_tree";
  label: string;
  description: string;
  enabled: boolean;
}
```

## Flow

### UC-1: User opens empty Workbench

1. Active Thread has no visible Workbench Pane.
2. User opens Workbench.
3. Desktop emits `workbench.command` `open_launcher`.
4. Backend creates or reveals one Launcher Pane.
5. Desktop renders the Launcher Pane in the Workbench column and Tab Strip.

### UC-2: Existing Launcher is revealed

1. Thread already has a hidden Launcher Pane.
2. User opens Workbench.
3. Backend marks the existing Launcher Pane visible and active.
4. Backend does not create a duplicate Launcher Pane.

### UC-3: User selects a Launcher action

1. Launcher Pane is visible.
2. User selects Browser, Terminal, or FileTree.
3. Desktop emits the matching Thread-scoped Workbench command.
4. Backend mutates the Thread Workbench only through `handleWorkbenchCommand`.
5. Desktop applies the resulting `workbench.changed` event.

## Invariants

1. A Launcher Pane is Thread-scoped Workbench state.
2. A Thread has at most one Launcher Pane.
3. Launcher state never represents the hidden Agent Runtime.
4. Launcher actions do not claim a Browser, Editor, Diff, or Terminal Pane exists.
5. Enabled Launcher actions have a real command path.

## Tests

| Rule | Test |
|------|------|
| Contract accepts Launcher Pane | `workbench_launcher_pane_contract_round_trips` |
| Backend opens one Launcher Pane | `opening_workbench_launcher_creates_or_reveals_single_launcher_pane` |
| Desktop requests Launcher for empty Workbench | `opening_empty_product_shell_workbench_requests_launcher_pane` |
| Product Shell renders Launcher actions | `workbench_launcher_pane_renders_real_workbench_actions` |
| Browser action opens a Browser Pane | `opening_browser_from_workbench_command_creates_visible_browser_pane` |
| Product Shell dispatches Browser action | `product_shell_launcher_browser_action_emits_open_browser_command` |
| Product Shell dispatches FileTree action | `product_shell_launcher_file_tree_action_opens_column_and_refreshes_tree` |

## Implementation Notes

- Keep Launcher actions static in this slice.
- Keep action execution out of scope until each action has a specific command
  spec.
