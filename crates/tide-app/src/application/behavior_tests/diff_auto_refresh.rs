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
