// Outward (driven) port traits — what the application needs from infrastructure.

pub(crate) mod clock_port;
pub(crate) mod clipboard_port;
pub(crate) mod fs_port;
pub(crate) mod process_port;
pub(crate) mod persistence_port;
pub(crate) mod git_port;
pub(crate) mod terminal_factory_port;
pub(crate) mod file_watcher_port;
pub(crate) mod lsp_port;
pub(crate) mod gpu_port;
pub(crate) mod platform_port;

// Re-export traits from port modules
pub(crate) use clock_port::ClockPort;
pub(crate) use clipboard_port::ClipboardPort;
pub(crate) use fs_port::FileSystemPort;
pub(crate) use process_port::ProcessPort;
pub(crate) use persistence_port::PersistencePort;
pub(crate) use git_port::GitPort;
pub(crate) use terminal_factory_port::TerminalFactoryPort;
pub(crate) use file_watcher_port::FileWatcherPort;
pub(crate) use lsp_port::LspPort;
pub(crate) use gpu_port::GpuPort;
pub(crate) use platform_port::PlatformPort;
