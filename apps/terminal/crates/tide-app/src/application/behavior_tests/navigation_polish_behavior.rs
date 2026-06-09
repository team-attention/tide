// Spec: docs/specs/navigation-polish.md

use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_core::{InputEvent, MouseButton, Rect, Vec2};
use crate::App;
use crate::{ActionPort, FileOpsPort};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_NAVIGATION_POLISH_DIR_ID: AtomicUsize = AtomicUsize::new(0);

fn test_app() -> App {
    let mut app = App::new();
    app.ports.fs = Box::new(crate::adapter::outward::fs_adapter::RealFileSystem);
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn temp_root(label: &str) -> PathBuf {
    let id = NEXT_NAVIGATION_POLISH_DIR_ID.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "tide_navigation_polish_{}_{}_{}",
        std::process::id(),
        id,
        label
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
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
    app.ft.tree = Some(crate::tide_tree::FsTree::new(root.clone()));
    (app, id)
}

fn identifier_click_position(
    app: &App,
    pane_rect: Rect,
    line_index: usize,
    col_index: usize,
) -> Vec2 {
    let cell = app.window.cached_cell_size;
    Vec2::new(
        pane_rect.x
            + crate::theme::PANE_PADDING
            + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width
            + col_index as f32 * cell.width
            + 1.0,
        pane_rect.y + crate::theme::TAB_BAR_HEIGHT + line_index as f32 * cell.height + 1.0,
    )
}

// --- UC-1: PreserveSystemFullScreenBehavior ---

#[test]
fn macos_window_marks_tide_window_as_managed_primary_full_screen_window() {
    // UC-1 BR-1, BR-2, BR-3: Native NSWindow construction opts into managed primary full-screen behavior.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");

    assert!(source.contains("NS_WINDOW_COLLECTION_BEHAVIOR_MANAGED"));
    assert!(source.contains("NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_PRIMARY"));
    assert!(source.contains("NS_WINDOW_COLLECTION_BEHAVIOR_PRIMARY"));
    assert!(source.contains("setCollectionBehavior"));
}

// --- UC-2: OpenFileFinderWithoutWorkspaceSymbolPreload ---

#[test]
fn opening_file_finder_defers_workspace_symbol_indexing() {
    // UC-2 BR-4: Opening FileFinder must not preload workspace symbols.
    let root = temp_root("defer_workspace_symbols");
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/header.rs"), "fn render_header() {}\n").unwrap();
    let (mut app, _id) = app_with_file_backed_editor(
        &root,
        "src/main.rs",
        "fn local_symbol() {}\nlocal_symbol();\n",
    );

    app.open_file_finder();

    let finder = app
        .modal
        .file_finder
        .as_ref()
        .expect("file finder should open");
    assert!(!finder.current_file_symbols.is_empty());
    assert!(finder.workspace_symbols.is_empty());
    assert!(
        !finder.workspace_symbols_loaded,
        "workspace symbol index should stay unloaded until requested"
    );
}

#[test]
fn workspace_symbol_mode_loads_symbol_index_once_on_demand() {
    // UC-2 BR-5, BR-6: WorkspaceSymbols mode lazy-loads the index once and remembers the loaded state.
    let root = temp_root("load_workspace_symbols");
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/header.rs"), "fn render_header() {}\n").unwrap();
    let (mut app, _id) = app_with_file_backed_editor(&root, "src/main.rs", "fn main() {}\n");

    app.open_file_finder();
    if let Some(ref mut finder) = app.modal.file_finder {
        finder.set_query("#render_header".to_string());
    }
    app.ensure_file_finder_workspace_symbols_loaded();
    let first_len = app
        .modal
        .file_finder
        .as_ref()
        .expect("file finder")
        .workspace_symbols
        .len();
    assert_eq!(
        app.modal.file_finder.as_ref().expect("file finder").mode,
        crate::state::FileFinderMode::WorkspaceSymbols
    );
    assert!(first_len > 0);
    assert!(
        app.modal
            .file_finder
            .as_ref()
            .expect("file finder")
            .workspace_symbols_loaded
    );

    app.ensure_file_finder_workspace_symbols_loaded();
    let second_len = app
        .modal
        .file_finder
        .as_ref()
        .expect("file finder")
        .workspace_symbols
        .len();

    assert_eq!(second_len, first_len);
}

// --- UC-3: GoToDefinitionFromModifierClick ---

#[test]
fn modifier_click_on_local_editor_symbol_jumps_in_file_without_palette() {
    // UC-3 BR-7: Modifier-click on a symbol defined in the current file jumps to
    // that definition in place (VS Code), and never opens the search palette.
    let root = temp_root("local_modifier_click");
    let (mut app, id) = app_with_file_backed_editor(
        &root,
        "src/main.rs",
        "fn render_header() {}\nrender_header();\n",
    );
    let pane_rect = Rect::new(0.0, 0.0, 420.0, 320.0);
    app.visual_pane_rects = vec![(id, pane_rect)];
    app.window.modifiers = crate::tide_core::Modifiers {
        meta: true,
        ..crate::tide_core::Modifiers::default()
    };
    // Click the call site on line 2 (0-based row 1).
    let click_position = identifier_click_position(&app, pane_rect, 1, 2);

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(InputEvent::MouseClick {
            position: click_position,
            button: MouseButton::Left,
        }),
    );

    assert!(
        app.modal.file_finder.is_none(),
        "Cmd+click must not open the search palette"
    );
    // The caret jumped to the definition on the first line (0-based row 0).
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert_eq!(pane.editor.cursor.position.line, 0);
    } else {
        panic!("editor pane expected");
    }
}

#[test]
fn modifier_click_on_cross_file_editor_symbol_opens_definition_file_without_palette() {
    // UC-3 BR-8: Modifier-click on a symbol defined in another file opens that
    // file at the definition — no palette.
    let root = temp_root("workspace_modifier_click");
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/header.rs"), "fn render_header() {}\n").unwrap();
    let (mut app, id) = app_with_file_backed_editor(
        &root,
        "src/main.rs",
        "fn main() {\n    render_header();\n}\n",
    );
    let pane_rect = Rect::new(0.0, 0.0, 420.0, 320.0);
    app.visual_pane_rects = vec![(id, pane_rect)];
    app.window.modifiers = crate::tide_core::Modifiers {
        meta: true,
        ..crate::tide_core::Modifiers::default()
    };
    let click_position = identifier_click_position(&app, pane_rect, 1, 4);

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(InputEvent::MouseClick {
            position: click_position,
            button: MouseButton::Left,
        }),
    );

    assert!(
        app.modal.file_finder.is_none(),
        "Cmd+click must not open the search palette"
    );
    let opened_header = app.panes.values().any(|p| {
        matches!(p, PaneKind::Editor(ep)
            if ep.editor.file_path().map(|x| x.ends_with("header.rs")).unwrap_or(false))
    });
    assert!(opened_header, "header.rs (the definition file) should open");
}
