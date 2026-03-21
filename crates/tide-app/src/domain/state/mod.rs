// State layer: pure data structs and algorithms. No side effects, no platform/GPU imports.

pub(crate) mod search;
pub(crate) mod diff;
pub(crate) mod settings;

pub(crate) mod input_line;
mod focus;
mod window;
mod timing;
mod ime;
mod cache;
pub(crate) mod drag_types;
mod interaction;
mod dock;
mod gpu_state;
mod platform;
mod input_latency;
pub(crate) mod background;
pub(crate) mod gateway_status;
mod associations;
mod workspace_mgr;
mod file_tree_model;
// Re-export all public types
pub(crate) use input_line::{InputLine, shell_escape, abbreviate_path};
pub(crate) use focus::{FocusArea, FocusState, ViewMode, LayoutSide};
pub(crate) use window::WindowState;
pub(crate) use timing::TimingState;
pub(crate) use ime::ImeState;
pub(crate) use cache::RenderCache;
pub(crate) use interaction::InteractionState;
pub(crate) use dock::DockState;
pub(crate) use input_latency::InputLatencyState;
pub(crate) use background::BackgroundServices;
pub(crate) use associations::PaneAssociations;
pub(crate) use gateway_status::GatewayStatus;
pub(crate) use workspace_mgr::WorkspaceManager;
pub(crate) use file_tree_model::FileTreeModel;
pub(crate) use super::modal::*;

#[cfg(test)]
mod tests;
