mod chrome;
mod cursor;
mod grid;
pub(crate) mod header;
mod hover;
mod ime;
pub(crate) mod overlays;
pub(crate) mod ui;

#[cfg(test)]
pub(crate) use chrome::{
    file_tree_focus_chrome, file_tree_hover_shows_overlay, file_tree_name_style,
    integration_toggle_notification_indicator_color, pane_surface_attention_status,
    workspace_item_indicator_color, workspace_item_indicator_status,
};
#[cfg(test)]
pub(crate) use cursor::editor_selection_rects;

use crate::tide_core::{Rect, Renderer};

use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;
use crate::AppCorePort;
use crate::LayoutPort;

pub(crate) fn wrapped_agent_blink_time(
    now: std::time::Instant,
    blink_origin: std::time::Instant,
    has_blinking: bool,
) -> Option<f64> {
    has_blinking.then(|| now.duration_since(blink_origin).as_secs_f64())
}

/// Compute the bar offset for a pane. Returns CONFLICT_BAR_HEIGHT if a notification bar
/// (conflict or save confirm) is visible, else 0.
pub(super) fn bar_offset_for(
    pane_id: crate::tide_core::PaneId,
    panes: &std::collections::HashMap<crate::tide_core::PaneId, PaneKind>,
    save_confirm: &Option<crate::SaveConfirmState>,
) -> f32 {
    if let Some(ref sc) = save_confirm {
        if sc.pane_id == pane_id {
            return CONFLICT_BAR_HEIGHT;
        }
    }
    if let Some(PaneKind::Editor(pane)) = panes.get(&pane_id) {
        if pane.needs_notification_bar() {
            return CONFLICT_BAR_HEIGHT;
        }
    }
    0.0
}

impl App {
    /// Poll the render thread for completed frames.  Returns the renderer
    /// to the GPU port and updates `drawable_wait_us`.
    pub(crate) fn poll_render_result(&mut self) {
        // Collect results from render thread into a vec to avoid overlapping borrows
        let results: Vec<_> = self
            .ports
            .gpu
            .render_thread()
            .map(|rt| {
                let mut v = Vec::new();
                while let Ok(result) = rt.result_rx.try_recv() {
                    v.push(result);
                }
                v
            })
            .unwrap_or_default();
        let mut surface_lost = false;
        for result in results {
            self.ports.gpu.set_drawable_wait_us(result.drawable_wait_us);
            if result.surface_lost {
                surface_lost = true;
            }
            self.ports.gpu.restore_renderer(result.renderer);
        }
        // Apply any font size change that was queued while the renderer was away.
        self.flush_pending_font_size();
        if surface_lost {
            self.reconfigure_surface();
        }
    }

    /// Build all vertex data and send to the render thread for GPU submission.
    /// Returns `true` if the frame was dispatched, `false` if the render
    /// thread is still busy with the previous frame (caller should retry).
    pub(crate) fn render(&mut self) -> bool {
        let t0 = std::time::Instant::now();

        // Try to get the renderer back from the render thread.
        // If it's not immediately available, spin-poll briefly (~200µs)
        // to avoid the ~1ms round-trip through the macOS event loop that
        // request_redraw() would require.  This catches the common case
        // where the render thread is just finishing up.
        self.poll_render_result();
        let mut renderer = match self.ports.gpu.take_renderer() {
            Some(r) => r,
            None => {
                for _ in 0..20 {
                    std::thread::yield_now();
                    self.poll_render_result();
                    if self.ports.gpu.has_renderer() {
                        break;
                    }
                }
                match self.ports.gpu.take_renderer() {
                    Some(r) => r,
                    None => return false,
                }
            }
        };

        // Sync renderer's scale factor in case it changed (e.g. display switch)
        renderer.set_scale_factor(self.window.scale_factor);

        let logical = self.logical_size();
        let focused = self.focus.focused;
        let search_focus = self.focus.search_focus;
        let show_file_tree = self.ft.visible;
        let file_tree_scroll = self.ft.scroll;
        let visual_pane_rects = self.visual_pane_rects.clone();
        let alive_pane_ids: Vec<u64> = self.panes.keys().copied().collect();
        let all_pane_ids = self.layout.pane_ids();

        let p = self.palette();

        // Keep runtime caches bounded to currently alive panes.
        self.cache
            .pane_generations
            .retain(|id, _| self.panes.contains_key(id));
        renderer.retain_pane_caches(&alive_pane_ids);

        // Atlas reset -> all cached UV coords are stale, force full rebuild
        if renderer.atlas_was_reset() {
            self.cache.pane_generations.clear();
            renderer.invalidate_all_pane_caches();
            self.cache.last_chrome_generation = self.cache.chrome_generation.wrapping_sub(1);
        }

        // Layout change -> invalidate only panes whose rects changed
        let layout_changed = self.prev_visual_pane_rects != visual_pane_rects;
        if layout_changed {
            let prev_map: std::collections::HashMap<u64, Rect> =
                self.prev_visual_pane_rects.iter().copied().collect();
            for &(id, rect) in &visual_pane_rects {
                if prev_map.get(&id) != Some(&rect) {
                    self.cache.pane_generations.remove(&id);
                    renderer.remove_pane_cache(id);
                }
            }
            // Also invalidate panes that were removed from the layout
            for &(id, _) in &self.prev_visual_pane_rects {
                if !visual_pane_rects.iter().any(|(vid, _)| *vid == id) {
                    self.cache.pane_generations.remove(&id);
                    renderer.remove_pane_cache(id);
                }
            }
            self.prev_visual_pane_rects = visual_pane_rects.clone();
        }

        // ── Pre-render: mutable pane state preparation ──
        for &(id, rect) in &visual_pane_rects {
            if let Some(PaneKind::Diff(dp)) = self.panes.get_mut(&id) {
                dp.side_by_side = true;
            }
            let pane_bar = bar_offset_for(id, &self.panes, &self.modal.save_confirm);
            if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&id) {
                let content_rect =
                    pane.content_rect(rect, TAB_BAR_HEIGHT + pane_bar, renderer.cell_size());
                pane.prepare_inline_caches(
                    content_rect,
                    renderer.cell_size(),
                    self.window.dark_mode,
                );
            }
        }

        renderer.begin_frame(logical);

        // ── Render: all sub-functions take &self (read-only App) ──

        let chrome_dirty = self.cache.chrome_generation != self.cache.last_chrome_generation;
        let chrome_hit_zones = if chrome_dirty {
            Some(chrome::render_chrome(
                self,
                &mut renderer,
                &p,
                logical,
                focused,
                show_file_tree,
                file_tree_scroll,
                &visual_pane_rects,
                &all_pane_ids,
            ))
        } else {
            None
        };

        let t_chrome = t0.elapsed();

        let gen_updates = grid::render_grid(self, &mut renderer, &p, &visual_pane_rects);

        {
            let order: Vec<u64> = visual_pane_rects.iter().map(|(id, _)| *id).collect();
            renderer.assemble_grid(&order);
        }

        let t_grid = t0.elapsed();

        cursor::render_cursor_and_highlights(
            self,
            &mut renderer,
            &p,
            &visual_pane_rects,
            focused,
            search_focus,
        );

        hover::render_hover(
            self,
            &mut renderer,
            &p,
            logical,
            &visual_pane_rects,
            show_file_tree,
            file_tree_scroll,
        );

        overlays::render_overlays(self, &mut renderer, &p, &visual_pane_rects);

        ime::render_ime_and_drop_preview(self, &mut renderer, &p, &visual_pane_rects, focused);

        // ── Post-render: apply mutations returned by render functions ──
        if let Some(zones) = chrome_hit_zones {
            self.header_hit_zones = zones;
            self.cache.last_chrome_generation = self.cache.chrome_generation;
        }
        for (id, gen) in gen_updates {
            self.cache.pane_generations.insert(id, gen);
        }

        renderer.end_frame();

        let t_build = t0.elapsed();

        // Send the renderer to the render thread for GPU submission.
        // The render thread handles get_current_texture() (which may block
        // on CAMetalLayer.nextDrawable()), command encoding, queue submission,
        // presentation, and device polling — all without blocking this thread.
        {
            let config_update = self.ports.gpu.take_pending_surface_config();
            if let Some(rt) = self.ports.gpu.render_thread() {
                let _ = rt
                    .job_tx
                    .send(crate::tide_renderer::render_thread::RenderJob {
                        renderer,
                        config_update,
                    });
                // renderer is now on the render thread — ports.gpu holds None
                // until poll_render_result() retrieves it.
            }
        }

        log::trace!(
            "frame build: chrome={:.0}us grid={:.0}us total={:.0}us",
            t_chrome.as_micros(),
            t_grid.as_micros(),
            t_build.as_micros(),
        );

        true
    }

    /// Insert preview: semi-transparent fill + thin border.
    /// `alpha_factor` (0..=1) controls fade-in opacity.
    fn draw_insert_preview(
        renderer: &mut crate::tide_renderer::WgpuRenderer,
        preview: Rect,
        p: &ThemePalette,
        alpha_factor: f32,
    ) {
        let fill = p.drop_fill.with_alpha_factor(alpha_factor);
        let border = p.drop_border.with_alpha_factor(alpha_factor);
        renderer.draw_rect(preview, fill);
        let bw = DROP_PREVIEW_BORDER_WIDTH;
        renderer.draw_rect(Rect::new(preview.x, preview.y, preview.width, bw), border);
        renderer.draw_rect(
            Rect::new(
                preview.x,
                preview.y + preview.height - bw,
                preview.width,
                bw,
            ),
            border,
        );
        renderer.draw_rect(Rect::new(preview.x, preview.y, bw, preview.height), border);
        renderer.draw_rect(
            Rect::new(
                preview.x + preview.width - bw,
                preview.y,
                bw,
                preview.height,
            ),
            border,
        );
    }

    /// Swap preview: thick border only, no fill — visually distinct from insert.
    /// `alpha_factor` (0..=1) controls fade-in opacity.
    fn draw_swap_preview(
        renderer: &mut crate::tide_renderer::WgpuRenderer,
        preview: Rect,
        p: &ThemePalette,
        alpha_factor: f32,
    ) {
        let border = p.swap_border.with_alpha_factor(alpha_factor);
        let bw = SWAP_PREVIEW_BORDER_WIDTH;
        renderer.draw_rect(Rect::new(preview.x, preview.y, preview.width, bw), border);
        renderer.draw_rect(
            Rect::new(
                preview.x,
                preview.y + preview.height - bw,
                preview.width,
                bw,
            ),
            border,
        );
        renderer.draw_rect(Rect::new(preview.x, preview.y, bw, preview.height), border);
        renderer.draw_rect(
            Rect::new(
                preview.x + preview.width - bw,
                preview.y,
                bw,
                preview.height,
            ),
            border,
        );
    }
}
