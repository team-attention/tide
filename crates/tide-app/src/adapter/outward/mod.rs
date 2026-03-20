// Outward (driven) adapters: application → outside world.

// Port implementations (*_adapter.rs)
pub(crate) mod clipboard_adapter;
pub(crate) mod clock_adapter;
pub(crate) mod file_watcher_adapter;
pub(crate) mod fs_adapter;
pub(crate) mod git_adapter;
pub(crate) mod gpu_adapter;
pub(crate) mod lsp_adapter;
pub(crate) mod persistence_adapter;
pub(crate) mod platform_adapter;
pub(crate) mod process_adapter;
pub(crate) mod terminal_factory_adapter;

// Infrastructure modules
pub(crate) mod renderer;
pub(crate) mod platform_native;
pub(crate) mod lsp_client;
pub(crate) mod view;
