// State layer: pure data structs and algorithms. No side effects, no platform/GPU imports.

pub(crate) mod diff;
pub(crate) mod search;
pub(crate) mod settings;

mod associations;
pub(crate) mod background;
mod cache;
pub(crate) mod context_artifact;
mod dock;
pub(crate) mod drag_types;
mod file_tree_model;
mod focus;
pub(crate) mod gateway_status;
mod gpu_state;
mod ime;
mod input_latency;
pub(crate) mod input_line;
mod interaction;
mod platform;
mod surface_animation;
mod timing;
mod window;
mod workspace_mgr;
// Re-export all public types
pub(crate) use super::modal::*;
pub(crate) use associations::PaneAssociations;
pub(crate) use background::BackgroundServices;
pub(crate) use cache::RenderCache;
pub(crate) use context_artifact::{ContextArtifact, ContextArtifactStore};
pub(crate) use dock::DockState;
pub(crate) use file_tree_model::FileTreeModel;
pub(crate) use focus::{FocusArea, FocusState, LayoutSide, ViewMode};
pub(crate) use gateway_status::GatewayStatus;
pub(crate) use ime::ImeState;
pub(crate) use input_latency::InputLatencyState;
pub(crate) use input_line::{abbreviate_path, shell_escape, InputLine};
pub(crate) use interaction::InteractionState;
pub(crate) use surface_animation::SurfaceVisibilityAnimation;
#[cfg(test)]
pub(crate) use surface_animation::SURFACE_VISIBILITY_ANIMATION_DURATION;
pub(crate) use timing::TimingState;
pub(crate) use window::{NotificationAuthorizationStatus, WindowState};
pub(crate) use workspace_mgr::WorkspaceManager;

#[cfg(test)]
mod tests;
