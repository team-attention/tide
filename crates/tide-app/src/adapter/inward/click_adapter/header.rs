use crate::tide_core::{Rect, SplitDirection, TerminalBackend};

use crate::header::{HeaderHitAction, HeaderHitZone};
use crate::pane::PaneKind;
use crate::ActionPort;
use crate::AppCorePort;
use crate::FocusNavPort;
use crate::InputStatePort;
use crate::LayoutPort;
use crate::ModalPort;
use crate::PaneAccessPort;
use crate::PaneLifecyclePort;
use crate::WorkspaceNavPort;
use crate::{shell_escape, DockPort, FileOpsPort, GitSwitcherState};

fn focus_header_context(
    ctx: &mut (impl WorkspaceNavPort + PaneAccessPort + DockPort),
    pane_id: crate::tide_core::PaneId,
) {
    if ctx.pane(pane_id).is_some() {
        ctx.focus_terminal(pane_id);
    }
}

fn resolve_terminal_launcher_if_needed(
    ctx: &mut (impl FocusNavPort + PaneAccessPort + PaneLifecyclePort),
) {
    if let Some(new_id) = ctx.focused_pane() {
        if matches!(ctx.pane(new_id), Some(PaneKind::Launcher(_))) {
            ctx.resolve_launcher(new_id, crate::action::LauncherChoice::Terminal);
        }
    }
}

/// Check if the current cursor position clicks on a header badge or close button.
/// Returns true if the click was consumed.
pub(crate) fn check_header_click(
    ctx: &mut (impl AppCorePort
              + FocusNavPort
              + PaneAccessPort
              + PaneLifecyclePort
              + ModalPort
              + InputStatePort
              + DockPort
              + WorkspaceNavPort
              + LayoutPort
              + FileOpsPort
              + ActionPort),
) -> bool {
    let pos = ctx.last_cursor_pos();
    let zones: Vec<HeaderHitZone> = ctx.header_hit_zones();
    for zone in &zones {
        if zone.rect.contains(pos) {
            match zone.action {
                HeaderHitAction::Close => {
                    ctx.close_specific_pane(zone.pane_id);
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::AddPane => {
                    focus_header_context(ctx, zone.pane_id);
                    ctx.new_terminal_tab();
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::NewFile => {
                    focus_header_context(ctx, zone.pane_id);
                    ctx.new_editor_pane();
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::OpenBrowser => {
                    focus_header_context(ctx, zone.pane_id);
                    ctx.open_browser_pane(None);
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::SplitHorizontal => {
                    focus_header_context(ctx, zone.pane_id);
                    if ctx.is_pane_in_dock(zone.pane_id) {
                        ctx.dock_split_new_tab_group(SplitDirection::Horizontal);
                        resolve_terminal_launcher_if_needed(ctx);
                    } else {
                        ctx.split_with_launcher(SplitDirection::Horizontal);
                    }
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::SplitVertical => {
                    focus_header_context(ctx, zone.pane_id);
                    if ctx.is_pane_in_dock(zone.pane_id) {
                        ctx.dock_split_new_tab_group(SplitDirection::Vertical);
                        resolve_terminal_launcher_if_needed(ctx);
                    } else {
                        ctx.split_with_launcher(SplitDirection::Vertical);
                    }
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::GitBranch => {
                    open_git_switcher(ctx, zone.pane_id, zone.rect);
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::GitStatus => {
                    let cwd = if let Some(PaneKind::Terminal(pane)) = ctx.pane(zone.pane_id) {
                        pane.context.cwd.clone()
                    } else {
                        None
                    };
                    if let Some(cwd) = cwd {
                        ctx.open_diff_pane(cwd);
                    }
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::AddComment => {
                    ctx.open_context_comment_composer(zone.pane_id);
                    return true;
                }
                HeaderHitAction::EditorCompare => {
                    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(zone.pane_id) {
                        if let Some(path) = pane.editor.file_path().map(|p| p.to_path_buf()) {
                            match ctx.read_file_to_string(&path) {
                                Ok(content) => {
                                    // Need to re-borrow pane_mut after the immutable call
                                    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(zone.pane_id)
                                    {
                                        let lines: Vec<String> =
                                            content.lines().map(String::from).collect();
                                        pane.disk_content = Some(lines);
                                        pane.diff_mode = true;
                                    }
                                }
                                Err(e) => {
                                    log::error!("Failed to read disk content for diff: {}", e);
                                }
                            }
                        }
                    }
                    ctx.invalidate_chrome();
                    ctx.invalidate_pane(zone.pane_id);
                    return true;
                }
                HeaderHitAction::EditorBack => {
                    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(zone.pane_id) {
                        pane.diff_mode = false;
                        pane.disk_content = None;
                    }
                    ctx.invalidate_chrome();
                    ctx.invalidate_pane(zone.pane_id);
                    return true;
                }
                HeaderHitAction::MarkdownPreview => {
                    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(zone.pane_id) {
                        pane.toggle_preview();
                    }
                    ctx.invalidate_chrome();
                    ctx.invalidate_pane(zone.pane_id);
                    return true;
                }
                HeaderHitAction::ToggleLivePreview => {
                    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(zone.pane_id) {
                        pane.toggle_live_preview();
                    }
                    ctx.invalidate_chrome();
                    ctx.invalidate_pane(zone.pane_id);
                    return true;
                }
                HeaderHitAction::EditorFileName => {
                    // Allow drag from editor filename area
                    ctx.interaction_mut().pane_drag =
                        crate::state::drag_types::PaneDragState::PendingDrag {
                            source_pane: zone.pane_id,
                            press_pos: ctx.last_cursor_pos(),
                        };
                    ctx.focus_terminal(zone.pane_id);
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::DiffRefresh => {
                    if let Some(PaneKind::Diff(dp)) = ctx.pane_mut(zone.pane_id) {
                        dp.refresh();
                    }
                    ctx.invalidate_chrome();
                    ctx.invalidate_pane(zone.pane_id);
                    return true;
                }
                HeaderHitAction::Maximize => {
                    // Toggle zoom for this pane
                    ctx.focus_terminal(zone.pane_id);
                    if ctx.is_pane_in_dock(zone.pane_id) {
                        ctx.set_dock_zoomed(!ctx.dock_zoomed());
                    } else {
                        // Stage pane: toggle zoomed_pane
                        if ctx.zoomed_pane() == Some(zone.pane_id) {
                            ctx.set_zoom(None);
                        } else {
                            ctx.set_zoom(Some(zone.pane_id));
                        }
                    }
                    ctx.invalidate_chrome();
                    ctx.invalidate_all_panes();
                    ctx.compute_layout();
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::DockTab(target_pane_id) => {
                    // Switch tab immediately for visual feedback, but also
                    // set PendingDrag to allow drag-and-drop reordering.
                    ctx.focus_terminal(target_pane_id);
                    ctx.interaction_mut().pane_drag =
                        crate::state::drag_types::PaneDragState::PendingDrag {
                            source_pane: target_pane_id,
                            press_pos: ctx.last_cursor_pos(),
                        };
                    ctx.invalidate_chrome();
                    ctx.invalidate_all_panes();
                    ctx.compute_layout();
                    ctx.request_redraw();
                    return true;
                }
                HeaderHitAction::StageTab(target_pane_id) => {
                    // Switch tab immediately for visual feedback, but also
                    // set PendingDrag to allow drag-and-drop extraction/reordering.
                    if let Some(old_zoomed) = ctx.zoomed_pane() {
                        // Transfer tab scroll offset from old zoomed pane to new one
                        let old_scroll = ctx
                            .interaction_mut()
                            .tab_scroll_offset
                            .remove(&old_zoomed)
                            .unwrap_or(0.0);
                        if old_scroll > 0.0 {
                            ctx.interaction_mut()
                                .tab_scroll_offset
                                .insert(target_pane_id, old_scroll);
                        }
                        ctx.set_zoom(Some(target_pane_id));
                    }
                    ctx.focus_terminal(target_pane_id);
                    ctx.interaction_mut().pane_drag =
                        crate::state::drag_types::PaneDragState::PendingDrag {
                            source_pane: target_pane_id,
                            press_pos: ctx.last_cursor_pos(),
                        };
                    ctx.invalidate_chrome();
                    ctx.invalidate_all_panes();
                    ctx.compute_layout();
                    ctx.request_redraw();
                    return true;
                }
            }
        }
    }
    false
}

/// Open the git switcher popup (works even when a process is running).
/// Clicking the same badge again closes the popup (toggle behavior).
fn open_git_switcher(
    ctx: &mut (impl AppCorePort + PaneAccessPort + ModalPort + InputStatePort),
    pane_id: crate::tide_core::PaneId,
    anchor_rect: Rect,
) {
    // Cancel any in-progress drag when opening a modal
    ctx.interaction_mut().pane_drag = crate::state::drag_types::PaneDragState::Idle;
    ctx.interaction_mut().drop_preview_start = None;
    // Toggle: close if already open for the same pane
    if let Some(ref gs) = ctx.modal().git_switcher {
        if gs.pane_id == pane_id {
            ctx.modal_mut().git_switcher = None;
            return;
        }
    }
    if let Some(PaneKind::Terminal(pane)) = ctx.pane(pane_id) {
        let shell_busy = !pane.context.shell_idle;
        if let Some(ref cwd) = pane.context.cwd {
            let cwd = cwd.clone();
            let worktrees = ctx.git_list_worktrees(&cwd);
            let mut gs = GitSwitcherState::new(pane_id, worktrees, anchor_rect);
            gs.shell_busy = shell_busy;
            ctx.modal_mut().git_switcher = Some(gs);
        }
    }
}

/// Get the cwd of the terminal pane associated with the git switcher.
fn git_switcher_pane_cwd(ctx: &(impl PaneAccessPort + ModalPort)) -> Option<std::path::PathBuf> {
    let gs = ctx.modal().git_switcher.as_ref()?;
    match ctx.pane(gs.pane_id) {
        Some(PaneKind::Terminal(p)) => p.context.cwd.clone(),
        _ => None,
    }
}

/// Resolve the main worktree path for the repo shown in the GitSwitcher.
fn git_switcher_main_worktree_cwd(
    ctx: &(impl PaneAccessPort + ModalPort),
) -> Option<std::path::PathBuf> {
    let gs = ctx.modal().git_switcher.as_ref()?;
    let fallback_cwd = git_switcher_pane_cwd(ctx)?;
    let main_cwd = gs
        .worktrees
        .iter()
        .find(|wt| wt.is_main)
        .map(|wt| wt.path.clone())
        .unwrap_or(fallback_cwd);
    Some(main_cwd)
}

/// Handle a git switcher popup button click.
pub(crate) fn handle_git_switcher_button(
    ctx: &mut (impl AppCorePort
              + PaneAccessPort
              + PaneLifecyclePort
              + ModalPort
              + ActionPort
              + InputStatePort),
    btn: crate::SwitcherButton,
) {
    match btn {
        crate::SwitcherButton::Switch(fi) => {
            let gs = match ctx.modal().git_switcher.as_ref() {
                Some(gs) => gs,
                None => return,
            };
            let pane_id = gs.pane_id;

            if gs.is_create_row(fi) {
                // Create worktree row
                let query = gs.input.text.trim().to_string();
                let cwd = git_switcher_pane_cwd(ctx);
                ctx.modal_mut().git_switcher = None;
                if let Some(cwd) = cwd {
                    let root = ctx.git_repo_root(&cwd).unwrap_or_else(|| cwd.clone());
                    let settings = ctx.persistence_load_settings();
                    let wt_path = settings.worktree.compute_worktree_path(&root, &query);
                    let new_branch = !ctx.git_branch_exists(&cwd, &query);
                    match ctx.git_add_worktree(&cwd, &wt_path, &query, new_branch) {
                        Ok(()) => {
                            settings.worktree.copy_files_to_worktree(&root, &wt_path);
                            if let Some(PaneKind::Terminal(pane)) = ctx.pane_mut(pane_id) {
                                if pane.context.shell_idle {
                                    let cmd = format!(
                                        "cd {}\n",
                                        shell_escape(&wt_path.to_string_lossy())
                                    );
                                    pane.backend.write(cmd.as_bytes());
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to create worktree: {}", e);
                        }
                    }
                }
            } else {
                let gs = ctx.modal().git_switcher.as_ref().unwrap();
                let action = gs.filtered_worktrees.get(fi).and_then(|&entry_idx| {
                    let wt = gs.worktrees.get(entry_idx)?;
                    Some(wt.path.to_string_lossy().to_string())
                });
                ctx.modal_mut().git_switcher = None;
                if let Some(path) = action {
                    if let Some(PaneKind::Terminal(pane)) = ctx.pane_mut(pane_id) {
                        if pane.context.shell_idle {
                            let cmd = format!("cd {}\n", shell_escape(&path));
                            pane.backend.write(cmd.as_bytes());
                        }
                    }
                }
            }
        }
        crate::SwitcherButton::Delete(fi) => {
            let (is_create, already_confirmed) = match ctx.modal().git_switcher.as_ref() {
                Some(gs) => (gs.is_create_row(fi), gs.delete_confirm == Some(fi)),
                None => return,
            };
            if is_create {
                return;
            }

            if !already_confirmed {
                if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                    gs.delete_confirm = Some(fi);
                }
                ctx.invalidate_chrome();
                return;
            }
            if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                gs.delete_confirm = None;
            }

            let main_cwd = git_switcher_main_worktree_cwd(ctx);

            let (wt_path, branch_name, is_main) = {
                let gs = ctx.modal().git_switcher.as_ref().unwrap();
                let entry_idx = match gs.filtered_worktrees.get(fi) {
                    Some(&i) => i,
                    None => return,
                };
                let wt = &gs.worktrees[entry_idx];
                if wt.is_current || wt.is_main {
                    return;
                }
                (wt.path.clone(), wt.branch.clone(), wt.is_main)
            };
            if let Some(main_cwd) = main_cwd {
                if !is_main {
                    if let Err(e) = ctx.git_remove_worktree(&main_cwd, &wt_path, true) {
                        log::error!("Failed to remove worktree: {}", e);
                    }
                    if let Some(ref branch) = branch_name {
                        if branch != "main" && branch != "master" {
                            if let Err(e) = ctx.git_delete_branch(&main_cwd, branch, true) {
                                log::error!("Failed to delete branch: {}", e);
                            }
                        }
                    }
                }
            }

            refresh_git_switcher(ctx, &wt_path);
            ctx.invalidate_chrome();
            return;
        }
        crate::SwitcherButton::NewPane(fi) => {
            let gs = match ctx.modal().git_switcher.as_ref() {
                Some(gs) => gs,
                None => return,
            };
            let pane_id = gs.pane_id;

            if gs.is_create_row(fi) {
                let query = gs.input.text.trim().to_string();
                let cwd = git_switcher_pane_cwd(ctx);
                ctx.modal_mut().git_switcher = None;
                if let Some(cwd) = cwd {
                    let root = ctx.git_repo_root(&cwd).unwrap_or_else(|| cwd.clone());
                    let settings = ctx.persistence_load_settings();
                    let wt_path = settings.worktree.compute_worktree_path(&root, &query);
                    let new_branch = !ctx.git_branch_exists(&cwd, &query);
                    match ctx.git_add_worktree(&cwd, &wt_path, &query, new_branch) {
                        Ok(()) => {
                            settings.worktree.copy_files_to_worktree(&root, &wt_path);
                            ctx.split_pane_from(pane_id, SplitDirection::Horizontal, Some(wt_path));
                        }
                        Err(e) => {
                            log::error!("Failed to create worktree: {}", e);
                        }
                    }
                }
            } else {
                let gs = ctx.modal().git_switcher.as_ref().unwrap();
                let wt_path = gs.filtered_worktrees.get(fi).and_then(|&entry_idx| {
                    let wt = gs.worktrees.get(entry_idx)?;
                    Some(wt.path.clone())
                });
                ctx.modal_mut().git_switcher = None;
                if let Some(wt_path) = wt_path {
                    ctx.split_pane_from(pane_id, SplitDirection::Horizontal, Some(wt_path));
                }
            }
        }
    }
    ctx.invalidate_chrome();
}

/// Refresh the git switcher popup in-place after a delete operation.
fn refresh_git_switcher(
    ctx: &mut (impl PaneAccessPort + ModalPort),
    deleted_worktree: &std::path::Path,
) {
    let gs = match ctx.modal().git_switcher.as_ref() {
        Some(gs) => gs,
        None => return,
    };
    let pane_id = gs.pane_id;
    let input_text = gs.input.text.clone();
    let input_cursor = gs.input.cursor;
    let anchor_rect = gs.anchor_rect;
    let shell_busy = gs.shell_busy;

    let worktrees = gs
        .worktrees
        .iter()
        .filter(|wt| wt.path != deleted_worktree)
        .cloned()
        .collect();
    let mut new_gs = GitSwitcherState::new(pane_id, worktrees, anchor_rect);
    new_gs.shell_busy = shell_busy;
    new_gs.input.text = input_text;
    new_gs.input.cursor = input_cursor;
    if !new_gs.input.is_empty() {
        let query_lower = new_gs.input.text.to_lowercase();
        new_gs.filtered_worktrees = new_gs
            .worktrees
            .iter()
            .enumerate()
            .filter(|(_, wt)| {
                let branch_match = wt
                    .branch
                    .as_ref()
                    .map(|b| b.to_lowercase().contains(&query_lower))
                    .unwrap_or_else(|| "(detached)".contains(&query_lower));
                let path_match = wt
                    .path
                    .to_string_lossy()
                    .to_lowercase()
                    .contains(&query_lower);
                branch_match || path_match
            })
            .map(|(i, _)| i)
            .collect();
    }
    let len = new_gs.current_filtered_len();
    if new_gs.selected >= len && len > 0 {
        new_gs.selected = len - 1;
    }
    ctx.modal_mut().git_switcher = Some(new_gs);
}
