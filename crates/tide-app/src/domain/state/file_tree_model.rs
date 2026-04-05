// FileTreeModel — file tree state: navigation, scroll, git status.

use crate::tide_core::Rect;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

pub(crate) struct FileTreeModel {
    pub tree: Option<crate::tide_tree::FsTree>,
    pub visible: bool,
    pub scroll: f32,
    pub scroll_target: f32,
    pub width: f32,
    pub border_dragging: bool,
    pub rect: Option<Rect>,
    pub cursor: usize,
    pub git_status: HashMap<PathBuf, crate::tide_core::FileGitStatus>,
    pub dir_git_status: HashMap<PathBuf, crate::tide_core::FileGitStatus>,
    pub normalized_entry_paths: HashMap<PathBuf, PathBuf>,
    pub modified_editor_paths: HashSet<PathBuf>,
    pub modified_editor_dirs: HashSet<PathBuf>,
    pub git_root: Option<PathBuf>,
}

impl FileTreeModel {
    pub fn new(default_width: f32) -> Self {
        Self {
            tree: None,
            visible: false,
            scroll: 0.0,
            scroll_target: 0.0,
            width: default_width,
            border_dragging: false,
            rect: None,
            cursor: 0,
            git_status: HashMap::new(),
            dir_git_status: HashMap::new(),
            normalized_entry_paths: HashMap::new(),
            modified_editor_paths: HashSet::new(),
            modified_editor_dirs: HashSet::new(),
            git_root: None,
        }
    }
}
