//! Modal-specific keyboard handling.
//!
//! Handles keyboard events for: file finder, git switcher, config page,
//! context menu, file tree rename, save-as, branch cleanup, and save confirm.

use crate::tide_core::{Key, Modifiers};

use crate::App;
use crate::FileOpsPort;
use crate::WorkspaceNavPort;
use crate::PaneLifecyclePort;

impl App {
    pub(super) fn handle_git_switcher_key(&mut self, key: Key, modifiers: &Modifiers) {
        // Cmd+Backspace → delete selected item
        if matches!(key, Key::Backspace) && modifiers.meta && !modifiers.ctrl && !modifiers.alt {
            let selected = self.modal.git_switcher.as_ref().map(|gs| gs.selected);
            if let Some(selected) = selected {
                self.handle_git_switcher_button(crate::SwitcherButton::Delete(selected));
            }
            return;
        }

        match key {
            Key::Escape => {
                // If delete confirmation is active, cancel it first
                if let Some(ref mut gs) = self.modal.git_switcher {
                    if gs.delete_confirm.is_some() {
                        gs.delete_confirm = None;
                        self.cache.invalidate_chrome();
                        return;
                    }
                }
                self.modal.git_switcher = None;
            }
            Key::Tab => {
                if let Some(ref mut gs) = self.modal.git_switcher {
                    gs.delete_confirm = None;
                    gs.toggle_mode();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Enter => {
                let info = self.modal.git_switcher.as_ref().map(|gs| (gs.selected, gs.mode));
                if let Some((selected, mode)) = info {
                    let btn = if modifiers.meta {
                        // Cmd+Enter → always New Pane
                        crate::SwitcherButton::NewPane(selected)
                    } else {
                        match mode {
                            crate::GitSwitcherMode::Branches => crate::SwitcherButton::Switch(selected),
                            // Worktrees: Enter triggers NewPane (no Switch action)
                            crate::GitSwitcherMode::Worktrees => crate::SwitcherButton::NewPane(selected),
                        }
                    };
                    self.handle_git_switcher_button(btn);
                }
                return;
            }
            Key::Up => {
                if let Some(ref mut gs) = self.modal.git_switcher {
                    gs.delete_confirm = None;
                    gs.select_up();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Down => {
                if let Some(ref mut gs) = self.modal.git_switcher {
                    gs.delete_confirm = None;
                    gs.select_down();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Backspace => {
                if let Some(ref mut gs) = self.modal.git_switcher {
                    gs.delete_confirm = None;
                    gs.backspace();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Delete => {
                if let Some(ref mut gs) = self.modal.git_switcher {
                    gs.delete_char();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Left => {
                if let Some(ref mut gs) = self.modal.git_switcher {
                    gs.move_cursor_left();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Right => {
                if let Some(ref mut gs) = self.modal.git_switcher {
                    gs.move_cursor_right();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Char(ch) => {
                if !modifiers.ctrl && !modifiers.meta {
                    if let Some(ref mut gs) = self.modal.git_switcher {
                        gs.insert_char(ch);
                        self.cache.invalidate_chrome();
                    }
                }
            }
            _ => {}
        }
        self.cache.needs_redraw = true;
    }

    pub(super) fn handle_file_finder_key(&mut self, key: Key, modifiers: &Modifiers) {
        if (modifiers.meta || modifiers.ctrl)
            && matches!(key, Key::Char('k') | Key::Char('K'))
        {
            if let Some(ref mut finder) = self.modal.file_finder {
                finder.select_up();
                self.cache.invalidate_chrome();
            }
            self.cache.needs_redraw = true;
            return;
        }
        if (modifiers.meta || modifiers.ctrl)
            && matches!(key, Key::Char('j') | Key::Char('J'))
        {
            if let Some(ref mut finder) = self.modal.file_finder {
                finder.select_down();
                self.cache.invalidate_chrome();
            }
            self.cache.needs_redraw = true;
            return;
        }
        match key {
            Key::Escape => {
                self.close_file_finder();
            }
            Key::Enter => {
                let path = self.modal.file_finder.as_ref().and_then(|f| f.selected_path());
                let replace_id = self.modal.file_finder.as_ref().and_then(|f| f.replace_pane_id);
                self.close_file_finder();
                if let Some(path) = path {
                    if let Some(pane_id) = replace_id {
                        // Replace the launcher pane with an editor for the selected file
                        self.replace_pane_with_editor(pane_id, path);
                    } else {
                        self.open_editor_pane(path);
                    }
                }
            }
            Key::Up => {
                if let Some(ref mut finder) = self.modal.file_finder {
                    finder.select_up();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Down => {
                if let Some(ref mut finder) = self.modal.file_finder {
                    finder.select_down();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Backspace => {
                if let Some(ref mut finder) = self.modal.file_finder {
                    finder.backspace();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Delete => {
                if let Some(ref mut finder) = self.modal.file_finder {
                    finder.delete_char();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Left => {
                if let Some(ref mut finder) = self.modal.file_finder {
                    finder.move_cursor_left();
                }
            }
            Key::Right => {
                if let Some(ref mut finder) = self.modal.file_finder {
                    finder.move_cursor_right();
                }
            }
            Key::Char(ch) => {
                if !modifiers.ctrl && !modifiers.meta {
                    if let Some(ref mut finder) = self.modal.file_finder {
                        finder.insert_char(ch);
                        self.cache.invalidate_chrome();
                    }
                }
            }
            _ => {}
        }
        self.cache.needs_redraw = true;
    }

    pub(super) fn handle_save_as_key(&mut self, key: Key, modifiers: &Modifiers) {
        match key {
            Key::Escape => {
                self.modal.save_as_input = None;
            }
            Key::Tab => {
                if let Some(ref mut input) = self.modal.save_as_input {
                    input.toggle_field();
                }
            }
            Key::Enter => {
                let resolved = self.modal.save_as_input.as_ref().and_then(|input| {
                    let pane_id = input.pane_id;
                    input.resolve_path().map(|p| (pane_id, p))
                });
                self.modal.save_as_input = None;
                if let Some((pane_id, path)) = resolved {
                    let path_str = path.to_string_lossy().to_string();
                    self.complete_save_as(pane_id, &path_str);
                }
            }
            Key::Backspace => {
                if let Some(ref mut input) = self.modal.save_as_input {
                    input.backspace();
                }
            }
            Key::Delete => {
                if let Some(ref mut input) = self.modal.save_as_input {
                    input.delete_char();
                }
            }
            Key::Left => {
                if let Some(ref mut input) = self.modal.save_as_input {
                    input.move_cursor_left();
                }
            }
            Key::Right => {
                if let Some(ref mut input) = self.modal.save_as_input {
                    input.move_cursor_right();
                }
            }
            Key::Char(ch) => {
                if !modifiers.ctrl && !modifiers.meta {
                    if let Some(ref mut input) = self.modal.save_as_input {
                        input.insert_char(ch);
                    }
                }
            }
            _ => {}
        }
        self.cache.needs_redraw = true;
    }

    pub(super) fn handle_context_menu_key(&mut self, key: Key) {
        match key {
            Key::Escape => {
                self.modal.context_menu = None;
            }
            Key::Up => {
                if let Some(ref mut menu) = self.modal.context_menu {
                    if menu.selected > 0 {
                        menu.selected -= 1;
                    }
                }
            }
            Key::Down => {
                if let Some(ref mut menu) = self.modal.context_menu {
                    if menu.selected + 1 < menu.items().len() {
                        menu.selected += 1;
                    }
                }
            }
            Key::Enter => {
                let selected = self.modal.context_menu.as_ref().map(|m| m.selected);
                if let Some(idx) = selected {
                    self.execute_context_menu_action(idx);
                }
                self.modal.context_menu = None;
            }
            _ => {}
        }
        self.cache.needs_redraw = true;
    }

    pub(super) fn handle_file_tree_rename_key(&mut self, key: Key, modifiers: &Modifiers) {
        match key {
            Key::Escape => {
                self.modal.file_tree_rename = None;
                self.cache.invalidate_chrome();
            }
            Key::Enter => {
                self.complete_file_tree_rename();
            }
            Key::Backspace => {
                if let Some(ref mut rename) = self.modal.file_tree_rename {
                    rename.input.backspace();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Delete => {
                if let Some(ref mut rename) = self.modal.file_tree_rename {
                    rename.input.delete_char();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Left => {
                if let Some(ref mut rename) = self.modal.file_tree_rename {
                    rename.input.move_cursor_left();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Right => {
                if let Some(ref mut rename) = self.modal.file_tree_rename {
                    rename.input.move_cursor_right();
                    self.cache.invalidate_chrome();
                }
            }
            Key::Char(ch) => {
                if !modifiers.ctrl && !modifiers.meta {
                    if let Some(ref mut rename) = self.modal.file_tree_rename {
                        rename.input.insert_char(ch);
                        self.cache.invalidate_chrome();
                    }
                }
            }
            _ => {}
        }
        self.cache.needs_redraw = true;
    }

    pub(super) fn handle_config_page_key(&mut self, key: Key, modifiers: &Modifiers) {
        use crate::state::ConfigSection;

        let page = match self.modal.config_page.as_mut() {
            Some(p) => p,
            None => return,
        };

        if page.recording.is_some() {
            if matches!(key, Key::Escape) {
                page.recording = None;
            } else {
                let hotkey = crate::tide_input::Hotkey::new(
                    key,
                    modifiers.shift,
                    modifiers.ctrl,
                    modifiers.meta,
                    modifiers.alt,
                );
                let Some(recording) = page.recording.as_ref() else { return };
                let action_index = recording.action_index;
                if action_index < page.bindings.len() {
                    for (i, (_, existing)) in page.bindings.iter_mut().enumerate() {
                        if i != action_index && *existing == hotkey {
                            *existing = crate::tide_input::Hotkey::new(
                                Key::Char('?'),
                                false,
                                false,
                                false,
                                false,
                            );
                        }
                    }
                    page.bindings[action_index].1 = hotkey;
                    page.dirty = true;
                }
                page.recording = None;
            }
            self.cache.invalidate_chrome();
            return;
        }

        if page.copy_files_editing {
            match key {
                Key::Escape | Key::Enter => {
                    page.copy_files_editing = false;
                    page.dirty = true;
                }
                Key::Backspace => {
                    page.copy_files_input.backspace();
                    page.dirty = true;
                }
                Key::Delete => {
                    page.copy_files_input.delete_char();
                    page.dirty = true;
                }
                Key::Left => {
                    page.copy_files_input.move_cursor_left();
                }
                Key::Right => {
                    page.copy_files_input.move_cursor_right();
                }
                Key::Char(ch) => {
                    if !modifiers.ctrl && !modifiers.meta {
                        page.copy_files_input.insert_char(ch);
                        page.dirty = true;
                    }
                }
                _ => {}
            }
            self.cache.invalidate_chrome();
            return;
        }

        if page.worktree_editing {
            match key {
                Key::Escape | Key::Enter => {
                    page.worktree_editing = false;
                    page.dirty = true;
                }
                Key::Backspace => {
                    page.worktree_input.backspace();
                    page.dirty = true;
                }
                Key::Delete => {
                    page.worktree_input.delete_char();
                    page.dirty = true;
                }
                Key::Left => {
                    page.worktree_input.move_cursor_left();
                }
                Key::Right => {
                    page.worktree_input.move_cursor_right();
                }
                Key::Char(ch) => {
                    if !modifiers.ctrl && !modifiers.meta {
                        page.worktree_input.insert_char(ch);
                        page.dirty = true;
                    }
                }
                _ => {}
            }
            self.cache.invalidate_chrome();
            return;
        }

        match key {
            Key::Escape => {
                self.close_config_page();
            }
            Key::Tab => {
                if let Some(page) = self.modal.config_page.as_mut() {
                    page.section = match page.section {
                        ConfigSection::Keybindings => ConfigSection::Worktree,
                        ConfigSection::Worktree => ConfigSection::Keybindings,
                    };
                    page.selected = 0;
                    page.scroll_offset = 0;
                }
            }
            Key::Up | Key::Char('k') => {
                if !modifiers.ctrl && !modifiers.meta {
                    if let Some(page) = self.modal.config_page.as_mut() {
                        match page.section {
                            ConfigSection::Keybindings => {
                                if page.selected > 0 {
                                    page.selected -= 1;
                                    if page.selected < page.scroll_offset {
                                        page.scroll_offset = page.selected;
                                    }
                                }
                            }
                            ConfigSection::Worktree => {
                                if page.selected_field > 0 {
                                    page.selected_field -= 1;
                                }
                            }
                        }
                    }
                }
            }
            Key::Down | Key::Char('j') => {
                if !modifiers.ctrl && !modifiers.meta {
                    if let Some(page) = self.modal.config_page.as_mut() {
                        match page.section {
                            ConfigSection::Keybindings => {
                                if page.selected + 1 < page.bindings.len() {
                                    page.selected += 1;
                                    let max_visible = crate::theme::CONFIG_PAGE_MAX_VISIBLE;
                                    if page.selected >= page.scroll_offset + max_visible {
                                        page.scroll_offset =
                                            page.selected.saturating_sub(max_visible - 1);
                                    }
                                }
                            }
                            ConfigSection::Worktree => {
                                if page.selected_field < 1 {
                                    page.selected_field += 1;
                                }
                            }
                        }
                    }
                }
            }
            Key::Enter => {
                if let Some(page) = self.modal.config_page.as_mut() {
                    match page.section {
                        ConfigSection::Keybindings => {
                            page.recording = Some(crate::RecordingState {
                                action_index: page.selected,
                            });
                        }
                        ConfigSection::Worktree => {
                            match page.selected_field {
                                0 => page.worktree_editing = true,
                                1 => page.copy_files_editing = true,
                                _ => {}
                            }
                        }
                    }
                }
            }
            Key::Backspace => {
                if let Some(page) = self.modal.config_page.as_mut() {
                    if page.section == ConfigSection::Keybindings
                        && page.selected < page.bindings.len()
                    {
                        let action = &page.bindings[page.selected].0;
                        let defaults = crate::tide_input::KeybindingMap::default_bindings();
                        if let Some((dh, _)) = defaults
                            .iter()
                            .find(|(_, da)| da.action_key() == action.action_key())
                        {
                            page.bindings[page.selected].1 = dh.clone();
                            page.dirty = true;
                        }
                    }
                }
            }
            _ => {}
        }
        self.cache.invalidate_chrome();
    }
}
