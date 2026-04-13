// Application services: use case implementations + App orchestration.

pub(crate) mod action_service;
mod dock_service;
mod file_ops_service;
pub(crate) mod file_tree_service;
mod focus_nav_service;
pub(crate) mod gpu_init_service;
mod lsp_service;
mod pane_close_service;
mod pane_create_service;
mod path_identity;
mod search_service;
pub(crate) mod session_service;
mod text_extract_service;
mod update_service;
pub(crate) mod workspace_infra_service;
mod workspace_service;
