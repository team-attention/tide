// FileTreeModel — file tree state: navigation, scroll, git status.

use super::SurfaceVisibilityAnimation;
use crate::tide_core::Rect;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

pub(crate) struct FileTreeModel {
    pub tree: Option<crate::tide_tree::FsTree>,
    pub visible: bool,
    pub scroll: f32,
    pub scroll_target: f32,
    pub width: f32,
    pub visibility_animation: Option<SurfaceVisibilityAnimation>,
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
            visibility_animation: None,
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

    pub(crate) fn begin_visibility_animation(
        &mut self,
        from_width: f32,
        to_width: f32,
        now: std::time::Instant,
    ) {
        self.visibility_animation =
            Some(SurfaceVisibilityAnimation::new(from_width, to_width, now));
    }

    pub(crate) fn rendered_width(&self, now: std::time::Instant) -> f32 {
        self.visibility_animation
            .map(|animation| animation.width_at(now))
            .unwrap_or_else(|| if self.visible { self.width } else { 0.0 })
    }

    pub(crate) fn finish_visibility_animation_if_complete(&mut self, now: std::time::Instant) {
        if self
            .visibility_animation
            .is_some_and(|animation| animation.is_complete_at(now))
        {
            self.visibility_animation = None;
        }
    }

    pub(crate) fn visible_for_layout(&self) -> bool {
        self.visible || self.visibility_animation.is_some()
    }
}
