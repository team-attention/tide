// Spec: docs/specs/browser-pane-ux.md
use crate::application::ports::inward::ActionPort;
use crate::application::ports::outward::process_port::ProcessPort;
use crate::pane::browser::BrowserPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_core::LayoutEngine;
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

fn app_with_two_browsers() -> (App, u64, u64) {
    let mut app = test_app();
    let (mut layout, first_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    let second_id = layout.split(first_id, crate::tide_core::SplitDirection::Vertical);
    app.layout = layout;
    app.panes
        .insert(first_id, PaneKind::Browser(BrowserPane::new(first_id)));
    app.panes
        .insert(second_id, PaneKind::Browser(BrowserPane::new(second_id)));
    app.focus.focused = Some(second_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(second_id);
    (app, first_id, second_id)
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

// --- UC-7: HandleUnsupportedBrowserPaneFlowsExplicitly ---

#[test]
fn external_handoff_prefers_committed_browser_url_when_browser_is_not_editing() {
    // UC-7 BR-30: External handoff preserves coherent Browser Pane chrome state, FocusArea, and committed Browser URL state after the handoff
    let (mut app, id) = app_with_browser();
    let opened_urls = Rc::new(RefCell::new(Vec::new()));
    app.ports.process = Box::new(RecordingProcess {
        opened_urls: opened_urls.clone(),
    });
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com/login".to_string();
        bp.url_input = "https://example.com/login?draft=1".to_string();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = false;
        bp.loading = true;
    }

    app.open_focused_browser_externally();

    assert_eq!(
        opened_urls.borrow().as_slice(),
        ["https://example.com/login"]
    );
    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
    };
    assert!(bp.loading);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn external_handoff_prefers_url_bar_draft_when_browser_is_editing() {
    // UC-7 BR-29: Browser Pane does not promise in-app passkey or AuthenticationServices behavior in this pass; unsupported auth flows rely on explicit external handoff
    let (mut app, id) = app_with_browser();
    let opened_urls = Rc::new(RefCell::new(Vec::new()));
    app.ports.process = Box::new(RecordingProcess {
        opened_urls: opened_urls.clone(),
    });
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com/login".to_string();
        bp.url_input = "https://example.com/login?continue=workspace".to_string();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
        bp.loading = true;
    }

    app.open_focused_browser_externally();

    assert_eq!(
        opened_urls.borrow().as_slice(),
        ["https://example.com/login?continue=workspace"]
    );
    let bp = match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|_| "non-browser")
        ),
    };
    assert!(bp.url_input_focused);
    assert!(bp.loading);
}

#[test]
fn external_handoff_requires_some_browser_url_state() {
    // UC-7 BR-27: Browser Pane non-renderable responses use an explicit external handoff path and must not leave Browser Pane loading feedback stuck on
    let (mut app, _id) = app_with_browser();
    let opened_urls = Rc::new(RefCell::new(Vec::new()));
    app.ports.process = Box::new(RecordingProcess {
        opened_urls: opened_urls.clone(),
    });

    app.open_focused_browser_externally();

    assert!(opened_urls.borrow().is_empty());
}

#[test]
fn download_external_handoff_clears_loading_and_updates_committed_browser_url() {
    // UC-7 BR-27 / BR-30: A download-triggered external handoff clears loading and keeps the committed Browser URL truthful
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com/report".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = false;
        bp.loading = true;
    }

    assert!(app.apply_webview_bridge_message(
        &serde_json::json!({
            "kind": "browser-external-handoff",
            "pane_id": id,
            "reason": "download",
            "url": "https://example.com/report.pdf"
        })
        .to_string()
    ));

    let Some(PaneKind::Browser(bp)) = app.panes.get(&id) else {
        panic!("browser pane should exist");
    };
    assert!(!bp.loading);
    assert_eq!(bp.url, "https://example.com/report.pdf");
    assert_eq!(bp.url_input, "https://example.com/report.pdf");
}

#[test]
fn download_external_handoff_preserves_distinct_browser_url_draft() {
    // UC-7 BR-30: External handoff keeps a distinct Browser URL draft while still clearing loading
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com/login".to_string();
        bp.url_input = "https://example.com/login?continue=workspace".to_string();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = true;
        bp.loading = true;
    }

    assert!(app.apply_webview_bridge_message(
        &serde_json::json!({
            "kind": "browser-external-handoff",
            "pane_id": id,
            "reason": "download",
            "url": "https://example.com/download"
        })
        .to_string()
    ));

    let Some(PaneKind::Browser(bp)) = app.panes.get(&id) else {
        panic!("browser pane should exist");
    };
    assert!(!bp.loading);
    assert_eq!(bp.url, "https://example.com/download");
    assert_eq!(bp.url_input, "https://example.com/login?continue=workspace");
}

#[test]
fn download_external_handoff_updates_originating_background_browser_pane() {
    // UC-7 BR-28: Download-triggered external handoff carries the originating PaneId and updates that Browser Pane even when another Pane is focused
    let (mut app, background_id, focused_id) = app_with_two_browsers();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&background_id) {
        bp.url = "https://example.com/report".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = false;
        bp.loading = true;
    }
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&focused_id) {
        bp.url = "https://example.com/dashboard".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = false;
        bp.loading = true;
    }

    assert!(app.apply_webview_bridge_message(
        &serde_json::json!({
            "kind": "browser-external-handoff",
            "pane_id": background_id,
            "reason": "download",
            "url": "https://example.com/report.pdf"
        })
        .to_string()
    ));

    let Some(PaneKind::Browser(background)) = app.panes.get(&background_id) else {
        panic!("background browser pane should exist");
    };
    assert!(!background.loading);
    assert_eq!(background.url, "https://example.com/report.pdf");
    assert_eq!(background.url_input, "https://example.com/report.pdf");

    let Some(PaneKind::Browser(focused)) = app.panes.get(&focused_id) else {
        panic!("focused browser pane should exist");
    };
    assert!(focused.loading);
    assert_eq!(focused.url, "https://example.com/dashboard");
    assert_eq!(focused.url_input, "https://example.com/dashboard");
}
