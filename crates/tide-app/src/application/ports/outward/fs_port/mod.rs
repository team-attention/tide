// FileSystemPort — abstracts filesystem operations for testability.

use std::io;
use std::path::{Path, PathBuf};

pub(crate) trait FileSystemPort {
    fn read_to_string(&self, path: &Path) -> io::Result<String>;
    fn write(&self, path: &Path, contents: &[u8]) -> io::Result<()>;
    fn create_dir_all(&self, path: &Path) -> io::Result<()>;
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
    fn remove_file(&self, path: &Path) -> io::Result<()>;
    fn remove_dir_all(&self, path: &Path) -> io::Result<()>;
    fn read_dir(&self, path: &Path) -> io::Result<Vec<DirEntry>>;
    fn exists(&self, path: &Path) -> bool;
    fn is_dir(&self, path: &Path) -> bool;
    fn current_dir(&self) -> io::Result<PathBuf>;
    fn home_dir(&self) -> Option<PathBuf>;
    fn config_dir(&self) -> Option<PathBuf>;
}

/// A simplified directory entry.
pub(crate) struct DirEntry {
    pub path: PathBuf,
    pub is_dir: bool,
}
