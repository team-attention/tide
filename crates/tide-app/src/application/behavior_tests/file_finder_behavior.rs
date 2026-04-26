// Spec: docs/specs/file-finder.md

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::state::{
    FileFinderDestination, FileFinderMode, FileFinderState, SymbolMatch, WorkspaceSearchHit,
};
use crate::tide_core::{MouseButton, Vec2};
use crate::App;
use crate::AppCorePort;

static NEXT_TEST_DIR_ID: AtomicUsize = AtomicUsize::new(0);

fn temp_dir(label: &str) -> PathBuf {
    let id = NEXT_TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "tide_file_finder_behavior_{}_{}_{}",
        std::process::id(),
        id,
        label
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn symbol(label: &str, path: &str, line: usize) -> SymbolMatch {
    SymbolMatch {
        label: label.to_string(),
        path: PathBuf::from(path),
        line,
        col: 0,
    }
}

fn test_app() -> App {
    let mut app = App::new();
    app.ports.fs = Box::new(crate::adapter::outward::fs_adapter::RealFileSystem);
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn test_window_proxy() -> crate::tide_platform::WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    crate::tide_platform::WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

fn app_with_file_backed_editor(root: &PathBuf, rel_path: &str, contents: &str) -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;

    let path = root.join(rel_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&path, contents).unwrap();

    let pane = EditorPane::open(id, &path).unwrap();
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

// --- UC-1: SearchFiles ---

#[test]
fn plain_query_uses_file_mode() {
    // UC-1 BR-1: A plain query uses FileFinderMode::Files.
    let base = temp_dir("plain_mode");
    let mut finder = FileFinderState::new(
        base,
        vec![PathBuf::from("src/editor.rs"), PathBuf::from("README.md")],
    );

    finder.insert_char('e');

    assert_eq!(finder.mode, FileFinderMode::Files);
}

#[test]
fn plain_file_query_prefers_basename_matches_over_deeper_paths() {
    // UC-1 BR-2: File search prefers basename and prefix matches ahead of deeper path-only matches.
    let base = temp_dir("basename_rank");
    let entries = vec![
        PathBuf::from("src/editor/view.rs"),
        PathBuf::from("editor.rs"),
        PathBuf::from("docs/editor-notes.md"),
    ];
    let mut finder = FileFinderState::new(base, entries);

    for ch in "editor".chars() {
        finder.insert_char(ch);
    }

    assert_eq!(finder.mode, FileFinderMode::Files);
    assert_eq!(finder.filtered.len(), 3);
    assert_eq!(
        finder.entries[finder.filtered[0]],
        PathBuf::from("editor.rs")
    );
}

// --- UC-2: SearchSymbols ---

#[test]
fn at_prefix_switches_to_current_file_symbol_mode() {
    // UC-2 BR-3: @query switches FileFinder into current-file symbol mode.
    let base = temp_dir("current_symbols");
    let mut finder = FileFinderState::new(base, vec![]).with_symbol_sources(
        Some(7),
        vec![symbol("render_header", "src/header.rs", 12)],
        vec![],
    );

    finder.insert_char('@');
    finder.insert_char('h');

    assert_eq!(finder.mode, FileFinderMode::Symbols);
    assert_eq!(finder.filtered.len(), 1);
}

#[test]
fn hash_prefix_switches_to_workspace_symbol_mode() {
    // UC-2 BR-4: #query switches FileFinder into workspace symbol mode.
    let base = temp_dir("workspace_symbols");
    let mut finder = FileFinderState::new(base, vec![]).with_symbol_sources(
        Some(7),
        vec![],
        vec![
            symbol("render_header", "src/header.rs", 12),
            symbol("render_grid", "src/grid.rs", 48),
        ],
    );

    finder.insert_char('#');
    finder.insert_char('g');

    assert_eq!(finder.mode, FileFinderMode::WorkspaceSymbols);
    assert_eq!(finder.filtered.len(), 1);
}

#[test]
fn selected_current_file_symbol_targets_focused_editor() {
    // UC-2 BR-5: Selecting a current-file SymbolMatch targets the focused Editor Pane.
    let base = temp_dir("symbol_destination");
    let mut finder = FileFinderState::new(base, vec![]).with_symbol_sources(
        Some(19),
        vec![symbol("render_header", "src/header.rs", 12)],
        vec![],
    );

    finder.insert_char('@');
    finder.insert_char('r');

    assert_eq!(
        finder.selected_destination(),
        Some(FileFinderDestination::FocusedEditorSymbol {
            pane_id: 19,
            line: 12,
            col: 0,
        })
    );
}

#[test]
fn selected_workspace_symbol_opens_file_at_symbol_line() {
    // UC-2 BR-6: Selecting a workspace SymbolMatch opens the target file at the symbol line.
    let base = temp_dir("workspace_symbol_destination");
    let mut finder = FileFinderState::new(base.clone(), vec![]).with_symbol_sources(
        Some(19),
        vec![],
        vec![symbol("render_grid", "src/grid.rs", 48)],
    );

    finder.insert_char('#');
    finder.insert_char('g');

    assert_eq!(
        finder.selected_destination(),
        Some(FileFinderDestination::OpenFile {
            path: base.join("src/grid.rs"),
            line: Some(48),
        })
    );
}

// --- UC-3: SearchWorkspaceText ---

#[test]
fn slash_prefix_switches_to_workspace_search_mode() {
    // UC-3 BR-7: /query switches FileFinder into workspace search mode.
    let base = temp_dir("workspace_search_mode");
    let src_dir = base.join("src");
    fs::create_dir_all(&src_dir).unwrap();
    fs::write(
        src_dir.join("main.rs"),
        "fn main() {\n    let needle = 1;\n}\n",
    )
    .unwrap();

    let mut finder = FileFinderState::new(base, vec![PathBuf::from("src/main.rs")]);
    for ch in "/needle".chars() {
        finder.insert_char(ch);
    }

    assert_eq!(finder.mode, FileFinderMode::WorkspaceSearch);
    assert_eq!(finder.filtered.len(), 1);
}

#[test]
fn workspace_search_ignores_single_character_queries() {
    // UC-3 BR-8: Workspace text search ignores empty and one-character queries.
    let base = temp_dir("workspace_search_short_query");
    fs::write(base.join("main.rs"), "needle\n").unwrap();

    let mut finder = FileFinderState::new(base, vec![PathBuf::from("main.rs")]);
    finder.insert_char('/');
    finder.insert_char('n');

    assert_eq!(finder.mode, FileFinderMode::WorkspaceSearch);
    assert!(finder.filtered.is_empty());
}

#[test]
fn selected_workspace_search_hit_opens_file_at_matching_line() {
    // UC-3 BR-9: Selecting a WorkspaceSearchHit opens the target file at the hit line.
    let base = temp_dir("workspace_hit_destination");
    let mut finder = FileFinderState::new(base.clone(), vec![]);
    finder.mode = FileFinderMode::WorkspaceSearch;
    finder.workspace_search_hits = vec![WorkspaceSearchHit {
        path: PathBuf::from("src/main.rs"),
        line: 7,
        col: 4,
        preview: "let needle = 1;".to_string(),
    }];
    finder.filtered = vec![0];

    assert_eq!(
        finder.selected_destination(),
        Some(FileFinderDestination::OpenFile {
            path: base.join("src/main.rs"),
            line: Some(7),
        })
    );
}

// --- UC-4: SelectWithPointer ---

#[test]
fn clicking_second_file_result_opens_the_clicked_file() {
    // UC-4 BR-10: Clicking a visible FileFinder file result opens the clicked file, not the previously selected result.
    let base = temp_dir("file_click_destination");
    let alpha_path = base.join("alpha.rs");
    let beta_path = base.join("beta.rs");
    fs::write(&alpha_path, "fn alpha() {}\n").unwrap();
    fs::write(&beta_path, "fn beta() {}\n").unwrap();
    let (mut app, original_id) = app_with_file_backed_editor(&base, "main.rs", "fn main() {}\n");
    app.modal.file_finder = Some(FileFinderState::new(
        base.clone(),
        vec![PathBuf::from("alpha.rs"), PathBuf::from("beta.rs")],
    ));

    let click_position = {
        let finder = app.modal.file_finder.as_ref().expect("file finder");
        let cell = app.window.cached_cell_size;
        let logical = app.logical_size();
        let geo = finder.geometry(cell.height, logical.width, logical.height);
        Vec2::new(geo.popup_x + 16.0, geo.list_top + geo.line_height * 1.5)
    };
    app.window.last_cursor_pos = click_position;

    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        MouseButton::Left,
        &test_window_proxy(),
    );

    assert!(app.modal.file_finder.is_none());
    let focused_id = app.focus.focused.expect("focused pane");
    assert_ne!(focused_id, original_id);
    let pane = match app.panes.get(&focused_id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected focused editor pane"),
    };
    assert_eq!(pane.editor.file_path(), Some(beta_path.as_path()));
}
