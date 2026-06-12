# Spec: Thread List Display Settings

## Scope

Give the Left Rail thread list user-configurable display settings, persisted across
sessions:
- **Group by**: Project (default) or Thread (flat list, no project grouping).
- **Sort**: Last activity (default), Created, or Name.
- **Group worktrees by repo** (Project mode only): when on, Projects that are git
  worktrees of the same repo are collected under that repo; when off (default),
  each worktree Project shows at the same level as any other Project.

## Evidence

- The view model builds `projectGroups` from `displayedProjects(state)` and buckets
  threads by `thread.scope.projectId`; `scratchThreads` are separate
  (`product-shell-state.ts` `createProductShellViewModel`).
- `ProductShellState` already holds UI prefs (`collapsedProjectIds`,
  `pinnedProjectIds`, …) but has no list-display settings and no persistence of
  them.
- A worktree Thread is its own Project (cwd = worktree path), per
  docs_v2/specs/worktree-creation.md. Grouping worktrees needs the repo root for a
  worktree Project; `gitWorktrees` (AgentChatWorktreeOption with `path`) is the
  available signal.

## Decisions

- Settings live on `ProductShellState.listSettings`
  `{ groupBy: "project" | "thread"; sortBy: "recent" | "created" | "name";
  groupWorktreesByRepo: boolean }`, defaulting to
  `{ groupBy: "project", sortBy: "recent", groupWorktreesByRepo: false }`.
- Persisted in the renderer via `localStorage` (durable desktop pref; no backend
  contract needed).
- "Thread" mode renders one flat, sorted thread list (project + scratch threads
  together); no project groups.
- Sort applies to threads within a group and to the flat list; "recent" = newest
  `updatedAt` first, "created" = newest `createdAt` first, "name" = title A–Z.

## Out Of Scope

- Backend-persisted/synced settings. Per-project sort overrides. Custom sort dirs.
- The worktree-by-repo collection visual nesting depth (single level: repo → its
  worktree Projects).

## Domain Model

- **List Display Settings**: user prefs controlling how the Left Rail thread list is
  grouped and sorted.

## Contracts

- None (renderer-local; persisted to localStorage).

## Flow

1. User opens list settings (Left Rail menu) and picks group/sort/worktree options.
2. The reducer updates `state.listSettings`; the renderer persists to localStorage.
3. `createProductShellViewModel` branches on `listSettings` to build either grouped
   or flat, sorted output.

## Invariants

- `groupWorktreesByRepo` only affects Project mode.
- Sorting never drops or duplicates a thread.
- Settings round-trip through localStorage (load on init, save on change).

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 Group mode | BR-1 "thread" mode yields a flat sorted thread list, no groups | `thread_group_mode_lists_all_threads_flat` |
| UC-1 Group mode | BR-2 "project" mode buckets threads by project (default) | `project_group_mode_buckets_threads_by_project` |
| UC-2 Sort | BR-3 "recent" orders newest updatedAt first | `recent_sort_orders_threads_by_last_activity` |
| UC-2 Sort | BR-4 "name" orders threads A–Z | `name_sort_orders_threads_alphabetically` |
| UC-3 Worktree group | BR-5 worktree Projects collect under their repo when on | `worktree_projects_group_under_their_repo_when_enabled` |

## Implementation Notes

- Pure changes in `product-shell-state.ts` (view-model branch + a
  `setProductShellListSettings` reducer).
- Renderer: a list-settings menu in the Left Rail + localStorage load/save.

## Location

- `src/desktop/application/domains/product-shell/product-shell.ts`
- `src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.ts`
