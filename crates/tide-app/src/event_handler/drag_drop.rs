use tide_core::{DropZone, PaneId, Rect, SplitDirection, Vec2};

use crate::theme::*;
use crate::App;

/// Threshold for outer zone detection (0–12% of pane extent).
const OUTER_ZONE_THRESHOLD: f32 = 0.12;

// ──────────────────────────────────────────────
// Workspace sidebar item geometry (shared layout computation)
// ──────────────────────────────────────────────

/// Precomputed layout geometry for workspace sidebar items.
pub(crate) struct WsSidebarGeometry {
    pub content_x: f32,
    pub content_w: f32,
    pub start_y: f32,
    pub item_h: f32,
    pub item_gap: f32,
}

impl WsSidebarGeometry {
    /// Get the rect of the nth workspace sidebar item.
    pub fn item_rect(&self, idx: usize) -> Rect {
        let y = self.start_y + idx as f32 * (self.item_h + self.item_gap);
        Rect::new(self.content_x, y, self.content_w, self.item_h)
    }
}

// ──────────────────────────────────────────────
// Hover target: tracks which interactive element the mouse is over
// ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum HoverTarget {
    FileTreeEntry(usize),
    FileTreeBorder,
    SplitBorder(SplitDirection),
    PaneTabBar(PaneId),
    PaneTabClose(PaneId),
    PaneMaximize(PaneId),
    FileFinderItem(usize),
    SidebarHandle,
    TitlebarSwap,
    TitlebarSettings,
    TitlebarTheme,
    TitlebarWorkspace,
    TitlebarFileTree,
    TitlebarDock,
    BrowserBack,
    BrowserForward,
    BrowserRefresh,
    BrowserUrlBar,
    EditorScrollbar(PaneId),
    WorkspaceSidebarItem(usize),
    WorkspaceSidebarNewBtn,
    WsSidebarBorder,
    DockBorder,
}

impl HoverTarget {
    /// Returns true if this hover target's visual feedback is rendered in the chrome layer.
    /// When transitioning to/from these targets, chrome_generation must be bumped.
    pub(crate) fn affects_chrome(&self) -> bool {
        matches!(
            self,
            HoverTarget::TitlebarSwap
                | HoverTarget::TitlebarSettings
                | HoverTarget::TitlebarTheme
                | HoverTarget::TitlebarWorkspace
                | HoverTarget::TitlebarFileTree
                | HoverTarget::TitlebarDock
                | HoverTarget::BrowserBack
                | HoverTarget::BrowserForward
                | HoverTarget::BrowserRefresh
                | HoverTarget::PaneTabClose(_)
                | HoverTarget::WorkspaceSidebarItem(_)
                | HoverTarget::WorkspaceSidebarNewBtn
        )
    }

    /// Returns true if this hover target has any visual feedback (overlay or chrome).
    /// Targets that only change the cursor icon (no rendered output) return false.
    pub(crate) fn has_visual_feedback(&self) -> bool {
        !matches!(self, HoverTarget::BrowserUrlBar)
    }
}

// ──────────────────────────────────────────────
// Drop destination: tree pane
// ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DropDestination {
    TreePane(PaneId, DropZone),
    TreeRoot(DropZone),
    DockRoot(DropZone),
    Workspace(usize),
    /// Drop onto the pinned group — pins the source pane.
    PinnedGroup,
}

// ──────────────────────────────────────────────
// Pane drag & drop state machine
// ──────────────────────────────────────────────

pub(crate) enum PaneDragState {
    Idle,
    PendingDrag {
        source_pane: PaneId,
        press_pos: Vec2,
    },
    Dragging {
        source_pane: PaneId,
        drop_target: Option<DropDestination>,
        /// Cached simulate_drop result to avoid cloning the layout tree every frame.
        cached_preview_rect: Option<Rect>,
    },
}

impl PaneDragState {
    /// Returns the source pane id if a drag is in progress.
    pub(crate) fn source_pane(&self) -> Option<PaneId> {
        match self {
            PaneDragState::PendingDrag { source_pane, .. }
            | PaneDragState::Dragging { source_pane, .. } => Some(*source_pane),
            PaneDragState::Idle => None,
        }
    }
}

impl App {
    /// Hit-test whether the position is within a pane's tab bar area.
    pub(crate) fn pane_at_tab_bar(&self, pos: Vec2) -> Option<PaneId> {
        for &(id, rect) in &self.visual_pane_rects {
            let tab_rect = Rect::new(rect.x, rect.y, rect.width, TAB_BAR_HEIGHT);
            if tab_rect.contains(pos) {
                return Some(id);
            }
        }
        None
    }

    /// Hit-test whether the position is on a pane tab bar close button.
    pub(crate) fn pane_tab_close_at(&self, pos: Vec2) -> Option<PaneId> {
        for &(id, rect) in &self.visual_pane_rects {
            let tab_rect = Rect::new(rect.x, rect.y, rect.width, TAB_BAR_HEIGHT);
            if !tab_rect.contains(pos) {
                continue;
            }
            // Close badge is the rightmost badge, grid-aligned
            let cell_w = self.cell_size().width;
            let grid_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_w).floor();
            let grid_right = rect.x + PANE_PADDING + grid_cols * cell_w;
            let close_w = cell_w + BADGE_PADDING_H * 2.0;
            let close_x = grid_right - close_w;
            let close_y = rect.y + (TAB_BAR_HEIGHT - PANE_CLOSE_SIZE) / 2.0;
            if pos.x >= close_x
                && pos.x <= close_x + close_w
                && pos.y >= close_y
                && pos.y <= close_y + PANE_CLOSE_SIZE
            {
                return Some(id);
            }
        }
        None
    }

    /// Hit-test whether the position is on a pane header maximize button.
    pub(crate) fn pane_maximize_at(&self, pos: Vec2) -> Option<PaneId> {
        for &(id, rect) in &self.visual_pane_rects {
            let tab_rect = Rect::new(rect.x, rect.y, rect.width, TAB_BAR_HEIGHT);
            if !tab_rect.contains(pos) {
                continue;
            }
            let cell_w = self.cell_size().width;
            let grid_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_w).floor();
            let grid_right = rect.x + PANE_PADDING + grid_cols * cell_w;
            let close_w = cell_w + BADGE_PADDING_H * 2.0;
            let close_x = grid_right - close_w;
            let max_w = cell_w + BADGE_PADDING_H * 2.0;
            let max_x = close_x - BADGE_GAP - max_w;
            let max_y = rect.y;
            if pos.x >= max_x && pos.x <= max_x + max_w
                && pos.y >= max_y && pos.y <= max_y + TAB_BAR_HEIGHT
            {
                return Some(id);
            }
        }
        None
    }

    /// Compute the drop destination for a given mouse position during drag.
    pub(crate) fn compute_drop_destination(
        &self,
        mouse: Vec2,
        source: PaneId,
    ) -> Option<DropDestination> {
        // Check workspace sidebar first — allow cross-workspace pane moves
        if let Some(idx) = self.workspace_sidebar_item_at_pos(mouse) {
            if idx != self.ws.active {
                return Some(DropDestination::Workspace(idx));
            }
        }

        // Check pinned group area — detect drops onto the pinned group region
        if self.dock.dock_open && self.has_pinned_panes() {
            if let Some(dock_rect) = self.dock_area_rect {
                let has_term_dock = self.focused_terminal_id().map(|tid| {
                    if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        !tp.dock_layout.pane_ids().is_empty()
                    } else { false }
                }).unwrap_or(false);

                if has_term_dock {
                    let pinned_w = (dock_rect.width * self.dock.pinned_dock_ratio).max(60.0).min(dock_rect.width - 60.0);
                    let pinned_rect = Rect::new(dock_rect.x, dock_rect.y, pinned_w, dock_rect.height);
                    if pinned_rect.contains(mouse) && !self.is_pane_pinned(source) {
                        return Some(DropDestination::PinnedGroup);
                    }
                }
            }
        }

        self.compute_tree_drop_target(mouse, source)
    }

    /// Pre-compute the simulate_drop preview rect for a given drop destination.
    /// Called only when drop_target changes, not every frame.
    pub(crate) fn compute_drop_preview_rect(
        &self,
        source: PaneId,
        target: &Option<DropDestination>,
    ) -> Option<Rect> {
        let dest = target.as_ref()?;
        match dest {
            DropDestination::TreeRoot(zone) | DropDestination::TreePane(_, zone)
            | DropDestination::DockRoot(zone) => {
                if *zone == tide_core::DropZone::Center {
                    return None;
                }
                let target_id = match dest {
                    DropDestination::TreePane(tid, _) => Some(*tid),
                    _ => None,
                };

                // Use dock layout for dock drops
                let use_dock = matches!(dest, DropDestination::DockRoot(_))
                    || target_id.map(|t| self.is_pane_in_dock(t)).unwrap_or(false);

                // Pinned pane dropping on non-owning terminal: no preview
                if use_dock && self.is_pane_pinned(source) {
                    let assoc_tid = self.assoc.associated_terminal.get(&source).copied();
                    if assoc_tid != self.focused_terminal_id() {
                        return None;
                    }
                }

                if use_dock {
                    let dock_area = self.dock_area_rect?;
                    let dock_size = tide_core::Size::new(dock_area.width, dock_area.height);

                    // Self-drop from tab group: compute preview rect directly
                    // (simulate_drop fails because active tab's rect gets filtered out)
                    if target_id == Some(source) {
                        let (w, h) = (dock_size.width, dock_size.height);
                        return Some(match *zone {
                            tide_core::DropZone::Top => Rect::new(0.0, 0.0, w, h * 0.5),
                            tide_core::DropZone::Bottom => Rect::new(0.0, h * 0.5, w, h * 0.5),
                            tide_core::DropZone::Left => Rect::new(0.0, 0.0, w * 0.5, h),
                            tide_core::DropZone::Right => Rect::new(w * 0.5, 0.0, w * 0.5, h),
                            _ => return None,
                        });
                    }

                    if let Some(tid) = self.focused_terminal_id() {
                        if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                            return tp.dock_layout.simulate_drop(source, target_id, *zone, true, dock_size);
                        }
                    }
                    return None;
                }

                let pane_area = self.pane_area_rect?;
                let pane_area_size = tide_core::Size::new(pane_area.width, pane_area.height);
                self.layout.simulate_drop(source, target_id, *zone, true, pane_area_size)
            }
            DropDestination::Workspace(_) => None,
            DropDestination::PinnedGroup => {
                // Show preview covering the pinned group area
                if let Some(dock_rect) = self.dock_area_rect {
                    let pinned_w = (dock_rect.width * self.dock.pinned_dock_ratio).max(60.0).min(dock_rect.width - 60.0);
                    Some(Rect::new(0.0, 0.0, pinned_w, dock_rect.height))
                } else {
                    None
                }
            }
        }
    }

    /// Compute workspace sidebar item layout geometry.
    pub(crate) fn ws_sidebar_geometry(&self) -> Option<WsSidebarGeometry> {
        let ws_rect = self.ws.sidebar_rect?;
        let cs = self.cell_size();
        let name_h = cs.height;
        let content_w = ws_rect.width - WS_SIDEBAR_PADDING * 2.0;
        let sub_h = cs.height * WS_SIDEBAR_SUB_SCALE;
        let item_h = WS_SIDEBAR_ITEM_PAD_V * 2.0 + name_h + WS_SIDEBAR_LINE_GAP + sub_h;
        Some(WsSidebarGeometry {
            content_x: ws_rect.x + WS_SIDEBAR_PADDING,
            content_w,
            start_y: ws_rect.y + PANE_CORNER_RADIUS + WS_SIDEBAR_PADDING,
            item_h,
            item_gap: WS_SIDEBAR_ITEM_GAP,
        })
    }

    /// Hit-test workspace sidebar items. Returns the 0-based workspace index if hit.
    fn workspace_sidebar_item_at_pos(&self, pos: Vec2) -> Option<usize> {
        if !self.ws.show_sidebar {
            return None;
        }
        let geo = self.ws_sidebar_geometry()?;
        for i in 0..self.ws.workspaces.len() {
            if geo.item_rect(i).contains(pos) {
                return Some(i);
            }
        }
        None
    }

    /// Get the visual rect of a workspace sidebar item (for rendering drag highlights).
    pub(crate) fn workspace_sidebar_item_rect(&self, idx: usize) -> Option<Rect> {
        let geo = self.ws_sidebar_geometry()?;
        if idx < self.ws.workspaces.len() {
            Some(geo.item_rect(idx))
        } else {
            None
        }
    }

    /// Compute tree pane drop target (pane + zone) for drag.
    /// Uses tiling rects for hit-testing so the gap between panes is a valid drop area.
    fn compute_tree_drop_target(
        &self,
        mouse: Vec2,
        source: PaneId,
    ) -> Option<DropDestination> {
        let source_tiling = self.pane_rects
            .iter()
            .find(|(id, _)| *id == source)
            .map(|(_, r)| *r);

        // Iterate tiling rects for hit-testing (covers gap areas between panes)
        for &(id, tiling_rect) in &self.pane_rects {
            if !tiling_rect.contains(mouse) {
                continue;
            }

            // Skip if dragging onto self — UNLESS source is in a dock tab group
            // (allows splitting a tab out of its group by dropping on directional zones)
            if id == source {
                // Check if source is in a dock tab group with multiple tabs
                let in_multi_tab_group = self.is_pane_in_dock(source) && {
                    self.focused_terminal_id()
                        .and_then(|tid| {
                            if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                                tp.dock_layout.tab_group_containing(source)
                                    .map(|tg| tg.tabs.len() > 1)
                            } else { None }
                        })
                        .unwrap_or(false)
                };
                if !in_multi_tab_group {
                    continue;
                }
            }

            // Use visual rect for zone computation: rel coords outside [0,1] = in gap → edge zone
            let visual_rect = self.visual_pane_rects
                .iter()
                .find(|(vid, _)| *vid == id)
                .map(|(_, r)| *r)
                .unwrap_or(tiling_rect);

            let rel_x = (mouse.x - visual_rect.x) / visual_rect.width;
            let rel_y = (mouse.y - visual_rect.y) / visual_rect.height;

            let zone = if rel_y < 0.25 {
                DropZone::Top
            } else if rel_y > 0.75 {
                DropZone::Bottom
            } else if rel_x < 0.25 {
                DropZone::Left
            } else if rel_x > 0.75 {
                DropZone::Right
            } else {
                DropZone::Center
            };

            // Check for outer zone: if the zone is directional and the target pane's
            // tiling rect edge touches the area boundary, AND the relative
            // position is within the outer threshold → Root-level drop.
            // Use dock_area_rect for dock panes, pane_area_rect for stage panes.
            if zone != DropZone::Center {
                let (area_opt, is_dock_area) = if let Some(dock_rect) = self.dock_area_rect {
                    if dock_rect.contains(mouse) {
                        (Some(dock_rect), true)
                    } else {
                        (self.pane_area_rect, false)
                    }
                } else {
                    (self.pane_area_rect, false)
                };
                if let Some(area) = area_opt {
                    let touches_boundary = match zone {
                        DropZone::Top => tiling_rect.y <= area.y + 0.5,
                        DropZone::Bottom => tiling_rect.y + tiling_rect.height >= area.y + area.height - 0.5,
                        DropZone::Left => tiling_rect.x <= area.x + 0.5,
                        DropZone::Right => tiling_rect.x + tiling_rect.width >= area.x + area.width - 0.5,
                        DropZone::Center => false,
                    };

                    let is_outer = match zone {
                        DropZone::Top => rel_y < OUTER_ZONE_THRESHOLD,
                        DropZone::Bottom => rel_y > (1.0 - OUTER_ZONE_THRESHOLD),
                        DropZone::Left => rel_x < OUTER_ZONE_THRESHOLD,
                        DropZone::Right => rel_x > (1.0 - OUTER_ZONE_THRESHOLD),
                        DropZone::Center => false,
                    };

                    if touches_boundary && is_outer {
                        // Redundancy check: root-level drop is redundant only if the source
                        // already spans the full perpendicular extent on that edge.
                        let source_redundant = if let Some(src_rect) = source_tiling {
                            match zone {
                                DropZone::Top => {
                                    src_rect.y <= area.y + 0.5
                                        && src_rect.x <= area.x + 0.5
                                        && src_rect.x + src_rect.width >= area.x + area.width - 0.5
                                }
                                DropZone::Bottom => {
                                    src_rect.y + src_rect.height >= area.y + area.height - 0.5
                                        && src_rect.x <= area.x + 0.5
                                        && src_rect.x + src_rect.width >= area.x + area.width - 0.5
                                }
                                DropZone::Left => {
                                    src_rect.x <= area.x + 0.5
                                        && src_rect.y <= area.y + 0.5
                                        && src_rect.y + src_rect.height >= area.y + area.height - 0.5
                                }
                                DropZone::Right => {
                                    src_rect.x + src_rect.width >= area.x + area.width - 0.5
                                        && src_rect.y <= area.y + 0.5
                                        && src_rect.y + src_rect.height >= area.y + area.height - 0.5
                                }
                                DropZone::Center => false,
                            }
                        } else {
                            false
                        };

                        if !source_redundant {
                            return Some(if is_dock_area {
                                DropDestination::DockRoot(zone)
                            } else {
                                DropDestination::TreeRoot(zone)
                            });
                        }
                    }
                }
            }

            return Some(DropDestination::TreePane(id, zone));
        }
        None
    }
}
