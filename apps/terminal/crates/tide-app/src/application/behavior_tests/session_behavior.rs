// Spec: docs/specs/session.md
use crate::application::ports::outward::persistence_port::{Session, SessionLayout};
use crate::pane::PaneKind;
use crate::DockPort;

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
    // UC-3 BR-8: restore_preferences preserves side-surface widths and theme but resets launch surface visibility.
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

#[test]
fn boot_seed_then_initial_pane_yields_exactly_one_workspace() {
    // UC-3 BR-11: main.rs seeds the Workspace rail once before init_phase1, then
    // creating the initial Terminal Pane must not push a duplicate Workspace.
    // A fresh non-crash launch must end with exactly one Workspace.
    let mut app = crate::App::new();

    // main.rs:184 seeds the rail before the window/init phase.
    app.ensure_initial_workspace_seeded();
    // init_phase1 (no saved session) creates the first Terminal Pane.
    app.create_initial_pane(None);

    assert_eq!(app.ws.workspaces.len(), 1);
    assert_eq!(app.ws.active, 0);
    assert_eq!(terminal_pane_count(&app), 1);
}

#[test]
fn restore_preferences_applies_light_mode_to_prespawned_terminal() {
    // UC-3 BR-9: restore_preferences syncs restored dark_mode into a pre-spawned Terminal.
    let session = Session {
        layout: SessionLayout::Leaf {
            pane_id: 1,
            cwd: None,
        },
        focused_pane_id: Some(1),
        show_file_tree: false,
        file_tree_width: 240.0,
        dark_mode: false,
        window_width: 1200.0,
        window_height: 800.0,
        sidebar_side: "left".to_string(),
        sidebar_outer: true,
        ws_sidebar_width: 88.0,
        show_workspace_sidebar: true,
        dock_open: false,
    };
    let mut app = crate::App::new();
    let early_terminal =
        crate::tide_terminal::Terminal::with_cwd(80, 24, None, true, Some(1)).unwrap();

    app.restore_preferences(&session, Some(early_terminal));

    let terminal = app
        .panes
        .values()
        .find_map(|pane| match pane {
            PaneKind::Terminal(terminal) => Some(terminal),
            _ => None,
        })
        .expect("restore_preferences should install the pre-spawned Terminal Pane");
    assert!(
        !terminal.backend.dark_mode_for_test(),
        "pre-spawned Terminal backend should match restored light mode"
    );
}

#[test]
fn restore_event_records_restored_stage_and_context_pane_counts() {
    // UC-3 BR-12: Workspace task monitors can summarize launch/session restore outcomes.
    let mut app = crate::App::new();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        terminal_id,
        PaneKind::Terminal(
            crate::pane::TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap(),
        ),
    );
    let context_id = app.layout.alloc_id();
    app.panes.insert(
        context_id,
        PaneKind::Browser(crate::pane::browser::BrowserPane::new(context_id)),
    );
    app.add_pane_to_dock(context_id, Some(terminal_id));

    app.record_restore_event(crate::state::RestoreEventKind::SessionRestored, true);

    let event = app
        .last_restore_event
        .as_ref()
        .expect("restore event should be recorded");
    assert_eq!(event.kind, crate::state::RestoreEventKind::SessionRestored);
    assert!(event.crash_recovery);
    assert_eq!(event.restored_panes, 2);
    assert_eq!(event.restored_context_panes, 1);
}

#[test]
fn launch_window_config_uses_default_size_despite_saved_session_dimensions() {
    // UC-3 BR-10: Ordinary launch ignores saved native Tide Window dimensions and uses default WindowConfig size.
    let session = Session {
        layout: SessionLayout::Leaf {
            pane_id: 1,
            cwd: None,
        },
        focused_pane_id: Some(1),
        show_file_tree: true,
        file_tree_width: 312.0,
        dark_mode: false,
        window_width: 1560.0,
        window_height: 909.0,
        sidebar_side: "right".to_string(),
        sidebar_outer: true,
        ws_sidebar_width: 96.0,
        show_workspace_sidebar: false,
        dock_open: true,
    };

    let config = crate::launch_window_config(Some(&session));

    assert_eq!(config.width, 960.0);
    assert_eq!(config.height, 640.0);
}
