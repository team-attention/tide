// Inward (driving) port traits — what the application can do.

mod action_port;
mod pane_lifecycle_port;
mod dock_port;
mod workspace_nav_port;
mod focus_nav_port;
mod file_ops_port;
mod clipboard_search_port;
mod text_extract_port;
mod app_core_port;
mod layout_port;

pub(crate) use action_port::ActionPort;
pub(crate) use pane_lifecycle_port::PaneLifecyclePort;
pub(crate) use dock_port::DockPort;
pub(crate) use workspace_nav_port::WorkspaceNavPort;
pub(crate) use focus_nav_port::FocusNavPort;
pub(crate) use file_ops_port::FileOpsPort;
pub(crate) use clipboard_search_port::ClipboardSearchPort;
pub(crate) use text_extract_port::TextExtractPort;
pub(crate) use app_core_port::AppCorePort;
pub(crate) use layout_port::LayoutPort;
