// FileTreePort — file tree scroll and visibility state.

use crate::state::FileTreeModel;

pub(crate) trait FileTreePort {
    fn ft(&self) -> &FileTreeModel;
    fn ft_mut(&mut self) -> &mut FileTreeModel;
    fn file_tree_max_scroll(&self) -> f32;
    fn auto_scroll_file_tree_cursor(&mut self);
    fn execute_context_menu_action(&mut self, action_index: usize);
    fn complete_file_tree_rename(&mut self);
    fn handle_file_tree_click(&mut self, pos: crate::tide_core::Vec2);
}
