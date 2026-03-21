//! Native IME event handling.
//!
//! With the native NSTextInputClient implementation, the platform layer
//! handles all composition complexity. We just receive committed text
//! and preedit updates — no workarounds needed.

use crate::pane::PaneKind;
use crate::AppCorePort;
use crate::FocusNavPort;
use crate::ImeStatePort;
use crate::ModalPort;
use crate::PaneAccessPort;
use crate::PaneLifecyclePort;

/// Handle IME committed text (composition done).
pub(crate) fn handle_ime_commit(
    ctx: &mut (impl AppCorePort + FocusNavPort + ImeStatePort + ModalPort + PaneAccessPort + PaneLifecyclePort),
    text: &str,
) {
    // Modal popups intercept text BEFORE any pane-level handling.
    if ctx.modal().file_finder.is_some() {
        for ch in text.chars() {
            if let Some(ref mut finder) = ctx.modal_mut().file_finder {
                finder.insert_char(ch);
                ctx.invalidate_chrome();
            }
        }
        ctx.ime_clear_composition();
        ctx.request_redraw();
        return;
    }
    if ctx.modal().save_as_input.is_some() {
        for ch in text.chars() {
            if let Some(ref mut input) = ctx.modal_mut().save_as_input {
                input.insert_char(ch);
            }
        }
        ctx.ime_clear_composition();
        ctx.request_redraw();
        return;
    }
    if ctx.modal().git_switcher.is_some() {
        for ch in text.chars() {
            if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                gs.insert_char(ch);
                ctx.invalidate_chrome();
            }
        }
        ctx.ime_clear_composition();
        ctx.request_redraw();
        return;
    }
    // Browser URL bar text input
    if let Some(focused_id) = ctx.focused_pane() {
        if let Some(PaneKind::Browser(bp)) = ctx.pane(focused_id) {
            if bp.url_input_focused {
                for ch in text.chars() {
                    if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                        let byte_off = bp.cursor_byte_offset();
                        bp.url_input.insert(byte_off, ch);
                        bp.url_input_cursor += 1;
                    }
                }
                ctx.invalidate_chrome();
                ctx.ime_clear_composition();
                ctx.request_redraw();
                return;
            }
        }
    }

    // Preview mode: ignore text input UNLESS search bar is active
    if ctx.search_focus().is_none() {
        if let Some(id) = ctx.focused_pane() {
            let is_preview = ctx
                .pane(id)
                .map(|p| matches!(p, PaneKind::Editor(ep) if ep.preview_mode))
                .unwrap_or(false);
            if is_preview {
                ctx.ime_clear_composition();
                ctx.request_redraw();
                return;
            }
        }
    }
    // Launcher pane: intercept single-char text to resolve launcher choice.
    if let Some(id) = ctx.focused_pane() {
        if matches!(ctx.pane(id), Some(PaneKind::Launcher(_))) {
            for ch in text.chars() {
                let choice = match ch {
                    't' | 'T' | 'ㅅ' => Some(crate::action::LauncherChoice::Terminal),
                    'e' | 'E' | 'ㄷ' => Some(crate::action::LauncherChoice::NewFile),
                    'o' | 'O' | 'ㅐ' => Some(crate::action::LauncherChoice::OpenFile),
                    'b' | 'B' | 'ㅠ' => Some(crate::action::LauncherChoice::Browser),
                    _ => None,
                };
                if let Some(c) = choice {
                    ctx.resolve_launcher(id, c);
                    ctx.ime_clear_composition();
                    ctx.request_redraw();
                    return;
                }
            }
            // Non-matching text: ignore for launcher
            ctx.ime_clear_composition();
            ctx.request_redraw();
            return;
        }
    }

    ctx.send_text_to_target(text);
    ctx.ime_clear_composition();
    ctx.request_redraw();
}

/// Handle IME preedit update (composition in progress).
pub(crate) fn handle_ime_preedit(
    ctx: &mut (impl AppCorePort + FocusNavPort + ImeStatePort + PaneAccessPort + PaneLifecyclePort),
    text: &str,
) {
    // Launcher pane: immediately resolve on preedit so Korean IME
    // doesn't require a second keystroke to commit the character.
    if !text.is_empty() {
        if let Some(id) = ctx.focused_pane() {
            if matches!(ctx.pane(id), Some(PaneKind::Launcher(_))) {
                let first_char = text.chars().next();
                let choice = match first_char {
                    Some('ㅅ') => Some(crate::action::LauncherChoice::Terminal),
                    Some('ㄷ') => Some(crate::action::LauncherChoice::NewFile),
                    Some('ㅐ') => Some(crate::action::LauncherChoice::OpenFile),
                    Some('ㅠ') => Some(crate::action::LauncherChoice::Browser),
                    _ => None,
                };
                if let Some(c) = choice {
                    ctx.resolve_launcher(id, c);
                    ctx.ime_clear_composition();
                    ctx.request_redraw();
                    return;
                }
            }
        }
    }

    ctx.ime_set_preedit(text);
    // Invalidate the grid cache for the target editor pane so the preedit
    // shift is re-rendered (editor generation doesn't change for preedit).
    if let Some(target) = ctx.effective_ime_target() {
        ctx.invalidate_pane(target);
    }
    // Invalidate chrome only when browser URL bar has preedit
    if ctx.focused_pane().and_then(|id| ctx.pane(id)).map_or(false, |p| {
        matches!(p, PaneKind::Browser(bp) if bp.url_input_focused)
    }) {
        ctx.invalidate_chrome();
    }
    ctx.request_redraw();
}
