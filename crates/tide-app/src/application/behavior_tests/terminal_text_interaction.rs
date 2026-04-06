// Spec: docs/specs/terminal-text-interaction.md

use std::cell::RefCell;
use std::rc::Rc;

use crate::application::ports::inward::ActionPort;
use crate::application::ports::outward::clipboard_port::ClipboardPort;
use crate::pane::{PaneKind, Selection, TerminalPane};
use crate::state::FocusArea;
use crate::theme::{PANE_PADDING, TAB_BAR_HEIGHT};
use crate::tide_core::{InputEvent, MouseButton, Rect, Vec2};
use crate::tide_input::{Action, GlobalAction};
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_terminal(cols: u16, rows: u16) -> (App, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, cols, rows, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(terminal_id);
    app.router.set_focused(terminal_id);
    (app, terminal_id)
}

fn terminal_click_position(
    rect: Rect,
    cell_size: crate::tide_core::Size,
    row: usize,
    col: usize,
) -> Vec2 {
    let inner_x = rect.x + PANE_PADDING;
    let inner_y = rect.y + TAB_BAR_HEIGHT;
    let max_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_size.width).floor() as usize;
    let actual_width = max_cols as f32 * cell_size.width;
    let extra_x = ((rect.width - 2.0 * PANE_PADDING) - actual_width) / 2.0;

    Vec2::new(
        inner_x + extra_x + (col as f32 + 0.5) * cell_size.width,
        inner_y + (row as f32 + 0.5) * cell_size.height,
    )
}

#[derive(Clone)]
struct RecordingClipboard {
    writes: Rc<RefCell<Vec<String>>>,
}

impl ClipboardPort for RecordingClipboard {
    fn get_text(&self) -> Result<String, String> {
        Err("test clipboard has no read path".to_string())
    }

    fn set_text(&self, text: &str) -> Result<(), String> {
        self.writes.borrow_mut().push(text.to_string());
        Ok(())
    }
}

// --- UC-1: ActivateWrappedTerminalUrl ---

#[test]
fn cmd_clicking_a_wrapped_terminal_url_opens_the_full_url() {
    // UC-1 BR-1: Clicking any visible-row segment of a wrapped URL opens the full logical URL
    let full_url = "https://example.com/very-long-path";
    let head = "https://example.com/very-";
    let tail = "long-path";
    let (mut app, terminal_id) = app_with_terminal(25, 6);
    let pane_rect = Rect::new(
        24.0,
        12.0,
        25.0 * app.window.cached_cell_size.width + 2.0 * PANE_PADDING,
        TAB_BAR_HEIGHT + 6.0 * app.window.cached_cell_size.height,
    );
    app.pane_rects = vec![(terminal_id, pane_rect)];
    app.visual_pane_rects = vec![(terminal_id, pane_rect)];
    app.window.modifiers.meta = true;

    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) {
        pane.backend
            .load_mock_screen_for_test(&format!("{head}\n{tail}"));
    }

    app.handle_action(
        Action::RouteToPane(terminal_id),
        Some(InputEvent::MouseClick {
            position: terminal_click_position(pane_rect, app.window.cached_cell_size, 1, 2),
            button: MouseButton::Left,
        }),
    );

    let browser = app
        .panes
        .values()
        .find_map(|pane| match pane {
            PaneKind::Browser(browser) => Some(browser),
            _ => None,
        })
        .expect("expected Browser Pane to open");

    assert_eq!(browser.url, full_url);
    assert_eq!(app.focus.focus_area, FocusArea::Dock);
    assert_eq!(app.panes.len(), 2);
}

// --- UC-2: CopyWrappedTerminalSelection ---

#[test]
fn copying_terminal_selection_across_wrapped_rows_omits_the_wrap_newline() {
    // UC-2 BR-2: A wrapped visible row does not insert a newline into copied text
    let full_url = "https://example.com/very-long-path";
    let head = "https://example.com/very-";
    let tail = "long-path";
    let writes = Rc::new(RefCell::new(Vec::new()));
    let (mut app, terminal_id) = app_with_terminal(25, 6);
    app.ports.clipboard = Box::new(RecordingClipboard {
        writes: writes.clone(),
    });

    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) {
        pane.backend
            .load_mock_screen_for_test(&format!("{head}\n{tail}"));
        let visible_start = pane
            .backend
            .history_size()
            .saturating_sub(pane.backend.display_offset());
        pane.selection = Some(Selection {
            anchor: (visible_start, 0),
            end: (visible_start + 1, tail.chars().count()),
        });
    }

    app.handle_global_action(GlobalAction::Copy);

    assert_eq!(writes.borrow().as_slice(), &[full_url.to_string()]);
}

#[test]
fn copying_terminal_selection_across_a_hard_line_break_preserves_newline() {
    // UC-2 BR-3: A non-wrapped visible row preserves a newline in copied text when the selection continues to the next row
    let writes = Rc::new(RefCell::new(Vec::new()));
    let (mut app, terminal_id) = app_with_terminal(12, 6);
    app.ports.clipboard = Box::new(RecordingClipboard {
        writes: writes.clone(),
    });

    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) {
        pane.backend.load_mock_screen_for_test("alpha\r\nbeta");
        let visible_start = pane
            .backend
            .history_size()
            .saturating_sub(pane.backend.display_offset());
        pane.selection = Some(Selection {
            anchor: (visible_start, 0),
            end: (visible_start + 1, 4),
        });
    }

    app.handle_global_action(GlobalAction::Copy);

    assert_eq!(writes.borrow().as_slice(), &["alpha\nbeta".to_string()]);
}
