# Spec: Thread Row Changes Routing

Status: Draft

## Scope

Make the Thread Row changes action open the same working-tree Changes pane that
the top chrome git diff count opens.

In scope:

- Thread Row context/utility menu wording and command routing.
- Empty Workbench launcher Diff action state.
- Regression coverage for late hydrate/workbench event ordering.

Out of scope:

- Codex model/version/catalog behavior.
- Provider AI review execution.
- Changes pane staging/commit behavior.

## Evidence

- `docs_v2/specs/git-changes-view.md` defines backend `workbench.command
  open_diff` as the first-class git Changes pane. It shows the changed files and
  selected file diff.
- The top chrome git badge already calls `handlers.onOpenChanges(gitBadge.cwd)`,
  which dispatches backend `open_diff`.
- Thread Row context menu previously labeled an action `Review changes` and
  routed it to `handlers.onOpenThreadReview(menu.threadId)`, which dispatched
  `workbench.command open_review`.
- Backend `open_review` creates a separate `review` Workbench pane for AI review
  runner state. It is not the git working-tree Changes pane.
- Backend launcher actions and composer synthetic launcher already describe Diff
  as `View working-tree changes (git)` and enable `open_diff`.
- Standalone `emptyWorkbenchLauncherPane()` previously rendered Diff disabled
  with `Available after a file edit or review target`, which could leave an
  open Workbench showing disabled Diff even though `open_diff` is available.

## Decisions

1. **Changes action routes to `open_diff`.** A Thread Row action whose wording
   refers to viewing/reviewing changes must dispatch backend `workbench.command
   open_diff` for that Thread.

2. **AI Review is separate.** The `review` Workbench pane remains available from
   provider capability / explicit review affordances. It is not the target for a
   Thread Row "show changes" action.

3. **Prefer clearer wording.** The row menu item should be named around the
   actual surface, for example `View changes`, to avoid conflating git Changes
   with AI Review.

4. **Launcher Diff is enabled.** Empty launcher states must render Diff enabled
   because `open_diff` creates the git Changes pane. Clean/non-git states are
   handled inside the Changes pane, not by disabling the launcher action.

5. **Late hydrate must not undo a real pane.** If a row action dispatches
   hydrate and `open_diff` close together, a later `thread.hydrated` or launcher
   snapshot must not leave the visible Workbench on Launcher after a `changes`
   pane event arrived.

## Out Of Scope

- Renaming backend command `open_diff`.
- Removing the `review` Workbench pane.
- Running a provider review automatically from the row menu.
- Changing git diff fetching or commit/staging commands.

## Domain Model

### Changes Pane

The working-tree Changes pane is represented as:

```ts
interface ChangesPaneState {
  paneId: string;
  kind: "changes";
  title: "Changes";
  revision: string;
  updatedAt: string;
  cwd: string;
}
```

It is opened through:

```ts
{
  kind: "workbench.command";
  payload: {
    threadId: string;
    command: "open_diff";
  };
}
```

### Review Pane

The AI review pane is represented as:

```ts
interface ReviewPaneState {
  paneId: string;
  kind: "review";
  title: "Review";
  cwd: string;
  agentId: "codex" | "claude" | "opencode";
}
```

It is opened through `workbench.command open_review` and is not used for the row
changes action.

## Contracts

No shared contract changes are required.

Existing contracts used:

- `workbench.command open_diff`
- `workbench.command open_review`
- `workbench.changed`

Contract interpretation:

- `open_diff` is the canonical working-tree Changes command.
- `open_review` is a distinct AI review surface command.

## Flow

### Thread Row View Changes

1. User opens a Thread Row utility menu.
2. User chooses `View changes`.
3. Renderer opens/selects that Thread.
4. Renderer dispatches `workbench.command open_diff` for that Thread.
5. Backend creates or reveals the singleton `changes` pane for the Thread root.
6. Desktop renders the Changes pane active.

### Empty Launcher Diff

1. User opens an empty Workbench launcher.
2. Launcher renders Diff enabled with `View working-tree changes (git)`.
3. User clicks Diff.
4. Renderer dispatches `open_diff`.
5. Backend replaces/removes launcher as needed and activates `changes`.

## Invariants

- Thread Row "changes" action and top chrome git diff count open the same
  Workbench surface.
- `open_review` is never dispatched by the row changes action.
- Launcher Diff is not disabled merely because no single-file diff source is
  selected.
- A Thread with no git repo still opens Changes and shows an explicit non-git
  state.
- Late `thread.hydrated` events do not overwrite an already-arrived active
  `changes` pane with Launcher-only state.

## Tests

- `thread_menu_view_changes_opens_changes_pane_for_that_thread`: the row menu
  action dispatches `open_diff`, not `open_review`.
- `thread_row_changes_action_renders_changes_pane_after_hydrate_race`: a late
  `thread.hydrated` event must not leave Workbench on Launcher after
  `workbench.changed` for `changes`.
- `empty_workbench_launcher_diff_action_is_enabled`: standalone empty launcher
  renders Diff enabled with `View working-tree changes (git)`.
- `empty_workbench_launcher_diff_dispatches_open_diff`: clicking launcher Diff
  dispatches `workbench.command open_diff`.

## Implementation Notes

- Keep `open_diff` command naming for now to avoid a shared-contract rename.
- Change row menu label/handler together so the UI text and backend command
  agree.
- Align `emptyWorkbenchLauncherPane()` metadata with backend
  `launcherPaneActions()`.
- Preserve the AI Review pane entry point through provider capability or another
  explicit review action, not this changes route.
