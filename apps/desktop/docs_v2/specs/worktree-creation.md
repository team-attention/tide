# Spec: Worktree Creation

## Scope

Make the Composer "New worktree" row actually create a git worktree (today it is a
no-op), mirroring Tide v1's rule, with a configurable path pattern, for any
git-backed Project (all three providers — worktrees are provider-agnostic).

In scope:
- A pure path rule `computeWorktreePath(repoRoot, branch, pattern?)` mirroring v1.
- A `worktree.create` BackendCommand `{ threadId | projectCwd, name }` that runs
  `git worktree add <path> -b <name>` via WorkspaceCommandPort, optionally copies
  configured files, and returns the new worktree path.
- Desktop: "New worktree" opens a small name input; on submit, create + scope the
  Start Composer to the new worktree path.
- Thread-list grouping: a worktree Thread is shown under its PARENT repo's project
  group with a branch badge (not as a separate top-level project).

## Evidence

- v1 rule (`crates/tide-app/src/domain/state/settings.rs` `compute_worktree_path`):
  default `{repo_root}.worktree/{branch}` (sibling dir), branch `/`→`-` sanitized;
  configurable via `base_dir_pattern` with `{repo_root}`/`{branch}` placeholders;
  `copy_files` lists files copied from repo root into the new worktree.
- v1 created via `git.add_worktree(cwd, path, branch, new_branch)` then
  `copy_files_to_worktree`.
- v2 `WorkspaceCommandPort.run({command,args,cwd,...})` can run arbitrary git.
- The "New worktree" row exists but `worktreeForRow("new-worktree")` returns
  undefined → selecting it does nothing (`agent-chat-shell-state.ts`).
- Threads group by Project today (`product-shell-state.ts` project groups keyed by
  projectId/cwd); a raw-cwd worktree Thread would fragment into its own group.

## Decisions

- Mirror v1's default path `{repo_root}.worktree/{branch}` (sibling), overridable
  by a `base_dir_pattern` setting; `copy_files` supported. (User: "just as v1, with
  a configuration option to change that rule.")
- Location: sibling of the repo (v1 default already is). (User choice.)
- Thread-list grouping: a worktree Thread is its OWN Project at the same level as
  other Projects (cwd = worktree path). Whether worktrees of one repo are visually
  collected together is a list-display setting, not hardcoded. (User decision; see
  docs_v2/specs/thread-list-display-settings.md.)
- The single "New worktree" name input drives the worktree name, branch name, and
  directory name together (v1 behavior).

## Out Of Scope

- Removing/pruning worktrees. Per-branch vs new-branch choice UI (default: new
  branch named after the input). Settings UI (rule is read from a config file).

## Domain Model

- **Worktree** (glossary, existing): a linked git working tree with its own path +
  branch. A Thread scoped to a worktree path is a worktree Thread.

## Contracts

- Implemented via Electron Main IPC `tide:create-worktree(cwd, name)` (which also
  registers the new worktree as a Project), not a Backend command — worktree
  creation is a project-registry/git concern owned by Main. The pure path rule
  lives in `src/shared/worktree-path.ts` (`computeWorktreePath`,
  `sanitizeWorktreeBranch`, `worktreeRepoRootForCwd`).

## Flow

1. "New worktree" → name input → `worktree.create { projectCwd, name }`.
2. Service computes path from rule, runs `git worktree add <path> -b <name>`,
   copies configured files, returns the path.
3. Desktop scopes the Start Composer to `worktreePath`; the next message starts a
   Thread there. The Thread groups under the parent repo with a branch badge.

## Invariants

- The worktree path is derived from the repo root + sanitized branch (never raw).
- Creation fails cleanly if the cwd is not a git repo or the branch exists.
- A worktree Thread's parent-project grouping is by the repo root (main worktree).

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 Path rule | BR-1 default is `{root}.worktree/{branch}`, `/`→`-` | `computes_default_worktree_path_as_repo_sibling` |
| UC-1 Path rule | BR-2 `base_dir_pattern` overrides with placeholders | `applies_configured_worktree_path_pattern` |
| UC-2 Create | BR-3 runs `git worktree add <path> -b <name>` in repo cwd | `creating_a_worktree_runs_git_worktree_add` |
| UC-2 Create | BR-4 returns the computed path + branch | `creating_a_worktree_returns_its_path_and_branch` |
| UC-3 Grouping | BR-5 worktree Thread groups under its parent repo project | (desktop, follow-on slice) |

## Implementation Notes

- Pure rule lives in a small module so both backend + tests use it.
- Backend `worktree.create` via WorkspaceCommandPort; copy_files via a file write.
- Desktop name input + grouping are a follow-on slice after the backend lands.

## Location

- `src/shared/contracts/commands.ts`
- `src/backend/application/services/thread-runtime-service.ts` (+ a worktree rule module)
- `src/desktop/application/domains/agent-chat/agent-chat-shell-state.ts` (follow-on)
- `src/desktop/application/domains/product-shell/product-shell-state.ts` (grouping, follow-on)
