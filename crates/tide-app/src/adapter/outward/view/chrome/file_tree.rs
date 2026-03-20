use crate::tide_core::{FileTreeSource, Rect, Renderer, TextStyle, Vec2};

use crate::theme::*;
use crate::ui::file_icon;
use crate::state::FocusArea;
use crate::App;
use crate::AppCorePort;

/// Render the file tree panel (rounded border, header, entries, cursor highlight).
pub(super) fn render_file_tree(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    logical: crate::tide_core::Size,
    file_tree_scroll: f32,
) {
    let tree_visual_rect = app.ft.rect.unwrap_or(Rect::new(
        0.0,
        app.window.top_inset,
        app.ft.width,
        logical.height - app.window.top_inset,
    ));

    let tree_focused = app.focus.focus_area == FocusArea::FileTree;
    let border_color = if tree_focused { p.border_focused } else { p.border_subtle };
    let top_border = if tree_focused { 2.0 } else { 1.0 };
    let side_border = if tree_focused { 2.0_f32 } else { 1.0_f32 };
    let edge_inset = PANE_CORNER_RADIUS;

    let r_border = Rect::new(
        tree_visual_rect.x,
        tree_visual_rect.y + edge_inset,
        tree_visual_rect.width,
        tree_visual_rect.height - edge_inset * 2.0,
    );

    // Shadow when focused (matches pane style)
    if tree_focused {
        let shadow_color = crate::tide_core::Color::new(0.769, 0.722, 0.651, 0.25);
        renderer.draw_chrome_shadow(r_border, shadow_color, PANE_CORNER_RADIUS, 16.0, -4.0);
    }

    // Outer rounded rect (border)
    renderer.draw_chrome_rounded_rect(r_border, border_color, PANE_CORNER_RADIUS);
    // Inner rounded rect (fill)
    let inset = Rect::new(
        r_border.x + side_border,
        r_border.y + top_border,
        r_border.width - 2.0 * side_border,
        r_border.height - top_border - side_border,
    );
    renderer.draw_chrome_rounded_rect(inset, p.file_tree_bg, (PANE_CORNER_RADIUS - side_border).max(0.0));

    // Shadow tree_visual_rect with inset version so content renders within the border
    let tree_visual_rect = Rect::new(
        tree_visual_rect.x,
        tree_visual_rect.y + edge_inset,
        tree_visual_rect.width,
        tree_visual_rect.height - edge_inset * 2.0,
    );

    if let Some(tree) = app.ft.tree.as_ref() {
        let cell_size = renderer.cell_size();
        let line_height = cell_size.height * FILE_TREE_LINE_SPACING;
        let indent_width = cell_size.width * 1.5;
        let left_padding = PANE_PADDING;

        // Text clip rect: inset with padding on both sides (matches left_padding)
        let tree_text_clip = Rect::new(
            tree_visual_rect.x,
            tree_visual_rect.y,
            tree_visual_rect.width - PANE_PADDING,
            tree_visual_rect.height,
        );

        // File tree header: root directory name
        {
            let header_y = tree_visual_rect.y;
            let header_h = FILE_TREE_HEADER_HEIGHT;
            let header_text_y = header_y + (header_h - cell_size.height) / 2.0;

            // Folder icon
            renderer.draw_chrome_text(
                "\u{f07b}",
                Vec2::new(tree_visual_rect.x + left_padding, header_text_y),
                TextStyle {
                    foreground: p.tree_dir_icon,
                    background: None,
                    bold: false, dim: false, italic: false, underline: false,
                },
                tree_text_clip,
            );

            // Directory name (last path component)
            let root_name = tree.root()
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| tree.root().to_string_lossy().to_string());
            renderer.draw_chrome_text(
                &root_name,
                Vec2::new(tree_visual_rect.x + left_padding + cell_size.width * 2.0, header_text_y),
                TextStyle {
                    foreground: p.tab_text_focused,
                    background: None,
                    bold: true, dim: false, italic: false, underline: false,
                },
                tree_text_clip,
            );

            // Bottom separator line (accent when focused)
            let sep_color = if tree_focused {
                let accent = p.dock_tab_underline;
                crate::tide_core::Color::new(accent.r, accent.g, accent.b, 0.35)
            } else {
                p.border_subtle
            };
            renderer.draw_chrome_rect(
                Rect::new(tree_visual_rect.x + PANE_PADDING, header_y + header_h - 1.0, tree_visual_rect.width - PANE_PADDING * 2.0, 1.0),
                sep_color,
            );
        }

        let entries = tree.visible_entries();
        let text_offset_y = (line_height - cell_size.height) / 2.0;
        for (i, entry) in entries.iter().enumerate() {
            // Skip entries that are being inline-renamed
            if app.modal.file_tree_rename.as_ref().is_some_and(|r| r.entry_index == i) {
                let y = tree_visual_rect.y + FILE_TREE_HEADER_HEIGHT + i as f32 * line_height - file_tree_scroll;
                if y + line_height < tree_visual_rect.y || y > tree_visual_rect.y + tree_visual_rect.height {
                    continue;
                }
                let text_y = y + text_offset_y;
                let x = tree_visual_rect.x + left_padding + entry.depth as f32 * indent_width;

                // Draw icon normally
                let icon = file_icon(&entry.entry.name, entry.entry.is_dir, entry.is_expanded);
                let icon_style = TextStyle {
                    foreground: p.tree_icon,
                    background: None,
                    bold: false, dim: false, italic: false, underline: false,
                };
                let icon_str: String = std::iter::once(icon).collect();
                renderer.draw_chrome_text(&icon_str, Vec2::new(x, text_y), icon_style, tree_text_clip);

                // Draw inline rename input
                let name_x = x + cell_size.width * 2.0;
                let rename = app.modal.file_tree_rename.as_ref().unwrap();
                let input_w = tree_visual_rect.x + tree_visual_rect.width - name_x - PANE_PADDING;
                let input_rect = Rect::new(name_x - 2.0, y, input_w + 2.0, line_height);
                renderer.draw_chrome_rect(input_rect, p.popup_bg);
                // Border
                renderer.draw_chrome_rect(Rect::new(input_rect.x, input_rect.y, input_rect.width, 1.0), p.popup_border);
                renderer.draw_chrome_rect(Rect::new(input_rect.x, input_rect.y + input_rect.height - 1.0, input_rect.width, 1.0), p.popup_border);
                renderer.draw_chrome_rect(Rect::new(input_rect.x, input_rect.y, 1.0, input_rect.height), p.popup_border);
                renderer.draw_chrome_rect(Rect::new(input_rect.x + input_rect.width - 1.0, input_rect.y, 1.0, input_rect.height), p.popup_border);
                // Text
                let ts = TextStyle {
                    foreground: p.tab_text_focused,
                    background: None,
                    bold: false, dim: false, italic: false, underline: false,
                };
                renderer.draw_chrome_text(&rename.input.text, Vec2::new(name_x, text_y), ts, tree_text_clip);
                // Cursor beam
                let cursor_x = name_x + unicode_width::UnicodeWidthStr::width(&rename.input.text[..rename.input.cursor]) as f32 * cell_size.width;
                renderer.draw_chrome_rect(Rect::new(cursor_x, text_y, 1.5, cell_size.height), p.cursor_accent);
                continue;
            }

            let y = tree_visual_rect.y + FILE_TREE_HEADER_HEIGHT + i as f32 * line_height - file_tree_scroll;
            if y + line_height < tree_visual_rect.y || y > tree_visual_rect.y + tree_visual_rect.height {
                continue;
            }

            let text_y = y + text_offset_y;
            let x = tree_visual_rect.x + left_padding + entry.depth as f32 * indent_width;

            // Expanded directory: draw row background (per Tide.pen)
            if entry.entry.is_dir && entry.is_expanded {
                let row_rect = Rect::new(
                    tree_visual_rect.x + left_padding / 2.0,
                    y,
                    tree_visual_rect.width - left_padding,
                    line_height,
                );
                renderer.draw_chrome_rounded_rect(row_rect, p.tree_row_active, FILE_TREE_ROW_RADIUS);
            }

            // Look up git status for this entry (O(1) via pre-computed cache)
            let git_color = if entry.entry.is_dir {
                app.ft.dir_git_status.get(&entry.entry.path).copied()
            } else {
                app.ft.git_status.get(&entry.entry.path).copied()
            };

            let status_color = git_color.and_then(|gs| match gs {
                crate::tide_core::FileGitStatus::Modified => Some(p.git_modified),
                crate::tide_core::FileGitStatus::Added | crate::tide_core::FileGitStatus::Untracked => Some(p.git_added),
                crate::tide_core::FileGitStatus::Conflict => Some(p.git_conflict),
                crate::tide_core::FileGitStatus::Deleted => None, // deleted files won't appear in tree
            });

            // Git status badge letter (right-aligned)
            let status_badge = git_color.and_then(|gs| match gs {
                crate::tide_core::FileGitStatus::Modified => Some("M"),
                crate::tide_core::FileGitStatus::Added | crate::tide_core::FileGitStatus::Untracked => Some("U"),
                crate::tide_core::FileGitStatus::Conflict => Some("!"),
                crate::tide_core::FileGitStatus::Deleted => None,
            });

            // Icon -- directories always keep standard icon color (per Tide.pen)
            let icon = file_icon(&entry.entry.name, entry.entry.is_dir, entry.is_expanded);
            let icon_color = if entry.entry.is_dir {
                p.tree_dir_icon
            } else if let Some(sc) = status_color {
                sc
            } else {
                p.tree_icon
            };

            // Draw icon
            let icon_style = TextStyle {
                foreground: icon_color,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            };
            let icon_str: String = std::iter::once(icon).collect();
            renderer.draw_chrome_text(
                &icon_str,
                Vec2::new(x, text_y),
                icon_style,
                tree_text_clip,
            );

            // Draw name after icon + space
            let name_x = x + cell_size.width * 2.0;
            let is_expanded_dir = entry.entry.is_dir && entry.is_expanded;
            let text_color = if let Some(sc) = status_color {
                sc
            } else if is_expanded_dir {
                p.tab_text_focused
            } else if entry.entry.is_dir {
                p.tree_dir
            } else {
                p.tree_text
            };
            let name_style = TextStyle {
                foreground: text_color,
                background: None,
                bold: is_expanded_dir,
                dim: false,
                italic: false,
                underline: false,
            };
            renderer.draw_chrome_text(
                &entry.entry.name,
                Vec2::new(name_x, text_y),
                name_style,
                tree_text_clip,
            );

            // Draw git status badge ("M", "A", "?", "!") right-aligned
            if let Some(badge) = status_badge {
                let badge_x = tree_visual_rect.x + tree_visual_rect.width - PANE_PADDING - cell_size.width;
                let badge_style = TextStyle {
                    foreground: status_color.unwrap_or(p.tree_text),
                    background: None,
                    bold: true, dim: false, italic: false, underline: false,
                };
                renderer.draw_chrome_text(badge, Vec2::new(badge_x, text_y), badge_style, tree_text_clip);
            }
        }

        // File tree keyboard cursor highlight (when focus_area == FileTree)
        if app.focus.focus_area == FocusArea::FileTree && app.ft.cursor < entries.len() {
            let cursor_y = tree_visual_rect.y + FILE_TREE_HEADER_HEIGHT + app.ft.cursor as f32 * line_height - file_tree_scroll;
            if cursor_y + line_height > tree_visual_rect.y && cursor_y < tree_visual_rect.y + tree_visual_rect.height {
                let row_rect = Rect::new(
                    tree_visual_rect.x + left_padding / 2.0,
                    cursor_y,
                    tree_visual_rect.width - left_padding,
                    line_height,
                );
                // Warm accent row highlight (more visible than hover)
                let accent = p.dock_tab_underline;
                let row_bg = crate::tide_core::Color::new(accent.r, accent.g, accent.b, 0.12);
                renderer.draw_chrome_rounded_rect(row_rect, row_bg, FILE_TREE_ROW_RADIUS);
                // Left accent bar on cursor row
                renderer.draw_chrome_rect(
                    Rect::new(tree_visual_rect.x + 2.0, cursor_y + 2.0, 2.0, line_height - 4.0),
                    accent,
                );
            }
        }
    }
}
