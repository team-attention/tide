use crate::tide_core::{Color, FileTreeSource, Rect, Renderer, TextStyle, Vec2};

use crate::state::FocusArea;
use crate::theme::*;
use crate::ui::{file_icon, file_tree_disclosure};
use crate::App;

#[cfg_attr(test, derive(Debug))]
#[derive(Clone, Copy)]
pub(crate) struct FileTreeFocusChrome {
    pub panel_border_color: Color,
    pub panel_top_border: f32,
    pub panel_side_border: f32,
    pub panel_shadow_alpha: f32,
    pub header_separator_color: Color,
    pub edge_separator_color: Color,
    pub cursor_fill: Color,
    pub cursor_stroke: Color,
}

#[cfg_attr(test, derive(Debug))]
#[derive(Clone, Copy)]
pub(crate) struct FileTreeRowChrome {
    pub fill: Color,
    pub stroke: Color,
}

pub(crate) fn file_tree_focus_chrome(p: &ThemePalette, tree_focused: bool) -> FileTreeFocusChrome {
    let transparent = Color::new(0.0, 0.0, 0.0, 0.0);
    FileTreeFocusChrome {
        panel_border_color: transparent,
        panel_top_border: 0.0,
        panel_side_border: 0.0,
        panel_shadow_alpha: 0.0,
        header_separator_color: p.border_subtle,
        edge_separator_color: p.border_subtle,
        cursor_fill: if tree_focused {
            p.file_tree_focus_fill
        } else {
            transparent
        },
        cursor_stroke: if tree_focused {
            p.file_tree_focus_stroke
        } else {
            transparent
        },
    }
}

pub(crate) fn file_tree_hover_shows_overlay(
    tree_focused: bool,
    hovered_index: usize,
    cursor_index: usize,
) -> bool {
    !tree_focused || hovered_index != cursor_index
}

pub(crate) fn file_tree_expanded_directory_chrome(p: &ThemePalette) -> FileTreeRowChrome {
    FileTreeRowChrome {
        fill: p.hover_file_tree,
        stroke: Color::new(0.0, 0.0, 0.0, 0.0),
    }
}

pub(crate) fn file_tree_disclosure_color(p: &ThemePalette) -> Color {
    let bg_lum = 0.2126 * p.file_tree_bg.r + 0.7152 * p.file_tree_bg.g + 0.0722 * p.file_tree_bg.b;
    let alpha = if bg_lum > 0.5 { 0.54 } else { 0.84 };
    Color::new(p.tree_icon.r, p.tree_icon.g, p.tree_icon.b, alpha)
}

pub(crate) fn file_tree_name_style(
    p: &ThemePalette,
    status_color: Option<Color>,
    is_directory: bool,
    is_expanded_dir: bool,
    is_cursor_row: bool,
) -> TextStyle {
    let text_color = if let Some(sc) = status_color {
        sc
    } else if is_cursor_row || is_expanded_dir {
        p.tab_text_focused
    } else if is_directory {
        p.tree_dir
    } else {
        p.tree_text
    };

    TextStyle {
        foreground: text_color,
        background: None,
        bold: is_expanded_dir,
        dim: false,
        italic: false,
        underline: false,
    }
}

fn draw_file_tree_row_slab(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    row_rect: Rect,
    chrome: FileTreeRowChrome,
) {
    if chrome.stroke.a > 0.0 {
        renderer.draw_chrome_rounded_rect(row_rect, chrome.stroke, FILE_TREE_ROW_RADIUS);
        let row_inset = 1.0;
        let inner_row = Rect::new(
            row_rect.x + row_inset,
            row_rect.y + row_inset,
            (row_rect.width - row_inset * 2.0).max(0.0),
            (row_rect.height - row_inset * 2.0).max(0.0),
        );
        renderer.draw_chrome_rounded_rect(
            inner_row,
            chrome.fill,
            (FILE_TREE_ROW_RADIUS - row_inset).max(0.0),
        );
    } else {
        renderer.draw_chrome_rounded_rect(row_rect, chrome.fill, FILE_TREE_ROW_RADIUS);
    }
}

fn draw_file_tree_icon_columns(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    name: &str,
    is_dir: bool,
    is_expanded: bool,
    status_color: Option<Color>,
    x: f32,
    text_y: f32,
    cell_w: f32,
    clip: Rect,
) -> f32 {
    if let Some(disclosure) = file_tree_disclosure(is_dir, is_expanded) {
        let disclosure_str: String = std::iter::once(disclosure).collect();
        let disclosure_color = file_tree_disclosure_color(p);
        renderer.draw_chrome_text(
            &disclosure_str,
            Vec2::new(x, text_y),
            TextStyle {
                foreground: disclosure_color,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            clip,
        );
    }

    let icon = file_icon(name, is_dir, is_expanded);
    let icon_color = if is_dir {
        p.tree_dir_icon
    } else if let Some(sc) = status_color {
        sc
    } else {
        p.tree_icon
    };
    let icon_str: String = std::iter::once(icon).collect();
    let icon_x = x + cell_w * 1.5;
    renderer.draw_chrome_text(
        &icon_str,
        Vec2::new(icon_x, text_y),
        TextStyle {
            foreground: icon_color,
            background: None,
            bold: false,
            dim: false,
            italic: false,
            underline: false,
        },
        clip,
    );

    x + cell_w * 3.25
}

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
    let focus_chrome = file_tree_focus_chrome(p, tree_focused);
    let border_color = focus_chrome.panel_border_color;
    let top_border = focus_chrome.panel_top_border;
    let side_border = focus_chrome.panel_side_border;
    let edge_inset = PANE_CORNER_RADIUS;

    let r_border = Rect::new(
        tree_visual_rect.x,
        tree_visual_rect.y + edge_inset,
        tree_visual_rect.width,
        tree_visual_rect.height - edge_inset * 2.0,
    );

    // Shadow when focused (matches pane style)
    if focus_chrome.panel_shadow_alpha > 0.0 {
        let shadow_color = Color::new(
            border_color.r,
            border_color.g,
            border_color.b,
            focus_chrome.panel_shadow_alpha,
        );
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
    renderer.draw_chrome_rounded_rect(
        inset,
        p.file_tree_bg,
        (PANE_CORNER_RADIUS - side_border).max(0.0),
    );

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

        // Header clip rect (full panel width)
        let tree_text_clip = Rect::new(
            tree_visual_rect.x,
            tree_visual_rect.y,
            tree_visual_rect.width - PANE_PADDING,
            tree_visual_rect.height,
        );
        // Entries clip rect: excludes header zone so scrolled entries don't bleed into it
        let entries_clip = Rect::new(
            tree_visual_rect.x,
            tree_visual_rect.y + FILE_TREE_HEADER_HEIGHT,
            tree_visual_rect.width - PANE_PADDING,
            tree_visual_rect.height - FILE_TREE_HEADER_HEIGHT,
        );

        let entries = tree.visible_entries();
        let text_offset_y = (line_height - cell_size.height) / 2.0;
        for (i, entry) in entries.iter().enumerate() {
            // Skip entries that are being inline-renamed
            if app
                .modal
                .file_tree_rename
                .as_ref()
                .is_some_and(|r| r.entry_index == i)
            {
                let y = tree_visual_rect.y + FILE_TREE_HEADER_HEIGHT + i as f32 * line_height
                    - file_tree_scroll;
                if y + line_height < tree_visual_rect.y
                    || y > tree_visual_rect.y + tree_visual_rect.height
                {
                    continue;
                }
                let text_y = y + text_offset_y;
                let x = tree_visual_rect.x + left_padding + entry.depth as f32 * indent_width;

                // Draw disclosure + icon columns before the inline rename input.
                let name_x = draw_file_tree_icon_columns(
                    renderer,
                    p,
                    &entry.entry.name,
                    entry.entry.is_dir,
                    entry.is_expanded,
                    None,
                    x,
                    text_y,
                    cell_size.width,
                    entries_clip,
                );
                let rename = app.modal.file_tree_rename.as_ref().unwrap();
                let input_w = tree_visual_rect.x + tree_visual_rect.width - name_x - PANE_PADDING;
                let input_rect = Rect::new(name_x - 2.0, y, input_w + 2.0, line_height);
                renderer.draw_chrome_rect(input_rect, p.popup_bg);
                // Border
                renderer.draw_chrome_rect(
                    Rect::new(input_rect.x, input_rect.y, input_rect.width, 1.0),
                    p.popup_border,
                );
                renderer.draw_chrome_rect(
                    Rect::new(
                        input_rect.x,
                        input_rect.y + input_rect.height - 1.0,
                        input_rect.width,
                        1.0,
                    ),
                    p.popup_border,
                );
                renderer.draw_chrome_rect(
                    Rect::new(input_rect.x, input_rect.y, 1.0, input_rect.height),
                    p.popup_border,
                );
                renderer.draw_chrome_rect(
                    Rect::new(
                        input_rect.x + input_rect.width - 1.0,
                        input_rect.y,
                        1.0,
                        input_rect.height,
                    ),
                    p.popup_border,
                );
                // Text
                let ts = TextStyle {
                    foreground: p.tab_text_focused,
                    background: None,
                    bold: false,
                    dim: false,
                    italic: false,
                    underline: false,
                };
                renderer.draw_chrome_text(
                    &rename.input.text,
                    Vec2::new(name_x, text_y),
                    ts,
                    entries_clip,
                );
                // Cursor beam
                let cursor_x = name_x
                    + unicode_width::UnicodeWidthStr::width(
                        &rename.input.text[..rename.input.cursor],
                    ) as f32
                        * cell_size.width;
                renderer.draw_chrome_rect(
                    Rect::new(cursor_x, text_y, 1.5, cell_size.height),
                    p.cursor_accent,
                );
                continue;
            }

            let y = tree_visual_rect.y + FILE_TREE_HEADER_HEIGHT + i as f32 * line_height
                - file_tree_scroll;
            if y + line_height < tree_visual_rect.y
                || y > tree_visual_rect.y + tree_visual_rect.height
            {
                continue;
            }

            let text_y = y + text_offset_y;
            let x = tree_visual_rect.x + left_padding + entry.depth as f32 * indent_width;
            let is_cursor_row = tree_focused && app.ft.cursor == i;

            // Expanded directory: subtle row background
            if entry.entry.is_dir && entry.is_expanded && !is_cursor_row {
                let row_rect = Rect::new(
                    tree_visual_rect.x + left_padding / 2.0,
                    y,
                    tree_visual_rect.width - left_padding,
                    line_height,
                );
                draw_file_tree_row_slab(renderer, row_rect, file_tree_expanded_directory_chrome(p));
            }

            if is_cursor_row {
                let row_rect = Rect::new(
                    tree_visual_rect.x + left_padding / 2.0,
                    y,
                    tree_visual_rect.width - left_padding,
                    line_height,
                );
                draw_file_tree_row_slab(
                    renderer,
                    row_rect,
                    FileTreeRowChrome {
                        fill: focus_chrome.cursor_fill,
                        stroke: focus_chrome.cursor_stroke,
                    },
                );
            }

            // Look up git status for this entry (O(1) via pre-computed cache)
            let git_color =
                app.effective_file_tree_git_status(&entry.entry.path, entry.entry.is_dir);

            let status_color = git_color.and_then(|gs| match gs {
                crate::tide_core::FileGitStatus::Modified => Some(p.git_modified),
                crate::tide_core::FileGitStatus::Added
                | crate::tide_core::FileGitStatus::Untracked => Some(p.git_added),
                crate::tide_core::FileGitStatus::Conflict => Some(p.git_conflict),
                crate::tide_core::FileGitStatus::Deleted => None, // deleted files won't appear in tree
            });

            // Git status badge letter (right-aligned)
            let status_badge = git_color.and_then(|gs| match gs {
                crate::tide_core::FileGitStatus::Modified => Some("M"),
                crate::tide_core::FileGitStatus::Added
                | crate::tide_core::FileGitStatus::Untracked => Some("U"),
                crate::tide_core::FileGitStatus::Conflict => Some("!"),
                crate::tide_core::FileGitStatus::Deleted => None,
            });

            // Draw disclosure + icon columns, then the entry name.
            let name_x = draw_file_tree_icon_columns(
                renderer,
                p,
                &entry.entry.name,
                entry.entry.is_dir,
                entry.is_expanded,
                status_color,
                x,
                text_y,
                cell_size.width,
                entries_clip,
            );
            let is_expanded_dir = entry.entry.is_dir && entry.is_expanded;
            let name_style = file_tree_name_style(
                p,
                status_color,
                entry.entry.is_dir,
                is_expanded_dir,
                is_cursor_row,
            );
            renderer.draw_chrome_text(
                &entry.entry.name,
                Vec2::new(name_x, text_y),
                name_style,
                entries_clip,
            );

            // Draw git status badge ("M", "A", "?", "!") right-aligned
            if let Some(badge) = status_badge {
                let badge_x =
                    tree_visual_rect.x + tree_visual_rect.width - PANE_PADDING - cell_size.width;
                let badge_style = TextStyle {
                    foreground: status_color.unwrap_or(p.tree_text),
                    background: None,
                    bold: true,
                    dim: false,
                    italic: false,
                    underline: false,
                };
                renderer.draw_chrome_text(
                    badge,
                    Vec2::new(badge_x, text_y),
                    badge_style,
                    entries_clip,
                );
            }
        }

        // File tree header: drawn AFTER entries so it covers scrolled content
        {
            let header_y = tree_visual_rect.y;
            let header_h = FILE_TREE_HEADER_HEIGHT;
            let header_text_y = header_y + (header_h - cell_size.height) / 2.0;

            // Opaque header background covers any scrolled entries
            renderer.draw_chrome_rect(
                Rect::new(
                    tree_visual_rect.x,
                    header_y,
                    tree_visual_rect.width,
                    header_h,
                ),
                p.file_tree_bg,
            );

            // Folder icon
            renderer.draw_chrome_text(
                "\u{f07b}",
                Vec2::new(tree_visual_rect.x + left_padding, header_text_y),
                TextStyle {
                    foreground: p.tree_dir_icon,
                    background: None,
                    bold: false,
                    dim: false,
                    italic: false,
                    underline: false,
                },
                tree_text_clip,
            );

            // Directory name (last path component)
            let root_name = tree
                .root()
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| tree.root().to_string_lossy().to_string());
            renderer.draw_chrome_text(
                &root_name,
                Vec2::new(
                    tree_visual_rect.x + left_padding + cell_size.width * 2.0,
                    header_text_y,
                ),
                TextStyle {
                    foreground: p.tab_text_focused,
                    background: None,
                    bold: true,
                    dim: false,
                    italic: false,
                    underline: false,
                },
                tree_text_clip,
            );

            // Bottom separator line (accent when focused)
            renderer.draw_chrome_rect(
                Rect::new(
                    tree_visual_rect.x + PANE_PADDING,
                    header_y + header_h - 1.0,
                    tree_visual_rect.width - PANE_PADDING * 2.0,
                    1.0,
                ),
                focus_chrome.header_separator_color,
            );
        }

        renderer.draw_chrome_rect(
            Rect::new(
                tree_visual_rect.x,
                tree_visual_rect.y,
                1.0,
                tree_visual_rect.height,
            ),
            focus_chrome.edge_separator_color,
        );
    }
}
