// Spec: docs/specs/browser-pane-ux.md
use crate::adapter::inward::event_loop_adapter;
use crate::adapter::inward::keyboard_adapter;
use crate::application::ports::inward::ActionPort;
use crate::application::ports::outward::clipboard_port::ClipboardPort;
use crate::application::ports::outward::process_port::ProcessPort;
use crate::pane::browser::BrowserPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_core::{InputEvent, Key, Modifiers, MouseButton, Vec2};
use crate::tide_input::{Action, GlobalAction};
use crate::App;
use std::cell::RefCell;
use std::rc::Rc;
use std::io;
use std::path::Path;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_browser() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(id, PaneKind::Browser(BrowserPane::new(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(id);
    (app, id)
}

fn cmd() -> Modifiers {
    Modifiers { meta: true, ctrl: false, shift: false, alt: false }
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

#[derive(Clone)]
struct RecordingProcess {
    opened_urls: Rc<RefCell<Vec<String>>>,
}

impl ProcessPort for RecordingProcess {
    fn open_with_default_app(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn reveal_in_finder(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn open_url(&self, url: &str) -> io::Result<()> {
        self.opened_urls.borrow_mut().push(url.to_string());
        Ok(())
    }
}

// --- UC-1: RouteFirstActionInEmptyOrLoadingBrowserPane ---

#[test]
fn new_empty_browser_pane_starts_with_url_bar_focused() {
    // UC-1 BR-1: A new empty Browser Pane starts with the URL bar focused
    let (_app, id) = app_with_browser();
    let pane = BrowserPane::new(id);
    assert!(pane.url_input_focused);
}

#[test]
fn clicking_empty_browser_pane_content_preserves_url_bar_focus() {
    // UC-1 BR-4: Clicking Browser Pane content in an empty Browser Pane restores or preserves Browser URL-bar focus instead of switching to native content focus
    let (mut app, id) = app_with_browser();

    app.handle_action(
        Action::RouteToPane(id),
        Some(InputEvent::MouseClick {
            position: Vec2::new(32.0, 96.0),
            button: MouseButton::Left,
        }),
    );

    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!("expected Browser pane, got {:?}", other.map(|_| "non-browser")),
    };
    assert!(bp.url_input_focused);
}

#[test]
fn clicking_loading_browser_pane_content_preserves_url_bar_focus() {
    // UC-1 BR-5: Clicking Browser Pane content in a loading Browser Pane preserves Browser URL-bar focus until navigation completes or the user explicitly focuses another Browser Pane target
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.loading = true;
        bp.url_input_focused = true;
    }

    app.handle_action(
        Action::RouteToPane(id),
        Some(InputEvent::MouseClick {
            position: Vec2::new(32.0, 96.0),
            button: MouseButton::Left,
        }),
    );

    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!("expected Browser pane, got {:?}", other.map(|_| "non-browser")),
    };
    assert!(bp.url_input_focused);
}

// --- UC-2: RouteFirstActionInNavigatedOrSearchActiveBrowserPane ---

#[test]
fn clicking_navigated_browser_pane_content_focuses_webview() {
    // UC-2 BR-7: A navigated Browser Pane defaults clicks in Browser Pane content to the native WKWebView
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = false;
    }

    app.handle_action(
        Action::RouteToPane(id),
        Some(InputEvent::MouseClick {
            position: Vec2::new(32.0, 96.0),
            button: MouseButton::Left,
        }),
    );

    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!("expected Browser pane, got {:?}", other.map(|_| "non-browser")),
    };
    assert!(!bp.url_input_focused);
}

#[test]
fn cmd_l_focuses_the_browser_url_bar_after_navigation() {
    // UC-2 BR-9: Cmd+L explicitly focuses the Browser URL bar in a navigated Browser Pane
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = false;
    }

    keyboard_adapter::handle_key_down(&mut app, Key::Char('l'), cmd(), Some("l".to_string()));

    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!("expected Browser pane, got {:?}", other.map(|_| "non-browser")),
    };
    let len = bp.url.chars().count();
    assert!(bp.url_input_focused);
    assert_eq!(bp.url_selection, Some((0, len)));
}

// --- UC-3: PreserveBrowserUrlBarEditing ---

#[test]
fn incidental_browser_content_click_does_not_cancel_url_bar_editing() {
    // UC-3 BR-11: Incidental Browser Pane content clicks do not clear Browser URL-bar focus while the user is actively editing the Browser URL bar
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = "https://example.com/docs".to_string();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
    }

    app.handle_action(
        Action::RouteToPane(id),
        Some(InputEvent::MouseClick {
            position: Vec2::new(48.0, 104.0),
            button: MouseButton::Left,
        }),
    );

    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!("expected Browser pane, got {:?}", other.map(|_| "non-browser")),
    };
    assert!(bp.url_input_focused);
    assert_eq!(bp.url_input, "https://example.com/docs");
}

// --- UC-4: InvokeBrowserPaneChromeActions ---

#[test]
fn copy_url_action_copies_the_current_browser_url() {
    // UC-4 BR-17: `Copy URL` copies the current Browser Pane URL
    let (mut app, id) = app_with_browser();
    let writes = Rc::new(RefCell::new(Vec::new()));
    app.ports.clipboard = Box::new(RecordingClipboard { writes: writes.clone() });
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
    }

    app.handle_global_action(GlobalAction::Copy);

    assert_eq!(writes.borrow().as_slice(), ["https://example.com"]);
}

#[test]
fn open_externally_action_uses_process_port_open_url() {
    // UC-4 BR-18: `Open externally` calls `ProcessPort::open_url()` with the current Browser Pane URL
    let (mut app, id) = app_with_browser();
    let opened_urls = Rc::new(RefCell::new(Vec::new()));
    app.ports.process = Box::new(RecordingProcess { opened_urls: opened_urls.clone() });
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com/login".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
    }

    app.open_focused_browser_externally();

    assert_eq!(opened_urls.borrow().as_slice(), ["https://example.com/login"]);
}

// --- UC-5: PreserveBrowserPaneLoadingFeedback ---

#[test]
fn browser_ime_target_is_none_when_navigated_browser_prefers_content() {
    // Spec support: a navigated Browser Pane without URL-bar focus should not own the IME target.
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = false;
    }

    assert_eq!(event_loop_adapter::effective_ime_target(
        app.focus.focused,
        app.focus.search_focus,
        &app.modal,
        &app.panes,
    ), None);
}

#[test]
fn search_focus_keeps_browser_as_effective_ime_target() {
    // Spec support: search-active Browser Pane keeps the Browser Pane as the IME target.
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = false;
    }
    app.focus.search_focus = Some(id);

    assert_eq!(event_loop_adapter::effective_ime_target(
        app.focus.focused,
        app.focus.search_focus,
        &app.modal,
        &app.panes,
    ), Some(id));
}
