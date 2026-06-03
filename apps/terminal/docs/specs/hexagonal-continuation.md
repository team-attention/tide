# Spec: Hexagonal Architecture — Continuation Plan

This is a historical continuation plan from the hexagonal migration. It is not the current product-surface reference; use `docs/glossary.md`, `docs/context-map.md`, and the active specs for current Tide terminology such as Workspace rail, Stage, Terminal Context Surface, and FileTree View.

## Current State (commit 0968fb9)

tide-app has been restructured into hexagonal architecture. 332 tests pass, bundle builds and runs.

### Directory Structure
```
tide-app/src/
├── main.rs                    # fn main() + mod declarations + facade re-exports
├── app.rs                     # App struct + Ports field + core helpers
├── theme.rs
├── layout_compute.rs
├── domain/
│   ├── mod.rs
│   ├── ports/
│   │   ├── mod.rs             # Ports struct (noop/real) + outward re-exports
│   │   ├── clock.rs           # ClockPort ✅
│   │   ├── clipboard.rs       # ClipboardPort ✅
│   │   ├── fs.rs              # FileSystemPort ✅
│   │   ├── process.rs         # ProcessPort ✅
│   │   └── inward/
│   │       ├── mod.rs          # All inward trait re-exports
│   │       ├── action.rs       # ActionPort (trait defined, NOT impl'd yet)
│   │       ├── pane_lifecycle.rs # PaneLifecyclePort (trait defined, NOT impl'd)
│   │       ├── dock.rs         # DockPort ✅ impl'd
│   │       ├── workspace_nav.rs # WorkspaceNavPort (trait defined, NOT impl'd)
│   │       ├── focus_nav.rs    # FocusNavPort ✅ impl'd
│   │       ├── file_ops.rs     # FileOpsPort ✅ impl'd
│   │       ├── clipboard_search.rs # ClipboardSearchPort ✅ impl'd
│   │       ├── text_extract.rs # TextExtractPort ✅ impl'd
│   │       ├── app_core.rs     # AppCorePort (trait defined, NOT impl'd)
│   │       └── layout.rs       # LayoutPort (trait defined, NOT impl'd)
│   ├── state/                  # 16 files (split from 1640 LOC mod.rs)
│   ├── pane/                   # terminal, editor, browser, diff, launcher
│   ├── modal/                  # ModalStack + all modal state types
│   └── action/                 # domain actions (some converted to trait impls)
├── adapter/
│   ├── inward/                 # event_loop.rs + handler/ (keyboard, click, mouse, etc.)
│   └── outward/
│       ├── view/               # rendering, header, ui, chrome, overlays
│       └── service/            # update, session, lsp, file_tree, gpu_init
└── behavior_tests/             # 26 test files, 332 tests
```

### Key Architecture Patterns

**Outward ports** (domain → infrastructure):
- Trait defined in `domain/ports/{name}.rs`
- Real + Noop impls in same file
- Added to `Ports` struct in `domain/ports/mod.rs`
- `App.ports` field, `Ports::noop()` in `App::new()`, `Ports::real()` in `init_phase1()`
- Call sites: `self.ports.{port}.method()` replaces direct IO calls

**Inward ports** (adapter → domain):
- Trait defined in `domain/ports/inward/{name}.rs`
- `impl TraitName for App` replaces `impl App` in the domain action file
- `pub(crate)`/`pub(super)` removed from methods (trait handles visibility)
- Private/static methods stay in separate `impl App` block
- Callers add `use crate::TraitName;` import
- All traits glob-exported via `pub(crate) use domain::ports::inward::*;` in main.rs

---

## Remaining Work

### A. Outward Ports — ✅ ALL COMPLETE (11/11)

Each follows the same pattern as ClockPort/ClipboardPort/FileSystemPort/ProcessPort.

#### 1. PersistencePort ✅
- **Trait** (`domain/ports/persistence.rs`):
  - `save_session(&self, session: &Session) -> io::Result<()>`
  - `load_session(&self) -> io::Result<Option<Session>>`
  - `save_context_area_session(&self, data: &ContextAreaSession) -> io::Result<()>`
  - `load_context_area_session(&self) -> io::Result<Option<ContextAreaSession>>`
  - `create_running_marker(&self) -> io::Result<()>`
  - `delete_running_marker(&self)`
  - `is_crash_recovery(&self) -> bool`
  - `save_settings(&self, settings: &TideSettings) -> io::Result<()>`
  - `load_settings(&self) -> Option<TideSettings>`
- **Migration targets**: `adapter/outward/service/session.rs`, `domain/state/settings.rs`, `adapter/inward/event_loop.rs`, `main.rs`
- **Real impl**: wraps current session.rs + settings.rs fs ops
- **Noop impl**: load returns None, save is no-op

#### 2. GitPort ✅ (partial — poller stays in adapter layer)
- **Trait** (`domain/ports/git.rs`):
  - `detect_git_info(&self, cwd: &Path) -> Option<GitInfo>`
  - `count_worktrees(&self, cwd: &Path) -> usize`
  - `repo_root(&self, cwd: &Path) -> Option<PathBuf>`
  - `status_files(&self, cwd: &Path) -> Vec<StatusEntry>`
  - `file_diff(&self, cwd: &Path, path: &Path, staged: bool) -> String`
  - `numstat(&self, cwd: &Path) -> Vec<NumstatEntry>`
  - `list_worktrees(&self, cwd: &Path) -> Vec<WorktreeInfo>`
  - `remove_worktree(&self, root: &Path, path: &Path, force: bool) -> Result<(), String>`
  - `delete_branch(&self, root: &Path, branch: &str, force: bool) -> Result<(), String>`
  - `start_poller(&self) -> Option<GitPollerHandle>`
- **Migration targets**: `adapter/outward/service/file_tree.rs`, `domain/pane/diff.rs`, `domain/action/pane_close.rs`

#### 3. FileWatcherPort ✅
- **Trait** (`domain/ports/file_watcher.rs`):
  - `watch(&mut self, path: &Path) -> io::Result<()>`
  - `unwatch(&mut self, path: &Path) -> io::Result<()>`
  - `poll_events(&mut self) -> Vec<FileWatchEvent>`
  - `is_dirty(&self) -> bool`
  - `clear_dirty(&self)`
- **Migration targets**: `adapter/outward/service/mod.rs` (init_file_watcher, watcher.watch/unwatch, rx.try_recv, file_watch_dirty)

#### 4. TerminalFactoryPort ✅
- **Trait** (`domain/ports/terminal_factory.rs`):
  - `create_terminal(&self, id: PaneId, cols: u16, rows: u16, cwd: Option<&Path>, dark_mode: bool) -> Result<TerminalPane, String>`
  - `pre_spawn_terminal(&self, cols: u16, rows: u16) -> Result<tide_terminal::Terminal, String>`
- **Migration targets**: `domain/action/pane_create.rs`, `adapter/inward/event_loop.rs`, `app.rs`

#### 5. GpuPort ✅
- **Trait** (`domain/ports/gpu.rs`):
  - `init_gpu(&mut self, window: &dyn PlatformWindow) -> GpuResources`
  - `spawn_render_thread(&self, ...) -> RenderThreadHandle`
- **Migration targets**: `adapter/outward/service/gpu_init.rs`, `adapter/outward/view/render_thread.rs`

#### 6. PlatformPort ✅
- **Trait** (`domain/ports/platform.rs`):
  - `show_window(&self)`, `set_fullscreen(&self, bool)`, `create_ime_proxy(&self, u64)`, etc.
- **Migration targets**: `adapter/inward/event_loop.rs` (12 call sites)
- **Highest risk** — platform coupling

#### 7. LspPort ✅
- **Trait** (`domain/ports/lsp.rs`):
  - `init(&mut self, root: &Path)`, `did_open/change/save/close`, `request_completion`, `poll`, `is_initialized`
- **Migration targets**: `adapter/outward/service/lsp.rs`, `adapter/inward/event_loop.rs`

### B. Inward Ports — ✅ ALL COMPLETE (10/10)

All 10 inward port traits now have `impl TraitName for App`:

| Trait | Source file | Status |
|-------|-----------|--------|
| DockPort | `domain/action/dock.rs` | ✅ (prior session) |
| FocusNavPort | `domain/action/focus_nav.rs` | ✅ (prior session) |
| FileOpsPort | `domain/action/file_ops.rs` | ✅ (prior session) |
| ClipboardSearchPort | `domain/action/search.rs` | ✅ (prior session) |
| TextExtractPort | `domain/action/text_extract.rs` | ✅ (prior session) |
| AppCorePort | `app.rs` | ✅ |
| LayoutPort | `layout_compute.rs` | ✅ |
| WorkspaceNavPort | `domain/action/workspace.rs` | ✅ |
| ActionPort | `domain/action/mod.rs` | ✅ |
| PaneLifecyclePort | `domain/action/pane_create.rs` (trait impl) + `pane_close.rs` (private helpers) | ✅ |

**Note**: PaneLifecyclePort's `impl` block lives entirely in `pane_create.rs` because Rust requires a single `impl Trait for Type` block. Private helpers (`close_pane_final`, `retain_terminal_context`) remain as `impl App` in `pane_close.rs`.

### C. Monocrate Migration

Merge all 9 crates into tide-app as internal modules.

**Problem**: partial merge impossible. If tide-app internalizes tide-core, other crates (tide-renderer etc.) still depend on the external tide-core. Types become incompatible.

**Solution**: merge ALL crates simultaneously.

**Steps:**
1. Create module per crate in tide-app/src/: `core_types/`, `renderer/`, `terminal/`, `layout/`, `tree/`, `input_router/`, `editor/`, `platform/`, `lsp/`
2. Copy each crate's src/ into the corresponding module
3. Convert `lib.rs` → `mod.rs`, `pub` → `pub(crate)` where appropriate
4. In main.rs, add aliases: `pub(crate) use core_types as tide_core;` etc.
5. For ALL .rs files in the project, replace `use tide_X::` with `use crate::tide_X::`
6. For ALL inline references `tide_X::Type`, replace with `crate::tide_X::Type`
7. Merge all Cargo.toml dependencies into tide-app/Cargo.toml
8. Remove workspace members from root Cargo.toml
9. Remove old crate directories

**Estimated scope**: ~18,000 LOC moved, ~500 cross-crate imports changed

**Approach**: sed-based bulk replacement + compile-fix cycle. Cannot be done incrementally.

---

## Verification

After each change:
```
cargo test -p tide-app 2>&1    # 332 tests
cargo build --release -p tide-app 2>&1
cargo bundle --release -p tide-app 2>&1  # from workspace root
```

## Test Execution Rule
- `cargo test -p tide-app 2>&1` — NO pipe (| tail, | head, | grep causes zombie processes)
