// UI theme constants — dark/light mode with warm neutral palette.

use crate::tide_core::Color;

// ──────────────────────────────────────────────
// ThemePalette — all mode-dependent colors
// ──────────────────────────────────────────────

#[derive(Clone, Copy)]
#[allow(dead_code)]
pub struct ThemePalette {
    // Surface
    pub surface_bg: Color,
    pub pane_bg: Color, // pane background (slightly lighter than surface_bg)
    pub file_tree_bg: Color,
    pub border_color: Color,   // gap / clear color
    pub border_focused: Color, // accent bar on focused pane
    pub border_subtle: Color,  // subtle border on all panels

    // Text
    pub tree_text: Color,       // file names
    pub tree_dir: Color,        // folder names
    pub tree_dir_icon: Color,   // folder icon color (warm)
    pub tree_icon: Color,       // file icon color (dim)
    pub tree_row_active: Color, // expanded folder row background
    pub file_tree_focus_fill: Color,
    pub file_tree_focus_stroke: Color,

    // Tab bar
    pub tab_bar_bg: Color,
    pub tab_bar_bg_focused: Color,
    pub active_tab_bg: Color,
    pub tab_text: Color,
    pub tab_text_active: Color, // active tab in unfocused pane (between dim and bright)
    pub tab_text_focused: Color,
    pub close_icon: Color,         // close button icon color
    pub dock_tab_underline: Color, // active dock tab bottom underline

    // Editor
    pub gutter_text: Color,
    pub gutter_active_text: Color,
    pub editor_modified: Color,
    pub panel_tab_bg_active: Color,

    // Drop preview (mode-independent colors kept here for consistency)
    pub drop_fill: Color,
    pub drop_border: Color,
    pub swap_border: Color,
    pub drag_source_dim: Color, // dim overlay on the source pane during drag

    // Scrollbar
    pub scrollbar_track: Color,
    pub scrollbar_thumb: Color,
    pub scrollbar_match: Color,
    pub scrollbar_current: Color,

    // Hover highlights (semi-transparent overlays)
    pub hover_file_tree: Color,
    pub hover_tab: Color,
    pub hover_close: Color,
    pub hover_panel_border: Color,

    // Search
    pub search_match_bg: Color,
    pub search_current_bg: Color,
    pub search_bar_bg: Color,
    pub search_bar_border: Color,
    pub search_bar_text: Color,
    pub search_bar_counter: Color,

    // IME preedit
    pub ime_preedit_bg: Color,
    pub ime_preedit_fg: Color,

    // Selection
    pub selection: Color,

    // Cursor accent
    pub cursor_accent: Color,

    // Conflict bar (file changed on disk while buffer dirty)
    pub conflict_bar_bg: Color,
    pub conflict_bar_text: Color,
    pub conflict_bar_btn: Color,
    pub conflict_bar_btn_text: Color,

    // Diff view
    pub diff_added_bg: Color,
    pub diff_removed_bg: Color,
    pub diff_added_gutter: Color,
    pub diff_removed_gutter: Color,

    // Header badges
    pub badge_bg: Color,
    pub badge_bg_unfocused: Color, // unfocused pane badge background
    pub badge_text: Color,
    pub badge_text_dimmed: Color,
    pub badge_git_branch: Color,
    pub badge_git_worktree: Color,
    #[allow(dead_code)]
    pub badge_git_additions: Color,
    #[allow(dead_code)]
    pub badge_git_deletions: Color,
    pub badge_conflict: Color,
    pub badge_deleted: Color,

    // Popup (branch switcher)
    pub popup_bg: Color,
    pub popup_border: Color,
    pub popup_selected: Color,
    pub popup_scrim: Color,

    // Link highlight
    pub link_color: Color,

    // Editor enhancements
    pub current_line_bg: Color,       // subtle bg on cursor line
    pub indent_guide: Color,          // vertical indent guide lines
    pub active_indent_guide: Color,   // current-line indent guide emphasis
    pub git_gutter_added: Color,      // green bar in gutter
    pub git_gutter_modified: Color,   // yellow bar in gutter
    pub bracket_match_bg: Color,      // bracket highlight background
    pub bracket_match_border: Color,  // bracket highlight border
    pub scrollbar_thumb_hover: Color, // scrollbar thumb on hover

    // File tree git status
    pub git_modified: Color,
    pub git_added: Color,
    pub git_added_bg: Color, // git added badge background
    pub git_conflict: Color,

    // Workspace sidebar
    pub ws_sidebar_text_inactive: Color, // inactive workspace item text
}

// ──────────────────────────────────────────────
// DARK palette — charcoal document surface, monochrome, high contrast
// ──────────────────────────────────────────────

pub static DARK: ThemePalette = ThemePalette {
    // Surface — app shell stays deep; document panes lift one neutral step.
    surface_bg: Color::new(0.034, 0.035, 0.040, 1.0),
    pane_bg: Color::new(0.067, 0.068, 0.077, 1.0),
    file_tree_bg: Color::new(0.047, 0.048, 0.054, 1.0), // quieter than document panes
    border_color: Color::new(0.039, 0.039, 0.043, 1.0),
    border_focused: Color::new(0.769, 0.722, 0.651, 0.65),
    border_subtle: Color::new(0.145, 0.140, 0.157, 1.0), // stronger for clearer panel edges

    // Text — warm neutral
    tree_text: Color::new(0.545, 0.545, 0.565, 1.0), // file names #8B8B90
    tree_dir: Color::new(0.678, 0.678, 0.690, 1.0),  // folder names #ADADB0
    tree_dir_icon: Color::new(0.831, 0.784, 0.714, 1.0), // folder icons #D4C8B6
    tree_icon: Color::new(0.290, 0.290, 0.306, 1.0), // file icons #4A4A4E
    tree_row_active: Color::new(1.0, 1.0, 1.0, 0.04), // quiet expanded-folder cue
    file_tree_focus_fill: Color::new(1.0, 1.0, 1.0, 0.085), // restrained selected-row fill
    file_tree_focus_stroke: Color::new(1.0, 1.0, 1.0, 0.14), // subtle list focus outline

    // Tab bar — VS Code inspired: clean minimal, bottom indicator
    tab_bar_bg: Color::new(0.088, 0.089, 0.100, 1.0), // deeper inactive chrome
    tab_bar_bg_focused: Color::new(0.155, 0.145, 0.124, 1.0), // clearer active-pane chrome
    active_tab_bg: Color::new(0.071, 0.072, 0.081, 1.0), // lifted from pane bg without becoming card-like
    tab_text: Color::new(0.370, 0.372, 0.392, 1.0),      // quieter inactive chrome
    tab_text_active: Color::new(0.680, 0.676, 0.652, 1.0), // active tab in unfocused pane
    tab_text_focused: Color::new(0.955, 0.948, 0.932, 1.0), // warm high-contrast title text
    close_icon: Color::new(0.360, 0.362, 0.385, 1.0),
    dock_tab_underline: Color::new(0.769, 0.722, 0.651, 1.0),

    // Editor
    gutter_text: Color::new(0.36, 0.36, 0.38, 1.0),
    gutter_active_text: Color::new(0.80, 0.79, 0.76, 1.0),
    editor_modified: Color::new(0.831, 0.659, 0.263, 1.0),
    panel_tab_bg_active: Color::new(0.055, 0.055, 0.063, 1.0),

    // Drop preview
    drop_fill: Color::new(1.0, 1.0, 1.0, 0.06),
    drop_border: Color::new(1.0, 1.0, 1.0, 0.18),
    swap_border: Color::new(1.0, 1.0, 1.0, 0.28),
    drag_source_dim: Color::new(0.0, 0.0, 0.0, 0.35),

    // Scrollbar
    scrollbar_track: Color::new(1.0, 1.0, 1.0, 0.024),
    scrollbar_thumb: Color::new(1.0, 1.0, 1.0, 0.10),
    scrollbar_match: Color::new(0.95, 0.75, 0.10, 0.85),
    scrollbar_current: Color::new(1.0, 0.90, 0.20, 1.0),

    // Hover
    hover_file_tree: Color::new(1.0, 1.0, 1.0, 0.04),
    hover_tab: Color::new(1.0, 1.0, 1.0, 0.05),
    hover_close: Color::new(1.0, 0.4, 0.4, 0.20),
    hover_panel_border: Color::new(1.0, 1.0, 1.0, 0.08),

    // Search
    search_match_bg: Color::new(0.65, 0.50, 0.10, 0.40),
    search_current_bg: Color::new(0.95, 0.75, 0.10, 0.60),
    search_bar_bg: Color::new(0.10, 0.10, 0.10, 1.0),
    search_bar_border: Color::new(1.0, 1.0, 1.0, 0.15),
    search_bar_text: Color::new(0.88, 0.88, 0.88, 1.0),
    search_bar_counter: Color::new(0.45, 0.45, 0.45, 1.0),

    // IME
    ime_preedit_bg: Color::new(0.10, 0.10, 0.10, 1.0),
    ime_preedit_fg: Color::new(0.95, 0.95, 0.95, 1.0),

    // Selection
    selection: Color::new(1.0, 1.0, 1.0, 0.25),

    // Cursor accent
    cursor_accent: Color::new(1.0, 1.0, 1.0, 1.0),

    // Conflict bar
    conflict_bar_bg: Color::new(0.18, 0.15, 0.06, 1.0),
    conflict_bar_text: Color::new(0.88, 0.78, 0.45, 1.0),
    conflict_bar_btn: Color::new(0.24, 0.20, 0.08, 1.0),
    conflict_bar_btn_text: Color::new(0.92, 0.82, 0.50, 1.0),

    // Diff view — transparent overlays matching Tide.pen
    diff_added_bg: Color::new(0.133, 0.773, 0.369, 0.071), // #22C55E12
    diff_removed_bg: Color::new(0.937, 0.267, 0.267, 0.071), // #EF444412
    diff_added_gutter: Color::new(0.525, 0.937, 0.675, 1.0), // #86EFAC
    diff_removed_gutter: Color::new(0.937, 0.604, 0.604, 1.0), // #EF9A9A

    // Header badges — alpha 0.094 = 0x18/0xFF per Tide.pen
    badge_bg: Color::new(0.769, 0.722, 0.651, 0.135),
    badge_bg_unfocused: Color::new(0.420, 0.420, 0.439, 0.110),
    badge_text: Color::new(0.655, 0.650, 0.630, 1.0),
    badge_text_dimmed: Color::new(0.360, 0.362, 0.385, 1.0),
    badge_git_branch: Color::new(0.769, 0.722, 0.651, 1.0),
    badge_git_worktree: Color::new(0.35, 0.80, 0.75, 1.0),
    badge_git_additions: Color::new(0.30, 0.80, 0.40, 1.0),
    badge_git_deletions: Color::new(0.90, 0.35, 0.35, 1.0),
    badge_conflict: Color::new(0.90, 0.65, 0.25, 1.0),
    badge_deleted: Color::new(0.90, 0.35, 0.35, 1.0),

    // Popup
    popup_bg: Color::new(0.067, 0.067, 0.075, 1.0),
    popup_border: Color::new(0.165, 0.165, 0.180, 1.0),
    popup_selected: Color::new(1.0, 1.0, 1.0, 0.024),
    popup_scrim: Color::new(0.0, 0.0, 0.0, 0.60),

    // Link highlight — #4E94CE blue
    link_color: Color::new(0.306, 0.580, 0.808, 1.0),

    // Editor enhancements
    current_line_bg: Color::new(1.0, 1.0, 1.0, 0.040), // visible without becoming a stripe
    indent_guide: Color::new(1.0, 1.0, 1.0, 0.075),    // quiet structural read
    active_indent_guide: Color::new(1.0, 1.0, 1.0, 0.145),
    git_gutter_added: Color::new(0.133, 0.773, 0.369, 0.80), // green bar
    git_gutter_modified: Color::new(0.831, 0.659, 0.263, 0.80), // yellow bar
    bracket_match_bg: Color::new(1.0, 1.0, 1.0, 0.08),       // subtle bracket bg
    bracket_match_border: Color::new(1.0, 1.0, 1.0, 0.25),   // bracket border
    scrollbar_thumb_hover: Color::new(1.0, 1.0, 1.0, 0.22),  // brighter thumb on hover

    // File tree git status
    git_modified: Color::new(0.831, 0.659, 0.263, 1.0), // warm yellow #D4A843
    git_added: Color::new(0.133, 0.773, 0.369, 1.0),    // green #22C55E
    git_added_bg: Color::new(0.133, 0.773, 0.369, 0.18), // green badge bg
    git_conflict: Color::new(0.90, 0.55, 0.20, 1.0),    // orange

    // Workspace sidebar
    ws_sidebar_text_inactive: Color::new(0.627, 0.627, 0.647, 1.0), // #A0A0A5
};

// ──────────────────────────────────────────────
// LIGHT palette — VS Code Light inspired neutral values
// ──────────────────────────────────────────────

pub static LIGHT: ThemePalette = ThemePalette {
    // Surface — VS Code Light: editor #FFFFFF, workbench #F3F3F3, separators #D4D4D4
    surface_bg: Color::rgb(0.953, 0.953, 0.953),
    pane_bg: Color::rgb(1.0, 1.0, 1.0),
    file_tree_bg: Color::rgb(0.953, 0.953, 0.953),
    border_color: Color::rgb(0.831, 0.831, 0.831),
    border_focused: Color::new(0.420, 0.545, 0.620, 0.40),
    border_subtle: Color::rgb(0.831, 0.831, 0.831),

    // Text — VS Code Light foreground scale
    tree_text: Color::rgb(0.17, 0.17, 0.17),
    tree_dir: Color::rgb(0.17, 0.17, 0.17),
    tree_dir_icon: Color::rgb(0.39, 0.39, 0.39),
    tree_icon: Color::rgb(0.46, 0.46, 0.46),
    tree_row_active: Color::new(0.420, 0.545, 0.620, 0.08),
    file_tree_focus_fill: Color::rgb(0.875, 0.902, 0.918),
    file_tree_focus_stroke: Color::rgb(0.650, 0.755, 0.815),

    // Tab bar — neutral workbench header with white active tab
    tab_bar_bg: Color::rgb(0.953, 0.953, 0.953),
    tab_bar_bg_focused: Color::rgb(0.965, 0.965, 0.965),
    active_tab_bg: Color::rgb(1.0, 1.0, 1.0),
    tab_text: Color::rgb(0.435, 0.435, 0.435),
    tab_text_active: Color::rgb(0.26, 0.26, 0.26),
    tab_text_focused: Color::rgb(0.18, 0.18, 0.18),
    close_icon: Color::rgb(0.435, 0.435, 0.435),
    dock_tab_underline: Color::rgb(0.420, 0.545, 0.620),

    // Editor
    gutter_text: Color::rgb(0.420, 0.545, 0.620),
    gutter_active_text: Color::rgb(0.18, 0.18, 0.18),
    editor_modified: Color::rgb(0.650, 0.520, 0.270),
    panel_tab_bg_active: Color::rgb(1.0, 1.0, 1.0),

    // Drop preview
    drop_fill: Color::new(0.420, 0.545, 0.620, 0.09),
    drop_border: Color::new(0.420, 0.545, 0.620, 0.26),
    swap_border: Color::new(0.420, 0.545, 0.620, 0.36),
    drag_source_dim: Color::new(0.0, 0.0, 0.0, 0.15),

    // Scrollbar
    scrollbar_track: Color::new(0.0, 0.0, 0.0, 0.04),
    scrollbar_thumb: Color::new(0.0, 0.0, 0.0, 0.22),
    scrollbar_match: Color::new(0.420, 0.545, 0.620, 0.42),
    scrollbar_current: Color::rgb(0.420, 0.545, 0.620),

    // Hover
    hover_file_tree: Color::new(0.0, 0.0, 0.0, 0.04),
    hover_tab: Color::rgb(0.910, 0.910, 0.910),
    hover_close: Color::new(1.0, 0.3, 0.3, 0.18),
    hover_panel_border: Color::rgb(0.831, 0.831, 0.831),

    // Search
    search_match_bg: Color::new(0.973, 0.847, 0.376, 0.65),
    search_current_bg: Color::new(0.973, 0.847, 0.376, 0.95),
    search_bar_bg: Color::rgb(1.0, 1.0, 1.0),
    search_bar_border: Color::rgb(0.807, 0.807, 0.807),
    search_bar_text: Color::rgb(0.18, 0.18, 0.18),
    search_bar_counter: Color::rgb(0.435, 0.435, 0.435),

    // IME
    ime_preedit_bg: Color::rgb(0.925, 0.935, 0.945),
    ime_preedit_fg: Color::rgb(0.18, 0.18, 0.18),

    // Selection
    selection: Color::new(0.745, 0.820, 0.875, 0.42),

    // Cursor accent
    cursor_accent: Color::rgb(0.18, 0.18, 0.18),

    // Conflict bar
    conflict_bar_bg: Color::rgb(1.0, 0.957, 0.800),
    conflict_bar_text: Color::rgb(0.520, 0.410, 0.185),
    conflict_bar_btn: Color::rgb(0.941, 0.851, 0.612),
    conflict_bar_btn_text: Color::rgb(0.20, 0.20, 0.20),

    // Diff view
    diff_added_bg: Color::rgb(0.882, 0.961, 0.882),
    diff_removed_bg: Color::rgb(1.0, 0.902, 0.902),
    diff_added_gutter: Color::rgb(0.370, 0.625, 0.395),
    diff_removed_gutter: Color::rgb(0.690, 0.390, 0.390),

    // Header badges
    badge_bg: Color::new(0.0, 0.0, 0.0, 0.08),
    badge_bg_unfocused: Color::new(0.0, 0.0, 0.0, 0.055),
    badge_text: Color::rgb(0.20, 0.20, 0.20),
    badge_text_dimmed: Color::rgb(0.435, 0.435, 0.435),
    badge_git_branch: Color::rgb(0.560, 0.420, 0.650),
    badge_git_worktree: Color::rgb(0.350, 0.580, 0.620),
    badge_git_additions: Color::rgb(0.360, 0.620, 0.430),
    badge_git_deletions: Color::rgb(0.690, 0.390, 0.390),
    badge_conflict: Color::rgb(0.650, 0.520, 0.270),
    badge_deleted: Color::rgb(0.690, 0.390, 0.390),

    // Popup — pure white with gentle scrim
    popup_bg: Color::new(1.0, 1.0, 1.0, 1.0), // pure white
    popup_border: Color::rgb(0.831, 0.831, 0.831),
    popup_selected: Color::rgb(0.925, 0.935, 0.945),
    popup_scrim: Color::new(0.0, 0.0, 0.0, 0.12), // gentle dim

    // Link highlight
    link_color: Color::rgb(0.420, 0.545, 0.620),

    // Editor enhancements
    current_line_bg: Color::rgb(0.935, 0.940, 0.945),
    indent_guide: Color::rgb(0.827, 0.827, 0.827),
    active_indent_guide: Color::rgb(0.576, 0.576, 0.576),
    git_gutter_added: Color::new(0.360, 0.620, 0.430, 0.85),
    git_gutter_modified: Color::new(0.650, 0.520, 0.270, 0.85),
    bracket_match_bg: Color::new(0.745, 0.820, 0.875, 0.28),
    bracket_match_border: Color::rgb(0.420, 0.545, 0.620),
    scrollbar_thumb_hover: Color::new(0.0, 0.0, 0.0, 0.35),

    // File tree git status
    git_modified: Color::rgb(0.650, 0.520, 0.270),
    git_added: Color::rgb(0.360, 0.620, 0.430),
    git_added_bg: Color::new(0.360, 0.620, 0.430, 0.12),
    git_conflict: Color::rgb(0.720, 0.430, 0.300),

    // Workspace sidebar
    ws_sidebar_text_inactive: Color::rgb(0.435, 0.435, 0.435),
};

// ──────────────────────────────────────────────
// Layout constants (mode-independent)
// ──────────────────────────────────────────────

pub const BORDER_WIDTH: f32 = 1.0;
pub const PANE_GAP: f32 = 2.0;
pub const PANE_PADDING: f32 = 12.0;
pub const TERMINAL_TOP_PADDING_CELLS: f32 = 0.5;
pub const PANE_CORNER_RADIUS: f32 = 0.0;
pub const FILE_TREE_LINE_SPACING: f32 = 1.7;
pub const FILE_TREE_ROW_RADIUS: f32 = 6.0;
pub const FILE_TREE_WIDTH: f32 = 200.0;
pub const FILE_TREE_MIN_WIDTH: f32 = 160.0;
pub const TERMINAL_CONTEXT_SURFACE_WIDTH: f32 = 1040.0;
pub const TERMINAL_CONTEXT_SURFACE_MIN_WIDTH: f32 = 360.0;
pub const TERMINAL_CONTEXT_SURFACE_DEFAULT_RATIO: f32 = 0.42;

pub const TAB_BAR_HEIGHT: f32 = 35.0;
pub const SIDE_SURFACE_BORDER_HIT_SLOP: f32 = 8.0;
pub const TAB_CLOSE_ICON_SIZE: f32 = 9.0;
pub const TAB_H_PAD: f32 = 11.0;
pub const TAB_CONTENT_SPACING: f32 = 6.0;

pub fn terminal_context_surface_uses_default_width(width: f32) -> bool {
    (width - TERMINAL_CONTEXT_SURFACE_WIDTH).abs() < 0.5
}

pub fn terminal_context_surface_default_width(window_width: f32) -> f32 {
    let cap = TERMINAL_CONTEXT_SURFACE_WIDTH.min(window_width.max(0.0));
    if cap <= 0.0 {
        return 0.0;
    }
    let min = TERMINAL_CONTEXT_SURFACE_MIN_WIDTH.min(cap);
    (window_width * TERMINAL_CONTEXT_SURFACE_DEFAULT_RATIO).clamp(min, cap)
}

pub fn terminal_context_surface_width_for_layout(stored_width: f32, window_width: f32) -> f32 {
    if terminal_context_surface_uses_default_width(stored_width) {
        terminal_context_surface_default_width(window_width)
    } else {
        stored_width
    }
}

pub fn terminal_top_padding(cell_height: f32) -> f32 {
    if cell_height <= 0.0 {
        0.0
    } else {
        (cell_height * TERMINAL_TOP_PADDING_CELLS).round()
    }
}

pub fn terminal_content_top(cell_height: f32) -> f32 {
    TAB_BAR_HEIGHT + terminal_top_padding(cell_height)
}

pub const TAB_ACTIVE_INDICATOR_HEIGHT: f32 = 2.0;
pub const TAB_MAX_WIDTH: f32 = 220.0;
pub const ACTIVE_TAB_MAX_WIDTH: f32 = 228.0;
pub const ACTIVE_TAB_SOFT_MAX_WIDTH: f32 = 320.0;
pub const TAB_MIN_WIDTH: f32 = 48.0;
pub const TAB_MIN_TITLE_WIDTH: f32 = 48.0;

/// Blink animation frequency for agent NeedsInput indicators (rad/s).
/// Period ≈ 1.5 seconds. Used for tab dots, pane borders, and workspace sidebar dots.
pub const AGENT_BLINK_FREQUENCY: f64 = 4.2;

pub const PANE_CLOSE_SIZE: f32 = 14.0;

pub const DROP_PREVIEW_BORDER_WIDTH: f32 = 1.0;
pub const SWAP_PREVIEW_BORDER_WIDTH: f32 = 2.0;
pub const DRAG_THRESHOLD: f32 = 5.0;

pub const SCROLLBAR_WIDTH: f32 = 6.0;
pub const SCROLLBAR_WIDTH_HOVER: f32 = 10.0;

pub const SEARCH_BAR_WIDTH: f32 = 260.0;
pub const SEARCH_BAR_HEIGHT: f32 = 28.0;
pub const SEARCH_BAR_CLOSE_SIZE: f32 = 20.0;

pub const CONFLICT_BAR_HEIGHT: f32 = 28.0;

// Header badges
/// Height of the macOS titlebar inset (traffic light area).
/// Used to offset all layout rects so content doesn't overlap the titlebar controls.
pub const TITLEBAR_HEIGHT: f32 = 40.0;

pub const BADGE_PADDING_H: f32 = 8.0;
pub const BADGE_GAP: f32 = 6.0;
pub const BADGE_RADIUS: f32 = 100.0;

pub const FILE_TREE_HEADER_HEIGHT: f32 = 38.0;
pub const TITLEBAR_ICON_BUTTON_PAD_H: f32 = 7.0;
pub const TITLEBAR_ICON_BUTTON_PAD_V: f32 = 3.0;
pub const TITLEBAR_ICON_SCALE: f32 = 1.18;
pub const TITLEBAR_BUTTON_GAP: f32 = 8.0;
pub const WORKSPACE_SIDEBAR_WIDTH: f32 = 180.0;
pub const WS_SIDEBAR_PADDING: f32 = 8.0;
pub const WS_SIDEBAR_ITEM_GAP: f32 = 4.0;
pub const WS_SIDEBAR_ITEM_PAD_V: f32 = 5.0;
pub const WS_SIDEBAR_ITEM_PAD_H: f32 = 8.0;

// ── Popup layout constants ──
pub const POPUP_CORNER_RADIUS: f32 = 8.0; // 팝업 라운드 코너 반지름
pub const POPUP_INPUT_PADDING: f32 = 10.0; // 입력 필드 높이 = cell_h + 이 값
pub const POPUP_LINE_EXTRA: f32 = 4.0; // 리스트 줄 높이 = cell_h + 이 값
pub const POPUP_TEXT_INSET: f32 = 8.0; // 팝업 내부 텍스트 좌우 여백
pub const POPUP_BORDER_WIDTH: f32 = 1.0; // 팝업 테두리 두께
pub const POPUP_SEPARATOR: f32 = 1.0; // 구분선 두께
pub const POPUP_SEPARATOR_INSET: f32 = 4.0; // 구분선 좌우 인셋
pub const POPUP_SELECTED_INSET: f32 = 2.0; // 선택 하이라이트 좌우 인셋
pub const CURSOR_BEAM_WIDTH: f32 = 1.5; // 텍스트 커서 beam 너비
pub const SAVE_AS_POPUP_W: f32 = 310.0; // Save-as 팝업 최대 너비
pub const CONTEXT_MENU_W: f32 = 180.0; // 컨텍스트 메뉴 너비

// ── Config page layout constants ──
pub const CONFIG_PAGE_W: f32 = 560.0;
pub const CONFIG_PAGE_MAX_H: f32 = 480.0;
pub const CONFIG_PAGE_MAX_VISIBLE: usize = 14;
pub const CONFIG_PAGE_TITLE_H: f32 = 36.0;
pub const CONFIG_PAGE_TAB_H: f32 = 32.0;
pub const CONFIG_PAGE_HINT_BAR_H: f32 = 28.0;
