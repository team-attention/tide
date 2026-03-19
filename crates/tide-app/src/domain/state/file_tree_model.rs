// FileTreeModel — file tree state: navigation, scroll, git status.

use std::collections::HashMap;
use std::path::PathBuf;
use tide_core::Rect;

pub(crate) struct FileTreeModel {
    pub tree: Option<tide_tree::FsTree>,
    pub visible: bool,
    pub scroll: f32,
    pub scroll_target: f32,
    pub width: f32,
    pub border_dragging: bool,
    pub rect: Option<Rect>,
    pub cursor: usize,
    pub git_status: HashMap<PathBuf, tide_core::FileGitStatus>,
    pub dir_git_status: HashMap<PathBuf, tide_core::FileGitStatus>,
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
            git_root: None,
        }
    }
}
