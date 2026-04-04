// Spec: docs/specs/editor.md — UC-4: PreviewScroll
use crate::pane::editor;

#[test]
fn j_scrolls_down_one_line() {
    // UC-4 BR-18: j scrolls down one line
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('j', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 1);
}

#[test]
fn k_scrolls_up_one_line() {
    // UC-4 BR-19: k scrolls up one line
    let mut v = 5;
    let mut h = 0;
    editor::apply_preview_scroll('k', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 4);
}

#[test]
fn k_does_not_scroll_below_zero() {
    // UC-4 BR-20: k does not scroll below zero
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('k', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 0);
}

#[test]
fn d_scrolls_down_half_page() {
    // UC-4 BR-21: d scrolls down half page
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('d', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 15);
}

#[test]
fn u_scrolls_up_half_page() {
    // UC-4 BR-22: u scrolls up half page
    let mut v = 20;
    let mut h = 0;
    editor::apply_preview_scroll('u', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 5);
}

#[test]
fn g_scrolls_to_top() {
    // UC-4 BR-23: g scrolls to top
    let mut v = 50;
    let mut h = 0;
    editor::apply_preview_scroll('g', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 0);
}

#[test]
fn capital_g_scrolls_to_bottom() {
    // UC-4 BR-24: G scrolls to bottom
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('G', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 100);
}

#[test]
fn scroll_clamps_to_max() {
    // UC-4 BR-24: preview scroll clamps to the available range
    let mut v = 95;
    let mut h = 0;
    editor::apply_preview_scroll('j', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 96);
    let mut v2 = 100;
    editor::apply_preview_scroll('j', &mut v2, &mut h, 100, 100, 30);
    assert_eq!(v2, 100);
}
