use std::time::Duration;

use crate::tide_core::InputEvent;

use crate::pane::PaneKind;
use crate::theme::*;
use crate::ActionPort;
use crate::AppCorePort;
use crate::FileTreePort;
use crate::InputStatePort;
use crate::LayoutPort;
use crate::ModalPort;
use crate::PaneAccessPort;
use crate::RouterPort;

const SHARED_TAB_SCROLL_GAIN: f32 = 12.0;
const SHARED_TAB_SCROLL_IDLE_WINDOW: Duration = Duration::from_millis(120);

pub(crate) fn shared_tab_scroll_delta(dx: f32, dy: f32) -> f32 {
    if dx != 0.0 {
        -dx
    } else {
        -dy
    }
}

pub(crate) fn shared_tab_scroll_is_new_gesture(
    last_event_age: Option<Duration>,
    last_direction: Option<f32>,
    scroll_delta: f32,
) -> bool {
    if scroll_delta == 0.0 {
        return false;
    }

    let direction = scroll_delta.signum();
    last_event_age.map_or(true, |age| age > SHARED_TAB_SCROLL_IDLE_WINDOW)
        || last_direction.is_some_and(|prev| prev != 0.0 && prev != direction)
}

pub(crate) fn shared_tab_scroll_step(scroll_delta: f32, cell_w: f32, is_new_gesture: bool) -> f32 {
    if scroll_delta == 0.0 {
        return 0.0;
    }

    let scaled = scroll_delta * SHARED_TAB_SCROLL_GAIN;
    if !is_new_gesture {
        return scaled;
    }

    let starter_step = (cell_w * 0.5).max(4.0);
    scaled.signum() * scaled.abs().max(starter_step)
}

pub(crate) fn clamp_shared_tab_scroll_offset(requested_scroll: f32, max_scroll: f32) -> f32 {
    requested_scroll.clamp(0.0, max_scroll.max(0.0))
}

/// Handle scroll event with pre-processed delta values.
/// dx/dy are in "line" units (platform normalizes pixel/line deltas).
pub(crate) fn handle_scroll(
    ctx: &mut (impl AppCorePort
              + ActionPort
              + LayoutPort
              + ModalPort
              + PaneAccessPort
              + InputStatePort
              + FileTreePort
              + RouterPort),
    dx: f32,
    dy: f32,
) {
    // Mark scroll activity so frame pacing skips coalescing
    ctx.mark_scroll_activity();

    // Popup scroll: config page
    {
        let modal = ctx.modal_mut();
        if let Some(ref mut cp) = modal.config_page {
            if matches!(cp.section, crate::state::ConfigSection::Keybindings) {
                let lines = if dy.abs() >= 1.0 {
                    dy.abs().ceil() as usize
                } else {
                    1
                };
                let max_visible = CONFIG_PAGE_MAX_VISIBLE;
                if dy > 0.0 {
                    cp.scroll_offset = cp.scroll_offset.saturating_sub(lines);
                } else if dy < 0.0 {
                    let max_off = cp.bindings.len().saturating_sub(max_visible);
                    cp.scroll_offset = (cp.scroll_offset + lines).min(max_off);
                }
            }
            ctx.invalidate_chrome();
            ctx.request_redraw();
            return;
        }
    }

    // Popup scroll: git switcher
    {
        let cursor_pos = ctx.last_cursor_pos();
        let has_git_switcher = ctx.modal().git_switcher.is_some();
        if has_git_switcher && ctx.git_switcher_contains(cursor_pos) {
            let modal = ctx.modal_mut();
            if let Some(ref mut gs) = modal.git_switcher {
                let max_visible = crate::GIT_SWITCHER_MAX_VISIBLE;
                let lines = if dy.abs() >= 1.0 {
                    dy.abs().ceil() as usize
                } else {
                    1
                };
                let filtered_len = gs.current_filtered_len();
                if dy > 0.0 {
                    gs.scroll_offset = gs.scroll_offset.saturating_sub(lines);
                } else if dy < 0.0 {
                    let max_off = filtered_len.saturating_sub(max_visible);
                    gs.scroll_offset = (gs.scroll_offset + lines).min(max_off);
                }
            }
            ctx.invalidate_chrome();
            ctx.request_redraw();
            return;
        }
    }

    // Popup scroll: file finder
    {
        let cursor_pos = ctx.last_cursor_pos();
        let has_file_finder = ctx.modal().file_finder.is_some();
        if has_file_finder && ctx.file_finder_contains(cursor_pos) {
            let lines = if dy.abs() >= 1.0 {
                dy.abs().ceil() as isize
            } else if dy != 0.0 {
                1
            } else {
                0
            };
            if lines != 0 {
                let delta = if dy > 0.0 { -lines } else { lines };
                if let Some(ref mut finder) = ctx.modal_mut().file_finder {
                    finder.scroll_by_lines(delta);
                }
            }
            ctx.invalidate_chrome();
            ctx.request_redraw();
            return;
        }
    }

    let editor_dx = dx;
    let editor_dy = dy;
    let horizontal_scroll_dominant = editor_dx != 0.0 && editor_dx.abs() > editor_dy.abs();

    // Tab bar scroll: if cursor is within the tab bar header area of any pane
    let cursor_pos = ctx.last_cursor_pos();
    {
        let pane_rects = ctx.visual_pane_rects();
        let mut tab_bar_pane: Option<crate::tide_core::PaneId> = None;
        for &(pid, pane_rect) in pane_rects {
            let tab_bar_rect = crate::tide_core::Rect::new(
                pane_rect.x,
                pane_rect.y,
                pane_rect.width,
                TAB_BAR_HEIGHT,
            );
            if tab_bar_rect.contains(cursor_pos) {
                tab_bar_pane = Some(pid);
                break;
            }
        }
        if let Some(pid) = tab_bar_pane {
            // Shared tab bars are horizontally scrollable surfaces:
            // prefer horizontal delta when it exists, and only fall back to
            // vertical wheel-style scrolling when no horizontal delta is present.
            let scroll_delta = shared_tab_scroll_delta(dx, dy);
            let max_scroll = ctx.shared_tab_max_scroll(pid).unwrap_or(0.0);
            if max_scroll > 0.0 && scroll_delta != 0.0 {
                let cell_w = ctx.cell_size().width;
                let now = ctx.clock_now();
                let interaction = ctx.interaction_mut();
                let last_event_age = interaction
                    .tab_scroll_last_at
                    .get(&pid)
                    .map(|at| now.duration_since(*at));
                let last_direction = interaction.tab_scroll_last_direction.get(&pid).copied();
                let is_new_gesture =
                    shared_tab_scroll_is_new_gesture(last_event_age, last_direction, scroll_delta);
                let offsets = &mut interaction.tab_scroll_offset;
                let current_offset = offsets.get(&pid).copied().unwrap_or(0.0);
                let next_offset = clamp_shared_tab_scroll_offset(
                    current_offset + shared_tab_scroll_step(scroll_delta, cell_w, is_new_gesture),
                    max_scroll,
                );
                offsets.insert(pid, next_offset);
                interaction.tab_scroll_last_at.insert(pid, now);
                interaction
                    .tab_scroll_last_direction
                    .insert(pid, scroll_delta.signum());
                interaction.tab_manual_scroll.insert(pid);
                ctx.invalidate_chrome();
                ctx.request_redraw();
                return;
            }
        }
    }

    // Check if scrolling over the file tree
    let ft_visible = ctx.ft().visible;
    let ft_rect = ctx.ft().rect;
    if ft_visible && ft_rect.is_some_and(|r| cursor_pos.x >= r.x && cursor_pos.x < r.x + r.width) {
        let max_scroll = ctx.file_tree_max_scroll();
        let current_scroll = ctx.ft().scroll;
        let new_val = (current_scroll - dy * 18.0).clamp(0.0, max_scroll);
        if new_val != current_scroll {
            let ft = ctx.ft_mut();
            ft.scroll = new_val;
            ft.scroll_target = new_val;
            ctx.invalidate_chrome();
        }
    } else {
        // Route scroll to the pane under the cursor via the input router
        let input = InputEvent::MouseScroll {
            delta: editor_dy,
            position: cursor_pos,
        };
        let action = ctx.route_input(input);
        ctx.handle_action(action, Some(input));
    }

    // Horizontal scroll for editor/diff panes (trackpad two-finger swipe)
    if horizontal_scroll_dominant {
        let editor_pane_id = ctx
            .visual_pane_rects()
            .iter()
            .find(|(_, r)| r.contains(cursor_pos))
            .map(|(id, r)| (*id, *r));
        if let Some((pid, rect)) = editor_pane_id {
            let cs = ctx.cell_size();
            let scroll_top_off = TAB_BAR_HEIGHT;
            match ctx.pane_mut(pid) {
                Some(PaneKind::Editor(pane)) if pane.preview_mode => {
                    let delta = (editor_dx.abs() * 3.0).ceil() as usize;
                    let max_w = pane.preview_max_line_width();
                    let inner_w = rect.width - 2.0 * PANE_PADDING;
                    let scrollbar_reserved = if pane.preview_line_count()
                        > ((rect.height - TAB_BAR_HEIGHT - PANE_PADDING) / cs.height).floor()
                            as usize
                    {
                        SCROLLBAR_WIDTH
                    } else {
                        0.0
                    };
                    let code_block_w = (inner_w - scrollbar_reserved - 2.0 * cs.width).max(0.0);
                    let preview_visible_cols = (code_block_w / cs.width).floor() as usize;
                    let max_h_scroll = max_w.saturating_sub(preview_visible_cols);
                    if editor_dx > 0.0 {
                        pane.preview_h_scroll = pane.preview_h_scroll.saturating_sub(delta);
                    } else {
                        pane.preview_h_scroll = (pane.preview_h_scroll + delta).min(max_h_scroll);
                    }
                }
                Some(PaneKind::Editor(pane)) => {
                    use crate::tide_editor::input::EditorAction;
                    let content_rect = crate::pane::pane_content_rect(rect, scroll_top_off);
                    let (visible_rows, visible_cols) =
                        pane.viewport_size_for_content_rect(content_rect, cs);
                    if editor_dx > 0.0 {
                        pane.handle_action_with_size(
                            EditorAction::ScrollLeft(editor_dx.abs()),
                            visible_rows,
                            visible_cols,
                        );
                    } else {
                        pane.handle_action_with_size(
                            EditorAction::ScrollRight(editor_dx.abs()),
                            visible_rows,
                            visible_cols,
                        );
                    }
                }
                Some(PaneKind::Diff(dp)) => {
                    let delta = (editor_dx.abs() * 3.0).ceil() as usize;
                    let vis_cols = (rect.width / cs.width).floor() as usize;
                    let content_y = rect.y + scroll_top_off;
                    let visual_row =
                        ((cursor_pos.y - content_y) / cs.height).floor().max(0.0) as usize;
                    if let Some(fi) = dp.file_index_at_row(visual_row) {
                        let max_h = dp.max_line_len().saturating_sub(vis_cols.saturating_sub(4));
                        let cur = dp.h_scroll.get(&fi).copied().unwrap_or(0);
                        let new_val = if editor_dx > 0.0 {
                            cur.saturating_sub(delta)
                        } else {
                            (cur + delta).min(max_h)
                        };
                        dp.h_scroll.insert(fi, new_val);
                    }
                    dp.generation = dp.generation.wrapping_add(1);
                }
                _ => {}
            }
            ctx.invalidate_pane(pid);
        }
    }
}
