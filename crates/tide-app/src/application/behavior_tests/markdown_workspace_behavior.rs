// Spec: docs/specs/markdown-workspace.md
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::ActionPort;
use crate::App;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_TEST_FILE_ID: AtomicUsize = AtomicUsize::new(0);

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_editor() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(id, PaneKind::Editor(EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

fn temp_markdown_path(label: &str) -> PathBuf {
    let id = NEXT_TEST_FILE_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("tide_markdown_workspace_{}_{}_{}.md", std::process::id(), id, label))
}

fn app_with_markdown_editor(contents: &str) -> (App, u64, PathBuf) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let path = temp_markdown_path("split_preview");
    std::fs::write(&path, contents).unwrap();
    let pane = EditorPane::open(id, &path).unwrap();
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id, path)
}

fn split_preview_modifiers() -> crate::tide_core::Modifiers {
    crate::tide_core::Modifiers { meta: true, ctrl: false, shift: true, alt: true }
}

fn preview_only_modifiers() -> crate::tide_core::Modifiers {
    crate::tide_core::Modifiers { meta: true, ctrl: false, shift: true, alt: false }
}

// --- UC-1: ToggleSplitPreview ---

#[test]
fn split_preview_toggle_is_ignored_for_non_markdown_panes() {
    // UC-1 BR-1: Split preview can be enabled only on Markdown panes
    let (mut app, id) = app_with_editor();

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::KeyPress {
            key: crate::tide_core::Key::Char('m'),
            modifiers: split_preview_modifiers(),
        }),
    );

    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.split_preview_active());
        assert!(!pane.preview_mode);
    } else {
        panic!("expected editor pane");
    }
}

#[test]
fn split_preview_toggle_enables_markdown_panes() {
    // UC-1 BR-2: Split preview toggle enables Markdown panes
    let (mut app, id, _path) = app_with_markdown_editor("# Title\n\nBody");

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::KeyPress {
            key: crate::tide_core::Key::Char('m'),
            modifiers: split_preview_modifiers(),
        }),
    );

    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.split_preview_active());
    } else {
        panic!("expected editor pane");
    }
}

#[test]
fn split_preview_toggle_keeps_preview_only_mode_disabled() {
    // UC-1 BR-3: Enabling split preview keeps preview-only mode disabled
    let (mut app, id, _path) = app_with_markdown_editor("# Title\n\nBody");

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::KeyPress {
            key: crate::tide_core::Key::Char('m'),
            modifiers: split_preview_modifiers(),
        }),
    );

    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.split_preview_active());
        assert!(!pane.preview_mode);
    } else {
        panic!("expected editor pane");
    }
}

// --- UC-2: AuthorWithSplitPreviewVisible ---

#[test]
fn text_input_keeps_authoring_active_while_split_preview_is_visible() {
    // UC-2 BR-4: Routed text input continues to mutate the Markdown buffer while split preview is visible
    let (mut app, id, _path) = app_with_markdown_editor("# Title\n");

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::KeyPress {
            key: crate::tide_core::Key::Char('m'),
            modifiers: split_preview_modifiers(),
        }),
    );
    app.send_text_to_target("hello");

    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.split_preview_active());
        assert!(pane.editor.is_modified());
        assert!(!pane.preview_mode);
    } else {
        panic!("expected editor pane");
    }
}

// --- UC-3: PreservePreviewOnlyMode ---

#[test]
fn preview_only_toggle_disables_split_preview() {
    // UC-3 BR-6: Entering preview-only mode disables split preview first
    let (mut app, id, _path) = app_with_markdown_editor("# Title\n\nBody");

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::KeyPress {
            key: crate::tide_core::Key::Char('m'),
            modifiers: split_preview_modifiers(),
        }),
    );
    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::KeyPress {
            key: crate::tide_core::Key::Char('m'),
            modifiers: preview_only_modifiers(),
        }),
    );

    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.split_preview_active());
        assert!(pane.preview_mode);
    } else {
        panic!("expected editor pane");
    }
}
