use crate::tide_core::{Rect, Vec2};

use crate::state::drag_types::{DropDestination, HoverTarget};
use crate::pane::PaneKind;
use crate::theme::*;
use crate::DockPort;
use crate::AppCorePort;
use crate::LayoutPort;
use crate::WorkspaceNavPort;
use crate::PaneLifecyclePort;
use crate::FocusNavPort;
use crate::PaneAccessPort;
use crate::ModalPort;
use crate::InputStatePort;

/// Handle a browser nav bar click based on hover target.
pub(crate) fn handle_browser_nav_click(
    ctx: &mut (impl AppCorePort + FocusNavPort + PaneAccessPort + InputStatePort),
    target: &HoverTarget,
) {
    let focused_id = match ctx.focused_pane() {
        Some(id) => id,
        None => return,
    };
    match target {
        HoverTarget::BrowserBack => {
            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                bp.go_back();
            }
        }
        HoverTarget::BrowserForward => {
            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                bp.go_forward();
            }
        }
        HoverTarget::BrowserRefresh => {
            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                bp.reload();
            }
        }
        HoverTarget::BrowserUrlBar => {
            // Compute geometry before mutably borrowing panes.
            let cell_w = ctx.cell_size().width;
            let click_x = ctx.last_cursor_pos().x;
            let pane_rect = ctx.visual_pane_rects().iter()
                .find(|(id, _)| *id == focused_id)
                .map(|&(_, r)| r);

            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                if !bp.url_input_focused {
                    bp.url_input_focused = true;
                    bp.url_input = bp.url.clone();
                    // Select all on initial focus (standard browser behavior)
                    let len = bp.url_input_char_len();
                    bp.url_selection = Some((0, len));
                    bp.url_input_cursor = len;
                } else {
                    // Already focused: position cursor at click, clear selection
                    bp.url_selection = None;
                    if let Some(rect) = pane_rect {
                        let nav_x = rect.x + crate::theme::PANE_PADDING;
                        let url_text_x = nav_x + 8.0 + cell_w * 6.0 + 4.0 + 4.0;
                        let relative_x = (click_x - url_text_x).max(0.0);
                        let mut col_px = 0.0_f32;
                        let mut char_idx = 0;
                        for ch in bp.url_input.chars() {
                            let w = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1) as f32 * cell_w;
                            if relative_x < col_px + w * 0.5 {
                                break;
                            }
                            col_px += w;
                            char_idx += 1;
                        }
                        bp.url_input_cursor = char_idx;
                    } else {
                        bp.url_input_cursor = bp.url_input.chars().count();
                    }
                }
            }
        }
        _ => {}
    }
    ctx.invalidate_chrome();
}

/// Handle notification bar button clicks (conflict bar + save confirm bar).
/// Checks all editor panes. Returns true if the click was consumed.
pub(crate) fn handle_notification_bar_click(
    ctx: &mut (impl AppCorePort + PaneAccessPort + ModalPort + PaneLifecyclePort),
    pos: Vec2,
) -> bool {
    // Try save confirm bar first
    if let Some(ref sc) = ctx.modal().save_confirm {
        let pane_id = sc.pane_id;
        if let Some(bar_rect) = notification_bar_rect(ctx, pane_id) {
            if pos.y >= bar_rect.y && pos.y <= bar_rect.y + bar_rect.height
                && pos.x >= bar_rect.x && pos.x <= bar_rect.x + bar_rect.width
            {
                let cell_size = ctx.cell_size();
                let btn_pad = 8.0;

                // Cancel (rightmost)
                let cancel_w = 6.0 * cell_size.width + btn_pad * 2.0;
                let cancel_x = bar_rect.x + bar_rect.width - cancel_w - 4.0;

                // Don't Save
                let dont_save_w = 10.0 * cell_size.width + btn_pad * 2.0;
                let dont_save_x = cancel_x - dont_save_w - 4.0;

                // Save
                let save_w = 4.0 * cell_size.width + btn_pad * 2.0;
                let save_x = dont_save_x - save_w - 4.0;

                if pos.x >= cancel_x {
                    ctx.cancel_save_confirm();
                } else if pos.x >= dont_save_x {
                    ctx.confirm_discard_and_close();
                } else if pos.x >= save_x {
                    ctx.confirm_save_and_close();
                }
                ctx.request_redraw();
                return true;
            }
        }
    }

    // Try conflict bar
    if handle_conflict_bar_click_inner(ctx, pos) {
        return true;
    }

    false
}

/// Get the notification bar rect for a pane.
fn notification_bar_rect(
    ctx: &impl AppCorePort,
    pane_id: crate::tide_core::PaneId,
) -> Option<Rect> {
    let content_top_off = TAB_BAR_HEIGHT;
    if let Some(&(_, rect)) = ctx.visual_pane_rects().iter().find(|(id, _)| *id == pane_id) {
        let content_top = rect.y + content_top_off;
        let bar_x = rect.x + PANE_PADDING;
        let bar_w = rect.width - 2.0 * PANE_PADDING;
        return Some(Rect::new(bar_x, content_top, bar_w, CONFLICT_BAR_HEIGHT));
    }
    None
}

/// Handle conflict bar button click for any pane. Returns true if the click was consumed.
fn handle_conflict_bar_click_inner(
    ctx: &mut (impl AppCorePort + PaneAccessPort),
    pos: Vec2,
) -> bool {
    // Find which pane has a conflict bar under the click
    let mut target_pane: Option<(crate::tide_core::PaneId, Rect)> = None;

    let content_top_off = TAB_BAR_HEIGHT;
    for &(id, rect) in ctx.visual_pane_rects() {
        if let Some(PaneKind::Editor(pane)) = ctx.pane(id) {
            if pane.needs_notification_bar() {
                let content_top = rect.y + content_top_off;
                let bar_x = rect.x + PANE_PADDING;
                let bar_w = rect.width - 2.0 * PANE_PADDING;
                let bar_rect = Rect::new(bar_x, content_top, bar_w, CONFLICT_BAR_HEIGHT);
                if pos.y >= bar_rect.y && pos.y <= bar_rect.y + CONFLICT_BAR_HEIGHT
                    && pos.x >= bar_rect.x && pos.x <= bar_rect.x + bar_rect.width
                {
                    target_pane = Some((id, bar_rect));
                    break;
                }
            }
        }
    }

    let (pane_id, bar_rect) = match target_pane {
        Some(t) => t,
        None => return false,
    };

    let cell_size = ctx.cell_size();

    let is_deleted = ctx.pane(pane_id)
        .and_then(|pk| if let PaneKind::Editor(ep) = pk { Some(ep.file_deleted) } else { None })
        .unwrap_or(false);

    let btn_pad = 8.0;

    // Overwrite button (rightmost)
    let overwrite_w = 9.0 * cell_size.width + btn_pad * 2.0;
    let overwrite_x = bar_rect.x + bar_rect.width - overwrite_w - 4.0;

    // Reload button (not for deleted files)
    let reload_w = 6.0 * cell_size.width + btn_pad * 2.0;
    let reload_x = overwrite_x - reload_w - 4.0;

    if pos.x >= overwrite_x {
        if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(pane_id) {
            if let Err(e) = pane.editor.buffer.save() {
                log::error!("Conflict overwrite failed: {}", e);
            }
            pane.disk_changed = false;
            pane.file_deleted = false;
            pane.diff_mode = false;
            pane.disk_content = None;
        }
    } else if !is_deleted && pos.x >= reload_x {
        if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(pane_id) {
            if let Err(e) = pane.editor.reload() {
                log::error!("Reload failed: {}", e);
            }
            pane.disk_changed = false;
            pane.file_deleted = false;
            pane.diff_mode = false;
            pane.disk_content = None;
        }
    }

    ctx.invalidate_chrome();
    ctx.invalidate_pane(pane_id);
    true
}

/// Handle click when config page is open.
pub(crate) fn handle_config_page_click(
    ctx: &mut (impl AppCorePort + ModalPort + WorkspaceNavPort),
    pos: Vec2,
) {
    use crate::state::ConfigSection;

    let logical = ctx.logical_size();
    let popup_w = crate::theme::CONFIG_PAGE_W.min(logical.width - 80.0).max(300.0);
    let popup_h = crate::theme::CONFIG_PAGE_MAX_H.min(logical.height - 80.0).max(200.0);
    let popup_x = (logical.width - popup_w) / 2.0;
    let popup_y = (logical.height - popup_h) / 2.0;
    let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);

    // Click outside popup → close
    if !popup_rect.contains(pos) {
        ctx.close_config_page();
        return;
    }

    let cell_size = ctx.cell_size();
    let cell_height = cell_size.height;

    // Title bar area
    let title_h = crate::theme::CONFIG_PAGE_TITLE_H;
    let title_y = popup_y + 2.0;

    // Tab bar area
    let tab_h = crate::theme::CONFIG_PAGE_TAB_H;
    let tab_y = title_y + title_h + 1.0;
    let half_w = popup_w / 2.0;

    // Click on tab bar → switch section
    if pos.y >= tab_y && pos.y < tab_y + tab_h {
        if let Some(ref mut page) = ctx.modal_mut().config_page {
            if pos.x < popup_x + half_w {
                page.section = ConfigSection::Keybindings;
            } else {
                page.section = ConfigSection::Worktree;
            }
            page.selected = 0;
            page.scroll_offset = 0;
        }
        ctx.invalidate_chrome();
        return;
    }

    // Content area
    let content_top = tab_y + tab_h + 1.0;
    let hint_bar_h = crate::theme::CONFIG_PAGE_HINT_BAR_H;
    let content_bottom = popup_y + popup_h - hint_bar_h;
    let line_height = 32.0_f32.max(cell_height + crate::theme::POPUP_LINE_EXTRA);

    if pos.y >= content_top && pos.y < content_bottom {
        if let Some(ref mut page) = ctx.modal_mut().config_page {
            match page.section {
                ConfigSection::Keybindings => {
                    let vi = ((pos.y - content_top) / line_height).floor() as usize;
                    let fi = page.scroll_offset + vi;
                    if fi < page.bindings.len() {
                        page.selected = fi;
                    }
                }
                ConfigSection::Worktree => {
                    let input_h = cell_height + crate::theme::POPUP_INPUT_PADDING;

                    // Base dir pattern input field
                    let wt_input_y = content_top + 8.0 + line_height + 4.0;
                    if pos.y >= wt_input_y && pos.y < wt_input_y + input_h {
                        page.selected_field = 0;
                        page.worktree_editing = true;
                        page.copy_files_editing = false;
                    }

                    // Copy files input field
                    let help_y = wt_input_y + input_h + 8.0;
                    let cf_label_y = help_y + cell_height + 12.0;
                    let cf_input_y = cf_label_y + line_height + 4.0;
                    if pos.y >= cf_input_y && pos.y < cf_input_y + input_h {
                        page.selected_field = 1;
                        page.copy_files_editing = true;
                        page.worktree_editing = false;
                    }
                }
            }
        }
        ctx.invalidate_chrome();
    }
}

/// Handle branch cleanup bar button clicks.
/// Returns true if the click was consumed.
pub(crate) fn handle_branch_cleanup_click(
    ctx: &mut (impl AppCorePort + ModalPort + PaneLifecyclePort),
    pos: crate::tide_core::Vec2,
) -> bool {
    let bc_pane_id = match ctx.modal().branch_cleanup {
        Some(ref bc) => bc.pane_id,
        None => return false,
    };
    let bar_rect = match notification_bar_rect(ctx, bc_pane_id) {
        Some(r) => r,
        None => return false,
    };
    if pos.y < bar_rect.y || pos.y > bar_rect.y + bar_rect.height
        || pos.x < bar_rect.x || pos.x > bar_rect.x + bar_rect.width
    {
        return false;
    }
    let cell_size = ctx.cell_size();
    let btn_pad = 8.0;

    // Cancel (rightmost)
    let cancel_w = 6.0 * cell_size.width + btn_pad * 2.0;
    let cancel_x = bar_rect.x + bar_rect.width - cancel_w - 4.0;

    // Keep
    let keep_w = 4.0 * cell_size.width + btn_pad * 2.0;
    let keep_x = cancel_x - keep_w - 4.0;

    // Delete
    let delete_w = 6.0 * cell_size.width + btn_pad * 2.0;
    let delete_x = keep_x - delete_w - 4.0;

    if pos.x >= cancel_x {
        ctx.cancel_branch_cleanup();
    } else if pos.x >= keep_x {
        ctx.confirm_branch_keep();
    } else if pos.x >= delete_x {
        ctx.confirm_branch_delete();
    }
    ctx.request_redraw();
    true
}

/// Handle a completed drop operation.
/// Center zone swaps source and target. Directional zones create a new split.
pub(crate) fn handle_drop(
    ctx: &mut (impl AppCorePort + FocusNavPort + PaneAccessPort + DockPort + LayoutPort + WorkspaceNavPort),
    source: crate::tide_core::PaneId,
    dest: DropDestination,
) {
    use crate::tide_core::{DropZone, SplitDirection};

    match dest {
        DropDestination::TreeRoot(zone) => {
            // Remove source from its current location
            ctx.layout_remove(source);
            // Insert at root level
            ctx.layout_insert_at_root(source, zone);
            ctx.focus_pane(source);
            ctx.invalidate_chrome();
            ctx.compute_layout();
        }
        DropDestination::DockRoot(zone) => {
            let was_pinned = ctx.is_pane_pinned(source);
            if was_pinned {
                ctx.pinned_layout_remove(source);
                let assoc_tid = ctx.associated_terminal(source);
                let current_tid = ctx.focused_terminal_id();
                if assoc_tid == current_tid {
                    // Same terminal: place with drop zone (normal behavior)
                    if let Some(tid) = current_tid {
                        ctx.dock_layout_insert_at_root(tid, source, zone);
                        ctx.dock_layout_set_focused(tid, source);
                        ctx.dock_layout_set_active_tab(tid, source);
                    }
                } else {
                    // Different terminal: just unpin to associated terminal, no placement
                    if let Some(tid) = assoc_tid {
                        if ctx.dock_layout_all_pane_ids_empty(tid) {
                            ctx.dock_layout_insert_leaf_group(tid, source);
                        } else {
                            ctx.dock_layout_add_tab_to_first_group(tid, source);
                        }
                    }
                }
            } else {
                if let Some(tid) = ctx.terminal_owning(source) {
                    ctx.dock_layout_remove(tid, source);
                }
                // Insert into focused terminal's dock_layout
                if let Some(tid) = ctx.focused_terminal_id() {
                    ctx.dock_layout_insert_at_root(tid, source, zone);
                    ctx.dock_layout_set_focused(tid, source);
                    ctx.dock_layout_set_active_tab(tid, source);
                    ctx.set_associated_terminal(source, tid);
                }
            }
            ctx.invalidate_chrome();
            ctx.compute_layout();
        }
        DropDestination::TreePane(target_id, zone) => {
            // Drop: remove source, insert as new split next to target
            if source == target_id && zone == DropZone::Center {
                return; // Can't drop on self as tab
            }
            let (direction, insert_first) = match zone {
                DropZone::Top => (SplitDirection::Vertical, true),
                DropZone::Bottom => (SplitDirection::Vertical, false),
                DropZone::Left => (SplitDirection::Horizontal, true),
                DropZone::Right => (SplitDirection::Horizontal, false),
                DropZone::Center => (SplitDirection::Vertical, false), // Center = add below
            };

            let source_in_dock = ctx.is_pane_in_dock(source);
            let target_in_dock = ctx.is_pane_in_dock(target_id);

            if source_in_dock && target_in_dock {
                let source_was_pinned = ctx.is_pane_pinned(source);
                if source_was_pinned {
                    ctx.pinned_layout_remove(source);
                    // If dropping on a non-owning terminal, just unpin to associated terminal
                    let assoc_tid = ctx.associated_terminal(source);
                    let current_tid = ctx.focused_terminal_id();
                    if assoc_tid != current_tid {
                        if let Some(tid) = assoc_tid {
                            if ctx.dock_layout_all_pane_ids_empty(tid) {
                                ctx.dock_layout_insert_leaf_group(tid, source);
                            } else {
                                ctx.dock_layout_add_tab_to_first_group(tid, source);
                            }
                        }
                        ctx.invalidate_chrome();
                        ctx.compute_layout();
                        ctx.request_redraw();
                        return;
                    }
                }
                // Both panes in dock — route to the owning terminal's dock_layout
                if let Some(tid) = ctx.terminal_owning(source) {
                    if source == target_id {
                        // Self-drop from tab group: find a sibling tab to use as split target
                        if let Some(sib) = ctx.dock_layout_tab_group_sibling(tid, source) {
                            ctx.dock_layout_remove(tid, source);
                            ctx.dock_layout_split_with_leaf_group(tid, sib, source, direction, insert_first);
                        }
                    } else {
                        ctx.dock_layout_remove(tid, source);
                        if zone == DropZone::Center {
                            if !ctx.dock_layout_add_tab(tid, target_id, source) {
                                ctx.dock_layout_add_tab_to_first_group(tid, source);
                            }
                        } else {
                            ctx.dock_layout_split_with_leaf_group(tid, target_id, source, direction, insert_first);
                        }
                    }
                    ctx.dock_layout_set_active_tab(tid, source);
                }
            } else {
                if zone == DropZone::Center {
                    // Center drop on Stage pane: merge into TabGroup (UC-5 BR-1)
                    ctx.layout_remove(source);
                    ctx.layout_add_tab(target_id, source);
                } else {
                    let insert_first = match zone {
                        DropZone::Top | DropZone::Left => true,
                        _ => false,
                    };
                    ctx.layout_remove(source);
                    ctx.layout_insert_pane(target_id, source, direction, insert_first);
                }
            }
            ctx.focus_pane(source);
            ctx.invalidate_chrome();
            ctx.compute_layout();
        }
        DropDestination::Workspace(target_idx) => {
            // move_pane_to_workspace calls switch_workspace which sets needs_redraw
            ctx.move_pane_to_workspace(source, target_idx);
        }
        DropDestination::PinnedGroup => {
            // Drag into pinned group = pin the pane (use toggle_dock_pin logic)
            if !ctx.is_pane_pinned(source) {
                // Temporarily focus the source so toggle_dock_pin finds it
                let prev = ctx.focused_pane();
                ctx.focus_pane(source);
                ctx.toggle_dock_pin();
                if let Some(prev) = prev {
                    ctx.focus_pane(prev);
                }
            }
        }
    }
    ctx.request_redraw();
}
