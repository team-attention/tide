// Spec: docs/specs/file-tree-focus-chrome.md

use crate::adapter::outward::view::{file_tree_focus_chrome, file_tree_hover_shows_overlay};
use crate::theme::{DARK, LIGHT};

fn color_tuple(color: crate::tide_core::Color) -> (u32, u32, u32, u32) {
    (
        color.r.to_bits(),
        color.g.to_bits(),
        color.b.to_bits(),
        color.a.to_bits(),
    )
}

// --- UC-1: RenderFocusedFileTreeChrome ---

#[test]
fn focused_file_tree_uses_selection_row_chrome_instead_of_panel_shadow() {
    // UC-1 BR-1: Focused FileTree panel chrome keeps the same quiet border weight as the unfocused FileTree and adds no focus shadow.
    for palette in [DARK, LIGHT] {
        let unfocused = file_tree_focus_chrome(&palette, false);
        let focused = file_tree_focus_chrome(&palette, true);

        assert_eq!(
            focused.panel_top_border.to_bits(),
            unfocused.panel_top_border.to_bits()
        );
        assert_eq!(
            focused.panel_side_border.to_bits(),
            unfocused.panel_side_border.to_bits()
        );
        assert_eq!(focused.panel_shadow_alpha.to_bits(), 0.0f32.to_bits());
    }
}

#[test]
fn focused_file_tree_cursor_row_uses_stroke_and_fill_without_accent_bar() {
    // UC-1 BR-2: The focused FileTree Cursor Row uses dedicated selection fill and stroke colors instead of the Dock accent bar treatment.
    for palette in [DARK, LIGHT] {
        let focused = file_tree_focus_chrome(&palette, true);

        assert!(focused.cursor_fill.a > 0.0);
        assert!(focused.cursor_stroke.a > 0.0);
        assert_eq!(focused.cursor_left_accent_width.to_bits(), 0.0f32.to_bits());
        assert_ne!(
            color_tuple(focused.cursor_fill),
            color_tuple(palette.hover_file_tree)
        );
    }
}

#[test]
fn focused_file_tree_header_separator_stays_subtle() {
    // UC-1 BR-3: The focused FileTree header separator stays in the subtle FileTree border family rather than switching to the warm Dock accent.
    for palette in [DARK, LIGHT] {
        let focused = file_tree_focus_chrome(&palette, true);

        assert_eq!(
            color_tuple(focused.header_separator_color),
            color_tuple(palette.border_subtle)
        );
        assert_ne!(
            color_tuple(focused.header_separator_color),
            color_tuple(palette.dock_tab_underline)
        );
    }
}

// --- UC-2: AvoidHoverStackOnFocusedFileTreeCursorRow ---

#[test]
fn hovered_focused_file_tree_cursor_row_does_not_stack_a_second_overlay() {
    // UC-2 BR-4/BR-5: Hover overlay is suppressed only for the focused FileTree Cursor Row and still renders for other valid hover cases.
    assert!(!file_tree_hover_shows_overlay(true, 4, 4));
    assert!(file_tree_hover_shows_overlay(true, 5, 4));
    assert!(file_tree_hover_shows_overlay(false, 4, 4));
}
