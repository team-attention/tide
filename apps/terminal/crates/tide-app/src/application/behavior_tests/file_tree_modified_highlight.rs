// Spec: docs/specs/file-tree-modified-highlight.md

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_core::FileGitStatus;
use crate::ActionPort;
use crate::App;

static NEXT_TEST_FILE_ID: AtomicUsize = AtomicUsize::new(0);

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn temp_fixture_dir(label: &str) -> PathBuf {
    let id = NEXT_TEST_FILE_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "tide_file_tree_modified_highlight_{}_{}_{}",
        std::process::id(),
        id,
        label
    ))
}

fn app_with_file_backed_editor(path: &Path) -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let pane = EditorPane::open(id, path).unwrap();
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

fn install_file_tree(app: &mut App, root: &Path) {
    app.ft.tree = Some(crate::tide_tree::FsTree::new(root.to_path_buf()));
    app.sync_file_tree_path_identity_cache();
}

// --- UC-1: HighlightModifiedFileRowBeforeGitPoll ---

#[test]
fn dirty_editor_marks_matching_file_tree_file_modified_before_git_poll() {
    // UC-1 BR-1/BR-2: Dirty file-backed Editor Panes immediately surface as Modified for matching file rows
    let fixture_root = temp_fixture_dir("file");
    std::fs::create_dir_all(&fixture_root).unwrap();
    let path = fixture_root.join("note.txt");
    std::fs::write(&path, "before\n").unwrap();

    let (mut app, _id) = app_with_file_backed_editor(&path);
    install_file_tree(&mut app, &fixture_root);
    app.send_text_to_target("after");

    assert_eq!(
        app.effective_file_tree_git_status(&path, false),
        Some(FileGitStatus::Modified)
    );

    let _ = std::fs::remove_dir_all(fixture_root);
}

#[test]
fn dirty_editor_matches_file_tree_entries_by_normalized_path_identity() {
    // UC-1 BR-1: FileTree row matching uses normalized path identity across symlink and realpath aliases
    let fixture_root = temp_fixture_dir("symlink");
    let real_dir = fixture_root.join("real");
    let link_dir = fixture_root.join("link");
    std::fs::create_dir_all(&real_dir).unwrap();
    std::os::unix::fs::symlink(&real_dir, &link_dir).unwrap();
    let real_path = real_dir.join("note.txt");
    let link_path = link_dir.join("note.txt");
    std::fs::write(&real_path, "before\n").unwrap();

    let (mut app, _id) = app_with_file_backed_editor(&link_path);
    install_file_tree(&mut app, &real_dir);
    app.send_text_to_target("after");

    assert_eq!(
        app.effective_file_tree_git_status(&real_path, false),
        Some(FileGitStatus::Modified)
    );

    let _ = std::fs::remove_dir_all(fixture_root);
}

#[test]
fn cached_file_tree_git_status_is_preserved_over_dirty_editor_fallback() {
    // UC-1 BR-3: Cached FileTree git status wins over the dirty-editor fallback
    let fixture_root = temp_fixture_dir("cached");
    std::fs::create_dir_all(&fixture_root).unwrap();
    let path = fixture_root.join("note.txt");
    std::fs::write(&path, "before\n").unwrap();

    let (mut app, _id) = app_with_file_backed_editor(&path);
    install_file_tree(&mut app, &fixture_root);
    app.ft
        .git_status
        .insert(path.clone(), FileGitStatus::Untracked);
    app.send_text_to_target("after");

    assert_eq!(
        app.effective_file_tree_git_status(&path, false),
        Some(FileGitStatus::Untracked)
    );

    let _ = std::fs::remove_dir_all(fixture_root);
}

// --- UC-2: HighlightModifiedAncestorDirectoryBeforeGitPoll ---

#[test]
fn dirty_editor_marks_matching_file_tree_directory_modified_before_git_poll() {
    // UC-2 BR-4: Dirty file-backed Editor Panes immediately surface as Modified for ancestor directory rows
    let fixture_root = temp_fixture_dir("dir");
    let docs_dir = fixture_root.join("docs");
    std::fs::create_dir_all(&docs_dir).unwrap();
    let path = docs_dir.join("note.txt");
    std::fs::write(&path, "before\n").unwrap();

    let (mut app, _id) = app_with_file_backed_editor(&path);
    install_file_tree(&mut app, &fixture_root);
    app.send_text_to_target("after");

    assert_eq!(
        app.effective_file_tree_git_status(&docs_dir, true),
        Some(FileGitStatus::Modified)
    );

    let _ = std::fs::remove_dir_all(fixture_root);
}

#[test]
fn saving_file_backed_editor_clears_file_tree_modified_fallback() {
    // UC-2 BR-6: Saving a file-backed Editor Pane removes the FileTree Modified fallback
    let fixture_root = temp_fixture_dir("save");
    std::fs::create_dir_all(&fixture_root).unwrap();
    let path = fixture_root.join("note.txt");
    std::fs::write(&path, "before\n").unwrap();

    let (mut app, id) = app_with_file_backed_editor(&path);
    install_file_tree(&mut app, &fixture_root);
    app.send_text_to_target("after");

    assert_eq!(
        app.effective_file_tree_git_status(&path, false),
        Some(FileGitStatus::Modified)
    );

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::KeyPress {
            key: crate::tide_core::Key::Char('s'),
            modifiers: crate::tide_core::Modifiers {
                meta: true,
                ..Default::default()
            },
        }),
    );

    assert_eq!(app.effective_file_tree_git_status(&path, false), None);

    let _ = std::fs::remove_dir_all(fixture_root);
}
