// ProcessPort — abstracts external process launching for testability.

use std::io;
use std::path::Path;

pub(crate) trait ProcessPort {
    fn open_with_default_app(&self, path: &Path) -> io::Result<()>;
    fn reveal_in_finder(&self, path: &Path) -> io::Result<()>;
    fn open_url(&self, url: &str) -> io::Result<()>;
}
