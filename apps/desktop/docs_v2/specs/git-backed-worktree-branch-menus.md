# Spec: Git-backed Worktree & Branch Menus

## Scope

Replace the hardcoded Composer Worktree and Branch menus with real git data for
the active Project's cwd: actual branches (local/remote, current marked) and
actual worktrees (current folder + existing worktrees). Graceful fallback when
the scope is Scratch or the folder is not a git repo.

Out of scope: creating branches/worktrees (the "+" rows remain affordances wired
later), remote fetch, git auth.

## Evidence

- Glossary: Worktree Option = current folder vs new/existing git worktree;
  Branch Option = the git branch for the Thread; Execution Context = cwd, repo,
  branch, worktree.
- Today `worktree_menu`/`branch_menu` rows are hardcoded placeholders in
  `agent-chat-shell-state.ts` (e.g. `feature/sidebar`, `release/2026-05`).
- The project registry slice established the pattern: Main-process IPC for
  Desktop-facing infra, injected into agent-chat state (like `availableProjects`).

## Decisions

### D1. Git queries run in Electron Main via IPC
A single `tide:git-context(cwd)` IPC runs read-only git in the cwd and returns
branches + worktrees + repo status. Consistent with the Main-owned project
registry (Desktop concern, not agent-runtime domain). Read-only `git` via
`execFile` (no shell), bounded.

### D2. Git context is fetched for the active Project cwd
The renderer fetches git context whenever the composer's active Project cwd
changes, and injects it into the agent-chat state (`availableBranches`,
`availableWorktrees`). Scratch / non-git scopes yield empty data.

### D3. Menus render real data with safe fallback
- Branch menu lists real branches (current marked, local before remote). If none
  (non-git/scratch), it shows just the current launch value. "Create new branch"
  remains.
- Worktree menu lists "current folder" (the main worktree) plus existing
  worktrees. "New worktree" remains.

### D4. Provider-native values preserved
Branch names and worktree paths are shown verbatim (no normalization). Selecting
sets `launchOptions.branch` / `launchOptions.worktree`.

## Contracts (Main IPC / preload)

```ts
gitContext(cwd: string): Promise<GitContext>;
interface GitContext {
  isGitRepo: boolean;
  currentBranch: string | null;
  branches: { name: string; kind: "local" | "remote"; current: boolean }[];
  worktrees: { path: string; branch: string | null; current: boolean }[];
}
```

## Flow

### UC-1: Open Branch menu in a git project
1. Composer scope is a Project with a git cwd; renderer has fetched git context.
2. Branch menu lists real branches, current marked, "Create new branch" last.
3. Selecting a branch sets `launchOptions.branch`.

### UC-2: Open Worktree menu
1. Worktree menu lists "current folder" + existing worktrees, "new worktree" last.

### UC-3: Scratch or non-git scope
1. git context is empty/`isGitRepo:false`; menus fall back to the current value
   plus the create affordance only.

## Invariants
1. Git is invoked read-only, never mutating the repo.
2. Branch/worktree values are provider/git-native (verbatim).
3. A non-git or Scratch scope never errors — it shows fallback rows.

## Tests
| Use Case | Rule | Expectation |
|----------|------|-------------|
| UC-1 | D3 | Injected branches render in the Branch menu with the current one marked; placeholders gone. |
| UC-2 | D3 | Injected worktrees render in the Worktree menu (current folder + existing). |
| UC-3 | D3 | With no injected git data, the Branch menu shows the current value + "Create new branch" only (no fabricated branches). |

## Implementation Notes
- Main: `tide:git-context` via `execFile("git", ["-C", cwd, ...])`; parse
  `for-each-ref` (branches) and `worktree list --porcelain` (worktrees).
- Preload + `window.tide` type + product-shell `projectBridge` (extend) or a new
  bridge method.
- agent-chat-shell-state: `availableBranches?`, `availableWorktrees?`;
  `branchMenuRows`/`worktreeMenuRows` build from them with fallback.
- product-shell-state: inject into agent-chat view (like `availableProjects`).
- renderer: fetch git context on active project cwd change.

## Location
- `src/desktop/infrastructure/electron/main/electron-main.ts`, `src/desktop/infrastructure/electron/preload/index.ts`
- `src/desktop/application/domains/agent-chat/agent-chat.ts`
- `src/desktop/application/domains/product-shell/product-shell.ts`
- `src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.ts`, `renderer-entry.ts`
