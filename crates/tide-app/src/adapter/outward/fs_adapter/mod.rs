// FileSystem adapter implementations.

use std::io;
use std::path::{Path, PathBuf};

use crate::application::ports::outward::fs_port::{FileSystemPort, DirEntry};

/// Real filesystem implementation.
pub(crate) struct RealFileSystem;

impl FileSystemPort for RealFileSystem {
    fn read_to_string(&self, path: &Path) -> io::Result<String> {
        std::fs::read_to_string(path)
    }

    fn write(&self, path: &Path, contents: &[u8]) -> io::Result<()> {
        std::fs::write(path, contents)
    }

    fn create_dir_all(&self, path: &Path) -> io::Result<()> {
        std::fs::create_dir_all(path)
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        std::fs::rename(from, to)
    }

    fn remove_file(&self, path: &Path) -> io::Result<()> {
        std::fs::remove_file(path)
    }

    fn remove_dir_all(&self, path: &Path) -> io::Result<()> {
        std::fs::remove_dir_all(path)
    }

    fn read_dir(&self, path: &Path) -> io::Result<Vec<DirEntry>> {
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
            entries.push(DirEntry {
                path: entry.path(),
                is_dir,
            });
        }
        Ok(entries)
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }

    fn current_dir(&self) -> io::Result<PathBuf> {
        std::env::current_dir()
    }

    fn home_dir(&self) -> Option<PathBuf> {
        dirs::home_dir()
    }

    fn config_dir(&self) -> Option<PathBuf> {
        dirs::config_dir()
    }
}

/// Noop filesystem for tests.
pub(crate) struct NoopFileSystem;

impl FileSystemPort for NoopFileSystem {
    fn read_to_string(&self, _path: &Path) -> io::Result<String> {
        Err(io::Error::new(io::ErrorKind::NotFound, "noop fs"))
    }

    fn write(&self, _path: &Path, _contents: &[u8]) -> io::Result<()> {
        Ok(())
    }

    fn create_dir_all(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn rename(&self, _from: &Path, _to: &Path) -> io::Result<()> {
        Ok(())
    }

    fn remove_file(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn remove_dir_all(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn read_dir(&self, _path: &Path) -> io::Result<Vec<DirEntry>> {
        Ok(Vec::new())
    }

    fn exists(&self, _path: &Path) -> bool {
        false
    }

    fn is_dir(&self, _path: &Path) -> bool {
        false
    }

    fn current_dir(&self) -> io::Result<PathBuf> {
        Err(io::Error::new(io::ErrorKind::NotFound, "NoopFileSystem has no current directory"))
    }

    fn home_dir(&self) -> Option<PathBuf> {
        None
    }

    fn config_dir(&self) -> Option<PathBuf> {
        None
    }
}
