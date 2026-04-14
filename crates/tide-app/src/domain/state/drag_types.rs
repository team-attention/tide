// Domain types for drag & drop and hover interaction.

use crate::tide_core::{DropZone, PaneId, Rect, SplitDirection, Vec2};

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
    HeaderAction(PaneId, crate::header::HeaderHitAction),
    FileFinderItem(usize),
    SidebarHandle,
    TitlebarSwap,
    TitlebarSettings,
    TitlebarTheme,
    TitlebarIntegration,
    TitlebarWorkspace,
    TitlebarFileTree,
    TitlebarDock,
    BrowserBack,
    BrowserForward,
    BrowserRefresh,
    BrowserCopyUrl,
    BrowserOpenExternal,
    BrowserUrlBar,
    EditorScrollbar(PaneId),
    WorkspaceSidebarItem(usize),
    WorkspaceSidebarNewBtn,
    WsSidebarBorder,
    DockBorder,
    /// Cursor is over a pane's text content area (terminal, editor, diff).
    PaneContent,
    /// Cursor is over a diff pane file header (clickable to toggle).
    DiffFileHeader,
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
                | HoverTarget::TitlebarIntegration
                | HoverTarget::TitlebarWorkspace
                | HoverTarget::TitlebarFileTree
                | HoverTarget::TitlebarDock
                | HoverTarget::BrowserBack
                | HoverTarget::BrowserForward
                | HoverTarget::BrowserRefresh
                | HoverTarget::BrowserCopyUrl
                | HoverTarget::BrowserOpenExternal
                | HoverTarget::PaneTabClose(_)
                | HoverTarget::HeaderAction(_, _)
                | HoverTarget::WorkspaceSidebarItem(_)
                | HoverTarget::WorkspaceSidebarNewBtn
        )
    }

    /// Returns true if this hover target has any visual feedback (overlay or chrome).
    /// Targets that only change the cursor icon (no rendered output) return false.
    pub(crate) fn has_visual_feedback(&self) -> bool {
        !matches!(
            self,
            HoverTarget::BrowserUrlBar | HoverTarget::PaneContent | HoverTarget::DiffFileHeader
        )
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
        /// Current cursor position, updated on every mouse move during drag.
        cursor_pos: Vec2,
        /// Label text of the tab being dragged, captured at drag start.
        source_label: String,
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
