# Spec: Open Folder → Persisted Project Registry

## Scope

Codex-style project onboarding for Tide's Left UI Projects section and the
Composer Project menu. A user opens a real directory; it is registered as a
persisted Project that stays listed even with no Threads, and scopes the new
Thread. Scratch remains the no-Project path. Worktree is unchanged (a separate
git execution choice within a Project).

Out of scope: creating/initializing new directories (the OS picker's "New
Folder" covers that), git worktree listing, Directory Trust (provider-owned).

## Evidence

- `docs_v2/glossary.md`: Project = a local folder/repo grouping providing the
  default execution context; Scratch = Threads with no explicit Project (Tide
  managed cwd); Worktree Option = current folder vs new/existing git worktree.
- Today projects are derived ONLY from threads (`projectsFromThreads`) — no
  registry, no folder picker; "Use existing folder"/"Create new project" were
  no-ops with hardcoded rows.
- Electron Main owns IPC (`tide:backend-command`) and the app data root
  (`resolveAppDataRoot()` → `TIDE_APP_DATA_ROOT ?? userData`).

## Decisions

### D1. The project registry is persisted by Electron Main
A Project registry (`project-registry.json` under the app data root) records
opened folders `{ projectId, name, cwd }`. It is a Desktop/Left-UI concern, not
agent-runtime domain, so it is persisted via Main IPC (supervisor) rather than
new backend Agent contracts.

### D2. Single "Open folder" action
The Composer Project menu offers one registration action, **Open folder**, which
opens the native directory picker. There is no separate "create new project"
flow (the OS picker can create folders). Selecting a folder registers it and
scopes the Thread to it.

### D3. Registry persists independent of Threads
A registered Project stays in the Projects list even with zero Threads (like
Codex). The displayed Projects list is the union of the registry and
thread-derived projects, deduped by `projectId` (cwd-derived).

### D4. projectId is derived from the cwd
`projectId` = the folder's basename; `name` = basename. The cwd is the unique
key (dedupe by cwd). This keeps a folder's identity stable across registry and
thread-derived sources.

### D5. Scratch and Worktree unchanged
Scratch stays the no-Project scope. The Worktree menu is untouched (still the
git execution choice within the chosen Project).

## Contracts (Main IPC, preload surface)

```ts
openDirectory(): Promise<string | null>;          // native dir picker
listProjects(): Promise<ProjectRegistryEntry[]>;  // read registry
registerProject(cwd: string): Promise<ProjectRegistryEntry[]>; // add + persist, returns full list
// ProjectRegistryEntry = { projectId: string; name: string; cwd: string }
```

## Flow

### UC-1: Open a folder as a Project
1. User clicks **Open folder** in the Composer Project menu.
2. Renderer calls `openDirectory()`; on cancel (null) nothing happens.
3. Renderer calls `registerProject(cwd)`; Main dedupes by cwd, persists, returns list.
4. Desktop merges the registry into the Projects list and scopes the Start
   Composer to the chosen Project.

### UC-2: Restore registry on launch
1. On mount the renderer calls `listProjects()`.
2. Desktop seeds the registry into the Projects list (union with thread-derived).

## Invariants
1. The registry persists under the app data root and survives restart.
2. Registry entries are deduped by cwd.
3. A registered Project appears in Projects even with no Threads.
4. Scratch threads never create a registry entry.

## Tests
| Use Case | Rule | Expectation |
|----------|------|-------------|
| UC-1 | D3/D4 | Merging a registered project with thread-derived projects yields one entry per cwd (no dupes). |
| UC-1 | D3 | A registered project with no threads still appears in the Projects list. |
| UC-2 | D1 | Setting the registry on product-shell state lists those projects. |
| D2 | — | The Composer Project menu shows a single "Open folder" action (no create/use-existing rows). |

## Implementation Notes
- Main: `tide:open-directory`, `tide:list-projects`, `tide:register-project`.
- Preload + renderer `window.tide` type: add the three methods.
- product-shell-state: `registeredProjects` field + `setProductShellRegisteredProjects`; merge in `projectsFromThreads` union.
- agent-chat-shell-state: Project menu → "Open folder" row (rowId `open-folder`).
- Renderer wires "Open folder" → IPC → register → state update.

## Location
- `src/desktop/infrastructure/electron/main/electron-main.ts`, `src/desktop/infrastructure/electron/preload/index.ts`
- `src/desktop/application/domains/product-shell/product-shell-state.ts`
- `src/desktop/application/domains/agent-chat/agent-chat-shell-state.ts`
- `src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.ts`, `renderer-entry.ts`
