// Spec: docs/specs/session.md
use crate::application::ports::outward::persistence_port::{Session, SessionLayout};
use crate::pane::PaneKind;

fn terminal_pane_count(app: &crate::App) -> usize {
    app.panes
        .values()
        .filter(|pane| matches!(pane, PaneKind::Terminal(_)))
        .count()
}

// --- UC-1: SaveLoadSession ---

#[test]
fn session_preserves_dark_mode_preference() {
    // UC-1 BR-1: Session preserves dark_mode preference
    let session = Session {
        layout: SessionLayout::Leaf {
            pane_id: 1,
            cwd: None,
        },
        focused_pane_id: Some(1),
        show_file_tree: false,
        file_tree_width: 200.0,
        dark_mode: false,
        window_width: 800.0,
        window_height: 600.0,
        sidebar_side: "left".to_string(),
        sidebar_outer: true,
        ws_sidebar_width: 180.0,
        show_workspace_sidebar: false,
        dock_open: false,
    };
    let json = serde_json::to_string(&session).unwrap();
    let restored: Session = serde_json::from_str(&json).unwrap();
    assert!(!restored.dark_mode);
}

#[test]
fn session_preserves_file_tree_visibility() {
    // UC-1 BR-2: Session preserves file tree visibility and width
    let session = Session {
        layout: SessionLayout::Leaf {
            pane_id: 1,
            cwd: None,
        },
        focused_pane_id: Some(1),
        show_file_tree: true,
        file_tree_width: 300.0,
        dark_mode: true,
        window_width: 1200.0,
        window_height: 800.0,
        sidebar_side: "right".to_string(),
        sidebar_outer: true,
        ws_sidebar_width: 180.0,
        show_workspace_sidebar: false,
        dock_open: false,
    };
    let json = serde_json::to_string(&session).unwrap();
    let restored: Session = serde_json::from_str(&json).unwrap();
    assert!(restored.show_file_tree);
    assert!((restored.file_tree_width - 300.0).abs() < f32::EPSILON);
    assert_eq!(restored.sidebar_side, "right");
}

#[test]
fn session_without_sidebar_fields_uses_defaults() {
    // UC-1 BR-3: Session without sidebar fields uses defaults
    let json = r#"{
        "layout": {"Leaf": {"pane_id": 1, "cwd": null}},
        "focused_pane_id": 1,
        "show_file_tree": false,
        "file_tree_width": 200.0,
        "dark_mode": true,
        "window_width": 800.0,
        "window_height": 600.0
    }"#;
    let session: Session = serde_json::from_str(json).unwrap();
    assert_eq!(session.sidebar_side, "left");
    assert!(session.sidebar_outer);
}

// --- UC-2: CreateFreshWorkspaceWithoutSession ---

#[test]
fn fresh_workspace_keeps_prespawned_terminal_at_startup_geometry_before_layout() {
    // UC-2 BR-4: A pre-spawned initial Terminal must not be resized from 80x24 using the whole Tide Window before layout computation
    let mut app = crate::App::new();
    app.window.window_size = (1800, 1095);
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    let early_terminal =
        crate::tide_terminal::Terminal::with_cwd(80, 24, None, true, Some(1)).unwrap();

    app.create_initial_pane(Some(early_terminal));

    let terminal = app
        .panes
        .values()
        .find_map(|pane| match pane {
            PaneKind::Terminal(terminal) => Some(terminal),
            _ => None,
        })
        .expect("fresh workspace should contain an initial Terminal Pane");
    assert_eq!(terminal.backend.current_cols(), 80);
    assert_eq!(terminal.backend.current_rows(), 24);
}

#[test]
fn fresh_workspace_uses_startup_geometry_when_creating_initial_terminal_before_layout() {
    // UC-2 BR-5: A non-pre-spawned initial Terminal must use the same 80x24 startup geometry before layout computation
    let mut app = crate::App::new();
    app.window.window_size = (1800, 1095);
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);

    app.create_initial_pane(None);

    let terminal = app
        .panes
        .values()
        .find_map(|pane| match pane {
            PaneKind::Terminal(terminal) => Some(terminal),
            _ => None,
        })
        .expect("fresh workspace should contain an initial Terminal Pane");
    assert_eq!(terminal.backend.current_cols(), 80);
    assert_eq!(terminal.backend.current_rows(), 24);
}

// --- UC-3: CreateDefaultLaunchSurface ---

#[test]
fn fresh_workspace_default_surface_shows_workspace_rail_and_terminal_only() {
    // UC-3 BR-6/BR-7: A fresh initial Workspace shows Workspace rail, one Stage Terminal Pane, and no side context.
    let mut app = crate::App::new();

    app.create_initial_pane(None);

    assert!(app.ws.show_sidebar);
    assert!(!app.ft.visible);
    assert!(!app.dock.dock_open);
    assert_eq!(terminal_pane_count(&app), 1);
}

#[test]
fn restore_preferences_starts_from_workspace_rail_and_terminal_only() {
    // UC-3 BR-8: restore_preferences preserves dimensions and theme but resets launch surface visibility.
    let session = Session {
        layout: SessionLayout::Leaf {
            pane_id: 1,
            cwd: None,
        },
        focused_pane_id: Some(1),
        show_file_tree: true,
        file_tree_width: 312.0,
        dark_mode: false,
        window_width: 1200.0,
        window_height: 800.0,
        sidebar_side: "right".to_string(),
        sidebar_outer: true,
        ws_sidebar_width: 96.0,
        show_workspace_sidebar: false,
        dock_open: true,
    };
    let mut app = crate::App::new();

    app.restore_preferences(&session, None);

    assert!(app.ws.show_sidebar);
    assert!(!app.ft.visible);
    assert!(!app.dock.dock_open);
    assert_eq!(terminal_pane_count(&app), 1);
    assert_eq!(app.ft.width.to_bits(), 312.0_f32.to_bits());
    assert_eq!(app.ws.width.to_bits(), 96.0_f32.to_bits());
    assert!(!app.window.dark_mode);
    assert_eq!(app.window.sidebar_side, crate::LayoutSide::Right);
}
