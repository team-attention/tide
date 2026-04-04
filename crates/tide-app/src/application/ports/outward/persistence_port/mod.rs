// PersistencePort — session save/load, settings, and crash recovery marker.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::state::settings::TideSettings;

// ──────────────────────────────────────────────
// Serializable session types (port data contract)
// ──────────────────────────────────────────────

#[derive(Serialize, Deserialize, Default)]
pub struct DrawerStateSnapshot {
    pub pane_ids: Vec<u64>,
    pub focused: Option<u64>,
    pub layout: Option<SessionLayout>,
    #[serde(default)]
    pub view_mode: String,
}

#[derive(Serialize, Deserialize, Default)]
pub struct SessionContextArea {
    pub context_area_open: bool,
    #[serde(default = "default_context_area_width")]
    pub context_area_width: f32,
    #[serde(default)]
    pub drawer_states: std::collections::HashMap<u64, DrawerStateSnapshot>,
}

#[derive(Serialize, Deserialize)]
pub struct Session {
    pub layout: SessionLayout,
    pub focused_pane_id: Option<u64>,
    pub show_file_tree: bool,
    pub file_tree_width: f32,
    pub dark_mode: bool,
    pub window_width: f32,
    pub window_height: f32,
    #[serde(default = "default_sidebar_side")]
    pub sidebar_side: String,
    #[serde(default = "default_sidebar_outer")]
    pub sidebar_outer: bool,
    #[serde(default = "default_ws_sidebar_width")]
    pub ws_sidebar_width: f32,
    #[serde(default)]
    pub show_workspace_sidebar: bool,
    #[serde(default)]
    pub dock_open: bool,
}

fn default_sidebar_side() -> String {
    "left".to_string()
}

fn default_sidebar_outer() -> bool {
    true
}

fn default_ws_sidebar_width() -> f32 {
    crate::theme::WORKSPACE_SIDEBAR_WIDTH
}

fn default_context_area_width() -> f32 {
    400.0
}

#[derive(Serialize, Deserialize)]
pub enum SessionLayout {
    Leaf {
        pane_id: u64,
        cwd: Option<PathBuf>,
    },
    LeafGroup {
        tabs: Vec<LeafGroupTab>,
        active: usize,
    },
    Split {
        direction: String,
        ratio: f32,
        left: Box<SessionLayout>,
        right: Box<SessionLayout>,
    },
}

/// A single tab entry inside a persisted LeafGroup.
#[derive(Serialize, Deserialize, Clone)]
pub struct LeafGroupTab {
    pub pane_id: u64,
    pub cwd: Option<PathBuf>,
}

// ──────────────────────────────────────────────
// Port trait
// ──────────────────────────────────────────────

pub(crate) trait PersistencePort {
    fn save_session(&self, session: &Session);
    fn load_session(&self) -> Option<Session>;
    fn save_context_area_session(&self, data: &SessionContextArea);
    fn load_context_area_session(&self) -> Option<SessionContextArea>;
    fn create_running_marker(&self);
    fn delete_running_marker(&self);
    fn is_crash_recovery(&self) -> bool;
    fn save_settings(&self, settings: &TideSettings);
    fn load_settings(&self) -> TideSettings;
}
