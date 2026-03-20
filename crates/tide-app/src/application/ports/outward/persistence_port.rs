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
    Split {
        direction: String,
        ratio: f32,
        left: Box<SessionLayout>,
        right: Box<SessionLayout>,
    },
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

// ── Real implementation (production) ──

pub(crate) struct RealPersistence;

impl PersistencePort for RealPersistence {
    fn save_session(&self, session: &Session) {
        crate::update::session::save_session(session);
    }

    fn load_session(&self) -> Option<Session> {
        crate::update::session::load_session()
    }

    fn save_context_area_session(&self, data: &SessionContextArea) {
        crate::update::session::save_context_area_session(data);
    }

    fn load_context_area_session(&self) -> Option<SessionContextArea> {
        crate::update::session::load_context_area_session()
    }

    fn create_running_marker(&self) {
        crate::update::session::create_running_marker();
    }

    fn delete_running_marker(&self) {
        crate::update::session::delete_running_marker();
    }

    fn is_crash_recovery(&self) -> bool {
        crate::update::session::is_crash_recovery()
    }

    fn save_settings(&self, settings: &TideSettings) {
        crate::state::settings::save_settings(settings);
    }

    fn load_settings(&self) -> TideSettings {
        crate::state::settings::load_settings()
    }
}

// ── Noop implementation (tests) ──

pub(crate) struct NoopPersistence;

impl PersistencePort for NoopPersistence {
    fn save_session(&self, _session: &Session) {}
    fn load_session(&self) -> Option<Session> { None }
    fn save_context_area_session(&self, _data: &SessionContextArea) {}
    fn load_context_area_session(&self) -> Option<SessionContextArea> { None }
    fn create_running_marker(&self) {}
    fn delete_running_marker(&self) {}
    fn is_crash_recovery(&self) -> bool { false }
    fn save_settings(&self, _settings: &TideSettings) {}
    fn load_settings(&self) -> TideSettings { TideSettings::default() }
}
