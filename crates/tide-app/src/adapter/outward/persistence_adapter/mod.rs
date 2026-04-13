// Persistence adapter implementations.

use crate::application::ports::outward::persistence_port::{
    PersistencePort, Session, SessionContextArea,
};
use crate::state::settings::TideSettings;

// ── Real implementation (production) ──

pub(crate) struct RealPersistence;

impl PersistencePort for RealPersistence {
    fn save_session(&self, session: &Session) {
        crate::update::session_service::save_session(session);
    }

    fn load_session(&self) -> Option<Session> {
        crate::update::session_service::load_session()
    }

    fn save_context_area_session(&self, data: &SessionContextArea) {
        crate::update::session_service::save_context_area_session(data);
    }

    fn load_context_area_session(&self) -> Option<SessionContextArea> {
        crate::update::session_service::load_context_area_session()
    }

    fn create_running_marker(&self) {
        crate::update::session_service::create_running_marker();
    }

    fn delete_running_marker(&self) {
        crate::update::session_service::delete_running_marker();
    }

    fn is_crash_recovery(&self) -> bool {
        crate::update::session_service::is_crash_recovery()
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
    fn load_session(&self) -> Option<Session> {
        None
    }
    fn save_context_area_session(&self, _data: &SessionContextArea) {}
    fn load_context_area_session(&self) -> Option<SessionContextArea> {
        None
    }
    fn create_running_marker(&self) {}
    fn delete_running_marker(&self) {}
    fn is_crash_recovery(&self) -> bool {
        false
    }
    fn save_settings(&self, _settings: &TideSettings) {}
    fn load_settings(&self) -> TideSettings {
        TideSettings::default()
    }
}
