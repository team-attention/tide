use std::path::{Path, PathBuf};

pub(crate) fn paths_refer_to_same_file(a: &Path, b: &Path) -> bool {
    normalize_path_for_identity(a) == normalize_path_for_identity(b)
}

pub(crate) fn normalize_path_for_identity(path: &Path) -> PathBuf {
    if let Ok(real) = std::fs::canonicalize(path) {
        return real;
    }

    if let (Some(parent), Some(file_name)) = (path.parent(), path.file_name()) {
        if let Ok(real_parent) = std::fs::canonicalize(parent) {
            return real_parent.join(file_name);
        }
    }

    path.to_path_buf()
}
