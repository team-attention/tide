// Port traits defining every external boundary.
//
// Outward (driven) ports: domain → infrastructure
pub(crate) mod clock;
pub(crate) mod clipboard;
pub(crate) mod fs;
pub(crate) mod process;

// Inward (driving) ports: adapters → domain
pub(crate) mod inward;

pub(crate) use clock::{ClockPort, SystemClock, FixedClock};
pub(crate) use clipboard::{ClipboardPort, SystemClipboard, NoopClipboard};
pub(crate) use fs::{FileSystemPort, RealFileSystem, NoopFileSystem};
pub(crate) use process::{ProcessPort, SystemProcess, NoopProcess};

/// Aggregates all port implementations. Injected into App.
pub(crate) struct Ports {
    pub clock: Box<dyn ClockPort>,
    pub clipboard: Box<dyn ClipboardPort>,
    pub fs: Box<dyn FileSystemPort>,
    pub process: Box<dyn ProcessPort>,
}

impl Ports {
    /// No-op / fixed implementations for tests and pre-init state.
    pub fn noop() -> Self {
        Self {
            clock: Box::new(FixedClock { instant: std::time::Instant::now() }),
            clipboard: Box::new(NoopClipboard),
            fs: Box::new(NoopFileSystem),
            process: Box::new(NoopProcess),
        }
    }

    /// Real implementations for production.
    pub fn real() -> Self {
        Self {
            clock: Box::new(SystemClock),
            clipboard: Box::new(SystemClipboard),
            fs: Box::new(RealFileSystem),
            process: Box::new(SystemProcess),
        }
    }
}
