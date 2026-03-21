//! Modal-specific keyboard handling.
//!
//! Handles keyboard events for: file finder, git switcher, config page,
//! context menu, file tree rename, save-as, branch cleanup, and save confirm.

use crate::tide_core::{Key, Modifiers};

use super::KeyboardPorts;

pub(super) fn handle_git_switcher_key(
    ctx: &mut impl KeyboardPorts,
    key: Key,
    modifiers: &Modifiers,
) {
    // Cmd+Backspace → delete selected item
    if matches!(key, Key::Backspace) && modifiers.meta && !modifiers.ctrl && !modifiers.alt {
        let selected = ctx.modal().git_switcher.as_ref().map(|gs| gs.selected);
        if let Some(selected) = selected {
            crate::adapter::inward::click_adapter::header::handle_git_switcher_button(
                ctx,
                crate::SwitcherButton::Delete(selected),
            );
        }
        return;
    }

    match key {
        Key::Escape => {
            // If delete confirmation is active, cancel it first
            let has_delete_confirm = ctx
                .modal()
                .git_switcher
                .as_ref()
                .map(|gs| gs.delete_confirm.is_some())
                .unwrap_or(false);
            if has_delete_confirm {
                if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                    gs.delete_confirm = None;
                }
                ctx.invalidate_chrome();
            } else {
                ctx.modal_mut().git_switcher = None;
            }
        }
        Key::Tab => {
            if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                gs.delete_confirm = None;
                gs.toggle_mode();
            }
            ctx.invalidate_chrome();
        }
        Key::Enter => {
            let info = ctx
                .modal()
                .git_switcher
                .as_ref()
                .map(|gs| (gs.selected, gs.mode));
            if let Some((selected, mode)) = info {
                let btn = if modifiers.meta {
                    // Cmd+Enter → always New Pane
                    crate::SwitcherButton::NewPane(selected)
                } else {
                    match mode {
                        crate::GitSwitcherMode::Branches => {
                            crate::SwitcherButton::Switch(selected)
                        }
                        // Worktrees: Enter triggers NewPane (no Switch action)
                        crate::GitSwitcherMode::Worktrees => {
                            crate::SwitcherButton::NewPane(selected)
                        }
                    }
                };
                crate::adapter::inward::click_adapter::header::handle_git_switcher_button(
                    ctx, btn,
                );
            }
            return;
        }
        Key::Up => {
            if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                gs.delete_confirm = None;
                gs.select_up();
            }
            ctx.invalidate_chrome();
        }
        Key::Down => {
            if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                gs.delete_confirm = None;
                gs.select_down();
            }
            ctx.invalidate_chrome();
        }
        Key::Backspace => {
            if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                gs.delete_confirm = None;
                gs.backspace();
            }
            ctx.invalidate_chrome();
        }
        Key::Delete => {
            if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                gs.delete_char();
            }
            ctx.invalidate_chrome();
        }
        Key::Left => {
            if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                gs.move_cursor_left();
            }
            ctx.invalidate_chrome();
        }
        Key::Right => {
            if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                gs.move_cursor_right();
            }
            ctx.invalidate_chrome();
        }
        Key::Char(ch) => {
            if !modifiers.ctrl && !modifiers.meta {
                if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                    gs.insert_char(ch);
                }
                ctx.invalidate_chrome();
            }
        }
        _ => {}
    }
    ctx.request_redraw();
}

pub(super) fn handle_file_finder_key(
    ctx: &mut impl KeyboardPorts,
    key: Key,
    modifiers: &Modifiers,
) {
    if (modifiers.meta || modifiers.ctrl) && matches!(key, Key::Char('k') | Key::Char('K')) {
        if let Some(ref mut finder) = ctx.modal_mut().file_finder {
            finder.select_up();
        }
        ctx.invalidate_chrome();
        ctx.request_redraw();
        return;
    }
    if (modifiers.meta || modifiers.ctrl) && matches!(key, Key::Char('j') | Key::Char('J')) {
        if let Some(ref mut finder) = ctx.modal_mut().file_finder {
            finder.select_down();
        }
        ctx.invalidate_chrome();
        ctx.request_redraw();
        return;
    }
    match key {
        Key::Escape => {
            ctx.close_file_finder();
        }
        Key::Enter => {
            let path = ctx
                .modal()
                .file_finder
                .as_ref()
                .and_then(|f| f.selected_path());
            let replace_id = ctx
                .modal()
                .file_finder
                .as_ref()
                .and_then(|f| f.replace_pane_id);
            ctx.close_file_finder();
            if let Some(path) = path {
                if let Some(pane_id) = replace_id {
                    // Replace the launcher pane with an editor for the selected file
                    ctx.replace_pane_with_editor(pane_id, path);
                } else {
                    ctx.open_editor_pane(path);
                }
            }
        }
        Key::Up => {
            if let Some(ref mut finder) = ctx.modal_mut().file_finder {
                finder.select_up();
            }
            ctx.invalidate_chrome();
        }
        Key::Down => {
            if let Some(ref mut finder) = ctx.modal_mut().file_finder {
                finder.select_down();
            }
            ctx.invalidate_chrome();
        }
        Key::Backspace => {
            if let Some(ref mut finder) = ctx.modal_mut().file_finder {
                finder.backspace();
            }
            ctx.invalidate_chrome();
        }
        Key::Delete => {
            if let Some(ref mut finder) = ctx.modal_mut().file_finder {
                finder.delete_char();
            }
            ctx.invalidate_chrome();
        }
        Key::Left => {
            if let Some(ref mut finder) = ctx.modal_mut().file_finder {
                finder.move_cursor_left();
            }
        }
        Key::Right => {
            if let Some(ref mut finder) = ctx.modal_mut().file_finder {
                finder.move_cursor_right();
            }
        }
        Key::Char(ch) => {
            if !modifiers.ctrl && !modifiers.meta {
                if let Some(ref mut finder) = ctx.modal_mut().file_finder {
                    finder.insert_char(ch);
                }
                ctx.invalidate_chrome();
            }
        }
        _ => {}
    }
    ctx.request_redraw();
}

pub(super) fn handle_save_as_key(
    ctx: &mut impl KeyboardPorts,
    key: Key,
    modifiers: &Modifiers,
) {
    match key {
        Key::Escape => {
            ctx.modal_mut().save_as_input = None;
        }
        Key::Tab => {
            if let Some(ref mut input) = ctx.modal_mut().save_as_input {
                input.toggle_field();
            }
        }
        Key::Enter => {
            let resolved = ctx
                .modal()
                .save_as_input
                .as_ref()
                .and_then(|input| {
                    let pane_id = input.pane_id;
                    input.resolve_path().map(|p| (pane_id, p))
                });
            ctx.modal_mut().save_as_input = None;
            if let Some((pane_id, path)) = resolved {
                let path_str = path.to_string_lossy().to_string();
                ctx.complete_save_as(pane_id, &path_str);
            }
        }
        Key::Backspace => {
            if let Some(ref mut input) = ctx.modal_mut().save_as_input {
                input.backspace();
            }
        }
        Key::Delete => {
            if let Some(ref mut input) = ctx.modal_mut().save_as_input {
                input.delete_char();
            }
        }
        Key::Left => {
            if let Some(ref mut input) = ctx.modal_mut().save_as_input {
                input.move_cursor_left();
            }
        }
        Key::Right => {
            if let Some(ref mut input) = ctx.modal_mut().save_as_input {
                input.move_cursor_right();
            }
        }
        Key::Char(ch) => {
            if !modifiers.ctrl && !modifiers.meta {
                if let Some(ref mut input) = ctx.modal_mut().save_as_input {
                    input.insert_char(ch);
                }
            }
        }
        _ => {}
    }
    ctx.request_redraw();
}

pub(super) fn handle_context_menu_key(ctx: &mut impl KeyboardPorts, key: Key) {
    match key {
        Key::Escape => {
            ctx.modal_mut().context_menu = None;
        }
        Key::Up => {
            if let Some(ref mut menu) = ctx.modal_mut().context_menu {
                if menu.selected > 0 {
                    menu.selected -= 1;
                }
            }
        }
        Key::Down => {
            if let Some(ref mut menu) = ctx.modal_mut().context_menu {
                if menu.selected + 1 < menu.items().len() {
                    menu.selected += 1;
                }
            }
        }
        Key::Enter => {
            let selected = ctx.modal().context_menu.as_ref().map(|m| m.selected);
            if let Some(idx) = selected {
                ctx.execute_context_menu_action(idx);
            }
            ctx.modal_mut().context_menu = None;
        }
        _ => {}
    }
    ctx.request_redraw();
}

pub(super) fn handle_file_tree_rename_key(
    ctx: &mut impl KeyboardPorts,
    key: Key,
    modifiers: &Modifiers,
) {
    match key {
        Key::Escape => {
            ctx.modal_mut().file_tree_rename = None;
            ctx.invalidate_chrome();
        }
        Key::Enter => {
            ctx.complete_file_tree_rename();
        }
        Key::Backspace => {
            if let Some(ref mut rename) = ctx.modal_mut().file_tree_rename {
                rename.input.backspace();
            }
            ctx.invalidate_chrome();
        }
        Key::Delete => {
            if let Some(ref mut rename) = ctx.modal_mut().file_tree_rename {
                rename.input.delete_char();
            }
            ctx.invalidate_chrome();
        }
        Key::Left => {
            if let Some(ref mut rename) = ctx.modal_mut().file_tree_rename {
                rename.input.move_cursor_left();
            }
            ctx.invalidate_chrome();
        }
        Key::Right => {
            if let Some(ref mut rename) = ctx.modal_mut().file_tree_rename {
                rename.input.move_cursor_right();
            }
            ctx.invalidate_chrome();
        }
        Key::Char(ch) => {
            if !modifiers.ctrl && !modifiers.meta {
                if let Some(ref mut rename) = ctx.modal_mut().file_tree_rename {
                    rename.input.insert_char(ch);
                }
                ctx.invalidate_chrome();
            }
        }
        _ => {}
    }
    ctx.request_redraw();
}

pub(super) fn handle_config_page_key(
    ctx: &mut impl KeyboardPorts,
    key: Key,
    modifiers: &Modifiers,
) {
    use crate::state::ConfigSection;

    let has_page = ctx.modal().config_page.is_some();
    if !has_page {
        return;
    }

    // Check recording state
    let is_recording = ctx
        .modal()
        .config_page
        .as_ref()
        .map(|p| p.recording.is_some())
        .unwrap_or(false);

    if is_recording {
        if matches!(key, Key::Escape) {
            if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                page.recording = None;
            }
        } else {
            let hotkey = crate::tide_input::Hotkey::new(
                key,
                modifiers.shift,
                modifiers.ctrl,
                modifiers.meta,
                modifiers.alt,
            );
            let action_index = ctx
                .modal()
                .config_page
                .as_ref()
                .and_then(|p| p.recording.as_ref().map(|r| r.action_index));
            if let Some(action_index) = action_index {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
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
            }
        }
        ctx.invalidate_chrome();
        return;
    }

    let is_copy_files_editing = ctx
        .modal()
        .config_page
        .as_ref()
        .map(|p| p.copy_files_editing)
        .unwrap_or(false);

    if is_copy_files_editing {
        match key {
            Key::Escape | Key::Enter => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.copy_files_editing = false;
                    page.dirty = true;
                }
            }
            Key::Backspace => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.copy_files_input.backspace();
                    page.dirty = true;
                }
            }
            Key::Delete => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.copy_files_input.delete_char();
                    page.dirty = true;
                }
            }
            Key::Left => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.copy_files_input.move_cursor_left();
                }
            }
            Key::Right => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.copy_files_input.move_cursor_right();
                }
            }
            Key::Char(ch) => {
                if !modifiers.ctrl && !modifiers.meta {
                    if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                        page.copy_files_input.insert_char(ch);
                        page.dirty = true;
                    }
                }
            }
            _ => {}
        }
        ctx.invalidate_chrome();
        return;
    }

    let is_worktree_editing = ctx
        .modal()
        .config_page
        .as_ref()
        .map(|p| p.worktree_editing)
        .unwrap_or(false);

    if is_worktree_editing {
        match key {
            Key::Escape | Key::Enter => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.worktree_editing = false;
                    page.dirty = true;
                }
            }
            Key::Backspace => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.worktree_input.backspace();
                    page.dirty = true;
                }
            }
            Key::Delete => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.worktree_input.delete_char();
                    page.dirty = true;
                }
            }
            Key::Left => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.worktree_input.move_cursor_left();
                }
            }
            Key::Right => {
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                    page.worktree_input.move_cursor_right();
                }
            }
            Key::Char(ch) => {
                if !modifiers.ctrl && !modifiers.meta {
                    if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                        page.worktree_input.insert_char(ch);
                        page.dirty = true;
                    }
                }
            }
            _ => {}
        }
        ctx.invalidate_chrome();
        return;
    }

    match key {
        Key::Escape => {
            ctx.close_config_page();
        }
        Key::Tab => {
            if let Some(page) = ctx.modal_mut().config_page.as_mut() {
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
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
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
                if let Some(page) = ctx.modal_mut().config_page.as_mut() {
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
            if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                match page.section {
                    ConfigSection::Keybindings => {
                        page.recording = Some(crate::RecordingState {
                            action_index: page.selected,
                        });
                    }
                    ConfigSection::Worktree => match page.selected_field {
                        0 => page.worktree_editing = true,
                        1 => page.copy_files_editing = true,
                        _ => {}
                    },
                }
            }
        }
        Key::Backspace => {
            if let Some(page) = ctx.modal_mut().config_page.as_mut() {
                if page.section == ConfigSection::Keybindings
                    && page.selected < page.bindings.len()
                {
                    let action_key = page.bindings[page.selected].0.action_key();
                    let defaults = crate::tide_input::KeybindingMap::default_bindings();
                    if let Some((dh, _)) = defaults
                        .iter()
                        .find(|(_, da)| da.action_key() == action_key)
                    {
                        page.bindings[page.selected].1 = dh.clone();
                        page.dirty = true;
                    }
                }
            }
        }
        _ => {}
    }
    ctx.invalidate_chrome();
}
