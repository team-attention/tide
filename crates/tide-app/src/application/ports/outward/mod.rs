// Outward (driven) port traits — infrastructure the application needs.

pub(crate) mod clock;
pub(crate) mod clipboard;
pub(crate) mod fs;
pub(crate) mod process;
pub(crate) mod persistence;
pub(crate) mod git;
pub(crate) mod terminal_factory;
pub(crate) mod file_watcher;
pub(crate) mod lsp;
pub(crate) mod gpu;
pub(crate) mod platform;

pub(crate) use clock::{ClockPort, SystemClock, FixedClock};
pub(crate) use clipboard::{ClipboardPort, SystemClipboard, NoopClipboard};
pub(crate) use fs::{FileSystemPort, RealFileSystem, NoopFileSystem};
pub(crate) use process::{ProcessPort, SystemProcess, NoopProcess};
pub(crate) use persistence::{PersistencePort, RealPersistence, NoopPersistence};
pub(crate) use git::{GitPort, RealGit, NoopGit};
pub(crate) use terminal_factory::{TerminalFactoryPort, RealTerminalFactory, NoopTerminalFactory};
pub(crate) use file_watcher::{FileWatcherPort, FileWatchEvent, RealFileWatcher, NoopFileWatcher};
pub(crate) use lsp::{LspPort, RealLsp, NoopLsp};
pub(crate) use gpu::{GpuPort, RealGpu, NoopGpu};
pub(crate) use platform::{PlatformPort, RealPlatform, NoopPlatform};

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
