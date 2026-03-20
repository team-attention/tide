// Outward adapters: port implementations + infrastructure services.


// Port adapter implementations (Real/Noop)
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
