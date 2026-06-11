// Spec: docs/specs/editor-file-watch-sync.md

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::application::ports::outward::file_watcher_port::{FileWatchEvent, FileWatcherPort};
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalContext};
use crate::state::FocusArea;
use crate::App;

static NEXT_TEST_DIR_ID: AtomicUsize = AtomicUsize::new(0);

struct RecordingFileWatcher {
    events: VecDeque<FileWatchEvent>,
    watched: Arc<Mutex<Vec<PathBuf>>>,
}

impl RecordingFileWatcher {
    fn new(events: Vec<FileWatchEvent>, watched: Arc<Mutex<Vec<PathBuf>>>) -> Self {
        Self {
            events: events.into(),
            watched,
        }
    }
}

impl FileWatcherPort for RecordingFileWatcher {
    fn init(&mut self, _waker: Option<crate::tide_platform::WakeCallback>) {}

    fn watch(&mut self, path: &Path) {
        self.watched.lock().unwrap().push(path.to_path_buf());
    }

    fn unwatch(&mut self, _path: &Path) {}

    fn poll_events(&mut self) -> Vec<FileWatchEvent> {
        self.events.drain(..).collect()
    }

    fn is_dirty(&self) -> bool {
        !self.events.is_empty()
    }

    fn clear_dirty(&self) {}
}

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn temp_fixture_dir(label: &str) -> PathBuf {
    let id = NEXT_TEST_DIR_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "tide_editor_file_watch_sync_{}_{}_{}",
        std::process::id(),
        id,
        label
    ))
}

fn symlinked_file_paths(label: &str) -> (PathBuf, PathBuf, PathBuf) {
    let fixture_root = temp_fixture_dir(label);
    let real_dir = fixture_root.join("real");
    let link_dir = fixture_root.join("link");
    std::fs::create_dir_all(&real_dir).unwrap();
    std::os::unix::fs::symlink(&real_dir, &link_dir).unwrap();
    let real_path = real_dir.join("note.md");
    let link_path = link_dir.join("note.md");
    (fixture_root, real_path, link_path)
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

// --- UC-1: ReloadCleanEditorPaneFromEquivalentWatchPath ---

#[test]
fn clean_editor_reloads_when_file_watch_event_uses_equivalent_real_path() {
    // UC-1 BR-1/BR-2: Matching uses normalized path identity and reloads a clean Editor Pane
    let (fixture_root, real_path, link_path) = symlinked_file_paths("reload");
    std::fs::write(&real_path, "# Before\n").unwrap();
    let event_path = std::fs::canonicalize(&real_path).unwrap();
    assert_ne!(event_path, link_path, "fixture must produce path aliasing");

    let watched = Arc::new(Mutex::new(Vec::new()));
    let watcher =
        RecordingFileWatcher::new(vec![FileWatchEvent::Modified(event_path)], watched.clone());
    let (mut app, id) = app_with_file_backed_editor(&link_path);
    app.ports.file_watcher = Box::new(watcher);
    app.watch_file(&link_path);

    std::fs::write(&real_path, "# After\n").unwrap();
    app.update();

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(pane.editor.buffer.lines, vec!["# After".to_string()]);
    assert!(!pane.disk_changed);
    assert!(!pane.file_deleted);

    let _ = std::fs::remove_dir_all(fixture_root);
}

#[test]
fn clean_editor_reload_clamps_cursor_to_character_boundary() {
    // UC-1 BR-5: Clean external reload preserves the cursor only at a valid UTF-8 character boundary.
    let (fixture_root, real_path, link_path) = symlinked_file_paths("char-boundary");
    std::fs::write(&real_path, "ab\n").unwrap();
    let event_path = std::fs::canonicalize(&real_path).unwrap();

    let watched = Arc::new(Mutex::new(Vec::new()));
    let watcher =
        RecordingFileWatcher::new(vec![FileWatchEvent::Modified(event_path)], watched.clone());
    let (mut app, id) = app_with_file_backed_editor(&link_path);
    app.ports.file_watcher = Box::new(watcher);
    app.watch_file(&link_path);

    {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.handle_action(
            crate::tide_editor::input::EditorAction::SetCursor { line: 0, col: 1 },
            20,
        );
        assert_eq!(
            pane.editor.cursor_position().col,
            1,
            "setup should place cursor after 'a'"
        );
    }

    std::fs::write(&real_path, "가나다\n").unwrap();
    app.update();

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    let cursor = pane.editor.cursor_position();
    let line = pane
        .editor
        .buffer
        .line(cursor.line)
        .expect("cursor line should exist");
    assert!(
        line.is_char_boundary(cursor.col),
        "reloaded cursor col must be a valid character boundary"
    );
    assert_eq!(
        cursor.col, 0,
        "cursor should floor to the nearest valid boundary"
    );

    let _ = std::fs::remove_dir_all(fixture_root);
}

// --- UC-3: ReloadCleanEditorPaneAfterAtomicReplacement ---

#[test]
fn clean_editor_treats_existing_removed_path_as_atomic_replacement() {
    // UC-3 BR-7: A remove event for a file path that currently exists again is treated as a changed file, not as a deletion.
    let fixture_root = temp_fixture_dir("atomic-replace-remove");
    std::fs::create_dir_all(&fixture_root).unwrap();
    let path = fixture_root.join("note.md");
    std::fs::write(&path, "# Before\n").unwrap();

    let watched = Arc::new(Mutex::new(Vec::new()));
    let watcher = RecordingFileWatcher::new(vec![FileWatchEvent::Removed(path.clone())], watched);
    let (mut app, id) = app_with_file_backed_editor(&path);
    app.ports.file_watcher = Box::new(watcher);

    std::fs::write(&path, "# After\n").unwrap();
    app.update();

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane to stay open"),
    };
    assert_eq!(pane.editor.buffer.lines, vec!["# After".to_string()]);
    assert!(!pane.disk_changed);
    assert!(!pane.file_deleted);

    let _ = std::fs::remove_dir_all(fixture_root);
}

#[test]
fn clean_editor_reloads_when_parent_directory_watch_event_reports_directory_path() {
    // UC-3 BR-8: A parent-directory change event refreshes clean Editor Panes in that directory when no child path is available.
    let fixture_root = temp_fixture_dir("atomic-replace-parent");
    std::fs::create_dir_all(&fixture_root).unwrap();
    let path = fixture_root.join("note.md");
    std::fs::write(&path, "# Before\n").unwrap();

    let watched = Arc::new(Mutex::new(Vec::new()));
    let watcher = RecordingFileWatcher::new(
        vec![FileWatchEvent::Modified(fixture_root.clone())],
        watched,
    );
    let (mut app, id) = app_with_file_backed_editor(&path);
    app.ports.file_watcher = Box::new(watcher);

    std::fs::write(&path, "# After\n").unwrap();
    app.update();

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(pane.editor.buffer.lines, vec!["# After".to_string()]);
    assert!(!pane.disk_changed);
    assert!(!pane.file_deleted);

    let _ = std::fs::remove_dir_all(fixture_root);
}

// --- UC-2: RefreshFileTreeGitStatusAfterEditorFileWatchEvent ---

#[test]
fn file_watch_event_triggers_git_poll_for_retained_editor_context() {
    // UC-2 BR-3/BR-4: File-watch-driven Editor updates trigger git polling from retained editor context
    let (fixture_root, real_path, link_path) = symlinked_file_paths("git-poll");
    std::fs::write(&real_path, "before\n").unwrap();

    let watched = Arc::new(Mutex::new(Vec::new()));
    let watcher = RecordingFileWatcher::new(
        vec![FileWatchEvent::Modified(
            std::fs::canonicalize(&real_path).unwrap(),
        )],
        watched,
    );
    let (mut app, id) = app_with_file_backed_editor(&link_path);
    app.ports.file_watcher = Box::new(watcher);
    app.focus.focused = Some(id);

    let terminal_id = 42;
    let repo_root = fixture_root.join("repo-root");
    std::fs::create_dir_all(&repo_root).unwrap();
    app.assoc.associated_terminal.insert(id, terminal_id);
    let mut retained = TerminalContext::default();
    retained.cwd = Some(repo_root.clone());
    app.assoc.retained_contexts.insert(terminal_id, retained);

    let (tx, rx) = std::sync::mpsc::channel();
    app.bg.git_poll_cwd_tx = Some(tx);

    std::fs::write(&real_path, "after\n").unwrap();
    app.update();

    let requests = rx.try_recv().expect("expected git poll trigger");
    assert!(
        requests.iter().any(|r| r.cwd == repo_root),
        "git poll should include the retained editor context cwd"
    );

    let _ = std::fs::remove_dir_all(fixture_root);
}
