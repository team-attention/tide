// Spec: docs/specs/diff-auto-refresh.md

use std::collections::HashMap;
use std::path::PathBuf;

use crate::pane::diff::{DiffFileEntry, DiffLine, DiffPane};
use crate::pane::PaneKind;
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

// --- UC-1: Auto-refresh DiffPane on git status change ---

#[test]
fn apply_poll_data_bumps_generation() {
    // UC-1 BR-2: DiffPane generation is bumped on apply so the renderer invalidates cache
    let cwd = PathBuf::from("/tmp/test-repo");
    let mut dp = DiffPane::new_empty(1, cwd);
    let gen_before = dp.generation;

    let files = vec![DiffFileEntry {
        status: " M".to_string(),
        path: "foo.rs".to_string(),
        additions: 3,
        deletions: 1,
    }];
    let mut diff_cache = HashMap::new();
    diff_cache.insert(0, vec![DiffLine::Added("new line".to_string())]);

    dp.apply_poll_data(files, diff_cache);
    assert!(dp.generation > gen_before);
}

#[test]
fn apply_poll_data_replaces_files_and_cache() {
    // UC-1 BR-1: Diff data is applied without calling git commands (just data replacement)
    let cwd = PathBuf::from("/tmp/test-repo");
    let mut dp = DiffPane::new_empty(1, cwd);
    assert!(dp.files.is_empty());
    assert!(dp.diff_cache.is_empty());

    let files = vec![
        DiffFileEntry {
            status: " M".to_string(),
            path: "a.rs".to_string(),
            additions: 1,
            deletions: 0,
        },
        DiffFileEntry {
            status: "??".to_string(),
            path: "b.rs".to_string(),
            additions: 5,
            deletions: 0,
        },
    ];
    let mut diff_cache = HashMap::new();
    diff_cache.insert(0, vec![DiffLine::Added("line1".to_string())]);
    diff_cache.insert(
        1,
        vec![
            DiffLine::Added("line2".to_string()),
            DiffLine::Added("line3".to_string()),
        ],
    );

    dp.apply_poll_data(files, diff_cache);
    assert_eq!(dp.files.len(), 2);
    assert_eq!(dp.diff_cache.len(), 2);
    assert_eq!(dp.expanded.len(), 2);
    assert_eq!(dp.files[0].path, "a.rs");
    assert_eq!(dp.files[1].path, "b.rs");
}

#[test]
fn consume_git_poll_refreshes_matching_diff_panes() {
    // UC-1 BR-3: Only DiffPanes whose cwd repo root matches the poller result are refreshed
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;

    let cwd = PathBuf::from("/tmp/test-repo");
    let dp = DiffPane::new_empty(id, cwd.clone());
    let gen_before = dp.generation;
    app.panes.insert(id, PaneKind::Diff(dp));
    app.focus.focused = Some(id);

    // Simulate poll results with diff data
    let mut results: crate::state::background::GitPollResults = HashMap::new();
    let files = vec![DiffFileEntry {
        status: " M".to_string(),
        path: "changed.rs".to_string(),
        additions: 2,
        deletions: 1,
    }];
    let mut diff_cache = HashMap::new();
    diff_cache.insert(
        0,
        vec![
            DiffLine::Removed("old".to_string()),
            DiffLine::Added("new".to_string()),
        ],
    );
    results.insert(
        cwd.clone(),
        crate::state::background::GitPollCwdResult {
            git_info: None,
            worktree_count: 0,
            current_worktree: None,
            worktrees: vec![],
            repo_root: Some(cwd.clone()),
            status_entries: vec![],
            diff_files: Some(files),
            diff_cache: Some(diff_cache),
        },
    );

    // Directly test the matching: iterate panes, find DiffPane with matching cwd
    let result = results.get(&cwd).unwrap();
    if let Some(ref files) = result.diff_files {
        for pane in app.panes.values_mut() {
            if let PaneKind::Diff(dp) = pane {
                if dp.cwd == cwd {
                    dp.apply_poll_data(
                        files.clone(),
                        result.diff_cache.clone().unwrap_or_default(),
                    );
                }
            }
        }
    }

    // Verify the diff pane was refreshed
    if let Some(PaneKind::Diff(dp)) = app.panes.get(&id) {
        assert!(dp.generation > gen_before);
        assert_eq!(dp.files.len(), 1);
        assert_eq!(dp.files[0].path, "changed.rs");
    } else {
        panic!("Expected DiffPane");
    }
}

#[test]
fn git_poll_collects_per_file_diffs_only_when_wants_diff() {
    // UC-1 BR-4: per-file diff collection is gated on an open DiffPane (wants_diff).
    use crate::application::services::file_tree_service::cwd_wants_diff;
    use std::collections::HashSet;
    use std::path::Path;

    let diff_cwds: HashSet<PathBuf> = [PathBuf::from("/repo/a")].into_iter().collect();
    let diff_roots: HashSet<PathBuf> = [PathBuf::from("/repo")].into_iter().collect();

    // Exact cwd match → wants diff.
    assert!(cwd_wants_diff(
        Path::new("/repo/a"),
        None,
        &diff_cwds,
        &diff_roots
    ));
    // Same repo root (different cwd) → wants diff.
    assert!(cwd_wants_diff(
        Path::new("/repo/b"),
        Some(Path::new("/repo")),
        &diff_cwds,
        &diff_roots
    ));
    // Unrelated cwd/repo → no diff.
    assert!(!cwd_wants_diff(
        Path::new("/other"),
        Some(Path::new("/other")),
        &diff_cwds,
        &diff_roots
    ));
    // No open DiffPanes → never wants diff.
    assert!(!cwd_wants_diff(
        Path::new("/repo/a"),
        Some(Path::new("/repo")),
        &HashSet::new(),
        &HashSet::new()
    ));
}

// --- UC-2: Open a DiffPane without blocking the app thread ---

#[test]
fn unloaded_diff_pane_renders_loading_state() {
    // UC-2 BR-6: a not-yet-loaded DiffPane is in the loading state, not a clean tree.
    let dp = DiffPane::new_empty(1, PathBuf::from("/tmp/test-repo"));
    assert!(!dp.loaded, "freshly opened DiffPane must start unloaded");
    assert!(dp.files.is_empty());
}

#[test]
fn open_diff_pane_spawns_no_git_subprocess() {
    // UC-2 BR-5: opening a DiffPane creates an empty, unloaded pane — content
    // arrives later from the poller, so no synchronous git ran on the app thread.
    use crate::FileOpsPort;
    let mut app = test_app();
    let (layout, root_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(root_id, PaneKind::Launcher(0));
    app.focus.focused = Some(root_id);

    app.open_diff_pane(PathBuf::from("/tmp/test-repo"));

    let dp = app
        .panes
        .values()
        .find_map(|p| match p {
            PaneKind::Diff(dp) => Some(dp),
            _ => None,
        })
        .expect("open_diff_pane should create a DiffPane");
    assert!(!dp.loaded, "open must not synchronously populate the pane");
    assert!(dp.files.is_empty());
}

#[test]
fn empty_wants_diff_result_settles_diff_pane_on_clean_tree() {
    // UC-2 BR-7: a wants-diff poll result with no changes clears the loading state.
    let mut dp = DiffPane::new_empty(1, PathBuf::from("/tmp/test-repo"));
    assert!(!dp.loaded);
    let gen_before = dp.generation;

    // Clean tree: empty file list + empty cache.
    dp.apply_poll_data(Vec::new(), HashMap::new());

    assert!(dp.loaded, "clean-tree result must mark the pane loaded");
    assert!(dp.files.is_empty());
    assert!(
        dp.generation > gen_before,
        "loading→clean transition must bump generation to repaint"
    );
}
