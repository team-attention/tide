// Spec: docs/specs/session.md — UC-1: SaveLoadSession
use crate::application::ports::outward::persistence_port::{Session, SessionLayout};

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
