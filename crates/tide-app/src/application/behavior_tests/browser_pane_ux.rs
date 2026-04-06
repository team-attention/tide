// Spec: docs/specs/browser-pane-ux.md
use crate::adapter::inward::click_adapter::pane::handle_browser_nav_click;
use crate::adapter::inward::event_loop_adapter;
use crate::adapter::inward::keyboard_adapter;
use crate::application::ports::inward::ActionPort;
use crate::application::ports::outward::clipboard_port::ClipboardPort;
use crate::application::ports::outward::process_port::ProcessPort;
use crate::pane::browser::BrowserPane;
use crate::pane::PaneKind;
use crate::state::drag_types::HoverTarget;
use crate::state::FocusArea;
use crate::tide_core::{InputEvent, Key, Modifiers, MouseButton, Rect, Vec2};
use crate::tide_input::{Action, GlobalAction};
use crate::tide_platform::{PlatformEvent, WindowProxy};
use crate::App;
use std::cell::RefCell;
use std::io;
use std::path::Path;
use std::rc::Rc;

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
    app.panes
        .insert(id, PaneKind::Browser(BrowserPane::new(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(id);
    (app, id)
}

fn cmd() -> Modifiers {
    Modifiers {
        meta: true,
        ctrl: false,
        shift: false,
        alt: false,
    }
}

fn browser_nav_url_bar_click_x(rect: Rect, cell_w: f32, columns: f32) -> f32 {
    let nav_x = rect.x + crate::theme::PANE_PADDING;
    let buttons_w = cell_w * 2.0 * 5.0;
    let gaps_w = 8.0;
    let url_text_inset = 4.0;
    nav_x + 8.0 + buttons_w + gaps_w + url_text_inset + columns * cell_w
}

fn test_window_proxy() -> WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    WindowProxy::new(tx, std::sync::Arc::new(|| {}))
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
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
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
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
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
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
    };
    assert!(!bp.url_input_focused);
}

#[test]
fn webview_focused_keeps_navigated_browser_pane_content_owned() {
    // UC-2 BR-7: WebViewFocused keeps a navigated Browser Pane content-owned instead of bouncing to the Browser URL bar
    let (mut app, id) = app_with_browser();
    let pane_rect = Rect::new(20.0, 20.0, 640.0, 320.0);
    app.visual_pane_rects = vec![(id, pane_rect)];
    app.window.last_cursor_pos = Vec2::new(pane_rect.x + 48.0, pane_rect.y + 104.0);
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
        bp.url_selection = Some((0, 8));
    }

    event_loop_adapter::handle_platform_event(
        &mut app,
        PlatformEvent::WebViewFocused,
        &test_window_proxy(),
    );

    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
    };
    assert!(!bp.url_input_focused);
    assert!(bp.url_selection.is_none());
    assert_eq!(app.focus.focused, Some(id));
    assert_eq!(
        event_loop_adapter::effective_ime_target(
            app.focus.focused,
            app.focus.search_focus,
            &app.modal,
            &app.panes,
        ),
        None
    );
}

#[test]
fn webview_focused_releases_stale_browser_url_bar_focus_for_page_input() {
    // UC-2 BR-7: An explicit WebViewFocused event lets a navigated Browser Pane page input take ownership even if the Browser URL bar was still focused with committed text
    let (mut app, id) = app_with_browser();
    let pane_rect = Rect::new(20.0, 20.0, 640.0, 320.0);
    app.visual_pane_rects = vec![(id, pane_rect)];
    app.window.last_cursor_pos = Vec2::new(pane_rect.x + 48.0, pane_rect.y + 104.0);
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com/form".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
    }

    event_loop_adapter::handle_platform_event(
        &mut app,
        PlatformEvent::WebViewFocused,
        &test_window_proxy(),
    );

    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
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
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
    };
    let len = bp.url.chars().count();
    assert!(bp.url_input_focused);
    assert_eq!(bp.url_selection, Some((0, len)));
}

#[test]
fn clicking_browser_url_bar_positions_cursor_after_browser_actions() {
    // UC-2 BR-10: Clicking the Browser URL bar explicitly switches the Browser Pane back to URL-bar editing from a navigated state and positions the cursor relative to the rendered Browser URL text
    let (mut app, id) = app_with_browser();
    let pane_rect = Rect::new(20.0, 20.0, 640.0, 320.0);
    app.visual_pane_rects = vec![(id, pane_rect)];
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
    }

    app.window.last_cursor_pos = Vec2::new(
        browser_nav_url_bar_click_x(pane_rect, app.window.cached_cell_size.width, 8.0),
        pane_rect.y + 40.0,
    );
    handle_browser_nav_click(&mut app, &HoverTarget::BrowserUrlBar);

    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
    };
    assert_eq!(bp.url_input_cursor, 8);
    assert!(bp.url_selection.is_none());
}

// --- UC-3: PreserveBrowserUrlBarEditing ---

#[test]
fn browser_content_click_clears_url_bar_focus() {
    // UC-3 BR-11: Clicking Browser Pane content unfocuses the URL bar
    // (matches real browser behavior — clicking the page dismisses URL editing)
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
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
    };
    assert!(!bp.url_input_focused);
}

// --- UC-4: InvokeBrowserPaneChromeActions ---

#[test]
fn copy_url_action_copies_the_current_browser_url() {
    // UC-4 BR-17: `Copy URL` copies the current Browser Pane URL
    let (mut app, id) = app_with_browser();
    let writes = Rc::new(RefCell::new(Vec::new()));
    app.ports.clipboard = Box::new(RecordingClipboard {
        writes: writes.clone(),
    });
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
fn copy_url_action_prefers_selected_url_input_while_editing() {
    // UC-4 BR-17: `Copy URL` copies the current Browser Pane URL state, preferring selected Browser URL-bar text or the current Browser URL-bar input while editing
    let (mut app, id) = app_with_browser();
    let writes = Rc::new(RefCell::new(Vec::new()));
    app.ports.clipboard = Box::new(RecordingClipboard {
        writes: writes.clone(),
    });
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = "https://example.com/login".to_string();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
        bp.url_selection = Some((8, 19));
    }

    app.handle_global_action(GlobalAction::Copy);

    assert_eq!(writes.borrow().as_slice(), ["example.com"]);
}

#[test]
fn open_externally_action_uses_process_port_open_url() {
    // UC-4 BR-18: `Open externally` calls `ProcessPort::open_url()` with the current Browser Pane URL
    let (mut app, id) = app_with_browser();
    let opened_urls = Rc::new(RefCell::new(Vec::new()));
    app.ports.process = Box::new(RecordingProcess {
        opened_urls: opened_urls.clone(),
    });
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com/login".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
    }

    app.open_focused_browser_externally();

    assert_eq!(
        opened_urls.borrow().as_slice(),
        ["https://example.com/login"]
    );
}

#[test]
fn open_externally_action_prefers_url_input_while_editing() {
    // UC-4 BR-18: `Open externally` calls `ProcessPort::open_url()` with the current Browser Pane URL state, preferring the current Browser URL-bar input while editing
    let (mut app, id) = app_with_browser();
    let opened_urls = Rc::new(RefCell::new(Vec::new()));
    app.ports.process = Box::new(RecordingProcess {
        opened_urls: opened_urls.clone(),
    });
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = "https://example.com/login".to_string();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
    }

    app.open_focused_browser_externally();

    assert_eq!(
        opened_urls.borrow().as_slice(),
        ["https://example.com/login"]
    );
}

#[test]
fn content_navigation_updates_browser_url_and_actions_use_committed_state() {
    // UC-6 BR-23 / BR-24 / BR-25: content-driven navigation updates the committed Browser URL and the visible Browser URL bar when the Browser URL bar is not actively editing a distinct draft
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = "https://example.com".to_string();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
        bp.url_selection = None;

        assert!(bp.sync_committed_url_from_navigation("https://example.com/docs"));
        assert_eq!(bp.url, "https://example.com/docs");
        assert_eq!(bp.url_input, "https://example.com/docs");
        assert_eq!(
            bp.url_state_for_copy(),
            Some("https://example.com/docs".to_string())
        );
        assert_eq!(
            bp.url_state_for_external_open(),
            Some("https://example.com/docs".to_string())
        );
        assert!(!bp.has_distinct_url_draft());
    } else {
        panic!("expected Browser pane");
    }
}

#[test]
fn content_navigation_updates_visible_browser_url_when_browser_url_bar_has_no_distinct_draft() {
    // UC-6 BR-24: Content navigation updates the visible Browser URL bar when the Browser URL bar is focused but still showing the last committed Browser URL
    let id = 7;
    let mut bp = BrowserPane::with_url(id, "https://example.com".to_string());
    bp.url_input_focused = true;
    bp.url_input = "https://example.com".to_string();
    bp.url_input_cursor = bp.url_input.chars().count();

    assert!(bp.sync_committed_url_from_navigation("https://example.com/docs"));
    assert_eq!(bp.url, "https://example.com/docs");
    assert_eq!(bp.url_input, "https://example.com/docs");
}

#[test]
fn content_navigation_preserves_distinct_browser_url_draft_while_updating_committed_url() {
    // UC-6 BR-24: Content navigation preserves a distinct Browser URL draft while still updating the committed Browser URL
    let id = 8;
    let mut bp = BrowserPane::with_url(id, "https://example.com".to_string());
    bp.url_input_focused = true;
    bp.url_input = "https://example.com/search?q=browser".to_string();
    bp.url_input_cursor = bp.url_input.chars().count();

    assert!(bp.sync_committed_url_from_navigation("https://example.com/docs"));
    assert_eq!(bp.url, "https://example.com/docs");
    assert_eq!(bp.url_input, "https://example.com/search?q=browser");
}

#[test]
fn polled_browser_state_changes_bump_generation_once() {
    // UC-6 BR-26: A Browser Pane state change reported through sync_webview_state bumps generation exactly once, including loading and navigation availability changes
    let id = 9;
    let mut bp = BrowserPane::with_url(id, "https://example.com".to_string());
    let start_generation = bp.generation;

    assert!(bp.sync_webview_state_from_poll(
        Some("https://example.com/docs".to_string()),
        true,
        true,
        false,
    ));
    assert_eq!(bp.generation, start_generation + 1);
    assert_eq!(bp.url, "https://example.com/docs");
    assert_eq!(bp.url_input, "https://example.com/docs");
    assert!(bp.loading);
    assert!(bp.can_go_back);
    assert!(!bp.can_go_forward);

    let after_change = bp.generation;
    assert!(!bp.sync_webview_state_from_poll(
        Some("https://example.com/docs".to_string()),
        true,
        true,
        false,
    ));
    assert_eq!(bp.generation, after_change);
}

// --- UC-5: PreserveBrowserPaneLoadingFeedback ---

#[test]
fn context_comment_composer_hides_browser_native_view_for_overlays() {
    // UC-5 BR-20: Any ModalStack popup, including the context comment composer, hides the native Browser Pane view
    let (mut app, id) = app_with_browser();
    app.modal.context_comment_composer = Some(crate::ContextCommentComposerState::new(
        id,
        id,
        "browser".to_string(),
        None,
        "selected browser text".to_string(),
    ));

    assert!(app.browser_native_views_obscured_by_overlays());
}

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

    assert_eq!(
        event_loop_adapter::effective_ime_target(
            app.focus.focused,
            app.focus.search_focus,
            &app.modal,
            &app.panes,
        ),
        None
    );
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

    assert_eq!(
        event_loop_adapter::effective_ime_target(
            app.focus.focused,
            app.focus.search_focus,
            &app.modal,
            &app.panes,
        ),
        Some(id)
    );
}
