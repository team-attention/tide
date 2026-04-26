// Spec: docs/specs/file-tree-bundle-handoff.md

use crate::application::ports::outward::process_port::ProcessPort;
use crate::tide_core::{FileTreeSource, Rect, Vec2};
use crate::{App, ContextMenuAction, ContextMenuState};
use std::cell::RefCell;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use tempfile::TempDir;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

#[derive(Clone, Default)]
struct ProcessCalls {
    opened_paths: Vec<PathBuf>,
    revealed_paths: Vec<PathBuf>,
}

#[derive(Clone)]
struct RecordingProcess {
    calls: Rc<RefCell<ProcessCalls>>,
}

impl ProcessPort for RecordingProcess {
    fn open_with_default_app(&self, path: &Path) -> io::Result<()> {
        self.calls
            .borrow_mut()
            .opened_paths
            .push(path.to_path_buf());
        Ok(())
    }

    fn reveal_in_finder(&self, path: &Path) -> io::Result<()> {
        self.calls
            .borrow_mut()
            .revealed_paths
            .push(path.to_path_buf());
        Ok(())
    }

    fn open_url(&self, _url: &str) -> io::Result<()> {
        Ok(())
    }
}

fn reveal_in_finder_action_index(is_dir: bool) -> usize {
    ContextMenuAction::items(is_dir, true)
        .iter()
        .position(|action| *action == ContextMenuAction::RevealInFinder)
        .expect("RevealInFinder action should exist")
}

fn setup_app_bundle_root() -> (TempDir, PathBuf) {
    let tmp = TempDir::new().expect("failed to create temp dir");
    let bundle_path = tmp.path().join("Tide.app");
    fs::create_dir(&bundle_path).expect("failed to create app bundle directory");
    fs::write(bundle_path.join("Contents.txt"), "bundle marker")
        .expect("failed to create app bundle contents");
    (tmp, bundle_path)
}

fn first_file_tree_row_click_position() -> Vec2 {
    Vec2::new(
        12.0,
        crate::theme::PANE_CORNER_RADIUS + crate::theme::FILE_TREE_HEADER_HEIGHT + 1.0,
    )
}

// --- UC-1: ActivateAppBundleFromFileTree ---

#[test]
fn clicking_app_bundle_in_file_tree_launches_it_instead_of_toggling_directory_expansion() {
    // UC-1 BR-1: Plain FileTree activation on a .app directory must launch the bundle instead of toggling directory expansion.
    let mut app = test_app();
    let calls = Rc::new(RefCell::new(ProcessCalls::default()));
    app.ports.process = Box::new(RecordingProcess {
        calls: Rc::clone(&calls),
    });
    app.ft.visible = true;
    app.ft.rect = Some(Rect::new(0.0, 0.0, 320.0, 420.0));

    let (_tmp, bundle_path) = setup_app_bundle_root();
    app.ft.tree = Some(crate::tide_tree::FsTree::new(
        bundle_path
            .parent()
            .expect("bundle should have a parent directory")
            .to_path_buf(),
    ));

    let initial_visible_count = app
        .ft
        .tree
        .as_ref()
        .expect("file tree should exist")
        .visible_entries()
        .len();

    app.handle_file_tree_click(first_file_tree_row_click_position());

    let calls = calls.borrow();
    assert_eq!(calls.opened_paths.as_slice(), &[bundle_path]);
    assert!(calls.revealed_paths.is_empty());
    let visible_count_after_click = app
        .ft
        .tree
        .as_ref()
        .expect("file tree should exist")
        .visible_entries()
        .len();
    assert_eq!(visible_count_after_click, initial_visible_count);
}

// --- UC-2: RevealAppBundleInFinder ---

#[test]
fn open_in_finder_reveals_app_bundles_without_launching_them() {
    // UC-2 BR-2: Open in Finder on a .app directory must call Finder reveal instead of default-app launch.
    let mut app = test_app();
    let calls = Rc::new(RefCell::new(ProcessCalls::default()));
    app.ports.process = Box::new(RecordingProcess {
        calls: Rc::clone(&calls),
    });
    let bundle_path = PathBuf::from("/tmp/Tide.app");
    app.modal.context_menu = Some(ContextMenuState {
        entry_index: 0,
        path: bundle_path.clone(),
        is_dir: true,
        shell_idle: true,
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });

    app.execute_context_menu_action(reveal_in_finder_action_index(true));

    let calls = calls.borrow();
    assert!(calls.opened_paths.is_empty());
    assert_eq!(calls.revealed_paths.as_slice(), &[bundle_path]);
}

#[test]
fn system_process_routes_app_bundle_open_in_finder_through_finder_app() {
    // UC-2 BR-3: App-bundle Open in Finder goes through Finder explicitly instead of opening the bundle path as an app.
    let source = include_str!("../../adapter/outward/process_adapter/mod.rs");

    assert!(source.contains("fn reveal_in_finder(&self, path: &Path)"));
    assert!(source.contains("is_app_bundle_path(path)"));
    assert!(source.contains("std::process::Command::new(\"open\")"));
    assert!(source.contains(".arg(\"-a\")"));
    assert!(source.contains(".arg(\"Finder\")"));
    assert!(source.contains("path.parent().unwrap_or(path)"));
}

// --- UC-3: PreserveNormalFinderHandoff ---

#[test]
fn open_in_finder_keeps_default_directory_handoff_for_non_bundle_directories() {
    // UC-3 BR-4: Non-bundle directories must preserve the existing default-app handoff.
    let mut app = test_app();
    let calls = Rc::new(RefCell::new(ProcessCalls::default()));
    app.ports.process = Box::new(RecordingProcess {
        calls: Rc::clone(&calls),
    });
    let dir_path = PathBuf::from("/tmp/workspace");
    app.modal.context_menu = Some(ContextMenuState {
        entry_index: 0,
        path: dir_path.clone(),
        is_dir: true,
        shell_idle: true,
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });

    app.execute_context_menu_action(reveal_in_finder_action_index(true));

    let calls = calls.borrow();
    assert_eq!(calls.opened_paths.as_slice(), &[dir_path]);
    assert!(calls.revealed_paths.is_empty());
}
