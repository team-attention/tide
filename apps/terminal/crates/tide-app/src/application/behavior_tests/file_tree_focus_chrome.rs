// Spec: docs/specs/file-tree-focus-chrome.md

use crate::adapter::outward::view::{
    file_tree_expanded_directory_chrome, file_tree_focus_chrome, file_tree_hover_shows_overlay,
    file_tree_name_style,
};
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

#[test]
fn focused_file_tree_cursor_row_chrome_renders_behind_entry_text() {
    // UC-1 BR-4: The focused FileTree Cursor Row chrome must render as a background layer so its fill never obscures row text.
    let source = include_str!("../../adapter/outward/view/chrome/file_tree.rs");

    let cursor_row_block = source
        .find("if is_cursor_row {")
        .expect("cursor row branch should be rendered");
    let first_row_text = source
        .find("renderer.draw_chrome_text(\n                &entry.entry.name,")
        .expect("file tree row name text should be rendered");

    assert!(
        cursor_row_block < first_row_text,
        "cursor row chrome should render before row text"
    );
}

#[test]
fn expanded_directory_rows_keep_bold_text_when_selected() {
    // UC-1 BR-5: Expanded directory rows keep their bold text styling even when the focused FileTree Cursor Row is on them.
    for palette in [DARK, LIGHT] {
        let style = file_tree_name_style(&palette, None, true, true, true);

        assert!(style.bold);
        assert_eq!(
            color_tuple(style.foreground),
            color_tuple(palette.tab_text_focused)
        );
    }
}

// --- UC-2: AvoidHoverStackOnFocusedFileTreeCursorRow ---

#[test]
fn hovered_focused_file_tree_cursor_row_does_not_stack_a_second_overlay() {
    // UC-2 BR-6/BR-7: Hover overlay is suppressed only for the focused FileTree Cursor Row and still renders for other valid hover cases.
    assert!(!file_tree_hover_shows_overlay(true, 4, 4));
    assert!(file_tree_hover_shows_overlay(true, 5, 4));
    assert!(file_tree_hover_shows_overlay(false, 4, 4));
}

// --- UC-3: RenderExpandedDirectoryRowChrome ---

#[test]
fn expanded_directory_rows_use_quiet_open_folder_chrome() {
    // UC-3 BR-8: Expanded Directory Rows use a no-stroke rounded fill that is weaker than the focused FileTree Cursor Row.
    for palette in [DARK, LIGHT] {
        let chrome = file_tree_expanded_directory_chrome(&palette);
        let focused = file_tree_focus_chrome(&palette, true);

        assert!(chrome.fill.a > 0.0);
        assert_eq!(chrome.stroke.a.to_bits(), 0.0f32.to_bits());
        assert_eq!(
            color_tuple(chrome.fill),
            color_tuple(palette.hover_file_tree)
        );
        assert!(
            chrome.fill.a < focused.cursor_fill.a,
            "open folder chrome should be quieter than focused selection chrome"
        );
    }
}

#[test]
fn borderless_file_tree_row_slabs_do_not_spend_geometry_on_hidden_strokes() {
    // UC-3 BR-8: No-stroke Expanded Directory Row slabs use the full row rect instead of an inset border geometry.
    let source = include_str!("../../adapter/outward/view/chrome/file_tree.rs");

    assert!(source.contains("if chrome.stroke.a > 0.0"));
    assert!(source.contains("renderer.draw_chrome_rounded_rect(row_rect, chrome.fill"));
}

#[test]
fn expanded_directory_cursor_rows_do_not_stack_duplicate_slabs() {
    // UC-3 BR-9: A row that is both an Expanded Directory Row and the FileTree Cursor Row must not render two stacked slab treatments.
    let source = include_str!("../../adapter/outward/view/chrome/file_tree.rs");

    assert!(source.contains("if entry.entry.is_dir && entry.is_expanded && !is_cursor_row"));
}

// --- UC-4: RenderIntegratedFileTreeContainer ---

#[test]
fn file_tree_container_uses_integrated_edge_chrome() {
    // UC-4 BR-10: FileTree panel border widths are zero in both focused and unfocused states.
    for palette in [DARK, LIGHT] {
        for tree_focused in [false, true] {
            let chrome = file_tree_focus_chrome(&palette, tree_focused);

            assert_eq!(chrome.panel_top_border.to_bits(), 0.0f32.to_bits());
            assert_eq!(chrome.panel_side_border.to_bits(), 0.0f32.to_bits());
            assert_eq!(chrome.panel_shadow_alpha.to_bits(), 0.0f32.to_bits());
        }
    }
}

#[test]
fn file_tree_container_does_not_draw_edge_gradient_seam() {
    // UC-4 BR-11: FileTree chrome source must not draw the old edge-gradient seam.
    let source = include_str!("../../adapter/outward/view/chrome/file_tree.rs");

    assert!(!source.contains("Edge gradient for depth separation"));
    assert!(!source.contains("strip_x("));
}

#[test]
fn file_tree_container_uses_subtle_edge_separator_not_dock_accent() {
    // UC-4 BR-12: FileTree View uses a subtle left edge separator from the same color family as the header separator, not the Dock accent.
    for palette in [DARK, LIGHT] {
        for tree_focused in [false, true] {
            let chrome = file_tree_focus_chrome(&palette, tree_focused);

            assert_eq!(
                color_tuple(chrome.edge_separator_color),
                color_tuple(palette.border_subtle)
            );
            assert_eq!(
                color_tuple(chrome.edge_separator_color),
                color_tuple(chrome.header_separator_color)
            );
            assert_ne!(
                color_tuple(chrome.edge_separator_color),
                color_tuple(palette.dock_tab_underline)
            );
        }
    }
}
