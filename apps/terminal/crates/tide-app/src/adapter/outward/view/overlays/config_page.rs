use crate::tide_core::{Rect, Renderer, TextStyle, Vec2};

use crate::state::settings::ThemePalettePreference;
use crate::theme::*;
use crate::App;
use crate::AppCorePort;

use super::{
    bold_style, draw_cursor_beam, draw_popup_border, draw_popup_rounded_bg, draw_popup_scrim,
    text_style, visual_width,
};

pub(crate) fn config_page_theme_status_text(dark_mode: bool) -> &'static str {
    if dark_mode {
        "Dark"
    } else {
        "Light"
    }
}

pub(crate) fn config_page_theme_toggle_text(dark_mode: bool) -> &'static str {
    if dark_mode {
        "Switch to Light"
    } else {
        "Switch to Dark"
    }
}

pub(crate) fn config_page_theme_palette_status_text(
    palette: ThemePalettePreference,
) -> &'static str {
    palette.display_name()
}

pub(crate) fn config_page_theme_palette_toggle_text(palette: ThemePalettePreference) -> String {
    format!("Next: {}", palette.next().display_name())
}

pub(crate) fn config_page_osc52_read_status_text(allowed: bool) -> &'static str {
    if allowed {
        "Allowed"
    } else {
        "Blocked"
    }
}

pub(crate) fn config_page_osc52_read_toggle_text(allowed: bool) -> &'static str {
    if allowed {
        "Block"
    } else {
        "Allow"
    }
}

/// Render the config page overlay (settings modal).
pub(super) fn render_config_page(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    let page = match app.modal.config_page {
        Some(ref page) => page,
        None => return,
    };

    use crate::state::ConfigSection;

    // Dim overlay (scrim)
    draw_popup_scrim(renderer, app.logical_size(), p.popup_scrim);

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let logical = app.logical_size();

    // Popup dimensions
    let popup_w = CONFIG_PAGE_W.min(logical.width - 80.0).max(300.0);
    let popup_h = CONFIG_PAGE_MAX_H.min(logical.height - 80.0).max(200.0);
    let popup_x = (logical.width - popup_w) / 2.0;
    let popup_y = (logical.height - popup_h) / 2.0;
    let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);

    // Shadow — always dark for depth
    let shadow_color = crate::tide_core::Color::new(0.0, 0.0, 0.0, 0.25);
    renderer.draw_top_shadow(popup_rect, shadow_color, 8.0, 40.0, 0.0);

    // Background + border (rounded)
    draw_popup_rounded_bg(
        renderer,
        popup_rect,
        p.popup_bg,
        p.popup_border,
        POPUP_CORNER_RADIUS,
    );

    let item_pad = 12.0_f32;
    let sep_color = p.popup_border;
    let accent_color = p.dock_tab_underline;
    let tab_active_color = p.tab_text_focused;
    let tab_inactive_color = p.tab_text;
    let hint_text_color = p.badge_text_dimmed;

    // ── Title bar ──
    let title_h = CONFIG_PAGE_TITLE_H;
    let title_y = popup_y + 2.0;
    let title_text_y = title_y + (title_h - cell_height) / 2.0;
    let title_style = bold_style(p.tab_text_focused);
    let title_clip = Rect::new(
        popup_x + item_pad,
        title_y,
        popup_w - 2.0 * item_pad,
        title_h,
    );
    renderer.draw_top_text(
        "Settings",
        Vec2::new(popup_x + item_pad, title_text_y),
        title_style,
        title_clip,
    );
    renderer.draw_top_rect(
        Rect::new(popup_x, title_y + title_h, popup_w, 1.0),
        sep_color,
    );

    // ── Tab bar ──
    let tab_h = CONFIG_PAGE_TAB_H;
    let tab_y = title_y + title_h + 1.0;
    let tab_text_y = tab_y + (tab_h - cell_height) / 2.0;
    let tab_labels = [
        (ConfigSection::Keybindings, "Keybindings"),
        (ConfigSection::Worktree, "Worktree"),
        (ConfigSection::Terminal, "Terminal"),
        (ConfigSection::Appearance, "Appearance"),
    ];
    let tab_w = popup_w / tab_labels.len() as f32;

    let tab_clip = Rect::new(popup_x, tab_y, popup_w, tab_h);
    for (idx, (section, label)) in tab_labels.iter().enumerate() {
        let active = page.section == *section;
        let style = TextStyle {
            foreground: if active {
                tab_active_color
            } else {
                tab_inactive_color
            },
            background: None,
            bold: active,
            dim: false,
            italic: false,
            underline: false,
        };
        let text_w = label.len() as f32 * cell_size.width;
        let text_x = popup_x + idx as f32 * tab_w + (tab_w - text_w) / 2.0;
        renderer.draw_top_text(label, Vec2::new(text_x, tab_text_y), style, tab_clip);
    }

    // Active tab underline
    let active_tab_idx = match page.section {
        ConfigSection::Keybindings => 0,
        ConfigSection::Worktree => 1,
        ConfigSection::Terminal => 2,
        ConfigSection::Appearance => 3,
    };
    let active_tab_x = popup_x + active_tab_idx as f32 * tab_w;
    renderer.draw_top_rect(
        Rect::new(active_tab_x, tab_y + tab_h - 2.0, tab_w, 2.0),
        accent_color,
    );
    renderer.draw_top_rect(Rect::new(popup_x, tab_y + tab_h, popup_w, 1.0), sep_color);

    // ── Content area ──
    let content_top = tab_y + tab_h + 1.0;
    let hint_bar_h = CONFIG_PAGE_HINT_BAR_H;
    let content_bottom = popup_y + popup_h - hint_bar_h;
    let line_height = 32.0_f32.max(cell_height + POPUP_LINE_EXTRA);

    match page.section {
        ConfigSection::Keybindings => {
            let max_visible = ((content_bottom - content_top) / line_height).floor() as usize;
            let list_clip = Rect::new(popup_x, content_top, popup_w, content_bottom - content_top);

            for vi in 0..max_visible {
                let fi = page.scroll_offset + vi;
                if fi >= page.bindings.len() {
                    break;
                }
                let (ref action, ref hotkey) = page.bindings[fi];
                let y = content_top + vi as f32 * line_height;
                if y + line_height > content_bottom {
                    break;
                }

                // Selected highlight
                if fi == page.selected {
                    renderer.draw_top_rect(
                        Rect::new(
                            popup_x + POPUP_SELECTED_INSET,
                            y,
                            popup_w - 2.0 * POPUP_SELECTED_INSET,
                            line_height,
                        ),
                        p.popup_selected,
                    );
                }

                let item_y = y + (line_height - cell_height) / 2.0;

                // Action label
                let label = action.label();
                let label_color = if fi == page.selected {
                    p.tab_text_focused
                } else {
                    tab_active_color
                };
                let label_style = TextStyle {
                    foreground: label_color,
                    background: None,
                    bold: fi == page.selected,
                    dim: false,
                    italic: false,
                    underline: false,
                };
                let label_clip = Rect::new(popup_x + item_pad, y, popup_w * 0.55, line_height);
                renderer.draw_top_text(
                    label,
                    Vec2::new(popup_x + item_pad, item_y),
                    label_style,
                    label_clip,
                );

                // Recording state or hotkey display
                let is_recording = page
                    .recording
                    .as_ref()
                    .map_or(false, |r| r.action_index == fi);
                let hotkey_x = popup_x + popup_w * 0.55;
                let hotkey_clip = Rect::new(hotkey_x, y, popup_w * 0.35, line_height);

                if is_recording {
                    let recording_style = TextStyle {
                        foreground: accent_color,
                        background: None,
                        bold: true,
                        dim: false,
                        italic: false,
                        underline: false,
                    };
                    renderer.draw_top_text(
                        "Press key...",
                        Vec2::new(hotkey_x, item_y),
                        recording_style,
                        hotkey_clip,
                    );
                } else {
                    let display = hotkey.display();
                    let hotkey_color = if fi == page.selected {
                        p.tab_text_focused
                    } else {
                        tab_inactive_color
                    };
                    let hotkey_style = text_style(hotkey_color);
                    renderer.draw_top_text(
                        &display,
                        Vec2::new(hotkey_x, item_y),
                        hotkey_style,
                        hotkey_clip,
                    );
                }

                // Edit indicator
                if fi == page.selected && !is_recording {
                    let edit_label = "\u{f044}"; // pencil icon
                    let edit_x = popup_x + popup_w - item_pad - cell_size.width;
                    let edit_style = text_style(tab_inactive_color);
                    renderer.draw_top_text(
                        edit_label,
                        Vec2::new(edit_x, item_y),
                        edit_style,
                        list_clip,
                    );
                }
            }
        }
        ConfigSection::Worktree => {
            let input_h = cell_height + POPUP_INPUT_PADDING;
            let selected_field = page.selected_field;
            let selected_border = accent_color;

            // ── Base dir pattern ──
            let y = content_top + 8.0;
            let item_y = y + (line_height - cell_height) / 2.0;

            // Label
            let label_style = bold_style(tab_active_color);
            renderer.draw_top_text(
                "Base dir pattern:",
                Vec2::new(popup_x + item_pad, item_y),
                label_style,
                Rect::new(popup_x, y, popup_w, line_height),
            );

            // Input field
            let wt_input_y = y + line_height + 4.0;
            let wt_input_rect = Rect::new(
                popup_x + item_pad,
                wt_input_y,
                popup_w - 2.0 * item_pad,
                input_h,
            );
            renderer.draw_top_rect(
                wt_input_rect,
                if page.worktree_editing {
                    p.popup_selected
                } else {
                    p.surface_bg
                },
            );
            let wt_border =
                if selected_field == 0 && !page.worktree_editing && !page.copy_files_editing {
                    selected_border
                } else {
                    p.popup_border
                };
            draw_popup_border(renderer, wt_input_rect, wt_border);

            let text_x = popup_x + item_pad + POPUP_TEXT_INSET;
            let text_y = wt_input_y + (input_h - cell_height) / 2.0;
            let text_clip = Rect::new(
                text_x,
                wt_input_y,
                popup_w - 2.0 * item_pad - 2.0 * POPUP_TEXT_INSET,
                input_h,
            );

            if page.worktree_input.is_empty() && !page.worktree_editing {
                let placeholder = "{repo_root}.worktree/{branch}";
                let muted_style = text_style(tab_inactive_color);
                renderer.draw_top_text(
                    placeholder,
                    Vec2::new(text_x, text_y),
                    muted_style,
                    text_clip,
                );
            } else {
                let ts = text_style(p.tab_text_focused);
                renderer.draw_top_text(
                    &page.worktree_input.text,
                    Vec2::new(text_x, text_y),
                    ts,
                    text_clip,
                );
            }

            // Cursor beam when editing
            if page.worktree_editing {
                let cx = text_x
                    + visual_width(&page.worktree_input.text[..page.worktree_input.cursor]) as f32
                        * cell_size.width;
                draw_cursor_beam(renderer, cx, text_y, cell_height, p.cursor_accent);
            }

            // Help text
            let help_y = wt_input_y + input_h + 8.0;
            let help_text = "Variables: {repo_root}, {branch}";
            let help_style = text_style(hint_text_color);
            renderer.draw_top_text(
                help_text,
                Vec2::new(popup_x + item_pad, help_y),
                help_style,
                Rect::new(popup_x, help_y, popup_w, cell_height + 4.0),
            );

            // ── Copy files ──
            let cf_label_y = help_y + cell_height + 12.0;
            let cf_label_item_y = cf_label_y + (line_height - cell_height) / 2.0;
            renderer.draw_top_text(
                "Copy files:",
                Vec2::new(popup_x + item_pad, cf_label_item_y),
                label_style,
                Rect::new(popup_x, cf_label_y, popup_w, line_height),
            );

            let cf_input_y = cf_label_y + line_height + 4.0;
            let cf_input_rect = Rect::new(
                popup_x + item_pad,
                cf_input_y,
                popup_w - 2.0 * item_pad,
                input_h,
            );
            renderer.draw_top_rect(
                cf_input_rect,
                if page.copy_files_editing {
                    p.popup_selected
                } else {
                    p.surface_bg
                },
            );
            let cf_border =
                if selected_field == 1 && !page.worktree_editing && !page.copy_files_editing {
                    selected_border
                } else {
                    p.popup_border
                };
            draw_popup_border(renderer, cf_input_rect, cf_border);

            let cf_text_x = popup_x + item_pad + POPUP_TEXT_INSET;
            let cf_text_y = cf_input_y + (input_h - cell_height) / 2.0;
            let cf_text_clip = Rect::new(
                cf_text_x,
                cf_input_y,
                popup_w - 2.0 * item_pad - 2.0 * POPUP_TEXT_INSET,
                input_h,
            );

            if page.copy_files_input.is_empty() && !page.copy_files_editing {
                let cf_placeholder = ".env, .vscode/settings.json";
                let muted_style = text_style(tab_inactive_color);
                renderer.draw_top_text(
                    cf_placeholder,
                    Vec2::new(cf_text_x, cf_text_y),
                    muted_style,
                    cf_text_clip,
                );
            } else {
                let ts = text_style(p.tab_text_focused);
                renderer.draw_top_text(
                    &page.copy_files_input.text,
                    Vec2::new(cf_text_x, cf_text_y),
                    ts,
                    cf_text_clip,
                );
            }

            // Cursor beam when editing
            if page.copy_files_editing {
                let cx = cf_text_x
                    + visual_width(&page.copy_files_input.text[..page.copy_files_input.cursor])
                        as f32
                        * cell_size.width;
                draw_cursor_beam(renderer, cx, cf_text_y, cell_height, p.cursor_accent);
            }

            // Help text for copy files
            let cf_help_y = cf_input_y + input_h + 8.0;
            let cf_help_text = "Comma-separated relative paths to copy into new worktrees";
            renderer.draw_top_text(
                cf_help_text,
                Vec2::new(popup_x + item_pad, cf_help_y),
                help_style,
                Rect::new(popup_x, cf_help_y, popup_w, cell_height + 4.0),
            );
        }
        ConfigSection::Terminal => {
            let input_h = cell_height + POPUP_INPUT_PADDING;
            let selected_field = page.selected_field;
            let selected_border = accent_color;
            let label_style = bold_style(tab_active_color);

            // ── Scrollback lines ──
            let y = content_top + 8.0;
            let item_y = y + (line_height - cell_height) / 2.0;
            renderer.draw_top_text(
                "Scrollback lines",
                Vec2::new(popup_x + item_pad, item_y),
                label_style,
                Rect::new(popup_x, y, popup_w, line_height),
            );

            let input_y = y + line_height + 4.0;
            let input_rect = Rect::new(
                popup_x + item_pad,
                input_y,
                popup_w - 2.0 * item_pad,
                input_h,
            );
            renderer.draw_top_rect(
                input_rect,
                if page.terminal_scrollback_editing {
                    p.popup_selected
                } else {
                    p.surface_bg
                },
            );
            let input_border = if selected_field == 0 && !page.terminal_scrollback_editing {
                selected_border
            } else {
                p.popup_border
            };
            draw_popup_border(renderer, input_rect, input_border);

            let text_x = popup_x + item_pad + POPUP_TEXT_INSET;
            let text_y = input_y + (input_h - cell_height) / 2.0;
            let text_clip = Rect::new(
                text_x,
                input_y,
                popup_w - 2.0 * item_pad - 2.0 * POPUP_TEXT_INSET,
                input_h,
            );
            if page.terminal_scrollback_input.is_empty() && !page.terminal_scrollback_editing {
                let muted_style = text_style(tab_inactive_color);
                renderer.draw_top_text(
                    &crate::tide_terminal::DEFAULT_SCROLLBACK_LINES.to_string(),
                    Vec2::new(text_x, text_y),
                    muted_style,
                    text_clip,
                );
            } else {
                let ts = text_style(p.tab_text_focused);
                renderer.draw_top_text(
                    &page.terminal_scrollback_input.text,
                    Vec2::new(text_x, text_y),
                    ts,
                    text_clip,
                );
            }

            if page.terminal_scrollback_editing {
                let cx = text_x
                    + visual_width(
                        &page.terminal_scrollback_input.text
                            [..page.terminal_scrollback_input.cursor],
                    ) as f32
                        * cell_size.width;
                draw_cursor_beam(renderer, cx, text_y, cell_height, p.cursor_accent);
            }

            // ── OSC 52 read ──
            let row_y = input_y + input_h + 16.0;
            let row_h = line_height + 8.0;
            if selected_field == 1 {
                renderer.draw_top_rect(
                    Rect::new(
                        popup_x + POPUP_SELECTED_INSET,
                        row_y,
                        popup_w - 2.0 * POPUP_SELECTED_INSET,
                        row_h,
                    ),
                    p.popup_selected,
                );
            }

            let row_item_y = row_y + (row_h - cell_height) / 2.0;
            renderer.draw_top_text(
                "OSC 52 read",
                Vec2::new(popup_x + item_pad, row_item_y),
                label_style,
                Rect::new(popup_x + item_pad, row_y, popup_w * 0.35, row_h),
            );

            let status = config_page_osc52_read_status_text(page.terminal_osc52_read);
            let status_style = text_style(p.tab_text_focused);
            renderer.draw_top_text(
                status,
                Vec2::new(popup_x + popup_w * 0.44, row_item_y),
                status_style,
                Rect::new(popup_x + popup_w * 0.44, row_y, popup_w * 0.20, row_h),
            );

            let action = config_page_osc52_read_toggle_text(page.terminal_osc52_read);
            let action_w = action.len() as f32 * cell_size.width;
            let action_x = popup_x + popup_w - item_pad - action_w;
            let action_style = text_style(accent_color);
            renderer.draw_top_text(
                action,
                Vec2::new(action_x, row_item_y),
                action_style,
                Rect::new(action_x, row_y, action_w, row_h),
            );
        }
        ConfigSection::Appearance => {
            let selected_field = page.selected_field.min(1);
            let mode_row_y = content_top + 12.0;
            let row_h = line_height + 8.0;
            let label_style = bold_style(tab_active_color);
            let rows = [
                (
                    "Mode",
                    config_page_theme_status_text(app.window.dark_mode).to_string(),
                    config_page_theme_toggle_text(app.window.dark_mode).to_string(),
                ),
                (
                    "Palette",
                    config_page_theme_palette_status_text(app.window.theme_palette).to_string(),
                    config_page_theme_palette_toggle_text(app.window.theme_palette),
                ),
            ];

            for (idx, (label, status, action)) in rows.iter().enumerate() {
                let row_y = mode_row_y + idx as f32 * (row_h + 8.0);
                if selected_field == idx {
                    renderer.draw_top_rect(
                        Rect::new(
                            popup_x + POPUP_SELECTED_INSET,
                            row_y,
                            popup_w - 2.0 * POPUP_SELECTED_INSET,
                            row_h,
                        ),
                        p.popup_selected,
                    );
                }

                let item_y = row_y + (row_h - cell_height) / 2.0;
                renderer.draw_top_text(
                    label,
                    Vec2::new(popup_x + item_pad, item_y),
                    label_style,
                    Rect::new(popup_x + item_pad, row_y, popup_w * 0.30, row_h),
                );

                let status_style = text_style(p.tab_text_focused);
                renderer.draw_top_text(
                    status,
                    Vec2::new(popup_x + popup_w * 0.38, item_y),
                    status_style,
                    Rect::new(popup_x + popup_w * 0.38, row_y, popup_w * 0.24, row_h),
                );

                let action_w = action.len() as f32 * cell_size.width;
                let action_x = popup_x + popup_w - item_pad - action_w;
                let action_style = text_style(accent_color);
                renderer.draw_top_text(
                    action,
                    Vec2::new(action_x, item_y),
                    action_style,
                    Rect::new(action_x, row_y, action_w, row_h),
                );
            }
        }
    }

    // ── Hint bar at bottom ──
    let hint_bar_y = popup_y + popup_h - hint_bar_h;
    renderer.draw_top_rect(Rect::new(popup_x, hint_bar_y, popup_w, 1.0), sep_color);
    let hint_text = match page.section {
        ConfigSection::Keybindings => {
            if page.recording.is_some() {
                "Press key combo  Esc cancel"
            } else {
                "Esc close  Tab section  \u{21B5} rebind  Bksp reset"
            }
        }
        ConfigSection::Worktree => {
            if page.worktree_editing || page.copy_files_editing {
                "\u{21B5} done  Esc cancel"
            } else {
                "Esc close  Tab section  \u{2191}\u{2193} select  \u{21B5} edit"
            }
        }
        ConfigSection::Terminal => {
            if page.terminal_scrollback_editing {
                "\u{21B5} done  Esc cancel"
            } else {
                "Esc close  Tab section  \u{2191}\u{2193} select  \u{21B5} edit/toggle"
            }
        }
        ConfigSection::Appearance => {
            "Esc close  Tab section  \u{2191}\u{2193} select  \u{21B5} change"
        }
    };
    let hint_text_w = hint_text.len() as f32 * cell_size.width;
    let hint_text_x = popup_x + (popup_w - hint_text_w) / 2.0;
    let hint_text_y = hint_bar_y + (hint_bar_h - cell_height) / 2.0;
    let hint_style = text_style(hint_text_color);
    let hint_clip = Rect::new(popup_x, hint_bar_y, popup_w, hint_bar_h);
    renderer.draw_top_text(
        hint_text,
        Vec2::new(hint_text_x, hint_text_y),
        hint_style,
        hint_clip,
    );
}
