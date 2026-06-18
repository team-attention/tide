use std::collections::HashSet;

use cosmic_text::{Buffer as CosmicBuffer, Metrics, Shaping};

use crate::tide_core::{Color, Rect, Size, TerminalCell, TextStyle, Vec2};

use super::font::attrs_for_family;
use super::vertex::{GridBgInstance, GridGlyphInstance};
use super::WgpuRenderer;

const PROGRAMMING_LIGATURE_PATTERNS: &[&str] = &[
    "!==", "===", "<=>", "=>", "->", "<-", "<=", ">=", "==", "!=", "::", ":=", "&&", "||",
    "++", "--", "/*", "*/", "</", "/>", "..", "...",
];

fn ligature_run_char(ch: char) -> bool {
    ch.is_ascii_graphic()
}

fn contains_programming_ligature_sequence(text: &str) -> bool {
    PROGRAMMING_LIGATURE_PATTERNS
        .iter()
        .any(|pattern| text.contains(pattern))
}

fn ligature_run_end(cells: &[TerminalCell], start: usize, cols: usize) -> Option<(usize, String)> {
    if start >= cols || start >= cells.len() || !ligature_run_char(cells[start].character) {
        return None;
    }

    let style = cells[start].style;
    let mut end = start;
    let mut text = String::new();
    while end < cols && end < cells.len() {
        let cell = &cells[end];
        if cell.style != style || !ligature_run_char(cell.character) {
            break;
        }
        text.push(cell.character);
        end += 1;
    }

    if end - start >= 2 && contains_programming_ligature_sequence(&text) {
        Some((end, text))
    } else {
        None
    }
}

#[derive(Default)]
pub struct PaneGridCache {
    pub bg_instances: Vec<GridBgInstance>,
    pub glyph_instances: Vec<GridGlyphInstance>,
}

impl PaneGridCache {
    fn clear(&mut self) {
        self.bg_instances.clear();
        self.glyph_instances.clear();
    }
}

/// Tracks a pane's instance range in the assembled grid arrays for incremental updates.
#[derive(Clone, Debug)]
pub(crate) struct PaneGridRange {
    pub bg_inst_start: usize,
    pub bg_inst_count: usize,
    pub glyph_inst_start: usize,
    pub glyph_inst_count: usize,
}

impl WgpuRenderer {
    // ── Per-pane cache API ──────────────────────────────────

    /// Begin recording grid draw calls for a specific pane.
    pub fn begin_pane_grid(&mut self, pane_id: u64) {
        self.active_pane_cache.clear();
        self.active_pane_id = Some(pane_id);
    }

    /// Finish recording and store the pane's cache.
    pub fn end_pane_grid(&mut self) {
        if let Some(id) = self.active_pane_id.take() {
            let mut cache = self.pane_grid_caches.remove(&id).unwrap_or_default();
            std::mem::swap(&mut cache, &mut self.active_pane_cache);
            self.pane_grid_caches.insert(id, cache);
            self.grid_dirty_panes.insert(id);
        }
    }

    /// Remove a pane's cached instances (call when pane is closed).
    pub fn remove_pane_cache(&mut self, pane_id: u64) {
        self.pane_grid_caches.remove(&pane_id);
        self.pane_grid_ranges.remove(&pane_id);
    }

    /// Keep only pane caches whose IDs are present in `pane_ids`.
    pub fn retain_pane_caches(&mut self, pane_ids: &[u64]) {
        let keep: HashSet<u64> = pane_ids.iter().copied().collect();
        self.pane_grid_caches.retain(|id, _| keep.contains(id));
    }

    /// Invalidate all per-pane caches (atlas reset, scale change, etc.).
    pub fn invalidate_all_pane_caches(&mut self) {
        self.pane_grid_caches.clear();
        self.pane_grid_ranges.clear();
        self.last_pane_order.clear();
        self.grid_dirty_panes.clear();
        self.grid_partial_uploads.clear();
    }

    /// Assemble all per-pane caches into the global grid arrays, in the given order.
    /// Uses incremental update when only some panes changed and instance counts match.
    pub fn assemble_grid(&mut self, pane_order: &[u64]) {
        // Nothing dirty and order unchanged → skip entirely
        if self.grid_dirty_panes.is_empty() && pane_order == &self.last_pane_order[..] {
            return;
        }

        // Try incremental path: same pane order, dirty panes' instance counts unchanged
        if pane_order == &self.last_pane_order[..] && !self.grid_dirty_panes.is_empty() {
            let can_incremental = self.grid_dirty_panes.iter().all(|id| {
                match (self.pane_grid_caches.get(id), self.pane_grid_ranges.get(id)) {
                    (Some(cache), Some(range)) => {
                        cache.bg_instances.len() == range.bg_inst_count
                            && cache.glyph_instances.len() == range.glyph_inst_count
                    }
                    _ => false,
                }
            });

            if can_incremental {
                self.assemble_grid_incremental();
                return;
            }
        }

        // Full assembly
        self.grid_bg_instances.clear();
        self.grid_glyph_instances.clear();
        self.pane_grid_ranges.clear();

        for &id in pane_order {
            if let Some(cache) = self.pane_grid_caches.get(&id) {
                let bg_inst_start = self.grid_bg_instances.len();
                let glyph_inst_start = self.grid_glyph_instances.len();

                self.grid_bg_instances
                    .extend_from_slice(&cache.bg_instances);
                self.grid_glyph_instances
                    .extend_from_slice(&cache.glyph_instances);

                self.pane_grid_ranges.insert(
                    id,
                    PaneGridRange {
                        bg_inst_start,
                        bg_inst_count: cache.bg_instances.len(),
                        glyph_inst_start,
                        glyph_inst_count: cache.glyph_instances.len(),
                    },
                );
            }
        }

        // Remove stale caches for panes no longer in the order
        let keep: HashSet<u64> = pane_order.iter().copied().collect();
        self.pane_grid_caches.retain(|id, _| keep.contains(id));

        self.last_pane_order = pane_order.to_vec();
        self.grid_dirty_panes.clear();
        self.grid_partial_uploads.clear();
        self.grid_needs_upload = true;
    }

    /// Incremental assembly: only replace instance data for dirty panes (same counts).
    fn assemble_grid_incremental(&mut self) {
        self.grid_partial_uploads.clear();

        let dirty: Vec<u64> = self.grid_dirty_panes.drain().collect();
        for id in dirty {
            let (cache, range) = match (
                self.pane_grid_caches.get(&id),
                self.pane_grid_ranges.get(&id),
            ) {
                (Some(c), Some(r)) => (c, r.clone()),
                _ => continue,
            };

            // In-place instance replacement
            self.grid_bg_instances[range.bg_inst_start..range.bg_inst_start + range.bg_inst_count]
                .copy_from_slice(&cache.bg_instances);
            self.grid_glyph_instances
                [range.glyph_inst_start..range.glyph_inst_start + range.glyph_inst_count]
                .copy_from_slice(&cache.glyph_instances);

            self.grid_partial_uploads.push(range);
        }
    }

    // ── Grid drawing API ────────────────────────────────────

    /// Draw a rect into the cached grid layer (or active pane cache) as an instance.
    pub fn draw_grid_rect(&mut self, rect: Rect, color: Color) {
        let x = rect.x * self.scale_factor;
        let y = rect.y * self.scale_factor;
        let w = rect.width * self.scale_factor;
        let h = rect.height * self.scale_factor;

        let inst = GridBgInstance {
            position: [x, y],
            size: [w, h],
            color: [color.r, color.g, color.b, color.a],
        };

        if self.active_pane_id.is_some() {
            self.active_pane_cache.bg_instances.push(inst);
        } else {
            self.grid_bg_instances.push(inst);
        }
    }

    /// Check if the atlas was reset since last check (all UV coords are stale).
    pub fn atlas_was_reset(&mut self) -> bool {
        let prev = self.last_atlas_reset_count;
        self.last_atlas_reset_count = self.atlas_reset_count;
        prev != self.atlas_reset_count
    }

    /// Signal that the grid content has changed and needs a full rebuild.
    pub fn invalidate_grid(&mut self) {
        self.grid_bg_instances.clear();
        self.grid_glyph_instances.clear();
        self.grid_needs_upload = true;
    }

    /// Draw a cell into the cached grid layer (or active pane cache) as instances.
    pub fn draw_grid_cell(
        &mut self,
        character: char,
        row: usize,
        col: usize,
        style: TextStyle,
        cell_size: Size,
        offset: Vec2,
    ) {
        let scale = self.scale_factor;
        let em_scale = self.em_scale();
        let px = (offset.x + col as f32 * cell_size.width) * scale;
        let py = (offset.y + row as f32 * cell_size.height) * scale;
        let cw = cell_size.width * scale;
        let ch = cell_size.height * scale;
        let baseline_y = self.baseline_y(ch);

        // Cache glyph first (needs &mut self for font system)
        let glyph_region = if character != ' ' && character != '\0' {
            let region = self.ensure_glyph_cached(character, style.bold, style.italic);
            if !region.is_empty() {
                Some(region)
            } else {
                None
            }
        } else {
            None
        };

        // Determine target arrays
        let (bg, gl) = if self.active_pane_id.is_some() {
            (
                &mut self.active_pane_cache.bg_instances,
                &mut self.active_pane_cache.glyph_instances,
            )
        } else {
            (&mut self.grid_bg_instances, &mut self.grid_glyph_instances)
        };

        // Background instance
        if let Some(bg_color) = style.background {
            bg.push(GridBgInstance {
                position: [px, py],
                size: [cw, ch],
                color: [bg_color.r, bg_color.g, bg_color.b, bg_color.a],
            });
        }

        // Glyph instance (em-relative metrics → physical pixels)
        if let Some(region) = glyph_region {
            let gx = px + region.em_left * em_scale;
            let gy = py + baseline_y - region.em_top * em_scale;
            let gw = region.em_width * em_scale;
            let gh = region.em_height * em_scale;

            gl.push(GridGlyphInstance {
                position: [gx, gy],
                size: [gw, gh],
                uv_min: region.uv_min,
                uv_max: region.uv_max,
                color: [
                    style.foreground.r,
                    style.foreground.g,
                    style.foreground.b,
                    style.foreground.a,
                ],
            });
        }
    }

    /// Draw a terminal row, shaping same-style ASCII runs that contain common
    /// programming ligature sequences.
    pub fn draw_grid_row(
        &mut self,
        cells: &[TerminalCell],
        row: usize,
        cols: usize,
        cell_size: Size,
        offset: Vec2,
    ) {
        let mut col = 0;
        let cols = cols.min(cells.len());
        while col < cols {
            if let Some((end, text)) = ligature_run_end(cells, col, cols) {
                let style = cells[col].style;
                if let Some(glyphs) =
                    self.shape_grid_ligature_run(&text, row, col, style, cell_size, offset)
                {
                    for bg_col in col..end {
                        self.draw_grid_cell(' ', row, bg_col, cells[bg_col].style, cell_size, offset);
                    }
                    if self.active_pane_id.is_some() {
                        self.active_pane_cache.glyph_instances.extend(glyphs);
                    } else {
                        self.grid_glyph_instances.extend(glyphs);
                    }
                    col = end;
                    continue;
                }
            }

            let cell = &cells[col];
            if !((cell.character == '\0' || cell.character == ' ')
                && cell.style.background.is_none())
            {
                self.draw_grid_cell(cell.character, row, col, cell.style, cell_size, offset);
            }
            col += 1;
        }
    }

    fn shape_grid_ligature_run(
        &mut self,
        text: &str,
        row: usize,
        col: usize,
        style: TextStyle,
        cell_size: Size,
        offset: Vec2,
    ) -> Option<Vec<GridGlyphInstance>> {
        let scale = self.scale_factor;
        let font_size_px = self.base_font_size * scale;
        let line_height = (font_size_px * 1.2).ceil();
        let metrics = Metrics::new(font_size_px, line_height);

        let mut attrs = attrs_for_family(&self.font_family);
        if style.bold {
            attrs = attrs.weight(cosmic_text::Weight::BOLD);
        }
        if style.italic {
            attrs = attrs.style(cosmic_text::Style::Italic);
        }

        let mut buffer = CosmicBuffer::new(&mut self.font_system, metrics);
        buffer.set_text(&mut self.font_system, text, attrs, Shaping::Advanced);
        buffer.shape_until_scroll(&mut self.font_system, false);

        let px = (offset.x + col as f32 * cell_size.width) * scale;
        let py = (offset.y + row as f32 * cell_size.height) * scale;
        let ch = cell_size.height * scale;
        let baseline_y = self.baseline_y(ch);
        let em_scale = self.em_scale();

        let mut instances = Vec::new();
        let glyphs = buffer.layout_runs().next()?.glyphs.to_vec();
        for glyph in glyphs {
            let region = self.ensure_shaped_glyph_cached(
                glyph.font_id,
                glyph.glyph_id,
                style.bold,
                style.italic,
            );
            if region.is_empty() {
                continue;
            }

            let glyph_x = glyph.x + glyph.font_size * glyph.x_offset;
            let glyph_y = glyph.y - glyph.font_size * glyph.y_offset;
            let gx = px + glyph_x + region.em_left * em_scale;
            let gy = py + baseline_y + glyph_y - region.em_top * em_scale;
            let gw = region.em_width * em_scale;
            let gh = region.em_height * em_scale;

            instances.push(GridGlyphInstance {
                position: [gx, gy],
                size: [gw, gh],
                uv_min: region.uv_min,
                uv_max: region.uv_max,
                color: [
                    style.foreground.r,
                    style.foreground.g,
                    style.foreground.b,
                    style.foreground.a,
                ],
            });
        }

        if instances.is_empty() {
            None
        } else {
            Some(instances)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tide_core::Color;

    fn cell(ch: char) -> TerminalCell {
        TerminalCell {
            character: ch,
            style: TextStyle {
                foreground: Color::WHITE,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            hyperlink: None,
        }
    }

    #[test]
    fn programming_ligature_detection_recognizes_common_sequences() {
        assert!(contains_programming_ligature_sequence("foo=>bar"));
        assert!(contains_programming_ligature_sequence("value !== other"));
        assert!(contains_programming_ligature_sequence("Vec::<T>"));
        assert!(!contains_programming_ligature_sequence("plain_text"));
    }

    #[test]
    fn ligature_runs_stop_at_style_and_space_boundaries() {
        let mut cells = vec![cell('a'), cell('='), cell('>'), cell(' '), cell('-'), cell('>')];
        cells[2].style.bold = true;

        assert_eq!(ligature_run_end(&cells, 0, cells.len()), None);
        assert_eq!(ligature_run_end(&cells, 4, cells.len()), Some((6, "->".to_string())));
    }
}
