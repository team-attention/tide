// Session persistence: save/restore workspace state across app restarts.

use crate::tide_core::{PaneId, SplitDirection};
use crate::tide_layout::{LayoutSnapshot, SplitLayout};
use std::path::PathBuf;

use crate::pane::PaneKind;
use crate::App;
use crate::AppCorePort;
use crate::LayoutPort;

// Session types are defined in application/ports/outward/persistence_port.rs
pub(crate) use crate::application::ports::outward::persistence_port::{
    DrawerStateSnapshot, LeafGroupTab, Session, SessionContextArea, SessionLayout,
};

// ──────────────────────────────────────────────
// Session file I/O
// ──────────────────────────────────────────────

fn session_path() -> Option<PathBuf> {
    let config_dir = dirs::config_dir()?;
    Some(config_dir.join("tide").join("session.json"))
}

fn context_area_session_path() -> Option<PathBuf> {
    let config_dir = dirs::config_dir()?;
    Some(config_dir.join("tide").join("session_context_area.json"))
}

pub fn save_context_area_session(data: &SessionContextArea) {
    let path = match context_area_session_path() {
        Some(p) => p,
        None => return,
    };
    if let Ok(json) = serde_json::to_string_pretty(data) {
        let _ = std::fs::write(&path, json);
    }
}

pub fn load_context_area_session() -> Option<SessionContextArea> {
    let path = context_area_session_path()?;
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn save_session(session: &Session) {
    let path = match session_path() {
        Some(p) => p,
        None => {
            log::warn!("Could not determine config directory for session save");
            return;
        }
    };

    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            log::error!("Failed to create session directory: {}", e);
            return;
        }
    }

    match serde_json::to_string_pretty(session) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                log::error!("Failed to write session file: {}", e);
            }
        }
        Err(e) => {
            log::error!("Failed to serialize session: {}", e);
        }
    }
}

pub fn load_session() -> Option<Session> {
    let path = session_path()?;
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

// ──────────────────────────────────────────────
// Running marker for crash recovery
// ──────────────────────────────────────────────

fn running_marker_path() -> Option<PathBuf> {
    let config_dir = dirs::config_dir()?;
    Some(config_dir.join("tide").join("running"))
}

pub fn create_running_marker() {
    let path = match running_marker_path() {
        Some(p) => p,
        None => return,
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, "");
}

pub fn delete_running_marker() {
    if let Some(path) = running_marker_path() {
        let _ = std::fs::remove_file(&path);
    }
}

pub fn is_crash_recovery() -> bool {
    running_marker_path().is_some_and(|p| p.exists())
}

// ──────────────────────────────────────────────
// Capture session from app state
// ──────────────────────────────────────────────

impl Session {
    pub fn from_app(app: &App) -> Self {
        let layout = match app.layout.snapshot() {
            Some(snap) => snapshot_to_session(&snap, app),
            None => SessionLayout::Leaf {
                pane_id: 1,
                cwd: std::env::current_dir().ok(),
            },
        };

        let logical_w = app.window.window_size.0 as f32 / app.window.scale_factor;
        let logical_h = app.window.window_size.1 as f32 / app.window.scale_factor;

        Session {
            layout,
            focused_pane_id: app.focus.focused,
            show_file_tree: app.ft.visible,
            file_tree_width: app.ft.width,
            dark_mode: app.window.dark_mode,
            window_width: logical_w,
            window_height: logical_h,
            sidebar_side: match app.window.sidebar_side {
                crate::LayoutSide::Left => "left".to_string(),
                crate::LayoutSide::Right => "right".to_string(),
            },
            sidebar_outer: true, // sidebar is always outermost
            ws_sidebar_width: app.ws.width,
            show_workspace_sidebar: app.ws.show_sidebar,
            dock_open: app.dock.dock_open,
        }
    }
}

impl SessionContextArea {
    pub fn from_app(app: &App) -> Self {
        // Collect dock state from all terminal panes
        let mut drawer_states = std::collections::HashMap::new();
        for (&tid, pane) in &app.panes {
            if let crate::pane::PaneKind::Terminal(tp) = pane {
                let dock_pane_ids = tp.dock_layout.all_pane_ids();
                if !dock_pane_ids.is_empty() {
                    let snap_layout = tp
                        .dock_layout
                        .snapshot()
                        .map(|s| snapshot_to_session_layout(&s, app));
                    drawer_states.insert(
                        tid,
                        DrawerStateSnapshot {
                            pane_ids: dock_pane_ids,
                            focused: tp.dock_focused,
                            layout: snap_layout,
                            view_mode: match tp.dock_view_mode {
                                crate::state::ViewMode::Split => "split".to_string(),
                                crate::state::ViewMode::Stacked => "stacked".to_string(),
                            },
                        },
                    );
                }
            }
        }
        SessionContextArea {
            context_area_open: app.dock.dock_open,
            context_area_width: app.dock.dock_width,
            drawer_states,
        }
    }
}

fn snapshot_to_session_layout(snap: &LayoutSnapshot, app: &App) -> SessionLayout {
    snapshot_to_session(snap, app)
}

fn snapshot_to_session(snap: &LayoutSnapshot, app: &App) -> SessionLayout {
    match snap {
        LayoutSnapshot::Leaf { tabs, active } => {
            // Each leaf now has a single pane; use active index for backward compat
            let id = tabs
                .get(*active)
                .or_else(|| tabs.first())
                .copied()
                .unwrap_or(0);
            let cwd = match app.panes.get(&id) {
                Some(PaneKind::Terminal(pane)) => pane.backend.detect_cwd_fallback(),
                _ => None,
            };
            SessionLayout::Leaf { pane_id: id, cwd }
        }
        LayoutSnapshot::LeafGroup { tabs, active } => {
            let session_tabs: Vec<_> = tabs
                .iter()
                .map(|id| {
                    let cwd = match app.panes.get(id) {
                        Some(PaneKind::Terminal(pane)) => pane.backend.detect_cwd_fallback(),
                        _ => None,
                    };
                    LeafGroupTab { pane_id: *id, cwd }
                })
                .collect();
            SessionLayout::LeafGroup {
                tabs: session_tabs,
                active: *active,
            }
        }
        LayoutSnapshot::Split {
            direction,
            ratio,
            left,
            right,
        } => SessionLayout::Split {
            direction: match direction {
                SplitDirection::Horizontal => "horizontal".to_string(),
                SplitDirection::Vertical => "vertical".to_string(),
            },
            ratio: *ratio,
            left: Box::new(snapshot_to_session(left, app)),
            right: Box::new(snapshot_to_session(right, app)),
        },
    }
}

// ──────────────────────────────────────────────
// Restore session into app
// ──────────────────────────────────────────────

impl App {
    pub(crate) fn restore_from_session(&mut self, session: Session) -> bool {
        // Rebuild layout tree from session, collecting pane info
        let mut pane_infos: Vec<(PaneId, Option<PathBuf>)> = Vec::new();
        let snap = match session_to_snapshot(&session.layout, &mut pane_infos) {
            Some(s) => s,
            None => return false,
        };

        self.layout = SplitLayout::from_snapshot(snap);

        // Apply dark mode early so pane creation uses the correct palette
        self.window.dark_mode = session.dark_mode;

        // Create terminal panes
        let cell_size = self.cell_size();
        let logical = self.logical_size();
        let cols = if cell_size.width > 0.0 {
            ((logical.width / 2.0 / cell_size.width).max(1.0).min(1000.0)) as u16
        } else {
            80
        };
        let rows = if cell_size.height > 0.0 {
            ((logical.height / cell_size.height).max(1.0).min(500.0)) as u16
        } else {
            24
        };
        let workspace_name = self.active_workspace_name();

        for (pane_id, cwd) in &pane_infos {
            match self.ports.terminal_factory.create_terminal(
                *pane_id,
                cols,
                rows,
                cwd.as_deref(),
                self.window.dark_mode,
                self.tide_window_id,
                Some(&workspace_name),
            ) {
                Ok(pane) => {
                    self.install_pty_waker(&pane);
                    self.panes.insert(*pane_id, PaneKind::Terminal(pane));
                    self.ime.pending_creates.push(*pane_id);
                }
                Err(e) => {
                    log::error!("Failed to create terminal pane {}: {}", pane_id, e);
                    return false;
                }
            }
        }

        // Restore UI state
        self.ft.visible = session.show_file_tree;
        self.ft.width = session.file_tree_width;
        self.ws.width = session.ws_sidebar_width;
        self.ws.show_sidebar = session.show_workspace_sidebar;
        // Restore dock data from separate file
        if let Some(ctx) = self.ports.persistence.load_context_area_session() {
            self.dock.dock_open = ctx.context_area_open;
            self.dock.dock_width = ctx.context_area_width;
            // Restore dock_layout into each terminal's TerminalPane
            for (tid, snap) in &ctx.drawer_states {
                if let Some(ref sl) = snap.layout {
                    let mut pane_infos_inner: Vec<(PaneId, Option<PathBuf>)> = Vec::new();
                    if let Some(layout_snap) = session_to_snapshot(sl, &mut pane_infos_inner) {
                        if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(tid) {
                            tp.dock_layout = SplitLayout::from_snapshot(layout_snap);
                            tp.dock_focused = snap.focused;
                            tp.dock_view_mode = match snap.view_mode.as_str() {
                                "split" => crate::state::ViewMode::Split,
                                _ => crate::state::ViewMode::Stacked,
                            };
                        }
                    }
                }
            }
        }
        self.window.sidebar_side = match session.sidebar_side.as_str() {
            "right" => crate::LayoutSide::Right,
            _ => crate::LayoutSide::Left,
        };
        // Apply dark mode to renderer
        let border_color = self.palette().border_color;
        self.ports.gpu.set_clear_color(border_color);

        // Resolve focus: try saved focus, fall back to first tree pane
        let all_pane_ids = self.layout.pane_ids();
        let focus_id = session
            .focused_pane_id
            .and_then(|id| {
                if self.panes.contains_key(&id) {
                    Some(id)
                } else {
                    None
                }
            })
            .or_else(|| all_pane_ids.first().copied());

        if let Some(id) = focus_id {
            self.focus.focused = Some(id);
            self.router.set_focused(id);
            // Set stage_focused so dock operations work
            if matches!(self.panes.get(&id), Some(PaneKind::Terminal(_))) {
                self.focus.stage_focused = Some(id);
            }
        }

        // Initialize file tree
        let cwd = pane_infos
            .first()
            .and_then(|(_, c)| c.clone())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")));
        let tree = crate::tide_tree::FsTree::new(cwd.clone());
        self.ft.tree = Some(tree);
        self.sync_file_tree_path_identity_cache();
        self.sync_file_tree_modified_editor_cache();
        self.timing.last_cwd = Some(cwd);

        true
    }

    /// Restore only preferences (window size, theme, side-surface widths) from a session,
    /// then create a fresh initial pane. Used after intentional quit.
    pub(crate) fn restore_preferences(
        &mut self,
        session: &Session,
        early_terminal: Option<crate::tide_terminal::Terminal>,
    ) {
        self.ft.width = session.file_tree_width;
        self.ws.width = session.ws_sidebar_width;
        self.window.dark_mode = session.dark_mode;
        self.window.sidebar_side = match session.sidebar_side.as_str() {
            "right" => crate::LayoutSide::Right,
            _ => crate::LayoutSide::Left,
        };

        // Apply dark mode to renderer
        let border_color = self.palette().border_color;
        self.ports.gpu.set_clear_color(border_color);

        self.create_initial_pane(early_terminal);
    }
}

impl App {
    /// Save both session files (main + context area).
    /// Used by all exit/auto-save paths.
    pub(crate) fn save_full_session(&self) {
        let session = Session::from_app(self);
        self.ports.persistence.save_session(&session);
        let context_area = SessionContextArea::from_app(self);
        self.ports
            .persistence
            .save_context_area_session(&context_area);
    }
}

/// Convert a `SessionLayout` to a `LayoutSnapshot`, collecting pane info.
/// Public for testing.
fn session_to_snapshot(
    layout: &SessionLayout,
    pane_infos: &mut Vec<(PaneId, Option<PathBuf>)>,
) -> Option<LayoutSnapshot> {
    match layout {
        SessionLayout::Leaf { pane_id, cwd } => {
            pane_infos.push((*pane_id, cwd.clone()));
            Some(LayoutSnapshot::Leaf {
                tabs: vec![*pane_id],
                active: 0,
            })
        }
        SessionLayout::LeafGroup { tabs, active } => {
            let pane_ids: Vec<PaneId> = tabs
                .iter()
                .map(|t| {
                    pane_infos.push((t.pane_id, t.cwd.clone()));
                    t.pane_id
                })
                .collect();
            Some(LayoutSnapshot::LeafGroup {
                tabs: pane_ids,
                active: *active,
            })
        }
        SessionLayout::Split {
            direction,
            ratio,
            left,
            right,
        } => {
            let dir = match direction.as_str() {
                "horizontal" => SplitDirection::Horizontal,
                "vertical" => SplitDirection::Vertical,
                _ => return None,
            };
            let l = session_to_snapshot(left, pane_infos)?;
            let r = session_to_snapshot(right, pane_infos)?;
            Some(LayoutSnapshot::Split {
                direction: dir,
                ratio: *ratio,
                left: Box::new(l),
                right: Box::new(r),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_layout_leaf_roundtrip() {
        let layout = SessionLayout::Leaf {
            pane_id: 42,
            cwd: Some(PathBuf::from("/home/user")),
        };
        let json = serde_json::to_string(&layout).unwrap();
        let restored: SessionLayout = serde_json::from_str(&json).unwrap();

        match restored {
            SessionLayout::Leaf { pane_id, cwd } => {
                assert_eq!(pane_id, 42);
                assert_eq!(cwd, Some(PathBuf::from("/home/user")));
            }
            _ => panic!("expected Leaf"),
        }
    }

    #[test]
    fn session_layout_split_roundtrip() {
        let layout = SessionLayout::Split {
            direction: "horizontal".to_string(),
            ratio: 0.5,
            left: Box::new(SessionLayout::Leaf {
                pane_id: 1,
                cwd: None,
            }),
            right: Box::new(SessionLayout::Leaf {
                pane_id: 2,
                cwd: Some(PathBuf::from("/tmp")),
            }),
        };
        let json = serde_json::to_string(&layout).unwrap();
        let restored: SessionLayout = serde_json::from_str(&json).unwrap();

        match restored {
            SessionLayout::Split {
                direction,
                ratio,
                left,
                right,
            } => {
                assert_eq!(direction, "horizontal");
                assert!((ratio - 0.5).abs() < f32::EPSILON);
                match *left {
                    SessionLayout::Leaf { pane_id, .. } => assert_eq!(pane_id, 1),
                    _ => panic!("expected Leaf"),
                }
                match *right {
                    SessionLayout::Leaf { pane_id, cwd } => {
                        assert_eq!(pane_id, 2);
                        assert_eq!(cwd, Some(PathBuf::from("/tmp")));
                    }
                    _ => panic!("expected Leaf"),
                }
            }
            _ => panic!("expected Split"),
        }
    }

    #[test]
    fn session_full_roundtrip() {
        let session = Session {
            layout: SessionLayout::Leaf {
                pane_id: 1,
                cwd: None,
            },
            focused_pane_id: Some(1),
            show_file_tree: true,
            file_tree_width: 250.0,
            dark_mode: true,
            window_width: 960.0,
            window_height: 640.0,
            sidebar_side: "left".to_string(),
            sidebar_outer: true,
            ws_sidebar_width: 200.0,
            show_workspace_sidebar: false,
            dock_open: false,
        };
        let json = serde_json::to_string(&session).unwrap();
        let restored: Session = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.focused_pane_id, Some(1));
        assert!(restored.show_file_tree);
        assert!((restored.file_tree_width - 250.0).abs() < f32::EPSILON);
        assert!((restored.ws_sidebar_width - 200.0).abs() < f32::EPSILON);
        assert!(restored.dark_mode);
    }

    #[test]
    fn session_to_snapshot_leaf() {
        let layout = SessionLayout::Leaf {
            pane_id: 10,
            cwd: Some(PathBuf::from("/home")),
        };
        let mut pane_infos = Vec::new();
        let snap = session_to_snapshot(&layout, &mut pane_infos).unwrap();

        assert_eq!(pane_infos.len(), 1);
        assert_eq!(pane_infos[0].0, 10);
        assert_eq!(pane_infos[0].1, Some(PathBuf::from("/home")));

        match snap {
            LayoutSnapshot::Leaf { tabs, active } => {
                assert_eq!(tabs, vec![10]);
                assert_eq!(active, 0);
            }
            _ => panic!("expected Leaf"),
        }
    }

    #[test]
    fn session_to_snapshot_split() {
        let layout = SessionLayout::Split {
            direction: "vertical".to_string(),
            ratio: 0.6,
            left: Box::new(SessionLayout::Leaf {
                pane_id: 1,
                cwd: None,
            }),
            right: Box::new(SessionLayout::Leaf {
                pane_id: 2,
                cwd: None,
            }),
        };
        let mut pane_infos = Vec::new();
        let snap = session_to_snapshot(&layout, &mut pane_infos).unwrap();

        assert_eq!(pane_infos.len(), 2);

        match snap {
            LayoutSnapshot::Split {
                direction, ratio, ..
            } => {
                assert_eq!(direction, SplitDirection::Vertical);
                assert!((ratio - 0.6).abs() < f32::EPSILON);
            }
            _ => panic!("expected Split"),
        }
    }

    #[test]
    fn session_to_snapshot_invalid_direction() {
        let layout = SessionLayout::Split {
            direction: "diagonal".to_string(),
            ratio: 0.5,
            left: Box::new(SessionLayout::Leaf {
                pane_id: 1,
                cwd: None,
            }),
            right: Box::new(SessionLayout::Leaf {
                pane_id: 2,
                cwd: None,
            }),
        };
        let mut pane_infos = Vec::new();
        assert!(session_to_snapshot(&layout, &mut pane_infos).is_none());
    }

    #[test]
    fn session_layout_leaf_group_roundtrip() {
        let layout = SessionLayout::LeafGroup {
            tabs: vec![
                LeafGroupTab {
                    pane_id: 10,
                    cwd: Some(PathBuf::from("/home")),
                },
                LeafGroupTab {
                    pane_id: 20,
                    cwd: None,
                },
                LeafGroupTab {
                    pane_id: 30,
                    cwd: Some(PathBuf::from("/tmp")),
                },
            ],
            active: 1,
        };
        let json = serde_json::to_string(&layout).unwrap();
        let restored: SessionLayout = serde_json::from_str(&json).unwrap();

        match restored {
            SessionLayout::LeafGroup { tabs, active } => {
                assert_eq!(tabs.len(), 3);
                assert_eq!(tabs[0].pane_id, 10);
                assert_eq!(tabs[0].cwd, Some(PathBuf::from("/home")));
                assert_eq!(tabs[1].pane_id, 20);
                assert_eq!(tabs[1].cwd, None);
                assert_eq!(tabs[2].pane_id, 30);
                assert_eq!(active, 1);
            }
            _ => panic!("expected LeafGroup"),
        }
    }

    #[test]
    fn session_to_snapshot_leaf_group() {
        let layout = SessionLayout::LeafGroup {
            tabs: vec![
                LeafGroupTab {
                    pane_id: 5,
                    cwd: Some(PathBuf::from("/a")),
                },
                LeafGroupTab {
                    pane_id: 6,
                    cwd: None,
                },
            ],
            active: 1,
        };
        let mut pane_infos = Vec::new();
        let snap = session_to_snapshot(&layout, &mut pane_infos).unwrap();

        assert_eq!(pane_infos.len(), 2);
        assert_eq!(pane_infos[0].0, 5);
        assert_eq!(pane_infos[0].1, Some(PathBuf::from("/a")));
        assert_eq!(pane_infos[1].0, 6);
        assert_eq!(pane_infos[1].1, None);

        match snap {
            LayoutSnapshot::LeafGroup { tabs, active } => {
                assert_eq!(tabs, vec![5, 6]);
                assert_eq!(active, 1);
            }
            _ => panic!("expected LeafGroup snapshot"),
        }
    }

    #[test]
    fn session_to_snapshot_split_with_leaf_group() {
        // A split where the left child is a LeafGroup and right is a Leaf
        let layout = SessionLayout::Split {
            direction: "horizontal".to_string(),
            ratio: 0.5,
            left: Box::new(SessionLayout::LeafGroup {
                tabs: vec![
                    LeafGroupTab {
                        pane_id: 1,
                        cwd: None,
                    },
                    LeafGroupTab {
                        pane_id: 2,
                        cwd: None,
                    },
                ],
                active: 0,
            }),
            right: Box::new(SessionLayout::Leaf {
                pane_id: 3,
                cwd: None,
            }),
        };
        let mut pane_infos = Vec::new();
        let snap = session_to_snapshot(&layout, &mut pane_infos).unwrap();

        assert_eq!(pane_infos.len(), 3);

        match snap {
            LayoutSnapshot::Split { left, right, .. } => {
                match *left {
                    LayoutSnapshot::LeafGroup { tabs, active } => {
                        assert_eq!(tabs, vec![1, 2]);
                        assert_eq!(active, 0);
                    }
                    _ => panic!("expected LeafGroup in left"),
                }
                match *right {
                    LayoutSnapshot::Leaf { tabs, active } => {
                        assert_eq!(tabs, vec![3]);
                        assert_eq!(active, 0);
                    }
                    _ => panic!("expected Leaf in right"),
                }
            }
            _ => panic!("expected Split"),
        }
    }

    #[test]
    fn old_session_without_leaf_group_loads_correctly() {
        // Simulate an old session file that only has Leaf and Split (no LeafGroup)
        let json = r#"{
            "layout": {
                "Split": {
                    "direction": "horizontal",
                    "ratio": 0.5,
                    "left": {"Leaf": {"pane_id": 1, "cwd": null}},
                    "right": {"Leaf": {"pane_id": 2, "cwd": "/tmp"}}
                }
            },
            "focused_pane_id": 1,
            "show_file_tree": false,
            "file_tree_width": 200.0,
            "dark_mode": true,
            "window_width": 800.0,
            "window_height": 600.0
        }"#;
        let session: Session = serde_json::from_str(json).unwrap();
        let mut pane_infos = Vec::new();
        let snap = session_to_snapshot(&session.layout, &mut pane_infos).unwrap();

        assert_eq!(pane_infos.len(), 2);
        match snap {
            LayoutSnapshot::Split { left, right, .. } => {
                match *left {
                    LayoutSnapshot::Leaf { tabs, .. } => assert_eq!(tabs, vec![1]),
                    _ => panic!("expected Leaf"),
                }
                match *right {
                    LayoutSnapshot::Leaf { tabs, .. } => assert_eq!(tabs, vec![2]),
                    _ => panic!("expected Leaf"),
                }
            }
            _ => panic!("expected Split"),
        }
    }

    #[test]
    fn session_defaults_for_missing_fields() {
        // Simulate old session file without sidebar_side and sidebar_outer
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
}
