// Spec: docs/specs/file-tree-bundle-handoff.md

use crate::application::ports::outward::process_port::ProcessPort;
use crate::tide_core::{FileTreeSource, Rect, Vec2};
use crate::tide_platform::WindowCommand;
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

fn reveal_in_finder_action_index(is_dir: bool, is_app_bundle: bool) -> usize {
    ContextMenuAction::items(is_dir, is_app_bundle, true)
        .iter()
        .position(|action| *action == ContextMenuAction::RevealInFinder)
        .expect("RevealInFinder action should exist")
}

fn open_app_action_index() -> usize {
    ContextMenuAction::items(true, true, true)
        .iter()
        .position(|action| *action == ContextMenuAction::OpenApp)
        .expect("OpenApp action should exist")
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

#[test]
fn clicking_app_bundle_in_file_tree_leaves_the_current_tide_window_open_after_launch() {
    // UC-1 BR-2: Successful plain FileTree activation on a .app directory must not queue WindowCommand::CloseWindow for the current Tide Window.
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

    app.handle_file_tree_click(first_file_tree_row_click_position());

    assert!(app
        .pending_platform_commands
        .iter()
        .all(|command| !matches!(command, WindowCommand::CloseWindow)));
}

// --- UC-2: OpenAppBundleFromContextMenu ---

#[test]
fn app_bundle_context_menu_uses_app_specific_actions_instead_of_directory_actions() {
    // UC-2 BR-3: .app directories must expose an explicit Open App context-menu action instead of reusing the generic directory action set.
    let items = ContextMenuAction::items(true, true, true);

    assert_eq!(
        items,
        &[
            ContextMenuAction::OpenApp,
            ContextMenuAction::RevealInFinder,
            ContextMenuAction::Rename,
            ContextMenuAction::Delete,
        ]
    );
}

#[test]
fn open_app_launches_app_bundles_from_the_file_tree_context_menu() {
    // UC-2 BR-4: Open App on a .app directory must call ProcessPort::open_with_default_app().
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
        is_app_bundle: true,
        shell_idle: true,
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });

    app.execute_context_menu_action(open_app_action_index());

    let calls = calls.borrow();
    assert_eq!(calls.opened_paths.as_slice(), &[bundle_path]);
    assert!(calls.revealed_paths.is_empty());
}

#[test]
fn open_app_leaves_the_current_tide_window_open_after_launch() {
    // UC-2 BR-5: Successful Open App on a .app directory must not queue WindowCommand::CloseWindow for the current Tide Window.
    let mut app = test_app();
    let calls = Rc::new(RefCell::new(ProcessCalls::default()));
    app.ports.process = Box::new(RecordingProcess {
        calls: Rc::clone(&calls),
    });
    let bundle_path = PathBuf::from("/tmp/Tide.app");
    app.modal.context_menu = Some(ContextMenuState {
        entry_index: 0,
        path: bundle_path,
        is_dir: true,
        is_app_bundle: true,
        shell_idle: true,
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });

    app.execute_context_menu_action(open_app_action_index());

    assert!(app
        .pending_platform_commands
        .iter()
        .all(|command| !matches!(command, WindowCommand::CloseWindow)));
}

// --- UC-3: RevealAppBundleInFinder ---

#[test]
fn app_bundle_context_menu_keeps_a_finder_specific_reveal_label() {
    // UC-3 BR-6: .app directories keep a separate Finder-reveal action that is labeled as Finder-specific.
    assert_eq!(
        ContextMenuAction::RevealInFinder.label(),
        "Reveal in Finder"
    );
}

#[test]
fn finder_reveal_reveals_app_bundles_without_launching_them() {
    // UC-3 BR-7: Finder reveal on a .app directory must call Finder reveal instead of default-app launch.
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
        is_app_bundle: true,
        shell_idle: true,
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });

    app.execute_context_menu_action(reveal_in_finder_action_index(true, true));

    let calls = calls.borrow();
    assert!(calls.opened_paths.is_empty());
    assert_eq!(calls.revealed_paths.as_slice(), &[bundle_path]);
}

#[test]
fn system_process_routes_app_bundle_reveal_through_standard_finder_reveal() {
    // UC-3 BR-8: App-bundle Finder reveal uses the standard Finder reveal handoff instead of a Finder-specific parent-directory open path.
    let source = include_str!("../../adapter/outward/process_adapter/mod.rs");

    assert!(source.contains("fn reveal_in_finder(&self, path: &Path)"));
    assert!(source.contains("std::process::Command::new(\"open\")"));
    assert!(source.contains(".arg(\"-R\")"));
    assert!(source.contains(".arg(path)"));
}

// --- UC-4: PreserveNormalFinderHandoff ---

#[test]
fn open_in_finder_keeps_default_directory_handoff_for_non_bundle_directories() {
    // UC-4 BR-9: Non-bundle directories must preserve the existing default-app handoff.
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
        is_app_bundle: false,
        shell_idle: true,
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });

    app.execute_context_menu_action(reveal_in_finder_action_index(true, false));

    let calls = calls.borrow();
    assert_eq!(calls.opened_paths.as_slice(), &[dir_path]);
    assert!(calls.revealed_paths.is_empty());
}
