use unicode_width::UnicodeWidthChar;

use crate::tide_core::{Color, Rect, Renderer, TextStyle, Vec2};

use crate::state::drag_types::HoverTarget;
use crate::theme::*;
use crate::ui::file_icon;
use crate::App;
use crate::AppCorePort;

use super::{
    draw_cursor_beam, draw_input_with_preedit, draw_popup_rounded_bg, draw_popup_scrim, text_style,
    visual_width,
};

fn with_alpha(color: Color, alpha: f32) -> Color {
    Color::new(color.r, color.g, color.b, alpha)
}

/// Truncate to `max_cells` display columns, keeping the front (filenames,
/// signatures) and marking the cut with an ellipsis.
fn ellipsize_end(s: &str, max_cells: usize) -> String {
    if max_cells == 0 || visual_width(s) <= max_cells {
        return s.to_string();
    }
    let budget = max_cells.saturating_sub(1);
    let mut out = String::new();
    let mut w = 0usize;
    for ch in s.chars() {
        let cw = ch.width().unwrap_or(1);
        if w + cw > budget {
            break;
        }
        out.push(ch);
        w += cw;
    }
    out.push('…');
    out
}

/// Truncate to `max_cells`, keeping the tail — used for paths so the filename
/// and line number (the useful part) stay visible.
fn ellipsize_front(s: &str, max_cells: usize) -> String {
    if max_cells == 0 || visual_width(s) <= max_cells {
        return s.to_string();
    }
    let budget = max_cells.saturating_sub(1);
    let chars: Vec<char> = s.chars().collect();
    let mut w = 0usize;
    let mut start = chars.len();
    for (i, ch) in chars.iter().enumerate().rev() {
        let cw = ch.width().unwrap_or(1);
        if w + cw > budget {
            break;
        }
        w += cw;
        start = i;
    }
    let mut out = String::from('…');
    out.extend(chars[start..].iter());
    out
}

/// The filename portion of a `path:line` location string (for the row icon).
fn loc_filename(loc: &str) -> &str {
    let path = loc.rsplit_once(':').map(|(p, _)| p).unwrap_or(loc);
    path.rsplit('/').next().unwrap_or(path)
}

/// Draw `text`, emphasizing the first case-insensitive occurrence of
/// `query_lower` (bold + the accent color) the way VS Code highlights matches.
#[allow(clippy::too_many_arguments)]
fn draw_match_text(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    text: &str,
    query_lower: &str,
    pos: Vec2,
    cell_w: f32,
    base: Color,
    accent: Color,
    clip: Rect,
) {
    let base_style = text_style(base);
    let orig: Vec<char> = text.chars().collect();
    let lower: Vec<char> = text.to_lowercase().chars().collect();
    // Skip emphasis if lowercasing changed the char count (keeps index mapping
    // exact); plain queries over ASCII/Hangul never hit this.
    if query_lower.is_empty() || lower.len() != orig.len() {
        renderer.draw_top_text(text, pos, base_style, clip);
        return;
    }

    let hi_style = TextStyle {
        foreground: accent,
        background: None,
        bold: true,
        dim: false,
        italic: false,
        underline: false,
    };
    let mask = subsequence_highlight_mask(&lower, query_lower);
    let mut cx = pos.x;
    let mut run = String::new();
    let mut run_hi = false;
    for (i, &ch) in orig.iter().enumerate() {
        if mask[i] != run_hi && !run.is_empty() {
            let style = if run_hi { hi_style } else { base_style };
            renderer.draw_top_text(&run, Vec2::new(cx, pos.y), style, clip);
            cx += visual_width(&run) as f32 * cell_w;
            run.clear();
        }
        run_hi = mask[i];
        run.push(ch);
    }
    if !run.is_empty() {
        let style = if run_hi { hi_style } else { base_style };
        renderer.draw_top_text(&run, Vec2::new(cx, pos.y), style, clip);
    }
}

/// Greedy left-to-right subsequence match: returns, per character of
/// `lower_text`, whether it is part of the matched run for `query_lower` — the
/// same emphasis VS Code applies, so fuzzy queries ("appfsz" → apply_font_size)
/// and plain substrings both light up.
fn subsequence_highlight_mask(lower_text: &[char], query_lower: &str) -> Vec<bool> {
    let mut mask = vec![false; lower_text.len()];
    let qchars: Vec<char> = query_lower.chars().collect();
    if qchars.is_empty() {
        return mask;
    }

    // 1. Prefer a clean contiguous substring — this is the common case (typing
    //    "TideMcpToolSurfaceAdapter" should light up that exact run, not the
    //    stray 't' in "create…"). Pick the occurrence at the strongest boundary
    //    (start-of-word / camelCase hump) so the highlight reads naturally.
    if qchars.len() <= lower_text.len() {
        let mut best: Option<(u8, usize)> = None;
        for start in 0..=(lower_text.len() - qchars.len()) {
            if lower_text[start..start + qchars.len()] == qchars[..] {
                let boundary = start == 0
                    || matches!(lower_text[start - 1], ' ' | '_' | '-' | '.' | '/' | ':' | '<' | '(');
                let rank = if boundary { 0u8 } else { 1u8 };
                if best.map_or(true, |(r, _)| rank < r) {
                    best = Some((rank, start));
                    if rank == 0 {
                        break;
                    }
                }
            }
        }
        if let Some((_, start)) = best {
            for slot in mask.iter_mut().skip(start).take(qchars.len()) {
                *slot = true;
            }
            return mask;
        }
    }

    // 2. Fall back to a greedy subsequence for true fuzzy queries
    //    ("appfs" → apply_font_size).
    let mut qi = 0usize;
    for (i, &ch) in lower_text.iter().enumerate() {
        if qi < qchars.len() && qchars[qi] == ch {
            mask[i] = true;
            qi += 1;
        }
    }
    mask
}

#[cfg(test)]
mod tests {
    use super::subsequence_highlight_mask;

    fn lower(s: &str) -> Vec<char> {
        s.to_lowercase().chars().collect()
    }

    #[test]
    fn fuzzy_subsequence_highlights_matched_chars() {
        // "appfsz" fuzzily matches apply_font_size → a,p,p, f(ont), s(ize), z? no z;
        // use a real subsequence "appfs".
        let text = lower("apply_font_size");
        let mask = subsequence_highlight_mask(&text, "appfs");
        let hit: String = text
            .iter()
            .zip(&mask)
            .filter(|(_, &m)| m)
            .map(|(c, _)| *c)
            .collect();
        assert_eq!(hit, "appfs");
    }

    #[test]
    fn contiguous_substring_is_fully_highlighted() {
        let text = lower("ProviderReadinessBlockerKind");
        let mask = subsequence_highlight_mask(&text, "providerread");
        // The first 12 chars (ProviderRead) are the contiguous match.
        assert!(mask[..12].iter().all(|&m| m));
        assert!(!mask[12]);
    }

    #[test]
    fn no_match_highlights_nothing() {
        let text = lower("hello");
        let mask = subsequence_highlight_mask(&text, "xyz");
        assert!(mask.iter().all(|&m| !m));
    }

    #[test]
    fn contiguous_run_wins_over_scattered_subsequence() {
        // The reported bug: typing the full name highlighted the stray 't' in
        // "create" plus a scattered tail. The contiguous run must win instead.
        let text = lower("createTideMcpToolSurfaceAdapter");
        let mask = subsequence_highlight_mask(&text, "tidemcptoolsurfaceadapter");
        assert!(
            mask[..6].iter().all(|&m| !m),
            "'create' prefix must stay unhighlighted"
        );
        assert!(
            mask[6..].iter().all(|&m| m),
            "the contiguous TideMcpToolSurfaceAdapter run must be highlighted"
        );
    }

    #[test]
    fn substring_prefers_word_boundary_occurrence() {
        // "on" appears twice; the standalone word should win over the one
        // buried inside "button".
        let text = lower("button on");
        let mask = subsequence_highlight_mask(&text, "on");
        // index 7,8 = the standalone "on" (after the space).
        assert!(mask[7] && mask[8], "boundary 'on' highlighted");
        assert!(!mask[4] && !mask[5], "the 'on' inside 'button' not highlighted");
    }
}

/// Render file finder UI on top layer (visible regardless of tab state).
pub(super) fn render_file_finder(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    let finder = match app.modal.file_finder {
        Some(ref f) => f,
        None => return,
    };

    // Dim overlay (scrim)
    draw_popup_scrim(renderer, app.logical_size(), p.popup_scrim);

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let logical = app.logical_size();
    let geo = finder.geometry(cell_height, logical.width, logical.height);

    let line_height = geo.line_height;
    let popup_w = geo.popup_w;
    let popup_x = geo.popup_x;
    let popup_y = geo.popup_y;
    let popup_h = geo.popup_h;
    let input_h = geo.input_h;
    let max_visible = geo.max_visible;

    let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);

    // Shadow — deeper so the palette reads as a floating panel above the scrim.
    let shadow_color = Color::new(0.0, 0.0, 0.0, 0.45);
    renderer.draw_top_shadow(popup_rect, shadow_color, 10.0, 48.0, 0.0);

    // Background + border (rounded)
    draw_popup_rounded_bg(
        renderer,
        popup_rect,
        p.popup_bg,
        p.popup_border,
        POPUP_CORNER_RADIUS,
    );

    let ts = text_style(p.tab_text_focused);
    let muted_style = text_style(p.tab_text);
    let item_pad = 12.0_f32;

    // Search input — with search icon
    let input_y = popup_y + 2.0;
    let input_clip = Rect::new(
        popup_x + item_pad,
        input_y,
        popup_w - 2.0 * item_pad,
        input_h,
    );
    let text_y = input_y + (input_h - cell_height) / 2.0;
    let icon_x = popup_x + 14.0;
    let icon_style = text_style(Color::new(0.47, 0.47, 0.50, 1.0));

    // Search icon
    renderer.draw_top_text(
        "\u{f002}",
        Vec2::new(icon_x, text_y),
        icon_style,
        input_clip,
    );

    // Align the typed query with the result column below it.
    let text_x = icon_x + cell_size.width * 1.7 + 6.0;
    let text_clip = Rect::new(
        text_x,
        input_y,
        popup_w - item_pad - 2.0 * cell_size.width,
        input_h,
    );

    // Query text, with the in-progress IME composition (Korean, etc.) shown
    // inline at the caret — the same treatment as every other Tide text input.
    let beam_x = if finder.input.is_empty() && app.ime.preedit.is_empty() {
        renderer.draw_top_text(
            finder.placeholder_text(),
            Vec2::new(text_x, text_y),
            muted_style,
            text_clip,
        );
        text_x
    } else {
        draw_input_with_preedit(
            renderer,
            &finder.input.text,
            finder.input.cursor,
            &app.ime.preedit,
            Vec2::new(text_x, text_y),
            cell_size,
            text_clip,
            ts,
            p.ime_preedit_bg,
            p.ime_preedit_fg,
        )
    };

    // Match count
    let count_text = format!("{}/{}", finder.filtered.len(), finder.total_candidates());
    let count_w = count_text.len() as f32 * cell_size.width;
    let count_x = popup_x + popup_w - count_w - item_pad;
    renderer.draw_top_text(
        &count_text,
        Vec2::new(count_x, text_y),
        muted_style,
        input_clip,
    );

    let mode_text = finder.mode_label();
    let mode_w = mode_text.len() as f32 * cell_size.width;
    let mode_pad_x = 7.0_f32;
    let mode_h = cell_height + 4.0;
    let mode_x = count_x - mode_w - item_pad - mode_pad_x * 2.0;
    let mode_rect = Rect::new(
        mode_x,
        text_y + (cell_height - mode_h) / 2.0,
        mode_w + mode_pad_x * 2.0,
        mode_h,
    );
    let badge_accent = Color::new(0.86, 0.78, 0.60, 1.0);
    renderer.draw_top_rounded_rect(mode_rect, with_alpha(badge_accent, 0.15), 5.0);
    renderer.draw_top_text(
        mode_text,
        Vec2::new(mode_x + mode_pad_x, text_y),
        text_style(with_alpha(badge_accent, 0.9)),
        input_clip,
    );

    // Cursor beam — after the committed prefix plus the in-progress composition.
    draw_cursor_beam(renderer, beam_x, text_y, cell_height, p.cursor_accent);

    // Separator line below input
    let sep_y = input_y + input_h;
    let sep_rect = Rect::new(
        popup_x + POPUP_SEPARATOR_INSET,
        sep_y,
        popup_w - 2.0 * POPUP_SEPARATOR_INSET,
        POPUP_SEPARATOR,
    );
    renderer.draw_top_rect(sep_rect, p.popup_border);

    // File list
    let list_top = geo.list_top;
    let list_clip = Rect::new(
        popup_x + item_pad,
        list_top,
        popup_w - 2.0 * item_pad,
        max_visible as f32 * line_height,
    );

    // Query (minus its mode prefix) for in-row match emphasis.
    let query_lower = finder
        .input
        .text
        .strip_prefix('@')
        .or_else(|| finder.input.text.strip_prefix('#'))
        .or_else(|| finder.input.text.strip_prefix('/'))
        .unwrap_or(finder.input.text.as_str())
        .to_lowercase();

    let cell_w = cell_size.width;
    let row_left = popup_x + 14.0;
    let icon_x = row_left;
    let text_x = icon_x + cell_w * 1.7 + 6.0;
    let row_right = popup_x + popup_w - 14.0;

    // Warm-monochrome palette: hierarchy via brightness, one gold accent.
    let primary_dim = Color::new(0.82, 0.82, 0.84, 1.0);
    let dir_dim = Color::new(0.46, 0.46, 0.49, 1.0);
    let icon_dim = Color::new(0.47, 0.47, 0.50, 1.0);
    let accent = Color::new(0.86, 0.78, 0.60, 1.0);

    for vi in 0..max_visible {
        let fi = finder.scroll_offset + vi;
        if fi >= finder.filtered.len() {
            break;
        }
        let y = list_top + vi as f32 * line_height;
        let is_selected = fi == finder.selected;
        let is_hovered = matches!(
            app.interaction.hover_target,
            Some(HoverTarget::FileFinderItem(idx)) if idx == fi
        );

        // Row highlight + an active accent bar on the selected row.
        if is_selected {
            let sel_rect = Rect::new(popup_x + 6.0, y + 2.0, popup_w - 12.0, line_height - 4.0);
            renderer.draw_top_rounded_rect(
                sel_rect,
                Color::new(1.0, 1.0, 1.0, 0.10),
                FILE_TREE_ROW_RADIUS,
            );
            let bar = Rect::new(popup_x + 6.0, y + 5.0, 2.5, line_height - 10.0);
            renderer.draw_top_rounded_rect(bar, accent, 1.5);
        } else if is_hovered {
            let sel_rect = Rect::new(popup_x + 6.0, y + 2.0, popup_w - 12.0, line_height - 4.0);
            renderer.draw_top_rounded_rect(
                sel_rect,
                Color::new(1.0, 1.0, 1.0, 0.045),
                FILE_TREE_ROW_RADIUS,
            );
        }

        let ty = y + (line_height - cell_height) / 2.0;
        let (primary, secondary) = finder.row_parts(fi).unwrap_or_default();

        // Left icon: a real file-type icon for files and text hits, a symbol
        // glyph for symbol modes.
        let (icon_char, icon_color) = match finder.mode {
            crate::state::FileFinderMode::Files => {
                (file_icon(loc_filename(&primary), false, false), icon_dim)
            }
            crate::state::FileFinderMode::Symbols
            | crate::state::FileFinderMode::WorkspaceSymbols => ('\u{f121}', icon_dim),
            crate::state::FileFinderMode::WorkspaceSearch => {
                (file_icon(loc_filename(&secondary), false, false), icon_dim)
            }
        };
        renderer.draw_top_text(
            &icon_char.to_string(),
            Vec2::new(icon_x, ty),
            text_style(icon_color),
            list_clip,
        );

        let primary_color = if is_selected { p.tab_text_focused } else { primary_dim };

        match finder.mode {
            crate::state::FileFinderMode::Files => {
                // Filename bright, parent directory dim (Quick Open hierarchy).
                let avail = ((row_right - text_x) / cell_w).max(0.0) as usize;
                let (dir, name) = match primary.rfind('/') {
                    Some(i) => (&primary[..=i], &primary[i + 1..]),
                    None => ("", primary.as_str()),
                };
                let dir_budget = avail.saturating_sub(visual_width(name));
                let dir_disp = ellipsize_front(dir, dir_budget);
                let mut cx = text_x;
                if !dir_disp.is_empty() {
                    renderer.draw_top_text(
                        &dir_disp,
                        Vec2::new(cx, ty),
                        text_style(dir_dim),
                        list_clip,
                    );
                    cx += visual_width(&dir_disp) as f32 * cell_w;
                }
                let name_disp =
                    ellipsize_end(name, avail.saturating_sub(visual_width(&dir_disp)));
                let name_style = TextStyle {
                    foreground: primary_color,
                    background: None,
                    bold: is_selected,
                    dim: false,
                    italic: false,
                    underline: false,
                };
                renderer.draw_top_text(&name_disp, Vec2::new(cx, ty), name_style, list_clip);
            }
            _ => {
                // Primary (signature / matched line) keeps priority; the path is
                // capped to ~40% and trimmed from the front so the filename and
                // line number stay readable.
                let total = ((row_right - text_x) / cell_w).max(0.0) as usize;
                let sec_disp = if secondary.is_empty() {
                    String::new()
                } else {
                    ellipsize_front(&secondary, (total * 40) / 100)
                };
                let sec_w = visual_width(&sec_disp);
                let gap = if sec_w > 0 { 2 } else { 0 };
                let prim_disp = ellipsize_end(&primary, total.saturating_sub(sec_w + gap));
                draw_match_text(
                    renderer,
                    &prim_disp,
                    &query_lower,
                    Vec2::new(text_x, ty),
                    cell_w,
                    primary_color,
                    accent,
                    list_clip,
                );
                if sec_w > 0 {
                    let sec_x = row_right - sec_w as f32 * cell_w;
                    renderer.draw_top_text(
                        &sec_disp,
                        Vec2::new(sec_x, ty),
                        text_style(dir_dim),
                        list_clip,
                    );
                }
            }
        }
    }

    // Empty-state row: a transient loading label while a background scan runs
    // (FileFinder `/` search or `#` symbols), otherwise "No matches".
    if finder.filtered.is_empty() {
        let label = if finder.searching {
            "Searching…"
        } else if finder.workspace_symbols_loading {
            "Loading symbols…"
        } else if !finder.input.text.is_empty() {
            "No matches"
        } else {
            ""
        };
        if !label.is_empty() {
            let ty = list_top + (line_height - cell_height) / 2.0;
            renderer.draw_top_text(
                label,
                Vec2::new(text_x, ty),
                text_style(dir_dim),
                list_clip,
            );
        }
    }

    if finder.filtered.len() > max_visible {
        let track_h = max_visible as f32 * line_height;
        let track_x = popup_x + popup_w - 5.0;
        let track = Rect::new(track_x, list_top, 2.0, track_h);
        renderer.draw_top_rounded_rect(track, p.scrollbar_track, 1.0);

        let max_offset = finder.filtered.len().saturating_sub(max_visible);
        if max_offset > 0 {
            let thumb_h = (track_h * (max_visible as f32 / finder.filtered.len() as f32)).max(18.0);
            let progress = finder.scroll_offset as f32 / max_offset as f32;
            let thumb_y = list_top + (track_h - thumb_h) * progress;
            let thumb = Rect::new(track_x - 1.0, thumb_y, 4.0, thumb_h);
            renderer.draw_top_rounded_rect(thumb, p.scrollbar_thumb, 2.0);
        }
    }
}
