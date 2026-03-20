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

pub(crate) use clock_port::{ClockPort, SystemClock, FixedClock};
pub(crate) use clipboard_port::{ClipboardPort, SystemClipboard, NoopClipboard};
pub(crate) use fs_port::{FileSystemPort, RealFileSystem, NoopFileSystem};
pub(crate) use process_port::{ProcessPort, SystemProcess, NoopProcess};
pub(crate) use persistence_port::{PersistencePort, RealPersistence, NoopPersistence};
pub(crate) use git_port::{GitPort, RealGit, NoopGit};
pub(crate) use terminal_factory_port::{TerminalFactoryPort, RealTerminalFactory, NoopTerminalFactory};
pub(crate) use file_watcher_port::{FileWatcherPort, FileWatchEvent, RealFileWatcher, NoopFileWatcher};
pub(crate) use lsp_port::{LspPort, RealLsp, NoopLsp};
pub(crate) use gpu_port::{GpuPort, RealGpu, NoopGpu};
pub(crate) use platform_port::{PlatformPort, RealPlatform, NoopPlatform};

/// Aggregates all outward port implementations. Injected into App.
pub(crate) struct Ports {
    pub clock: Box<dyn ClockPort>,
    pub clipboard: Box<dyn ClipboardPort>,
    pub fs: Box<dyn FileSystemPort>,
    pub process: Box<dyn ProcessPort>,
    pub persistence: Box<dyn PersistencePort>,
    pub git: Box<dyn GitPort>,
    pub terminal_factory: Box<dyn TerminalFactoryPort>,
    pub file_watcher: Box<dyn FileWatcherPort>,
    pub lsp: Box<dyn LspPort>,
    pub gpu: Box<dyn GpuPort>,
    pub platform: Box<dyn PlatformPort>,
}

impl Ports {
    /// No-op / fixed implementations for tests and pre-init state.
    pub fn noop() -> Self {
        Self {
            clock: Box::new(FixedClock { instant: std::time::Instant::now() }),
            clipboard: Box::new(NoopClipboard),
            fs: Box::new(NoopFileSystem),
            process: Box::new(NoopProcess),
            persistence: Box::new(NoopPersistence),
            git: Box::new(NoopGit),
            terminal_factory: Box::new(RealTerminalFactory),
            file_watcher: Box::new(NoopFileWatcher),
            lsp: Box::new(NoopLsp),
            gpu: Box::new(NoopGpu),
            platform: Box::new(NoopPlatform),
        }
    }

    /// Real implementations for production.
    pub fn real() -> Self {
        Self {
            clock: Box::new(SystemClock),
            clipboard: Box::new(SystemClipboard),
            fs: Box::new(RealFileSystem),
            process: Box::new(SystemProcess),
            persistence: Box::new(RealPersistence),
            git: Box::new(RealGit),
            terminal_factory: Box::new(RealTerminalFactory),
            file_watcher: Box::new(RealFileWatcher::new()),
            lsp: Box::new(RealLsp::new()),
            gpu: Box::new(RealGpu::new()),
            platform: Box::new(RealPlatform::new()),
        }
    }
}
