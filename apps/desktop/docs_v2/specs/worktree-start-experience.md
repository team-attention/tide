# Spec: Worktree Start Experience

## Scope

Redesign how a user starts work in a new git worktree from the Start Composer, so
the worktree, optional branch, and optional name are chosen in the composer, the
worktree is created **at send time** with a deterministic name, and the resulting
worktree Thread is grouped **under its parent repo Project** in the Left Rail.

In scope:

- **Deterministic worktree naming** decided once, at send time, from a fixed
  priority: user-typed name → ASCII slug of the first message → random hash.
  All results are git-safe ASCII (`[a-z0-9-]`). Non-ASCII (e.g. Korean) first
  messages fall through to the hash.
- **Composer "New worktree" becomes a deferred intent**: selecting it sets a
  pending new-worktree launch option (optional name + optional base branch); the
  worktree is created on send, not on menu submit.
- **Base-branch support** in worktree creation: `git worktree add -b <name>
  <path> [<base-ref>]`.
- **Sidebar grouping default**: worktree Threads nest flat under their parent
  repo's Project group (with a branch badge), not as separate top-level Projects.
- **Recent environment choice**: the Start Composer remembers whether the user last
  chose Local or New worktree, so New Thread keeps the recent Worktree/Local option
  instead of always resetting to Local.
- **Trust inheritance for Tide default worktrees**: if the parent repo is already
  trusted for the selected provider, the new default-path worktree is trusted before
  provider readiness runs, so starting in the worktree does not ask again.
- **Local branch alignment**: when the user starts a Thread with Worktree = Local
  and Branch = a different local branch, Tide checks out that branch in the selected
  folder before starting the Agent Runtime.
- **Local checkout collision warning**: if another Thread is actively running in the
  same local folder, Tide warns before switching the shared working tree branch.

## Evidence

- `git-backed-worktree-branch-menus.md` (done): the composer Worktree/Branch menus
  already render real git data (`tide:git-context`); selecting sets
  `launchOptions.worktree` / `launchOptions.branch`.
- `worktree-creation.md` (done): `tide:create-worktree(cwd, name, options)` runs
  `git worktree add -b <branch> <path>`, copies configured files, and **registers
  the new worktree as its own top-level Project**. Today creation is **eager** —
  the composer "New worktree" row opens an inline name input and creates on submit
  (`tide-product-shell.ts:1020-1045`, `worktreeCreate` state). The pure rule lives
  in `src/shared/worktree-path.ts` (`computeWorktreePath`, `sanitizeWorktreeBranch`,
  `worktreeRepoRootForCwd`). Empty name falls back to `<basename>-wt`, **not** a hash.
- `thread-list-display-settings.md` (done): `groupWorktreesByRepo` already folds a
  worktree Project's threads under its repo Project
  (`product-shell-state.ts:628-668`), but defaults to `false`, so worktrees show
  as separate top-level Projects today. The fold requires the repo to be a known
  Project (it is, since the user picks the repo Project first).
- `worktreeForRow("new-worktree")` returns `undefined` so menu selection is a
  no-op; the renderer special-cases the row to open the inline input
  (`agent-chat-shell-state.ts:2057-2065`, `tide-product-shell.ts:1436-1439`).
- Thread title today = `titleFromMessage(firstMessage)` or manual rename
  (`service-value-helpers.ts`); no agent-metadata-derived title.
- The current Composer submit path passes `launchOptions.branch` to `thread.start`
  but does not switch the selected cwd first. The top-bar git badge is read from
  the real cwd, so a Start Composer chip can say `main` while the Thread starts in
  a folder still checked out to another branch.

## Decisions

### D1. Name is decided once, at send time (no live-directory rename)

The worktree directory + branch name is resolved exactly once, when the first
message is sent and the worktree is created. Priority:

1. **User-typed name** (sanitized), if non-empty after sanitization.
2. **ASCII slug of the first message**, if it yields ≥ 3 usable ASCII chars.
3. **Random hash** `wt-<6 hex>` otherwise.

Rationale (user's "deterministic guarantee" concern): the first message always
exists, and the hash always works, so a valid name is *always* available without
depending on the agent producing a usable title. Because the name is set before
creation, no `git worktree move` of a live directory is ever needed.

### D2. git names are ASCII-only; non-ASCII first messages fall to the hash

The slug lowercases, maps whitespace/`/`/`_` → `-`, strips every char outside
`[a-z0-9-]`, collapses repeats, trims, caps at ~6 tokens / 40 chars. A Korean-only
message yields an empty slug → hash. A mixed message keeps only its ASCII tokens
(`"fix login 로그인"` → `fix-login`). git branch/dir names never contain non-ASCII.
(User confirmed the Korean-message worry; this is exactly why the hash fallback stays.)

### D3. "New worktree" is a deferred intent, resolved on send

Selecting "New worktree…" in the composer opens a small inline form (optional name,
optional base branch) and sets a pending launch option
(`launchOptions.newWorktree = { name?: string, baseBranch?: string }`) plus
`launchOptions.worktree = "new"`. **No git command runs yet.** On send, Desktop
resolves the final name (D1), calls `createWorktree(repoCwd, finalName,
{ baseBranch, ... })`, re-scopes the Thread to the returned worktree path, and
starts the Thread there. The eager sidebar "create worktree" path
(`creatingWorktreeForProjectId`) stays as-is for now (it creates an empty worktree
Project without a Thread).

### D4. Base branch is the worktree's start point

The optional branch selection is the **base ref** the new worktree branches from
(`git worktree add -b <name> <path> <base-ref>`), defaulting to the repo's current
branch when unset. (Distinct from picking an *existing* worktree, which still sets
`launchOptions.worktree = <path>`.)

### D5. Worktree Threads group under their parent repo by default

`listSettings.groupWorktreesByRepo` defaults to **`true`**. A worktree Thread (scope
cwd `<repo>.worktree/<branch>`) lists flat under its repo Project group with a
**branch badge**, not as a separate top-level Project. This supersedes
`worktree-creation.md`'s "worktree Thread is its OWN Project" default and flips the
`thread-list-display-settings.md` default. The toggle remains for users who want
the flat top-level view.

### D6. Name collisions get a hash suffix

If the resolved path or branch already exists, append `-<4 hex>` (e.g.
`fix-login-bug-a3f9`) so a repeated message/name never fails creation.

### D7. Worktree/Local mode is part of the Start Composer preference

The renderer-local Start Composer preference stores only the environment mode:
`current folder` (Local) or `new` (New worktree). It must not persist an existing
worktree absolute path, because that path is scoped to the repo where it was
chosen and would incorrectly re-scope a new Thread started from another Project.
It also does not persist the selected base branch, because branch names are
repo-scoped and must be chosen from the current Project's git context.
The optional typed new-worktree name is not persisted: each new Thread should
resolve its own name from the typed form or first message. If the restored scope
is Scratch or otherwise cannot create/use a worktree, the restored worktree option
falls back to `current folder` (Local).

### D8. Default worktrees inherit trust from their parent repo

When a Thread starts in a default-rule worktree path (`<repo>.worktree/<branch>`),
the backend checks readiness for the parent repo path first. If that parent check
does not include `directory_trust_required`, `not_installed`, or `unknown`, Tide
writes provider trust for the worktree cwd before checking readiness for the actual
Thread. This removes repeat trust prompts for Tide-created worktrees while keeping
the prompt when the parent repo itself has not been trusted.

### D9. Local Branch is applied to the shared folder before Thread start

For Worktree = `current folder`, the Branch option is not merely metadata. On send,
Desktop reads the selected folder's fresh git context. If `currentBranch !==
launchOptions.branch`, and the requested branch is a local branch, Tide runs
`git switch <branch>` in that folder before dispatching `thread.start`. The Agent
Runtime then receives a cwd whose actual checkout matches the Composer chip and the
top-bar branch badge.

If the selected branch is remote-only, missing, or git refuses the switch (dirty
files, branch checked out in another worktree, etc.), Tide does not start the
Thread. The Composer draft stays intact and the user sees the git failure.

### D10. Switching a shared local folder warns when another Thread is running

If the selected local folder has another Thread whose current turn is `running`,
Desktop shows a confirmation before D9 switches the branch. Confirming means "switch
this shared cwd, then start the new Thread"; cancelling leaves the draft and current
branch unchanged. Idle or merely live historical sessions do not block, because they
are not actively operating on the files.

## Out Of Scope

- Renaming a worktree's git branch/directory **after** creation (the deferred
  send-time naming removes the need; a manual rename action is a later slice).
- Agent-metadata-derived **display titles** (thread title stays
  `titleFromMessage`; an agent-title enhancement is a separate later slice and
  would touch only the display label, never the git path).
- Worktree removal/pruning UX (already exists separately).
- Settings UI for the path pattern / copy-files (read from config as today).

## Domain Model

- **Worktree** (glossary): a linked git working tree with its own path + branch. A
  Thread scoped to a worktree path is a worktree Thread.
- **New-worktree intent**: a composer-only pending value `{ name?, baseBranch? }`
  describing a worktree to create on send. Not persisted; consumed at send.

## Contracts

Pure naming (new module `src/shared/worktree-name.ts`):

```ts
// ASCII slug of free text; "" when nothing usable remains (e.g. all-Korean).
export function slugFromMessage(message: string): string;

// Resolve the final worktree name from the fixed priority. `makeHash` is injected
// so the rule is pure/testable; production passes a real random generator.
export function resolveWorktreeName(input: {
  typedName?: string;
  firstMessage?: string;
  makeHash: () => string;   // e.g. () => `wt-${randomHex(6)}`
}): string;
```

Main IPC (`src/desktop/infrastructure/electron/preload/index.ts`, `electron-main.ts`) — extend creation
to accept a base branch (additive, backward compatible):

```ts
createWorktree(
  cwd: string,
  name: string,
  options?: { baseDirPattern?: string; copyFiles?: string[]; baseBranch?: string },
): Promise<{ entries: ProjectRegistryEntry[]; createdCwd: string | null }>;

checkoutBranch(
  cwd: string,
  branch: string,
): Promise<{ checkedOut: boolean; currentBranch: string | null; error?: string }>;
```

Composer launch options (renderer-only, JSON-compatible):

```ts
launchOptions.worktree = "new";                       // sentinel for a pending create
launchOptions.newWorktree = { name?: string; baseBranch?: string };
```

## Flow

### UC-1: New worktree, blank name, English first message

1. Repo Project selected. Worktree menu → "New worktree…" → leave name blank,
   keep default base branch → confirm. Composer chip shows "New worktree (auto)".
2. User types "fix the login redirect bug" and sends.
3. Desktop resolves name → `fix-the-login-redirect-bug`, calls
   `createWorktree(repoCwd, "fix-the-login-redirect-bug", { baseBranch })`.
4. Worktree `<repo>.worktree/fix-the-login-redirect-bug` + branch of the same name
   are created off the base; the Thread starts there.
5. If the repo Project is already trusted for the selected provider, Tide trusts
   the worktree cwd before provider readiness runs.
6. Left Rail: the Thread appears under the repo Project group with a branch badge.

### UC-2: New worktree, blank name, Korean first message

1. Same as UC-1 but the first message is "로그인 버그 고쳐줘".
2. Slug is empty → name resolves to `wt-<hash>`; worktree/branch use that ASCII name.

### UC-3: New worktree, typed name

1. User types name "spike" in the inline form → name resolves to `spike`
   regardless of the message.

### UC-4: Existing worktree (unchanged)

1. Worktree menu lists existing worktrees; selecting one sets
   `launchOptions.worktree = <path>` and scopes the Thread there (no creation).

### UC-5: Local folder, selected branch differs from checkout

1. Repo Project selected. Worktree menu = Local. Branch menu = `main`.
2. The actual folder is checked out to `codex/left-rail-hover-context`.
3. User sends.
4. Desktop reads git context, sees `main` is a local branch and differs from the
   current branch, runs `git switch main`, refreshes git context, then dispatches
   `thread.start`.
5. If another Thread is currently running in the same cwd, a warning appears before
   step 4.

## Invariants

1. The worktree branch/dir name is always git-safe ASCII derived per D1/D2 — never
   raw, never non-ASCII.
2. A valid name is always produced (hash is the terminal fallback); send never
   fails for lack of a usable name.
3. No `git worktree move`/`branch -m` runs against a live worktree in this flow
   (name is fixed before creation).
4. A worktree Thread's parent-group is its repo root (default grouping on).
5. git is invoked read-only for menus; creation runs exactly one `git worktree add`.
6. For Local starts, `launchOptions.branch` and the selected cwd's actual branch are
   aligned before `thread.start` dispatches.
7. Tide never force-switches a local folder. Git refusal keeps the draft intact.

## Tests

| UC | Rule | Test |
|----|------|------|
| UC-1 | D1 typed/slug/hash priority | `resolve_worktree_name_prefers_typed_then_slug_then_hash` |
| UC-1 | D2 english slug | `slug_from_message_builds_ascii_kebab_from_english` |
| UC-2 | D2 korean → empty slug | `slug_from_message_is_empty_for_non_ascii_only_message` |
| —    | D2 mixed keeps ascii tokens | `slug_from_message_keeps_only_ascii_tokens` |
| —    | D2 truncation/token cap | `slug_from_message_caps_length_and_token_count` |
| UC-2 | D1 blank+korean → hash | `resolve_worktree_name_falls_back_to_hash_for_non_ascii_message` |
| UC-1 | D8 trusted parent repo → worktree trusted | `default_worktree_thread_auto_trusts_when_parent_repo_is_trusted` |
| UC-1 | D8 untrusted parent repo → prompt remains | `default_worktree_thread_keeps_trust_prompt_when_parent_repo_is_untrusted` |
| UC-3 | D1 typed wins | `resolve_worktree_name_uses_typed_name_over_message` |
| D5   | grouping default-on | `worktree_threads_group_under_repo_by_default` |
| D4   | base branch arg | `worktree_create_git_args_include_base_branch` (pure arg helper) |
| D6   | collision suffix | `resolve_worktree_name_appends_hash_suffix_on_collision` |
| D7   | new Start Composer restores recent New-worktree mode | `a_new_thread_defaults_to_the_remembered_worktree_environment` |
| D7   | Local stays selected when it is the recent environment | `a_new_thread_defaults_to_the_remembered_local_environment` |
| D7   | Scratch cannot restore pending new-worktree intent | `remembered_new_worktree_falls_back_to_local_without_project_scope` |
| D7   | existing worktree paths are normalized to Local before persistence/restore | `existing_worktree_paths_are_not_restored_as_global_start_defaults` |
| D9   | Local start plans a checkout when branch differs | `local_branch_checkout_plan_switches_current_folder_before_start` |
| D9   | Remote-only branch blocks Local checkout | `local_branch_checkout_plan_blocks_remote_only_branch` |
| D10  | Running same-cwd Thread requires confirmation | `local_branch_checkout_plan_warns_when_running_thread_shares_cwd` |
| D9   | Main git args switch the selected branch | `branch_checkout_args_switch_to_branch` |

## Implementation Notes

Sliced for incremental, low-risk landing:

- **Slice A — naming rule (pure + tested)**: `src/shared/worktree-name.ts`
  (`slugFromMessage`, `resolveWorktreeName`) + unit tests. Foundational; directly
  resolves the determinism/Korean concern. Zero UI risk.
- **Slice B — grouping default**: flip `groupWorktreesByRepo` default to `true`
  (`product-shell-state.ts`), confirm/extend the worktree branch badge on grouped
  thread rows, update the existing grouping test. Small, independent.
- **Slice C — base-branch contract**: extend `createWorktree` IPC + git args with
  `baseBranch` (pure git-arg helper unit-tested; main wiring additive).
- **Slice D — deferred composer flow**: "New worktree…" sets the pending intent
  (inline form: optional name + base-branch picker); send path resolves the name
  (Slice A), creates (Slice C), re-scopes, starts. Replaces the eager submit-time
  create in the composer (`tide-product-shell.ts` `worktreeCreate`).

Keep the pending intent renderer-local (not in Backend Thread contracts); it is
consumed before `thread.start`. Hash generation lives in renderer/main (real
randomness), injected into the pure rule so tests stay deterministic.

## Location

- `src/shared/worktree-name.ts` (new), `src/shared/worktree-path.ts`
- `src/desktop/infrastructure/electron/main/electron-main.ts`, `src/desktop/infrastructure/electron/preload/index.ts`
- `src/desktop/application/domains/agent-chat/agent-chat.ts`
- `src/desktop/application/domains/product-shell/product-shell.ts`
- `src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.ts`, `renderer-entry.ts`
