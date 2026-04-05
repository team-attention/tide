use crate::tide_core::{Color, Rect, Renderer, TextStyle, Vec2};

use crate::theme::*;
use crate::state::abbreviate_path;
use crate::App;
use crate::AppCorePort;

use super::{visual_width, draw_popup_rounded_bg, draw_popup_scrim, draw_cursor_beam, text_style, bold_style};

pub(crate) struct CurrentWorktreeRowLayout {
    pub display_name: String,
    pub text_clip_w: f32,
    pub badge_x: f32,
    pub badge_w: f32,
}

pub(crate) fn current_worktree_row_layout(
    name: &str,
    popup_x: f32,
    popup_w: f32,
    item_pad: f32,
    name_x: f32,
    cell_w: f32,
) -> CurrentWorktreeRowLayout {
    let badge_label = "current";
    let badge_w = badge_label.len() as f32 * cell_w + 8.0;
    let badge_x = popup_x + popup_w - item_pad - badge_w;
    let text_clip_w = (badge_x - cell_w - name_x).max(0.0);
    let max_name_chars = (text_clip_w / cell_w).floor().max(0.0) as usize;
    let display_name: String = name.chars().take(max_name_chars).collect();

    CurrentWorktreeRowLayout {
        display_name,
        text_clip_w,
        badge_x,
        badge_w,
    }
}

/// Render git switcher popup overlay (worktree popup).
pub(super) fn render_git_switcher(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    let gs = match app.modal.git_switcher {
        Some(ref gs) => gs,
        None => return,
    };

    // Dim overlay (scrim)
    draw_popup_scrim(renderer, app.logical_size(), p.popup_scrim);

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let logical = app.logical_size();
    let geo = gs.geometry(cell_height, logical.width, logical.height);

    let line_height = geo.line_height;
    let popup_w = geo.popup_w;
    let popup_x = geo.popup_x;
    let popup_y = geo.popup_y;
    let popup_h = geo.popup_h;
    let input_h = geo.input_h;
    let max_visible = geo.max_visible;
    let new_wt_btn_h = geo.new_wt_btn_h;

    let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);

    // Shadow (behind background) — always dark for depth regardless of theme
    let shadow_color = Color::new(0.0, 0.0, 0.0, 0.25);
    renderer.draw_top_shadow(popup_rect, shadow_color, 8.0, 40.0, 0.0);

    // Background + border (rounded)
    draw_popup_rounded_bg(renderer, popup_rect, p.popup_bg, p.popup_border, POPUP_CORNER_RADIUS);

    let ts = text_style(p.tab_text_focused);
    let muted_style = text_style(p.tab_text);
    let item_pad = 12.0_f32;

    // Search input — with search icon and bottom border
    let input_y = popup_y + 2.0;
    let input_clip = Rect::new(popup_x + item_pad, input_y, popup_w - 2.0 * item_pad, input_h);
    let text_y = input_y + (input_h - cell_height) / 2.0;
    let icon_x = popup_x + item_pad;
    let icon_gray = p.tab_text;
    let icon_style = text_style(icon_gray);
    renderer.draw_top_text("\u{f002}", Vec2::new(icon_x, text_y), icon_style, input_clip);
    let text_x = icon_x + cell_size.width + 6.0; // after icon + gap
    let placeholder = "Search worktrees...";
    let placeholder_color = p.badge_text_dimmed;
    let placeholder_style = text_style(placeholder_color);
    if gs.input.is_empty() {
        renderer.draw_top_text(placeholder, Vec2::new(text_x, text_y), placeholder_style, input_clip);
    } else {
        renderer.draw_top_text(&gs.input.text, Vec2::new(text_x, text_y), ts, input_clip);
    }
    // Cursor beam
    let cx = text_x + visual_width(&gs.input.text[..gs.input.cursor]) as f32 * cell_size.width;
    draw_cursor_beam(renderer, cx, text_y, cell_height, p.cursor_accent);
    // Bottom border of search bar
    let sep_color = p.popup_border;
    renderer.draw_top_rect(Rect::new(popup_x, input_y + input_h - 1.0, popup_w, 1.0), sep_color);

    // List area (with 4px top padding per Pen design)
    let list_top = geo.list_top;
    let list_clip = Rect::new(popup_x, list_top, popup_w, max_visible as f32 * line_height + new_wt_btn_h);

    // Compute button zone width so we can clip text before it
    let btn_pad_h = 10.0_f32;
    let new_pane_btn_w = "New Pane".len() as f32 * cell_size.width + btn_pad_h * 2.0;
    let delete_btn_w = cell_size.width + btn_pad_h * 2.0; // trash icon only
    let gap = 8.0_f32; // flex gap between items (matches Pen)
    let busy = gs.shell_busy;
    let buttons_zone_w = new_pane_btn_w + if !busy { gap + delete_btn_w } else { 0.0 };

    // Item style constants
    let accent_color = p.dock_tab_underline; // #C4B8A6
    let text_gray = p.tab_text_focused;
    let hint_bar_border = p.popup_border;
    let hint_text_color = p.tab_text;
    let badge_bg_color = Color::new(accent_color.r, accent_color.g, accent_color.b, 0.094);
    let switch_btn_bg = accent_color;
    // Button text must always be dark (readable on accent bg in both modes)
    let switch_btn_text_color = Color::new(0.05, 0.05, 0.05, 1.0);

    // Delete button style constants
    let delete_border_color = Color::new(0.6, 0.2, 0.2, 1.0); // red-tinted border
    let delete_icon_color = Color::new(0.8, 0.3, 0.3, 1.0); // red-tinted icon

    let delete_confirm_idx = gs.delete_confirm;

    // Helper: render action buttons, right-aligned in row.
    // Worktrees: [Delete] [New Pane (filled, primary action)].
    // When `busy` is true, Delete is hidden.
    // `show_delete` controls whether the delete button is shown (hidden for main worktree).
    // When `fi` matches `delete_confirm`, delete button shows "Delete?" filled red.
    let render_action_buttons = |renderer: &mut crate::tide_renderer::WgpuRenderer,
                                  y: f32, _item_y: f32, show_delete: bool, fi: usize| {
        let confirming = delete_confirm_idx == Some(fi);
        let btn_h = cell_height + 4.0; // taller buttons for 36px rows
        let btn_y = y + (line_height - btn_h) / 2.0;
        let btn_radius = 4.0_f32;
        let btn_right = popup_x + popup_w - item_pad;
        let btn_text_y = btn_y + (btn_h - cell_height) / 2.0;

        // "New Pane" button (filled, primary action)
        let label = "New Pane";
        let w = label.len() as f32 * cell_size.width + btn_pad_h * 2.0;
        let x = btn_right - w;
        renderer.draw_top_rounded_rect(
            Rect::new(x, btn_y, w, btn_h),
            switch_btn_bg,
            btn_radius,
        );
        let style = TextStyle {
            foreground: switch_btn_text_color,
            background: None,
            bold: true,
            dim: false,
            italic: false,
            underline: false,
        };
        renderer.draw_top_text(label, Vec2::new(x + btn_pad_h, btn_text_y), style, list_clip);

        // Delete button — outlined red (hidden when busy or main worktree)
        if !busy && show_delete {
            if confirming {
                // Confirmation state: filled red "Delete?" button
                let del_label = "Delete?";
                let del_w = del_label.len() as f32 * cell_size.width + btn_pad_h * 2.0;
                let del_x = x - gap - del_w;
                renderer.draw_top_rounded_rect(
                    Rect::new(del_x, btn_y, del_w, btn_h),
                    delete_border_color,
                    btn_radius,
                );
                let del_style = TextStyle {
                    foreground: Color::new(1.0, 1.0, 1.0, 1.0),
                    background: None,
                    bold: true, dim: false, italic: false, underline: false,
                };
                renderer.draw_top_text(del_label, Vec2::new(del_x + btn_pad_h, btn_text_y), del_style, list_clip);
            } else {
                let del_w = cell_size.width + btn_pad_h * 2.0;
                let del_x = x - gap - del_w;
                renderer.draw_top_rounded_rect(
                    Rect::new(del_x, btn_y, del_w, btn_h),
                    delete_border_color,
                    btn_radius,
                );
                renderer.draw_top_rounded_rect(
                    Rect::new(del_x + 1.0, btn_y + 1.0, del_w - 2.0, btn_h - 2.0),
                    p.popup_bg,
                    (btn_radius - 1.0).max(0.0),
                );
                let del_style = text_style(delete_icon_color);
                renderer.draw_top_text("\u{f1f8}", Vec2::new(del_x + btn_pad_h, btn_text_y), del_style, list_clip);
            }
        }
    };

    let base_len = gs.base_filtered_len();

    // Worktree list items
    for vi in 0..max_visible {
        let fi = gs.scroll_offset + vi;
        if fi >= base_len {
            break;
        }
        let entry_idx = gs.filtered_worktrees[fi];
        let wt = &gs.worktrees[entry_idx];
        let y = list_top + vi as f32 * line_height;

        // Selected highlight
        if fi == gs.selected {
            renderer.draw_top_rect(
                Rect::new(popup_x + POPUP_SELECTED_INSET, y, popup_w - 2.0 * POPUP_SELECTED_INSET, line_height),
                p.popup_selected,
            );
        }

        let item_x = popup_x + item_pad;
        let item_y = y + (line_height - cell_height) / 2.0;

        let name = wt.branch.as_deref().unwrap_or("(detached)");

        // Git-branch icon
        let wt_icon_color = if wt.is_current { p.badge_git_worktree } else { icon_gray };
        let wt_icon_style = text_style(wt_icon_color);
        renderer.draw_top_text("\u{e0a0}", Vec2::new(item_x, item_y), wt_icon_style, list_clip);
        let name_x = item_x + cell_size.width + 6.0;

        if wt.is_current {
            // Current worktree: accent icon, white text, subtle bg tint, "current" badge
            let current_row_bg = Color::new(0.769, 0.722, 0.651, 0.031); // #C4B8A608
            renderer.draw_top_rect(
                Rect::new(popup_x, y, popup_w, line_height),
                current_row_bg,
            );
            let name_style = TextStyle {
                foreground: p.tab_text_focused,
                background: None,
                bold: fi == gs.selected,
                dim: false,
                italic: false,
                underline: false,
            };
            let layout = current_worktree_row_layout(
                name,
                popup_x,
                popup_w,
                item_pad,
                name_x,
                cell_size.width,
            );
            let text_clip = Rect::new(name_x, y, layout.text_clip_w, line_height);
            renderer.draw_top_text(
                &layout.display_name,
                Vec2::new(name_x, item_y),
                name_style,
                text_clip,
            );

            // "current" badge
            let badge_label = "current";
            let badge_w = layout.badge_w;
            let badge_h = cell_height;
            let badge_x = layout.badge_x;
            let badge_y = y + (line_height - badge_h) / 2.0;
            renderer.draw_top_rounded_rect(
                Rect::new(badge_x, badge_y, badge_w, badge_h),
                badge_bg_color,
                4.0,
            );
            let badge_style = TextStyle {
                foreground: accent_color,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            };
            renderer.draw_top_text(badge_label, Vec2::new(badge_x + 4.0, item_y), badge_style, list_clip);
        } else {
            // Non-current worktree: gray icon, gray text, path, action buttons
            // Clip text before buttons zone
            let icon_zone = cell_size.width + 6.0;
            let text_clip_w = popup_w - item_pad * 2.0 - icon_zone - buttons_zone_w - 8.0;
            let text_clip = Rect::new(name_x, y, text_clip_w.max(0.0), line_height);
            let name_style = TextStyle {
                foreground: text_gray,
                background: None,
                bold: fi == gs.selected,
                dim: false,
                italic: false,
                underline: false,
            };
            renderer.draw_top_text(name, Vec2::new(name_x, item_y), name_style, text_clip);

            // Abbreviated path
            let path_display = abbreviate_path(&wt.path);
            let path_x = name_x + (name.len() as f32 + 1.0) * cell_size.width;
            renderer.draw_top_text(&path_display, Vec2::new(path_x, item_y), muted_style, text_clip);

            render_action_buttons(renderer, y, item_y, !wt.is_main, fi);
        }
    }

    // Create row: rendered after normal items if visible (hidden when busy)
    if gs.has_create_row() && !busy {
        let create_fi = base_len;
        if create_fi >= gs.scroll_offset && create_fi < gs.scroll_offset + max_visible {
            let vi = create_fi - gs.scroll_offset;
            let y = list_top + vi as f32 * line_height;
            let item_x = popup_x + item_pad;
            let item_y = y + (line_height - cell_height) / 2.0;

            if create_fi == gs.selected {
                renderer.draw_top_rect(
                    Rect::new(popup_x + POPUP_SELECTED_INSET, y, popup_w - 2.0 * POPUP_SELECTED_INSET, line_height),
                    p.popup_selected,
                );
            }

            let plus_style = bold_style(accent_color);
            renderer.draw_top_text("+", Vec2::new(item_x, item_y), plus_style, list_clip);

            let name_x = item_x + 2.0 * cell_size.width;
            let create_name_style = TextStyle {
                foreground: p.tab_text_focused,
                background: None,
                bold: create_fi == gs.selected,
                dim: false,
                italic: false,
                underline: false,
            };
            renderer.draw_top_text(gs.input.text.trim(), Vec2::new(name_x, item_y), create_name_style, list_clip);

            render_action_buttons(renderer, y, item_y, false, usize::MAX);  // no delete for create row
        }
    }

    // Hint bar at bottom
    let hint_bar_h = 28.0_f32;
    let hint_bar_y = popup_y + popup_h - hint_bar_h;
    // Top border of hint bar
    renderer.draw_top_rect(Rect::new(popup_x, hint_bar_y, popup_w, 1.0), hint_bar_border);
    // Hint text centered
    let hint_text = "\u{21B5} checkout  \u{2318}\u{21B5} split  \u{2318}\u{232B} delete  esc close";
    let hint_text_w = hint_text.len() as f32 * cell_size.width;
    let hint_text_x = popup_x + (popup_w - hint_text_w) / 2.0;
    let hint_text_y = hint_bar_y + (hint_bar_h - cell_height) / 2.0;
    let hint_style = TextStyle {
        foreground: hint_text_color,
        background: None,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
    };
    let hint_clip = Rect::new(popup_x, hint_bar_y, popup_w, hint_bar_h);
    renderer.draw_top_text(hint_text, Vec2::new(hint_text_x, hint_text_y), hint_style, hint_clip);
}
