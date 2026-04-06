//! Keyboard event handling.
//!
//! With native IME, the platform calls ImeCommit for all committed text.
//! KeyDown only fires for keys NOT consumed by the IME (hotkeys, control keys).

mod modal;
mod preview;

use crate::tide_core::{InputEvent, Key, Modifiers};

use crate::state::drag_types::PaneDragState;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::ActionPort;
use crate::AppCorePort;
use crate::ClipboardSearchPort;
use crate::FileOpsPort;
use crate::FileTreePort;
use crate::FocusNavPort;
use crate::InputStatePort;
use crate::ImeStatePort;
use crate::ModalPort;
use crate::PaneAccessPort;
use crate::PaneLifecyclePort;
use crate::RouterPort;
use crate::WorkspaceNavPort;

// ── Trait alias for keyboard adapter ports ──

pub(crate) trait KeyboardPorts:
    AppCorePort
    + ActionPort
    + ClipboardSearchPort
    + FileOpsPort
    + FileTreePort
    + FocusNavPort
    + InputStatePort
    + ImeStatePort
    + ModalPort
    + PaneAccessPort
    + PaneLifecyclePort
    + RouterPort
    + WorkspaceNavPort
{
}
impl<
        T: AppCorePort
            + ActionPort
            + ClipboardSearchPort
            + FileOpsPort
            + FileTreePort
            + FocusNavPort
            + InputStatePort
            + ImeStatePort
            + ModalPort
            + PaneAccessPort
            + PaneLifecyclePort
            + RouterPort
            + WorkspaceNavPort,
    > KeyboardPorts for T
{
}

pub(crate) fn handle_key_down(
    ctx: &mut impl KeyboardPorts,
    key: Key,
    modifiers: Modifiers,
    chars: Option<String>,
) {
    // Cancel pane drag on Escape
    if !matches!(ctx.interaction().pane_drag, PaneDragState::Idle) {
        if matches!(key, Key::Escape) {
            let interaction = ctx.interaction_mut();
            interaction.pane_drag = PaneDragState::Idle;
            interaction.drop_preview_start = None;
            ctx.request_redraw();
            return;
        }
    }

    // If the key produced text and no command modifiers are held,
    // route via the text input system.
    // Exception 1: navigation keys (arrows, Escape, Enter, Tab, Backspace, Delete)
    // should not be routed as text even if the IME produced chars alongside them
    // (e.g., Korean IME commits composition on arrow press).
    // Exception 2: skip text routing when the active editor is in preview mode
    // AND no search bar is active, so keys like j/k/d/u fall through to
    // the preview scroll handler.
    let is_navigation_key = matches!(
        key,
        Key::Up
            | Key::Down
            | Key::Left
            | Key::Right
            | Key::Escape
            | Key::Enter
            | Key::Tab
            | Key::Backspace
            | Key::Delete
            | Key::Home
            | Key::End
            | Key::PageUp
            | Key::PageDown
    );
    if let Some(ref text) = chars {
        if !is_navigation_key && !modifiers.meta && !modifiers.ctrl && !modifiers.alt {
            let in_preview = ctx.search_focus().is_none()
                && ctx
                    .focused_pane()
                    .and_then(|id| ctx.pane(id))
                    .map(|p| matches!(p, PaneKind::Editor(ep) if ep.preview_mode))
                    .unwrap_or(false);
            if !in_preview {
                ctx.send_text_to_target(text);
                ctx.request_redraw();
                return;
            }
        }
    }

    // Cmd+Q → quit
    if matches!(key, Key::Char('q'))
        && modifiers.meta
        && !modifiers.ctrl
        && !modifiers.shift
        && !modifiers.alt
    {
        ctx.exit_app();
    }

    // Config page interception
    if ctx.modal().config_page.is_some() {
        modal::handle_config_page_key(ctx, key, &modifiers);
        return;
    }

    // Context menu interception
    if ctx.modal().context_menu.is_some() {
        modal::handle_context_menu_key(ctx, key);
        return;
    }

    // File tree inline rename interception
    if ctx.modal().file_tree_rename.is_some() {
        modal::handle_file_tree_rename_key(ctx, key, &modifiers);
        return;
    }

    // Git switcher popup interception
    if ctx.modal().git_switcher.is_some() {
        modal::handle_git_switcher_key(ctx, key, &modifiers);
        return;
    }

    // File finder interception
    if ctx.modal().file_finder.is_some() {
        modal::handle_file_finder_key(ctx, key, &modifiers);
        return;
    }

    // Save-as input interception
    if ctx.modal().save_as_input.is_some() {
        modal::handle_save_as_key(ctx, key, &modifiers);
        return;
    }

    // Explicit context comment composer interception
    if ctx.modal().context_comment_composer.is_some() {
        modal::handle_context_comment_composer_key(ctx, key, &modifiers);
        return;
    }

    // Branch cleanup bar interception
    if ctx.modal().branch_cleanup.is_some() {
        let stale = ctx
            .modal()
            .branch_cleanup
            .as_ref()
            .map(|bc| !ctx.has_pane(bc.pane_id))
            .unwrap_or(false);
        if stale {
            ctx.modal_mut().branch_cleanup = None;
        } else {
            match key {
                Key::Escape => {
                    ctx.cancel_branch_cleanup();
                }
                Key::Enter => {
                    // Enter → Keep (safe default: close without deleting)
                    ctx.confirm_branch_keep();
                }
                _ => {}
            }
            ctx.request_redraw();
            return;
        }
    }

    // Save confirm bar interception
    if ctx.modal().save_confirm.is_some() {
        if matches!(key, Key::Escape) {
            ctx.cancel_save_confirm();
        }
        ctx.request_redraw();
        return;
    }

    // Completion popup interception: intercept navigation/accept/dismiss keys
    // when the focused editor has an active completion popup.
    if let Some(focused_id) = ctx.focused_pane() {
        let has_completion = matches!(
            ctx.pane(focused_id),
            Some(PaneKind::Editor(pane)) if pane.completion.is_some()
        );
        if has_completion {
            match key {
                Key::Down => {
                    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(focused_id) {
                        if let Some(ref mut cs) = pane.completion {
                            cs.select_next();
                        }
                    }
                    ctx.invalidate_pane(focused_id);
                    ctx.request_redraw();
                    return;
                }
                Key::Up => {
                    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(focused_id) {
                        if let Some(ref mut cs) = pane.completion {
                            cs.select_prev();
                        }
                    }
                    ctx.invalidate_pane(focused_id);
                    ctx.request_redraw();
                    return;
                }
                Key::Tab | Key::Enter => {
                    ctx.accept_completion(focused_id);
                    ctx.request_redraw();
                    return;
                }
                Key::Escape => {
                    ctx.dismiss_completion(focused_id);
                    ctx.request_redraw();
                    return;
                }
                Key::Left | Key::Right => {
                    // Cursor movement dismisses completion
                    ctx.dismiss_completion(focused_id);
                    // Fall through to normal handling
                }
                // Backspace shortens the prefix and re-filters (BR-11a).
                // If prefix becomes empty, dismiss the popup.
                Key::Backspace => {
                    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(focused_id) {
                        let should_dismiss = if let Some(ref mut cs) = pane.completion {
                            cs.prefix.pop();
                            if cs.prefix.is_empty() {
                                true
                            } else {
                                cs.apply_filter();
                                cs.is_empty()
                            }
                        } else {
                            false
                        };
                        if should_dismiss {
                            pane.completion = None;
                        }
                    }
                    ctx.invalidate_pane(focused_id);
                    // Fall through to normal backspace handling
                }
                // Printable char keys fall through —
                // text_routing handles filtering.
                Key::Char(_) => {}
                _ => {
                    // Other non-text keys dismiss completion
                    // and fall through to normal handling
                    ctx.dismiss_completion(focused_id);
                }
            }
        }
    }

    // Ctrl+Space: explicit completion trigger
    if modifiers.ctrl && !modifiers.meta && !modifiers.alt && matches!(key, Key::Char(' ')) {
        if let Some(focused_id) = ctx.focused_pane() {
            if matches!(ctx.pane(focused_id), Some(PaneKind::Editor(_))) {
                ctx.trigger_completion_explicit(focused_id);
                ctx.request_redraw();
                return;
            }
        }
    }

    // FocusArea interception
    match ctx.current_focus_area() {
        FocusArea::FileTree => {
            if matches!(key, Key::Enter) && modifiers.meta {
                preview::handle_file_tree_nav_key(ctx, key, &modifiers);
                return;
            }
            if modifiers.meta || (modifiers.ctrl && modifiers.shift) {
                let input = InputEvent::KeyPress { key, modifiers };
                let action = ctx.route_input(input);
                if !matches!(action, crate::tide_input::Action::RouteToPane(_)) {
                    ctx.handle_action(action, Some(input));
                }
                ctx.request_redraw();
                return;
            }
            preview::handle_file_tree_nav_key(ctx, key, &modifiers);
            return;
        }
        FocusArea::Stage | FocusArea::Dock => {
            // Browser URL bar keyboard handling
            if let Some(focused_id) = ctx.focused_pane() {
                let is_browser_url_focused = matches!(
                    ctx.pane(focused_id),
                    Some(PaneKind::Browser(bp)) if bp.url_input_focused
                );
                if is_browser_url_focused {
                    // URL bar editing shortcuts (Cmd+A/C/V/X) must be
                    // handled here, before the global hotkey router
                    // intercepts them as Copy/Paste actions.
                    if modifiers.meta && !modifiers.ctrl && !modifiers.alt {
                        match key {
                            Key::Char('a') | Key::Char('A') => {
                                if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                                    let len = bp.url_input_char_len();
                                    bp.url_selection = Some((0, len));
                                    bp.url_input_cursor = len;
                                }
                                ctx.invalidate_chrome();
                                return;
                            }
                            Key::Char('c') | Key::Char('C') => {
                                if let Some(PaneKind::Browser(bp)) = ctx.pane(focused_id) {
                                    let text = bp
                                        .url_selected_text()
                                        .unwrap_or_else(|| bp.url_input.clone());
                                    if !text.is_empty() {
                                        let _ = ctx.clipboard_set_text(&text);
                                    }
                                }
                                return;
                            }
                            Key::Char('x') | Key::Char('X') => {
                                let text =
                                    ctx.pane(focused_id).and_then(|p| {
                                        if let PaneKind::Browser(bp) = p {
                                            bp.url_selected_text()
                                        } else {
                                            None
                                        }
                                    });
                                if let Some(text) = text {
                                    let _ = ctx.clipboard_set_text(&text);
                                    if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                                        bp.url_delete_selection();
                                    }
                                }
                                ctx.invalidate_chrome();
                                return;
                            }
                            Key::Char('v') | Key::Char('V') => {
                                if let Ok(text) = ctx.clipboard_get_text() {
                                    let text: String = text
                                        .chars()
                                        .take_while(|c| *c != '\n' && *c != '\r')
                                        .collect();
                                    if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                                        bp.url_delete_selection();
                                        let byte_off = bp.cursor_byte_offset();
                                        bp.url_input.insert_str(byte_off, &text);
                                        bp.url_input_cursor += text.chars().count();
                                    }
                                }
                                ctx.invalidate_chrome();
                                return;
                            }
                            _ => {}
                        }
                    }
                    // Global hotkeys take priority over URL bar input
                    if modifiers.meta || (modifiers.ctrl && modifiers.shift) {
                        let input = InputEvent::KeyPress { key, modifiers };
                        let action = ctx.route_input(input);
                        if !matches!(action, crate::tide_input::Action::RouteToPane(_)) {
                            ctx.handle_action(action, Some(input));
                            ctx.request_redraw();
                            return;
                        }
                    }
                    preview::handle_browser_url_bar_key(ctx, focused_id, key, &modifiers);
                    return;
                }
                if let Some(PaneKind::Browser(_)) = ctx.pane(focused_id) {
                    // Cmd+L → focus URL bar with select-all
                    if modifiers.meta && matches!(key, Key::Char('l') | Key::Char('L')) {
                        if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                            bp.url_input_focused = true;
                            bp.url_input = bp.url.clone();
                            let len = bp.url_input.chars().count();
                            bp.url_input_cursor = len;
                            bp.url_selection = Some((0, len));
                            ctx.invalidate_chrome();
                        }
                        return;
                    }
                }
            }

            // Search bar interception (before routing to pane)
            if let Some(search_pane_id) = ctx.search_focus() {
                preview::handle_search_bar_key(ctx, search_pane_id, key, &modifiers);
                return;
            }

            // Fall through to normal routing
        }
    }

    let input = InputEvent::KeyPress { key, modifiers };
    let action = ctx.route_input(input);
    ctx.handle_action(action, Some(input));
    ctx.request_redraw();
}
