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
    app.panes
        .insert(id, PaneKind::Editor(EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

fn temp_markdown_path(label: &str) -> PathBuf {
    let id = NEXT_TEST_FILE_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "tide_markdown_workspace_{}_{}_{}.md",
        std::process::id(),
        id,
        label
    ))
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
    crate::tide_core::Modifiers {
        meta: true,
        ctrl: false,
        shift: true,
        alt: true,
    }
}

fn preview_only_modifiers() -> crate::tide_core::Modifiers {
    crate::tide_core::Modifiers {
        meta: true,
        ctrl: false,
        shift: true,
        alt: false,
    }
}

fn pane_content_rect(
    pane_rect: crate::tide_core::Rect,
    cell_height: f32,
) -> crate::tide_core::Rect {
    let base = crate::pane::pane_content_rect(pane_rect, crate::theme::TAB_BAR_HEIGHT);
    let padding = crate::theme::editor_live_preview_vertical_padding(cell_height);
    crate::tide_core::Rect::new(
        base.x,
        base.y + padding,
        base.width,
        (base.height - 2.0 * padding).max(1.0),
    )
}

fn test_window_proxy() -> crate::tide_platform::WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    crate::tide_platform::WindowProxy::new(tx, std::sync::Arc::new(|| {}))
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

#[test]
fn split_preview_prepare_caches_uses_preview_region_width() {
    // UC-2 BR-9: Split preview preview lines come from preview_cache keyed by preview region width
    let (mut app, id, _path) = app_with_markdown_editor("# Title\n\nThis is a fairly long markdown paragraph that should wrap inside split preview.");
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 520.0, 320.0);
    let cell_size = app.window.cached_cell_size;
    let content_rect = pane_content_rect(pane_rect, cell_size.height);

    let pane = match app.panes.get_mut(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    pane.split_preview = true;
    let (_, preview_rect) = pane
        .split_preview_rects(content_rect, cell_size)
        .expect("split preview should have a preview region");

    pane.prepare_inline_caches(content_rect, cell_size, false);

    assert_eq!(
        pane.preview_cache_width(),
        Some(pane.preview_wrap_width_for_rect(preview_rect, cell_size)),
    );
    assert!(
        pane.preview_line_count() > 0,
        "split preview should populate cached preview lines"
    );
}

#[test]
fn split_preview_click_refreshes_wrap_map_for_authoring_region_width() {
    // UC-2 BR-8: Split preview authoring reuses a cached WrapMap built for the authoring region width
    let (mut app, id, _path) = app_with_markdown_editor(&"a".repeat(160));
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 520.0, 320.0);
    let cell_size = app.window.cached_cell_size;
    let content_rect = pane_content_rect(pane_rect, cell_size.height);
    app.visual_pane_rects = vec![(id, pane_rect)];

    let (authoring_rect, split_width_cols, full_width_cols) = {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.split_preview = true;
        let (authoring_rect, _) = pane
            .split_preview_rects(content_rect, cell_size)
            .expect("split preview should have an authoring region");
        let split_width_cols = pane.wrap_cols_for_rect(authoring_rect, cell_size);
        let full_width_cols = pane.wrap_cols_for_rect(content_rect, cell_size);
        pane.ensure_wrap_map(full_width_cols);
        assert_eq!(
            pane.wrap_map().map(|map| map.wrap_width()),
            Some(full_width_cols)
        );
        (authoring_rect, split_width_cols, full_width_cols)
    };

    assert!(
        full_width_cols > split_width_cols,
        "test setup should produce a narrower authoring region in split preview"
    );

    let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
    let click_x = authoring_rect.x + gutter_width + 2.0 * cell_size.width + 1.0;
    let click_y = authoring_rect.y + 1.0 * cell_size.height + 1.0;

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::MouseClick {
            position: crate::tide_core::Vec2::new(click_x, click_y),
            button: crate::tide_core::MouseButton::Left,
        }),
    );

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(
        pane.wrap_map().map(|map| map.wrap_width()),
        Some(split_width_cols)
    );
    let pos = pane.editor.cursor_position();
    assert_eq!(
        pos.line, 0,
        "wrapped click should stay on the first logical line"
    );
    assert_eq!(pos.col, split_width_cols + 2);
}

#[test]
fn split_preview_selection_stays_in_authoring_region() {
    // UC-2 BR-10: Split preview mouse selection starts only inside the authoring region
    let (mut app, id, _path) = app_with_markdown_editor("# Title\n\nBody");
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 520.0, 320.0);
    let cell_size = app.window.cached_cell_size;
    let content_rect = pane_content_rect(pane_rect, cell_size.height);
    app.visual_pane_rects = vec![(id, pane_rect)];

    let preview_rect = {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.split_preview = true;
        pane.prepare_inline_caches(content_rect, cell_size, false);
        pane.preview_rect(content_rect, cell_size)
            .expect("split preview should expose a preview region")
    };

    app.window.last_cursor_pos = crate::tide_core::Vec2::new(
        preview_rect.x + cell_size.width + 1.0,
        preview_rect.y + cell_size.height + 1.0,
    );

    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert!(
        pane.selection.is_none(),
        "preview-region clicks should not start authoring selection"
    );
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
