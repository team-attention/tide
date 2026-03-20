// Inward (driving) port traits — use cases the domain exposes to adapters.
//
// Each trait maps 1:1 to a domain source file. Adapters call these methods
// to interact with the domain. The compiler enforces that only methods
// declared in these traits are part of the public domain interface.

mod action;
mod pane_lifecycle;
mod dock;
mod workspace_nav;
mod focus_nav;
mod file_ops;
mod clipboard_search;
mod text_extract;
mod app_core;
mod layout;

pub(crate) use action::ActionPort;
pub(crate) use pane_lifecycle::PaneLifecyclePort;
pub(crate) use dock::DockPort;
pub(crate) use workspace_nav::WorkspaceNavPort;
pub(crate) use focus_nav::FocusNavPort;
pub(crate) use file_ops::FileOpsPort;
pub(crate) use clipboard_search::ClipboardSearchPort;
pub(crate) use text_extract::TextExtractPort;
pub(crate) use app_core::AppCorePort;
pub(crate) use layout::LayoutPort;
