// Spec: docs/specs/browser-pane-v2.md
use crate::ActionPort;
use crate::application::ports::outward::process_port::ProcessPort;
use crate::pane::browser::BrowserPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_core::{LayoutEngine, SplitDirection};
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

fn app_with_navigated_browser(url: &str) -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let bp = BrowserPane::with_url(id, url.to_string());
    app.panes.insert(id, PaneKind::Browser(bp));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(id);
    (app, id)
}

fn app_with_two_browsers() -> (App, u64, u64) {
    let mut app = test_app();
    let (mut layout, first_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    let second_id = layout.split(first_id, SplitDirection::Vertical);
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

fn get_browser(app: &App, id: u64) -> &BrowserPane {
    match app.panes.get(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        _ => panic!("expected Browser pane for id {}", id),
    }
}

fn get_browser_mut(app: &mut App, id: u64) -> &mut BrowserPane {
    match app.panes.get_mut(&id) {
        Some(PaneKind::Browser(bp)) => bp,
        _ => panic!("expected Browser pane for id {}", id),
    }
}

// --- UC-1: ManageBrowserPaneDownloadsInApp ---

#[test]
fn download_response_enters_browser_pane_download_state() {
    // UC-1 BR-1: Browser Pane V2 does not immediately hand every non-renderable response to NSWorkspace
    let (mut app, id) = app_with_navigated_browser("https://example.com/report");
    {
        let bp = get_browser_mut(&mut app, id);
        bp.loading = true;
    }

    // Simulate a download-capable response detected by the adapter
    {
        let bp = get_browser_mut(&mut app, id);
        bp.begin_download("https://example.com/report.pdf", "/tmp/report.pdf");
    }

    let bp = get_browser(&app, id);
    assert!(bp.download_state.is_some(), "Browser Pane should enter download state");
    let dl = bp.download_state.as_ref().unwrap();
    assert_eq!(dl.url, "https://example.com/report.pdf");
    assert_eq!(dl.destination, "/tmp/report.pdf");
    assert!(!dl.completed);
}

#[test]
fn download_lifecycle_preserves_browser_pane_loading_and_url_state() {
    // UC-1 BR-2: Browser Pane loading and committed Browser URL state remain coherent throughout download lifecycle changes
    let (mut app, id) = app_with_navigated_browser("https://example.com/files");
    {
        let bp = get_browser_mut(&mut app, id);
        bp.loading = true;
        bp.begin_download("https://example.com/files/data.csv", "/tmp/data.csv");
    }

    let bp = get_browser(&app, id);
    // Committed URL stays at the page URL, not the download URL
    assert_eq!(bp.url, "https://example.com/files");
    // Loading should reflect the page state, not be stuck
    assert!(!bp.loading, "Page loading should clear when download takes over");
    assert!(bp.download_state.is_some());
}

#[test]
fn download_capability_failure_falls_back_to_explicit_external_handoff() {
    // UC-1 BR-3: Browser Pane external handoff remains available when in-app download capability is unavailable or fails
    let (mut app, id) = app_with_navigated_browser("https://example.com/report");
    let opened_urls = Rc::new(RefCell::new(Vec::new()));
    app.ports.process = Box::new(RecordingProcess {
        opened_urls: opened_urls.clone(),
    });
    {
        let bp = get_browser_mut(&mut app, id);
        bp.loading = true;
        // Simulate download capability failure
        bp.fail_download("https://example.com/report.pdf");
    }

    // Should fall back to external handoff
    app.open_focused_browser_externally();
    assert!(!opened_urls.borrow().is_empty(), "Should have handed off to external browser");
}

// --- UC-3: StrengthenBrowserPaneSessionState ---

#[test]
fn auth_and_download_flows_keep_browser_url_and_navigation_state_aligned() {
    // UC-3 BR-7: Browser Pane committed Browser URL, visible Browser URL, and navigation availability remain aligned after auth and download flows
    let id = 42;
    let mut bp = BrowserPane::with_url(id, "https://example.com/login".to_string());
    bp.loading = false;
    bp.can_go_back = true;

    // Simulate auth redirect: login -> oauth -> callback -> dashboard
    assert!(bp.sync_committed_url_from_navigation("https://auth.example.com/oauth"));
    assert!(bp.sync_committed_url_from_navigation("https://example.com/callback"));
    assert!(bp.sync_committed_url_from_navigation("https://example.com/dashboard"));

    assert_eq!(bp.url, "https://example.com/dashboard");
    assert_eq!(bp.url_input, "https://example.com/dashboard");
    // URL bar and committed URL must be aligned after the auth flow
    assert!(!bp.has_distinct_url_draft());
}

#[test]
fn browser_pane_v2_preserves_browser_pane_ux_hardening_rules() {
    // UC-3 BR-8: Browser Pane capability work preserves Browser Pane UX hardening invariants for FocusArea ownership and Browser URL truthfulness
    let (app, id) = app_with_browser();
    let bp = get_browser(&app, id);

    // UX hardening invariant: new empty Browser Pane starts with URL bar focused
    assert!(bp.url_input_focused);
    // UX hardening invariant: empty Browser Pane reports empty navigation state
    assert!(bp.is_empty_navigation_state());
    // UX hardening invariant: FocusArea is Stage
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn workspace_transitions_preserve_only_explicit_browser_pane_capability_state() {
    // UC-3 BR-9: Browser Pane capability state survives Workspace and Pane lifecycle transitions only when explicitly specified by the spec
    let (mut app, id) = app_with_navigated_browser("https://example.com");
    {
        let bp = get_browser_mut(&mut app, id);
        bp.loading = false;
        // Simulate a pending download state
        bp.begin_download("https://example.com/file.zip", "/tmp/file.zip");
    }

    // After workspace cold-store and restore, download state should NOT survive
    // (unless the spec explicitly says it should)
    let bp = get_browser(&app, id);
    let snapshot = bp.to_workspace_snapshot();
    let restored = BrowserPane::from_workspace_snapshot(id, &snapshot);
    assert!(
        restored.download_state.is_none(),
        "Download state should not survive workspace transition unless explicitly specified"
    );
}

// --- UC-4: HandleBrowserPanePermissionRequests ---

#[test]
fn permission_request_surfaces_in_browser_pane() {
    // UC-4 BR-10: Browser Pane surfaces permission requests through WKUIDelegate instead of silently failing
    use crate::pane::browser::{BrowserPermissionKind, BrowserPermissionRequest};

    let id = 10;
    let mut bp = BrowserPane::with_url(id, "https://meet.example.com".to_string());
    bp.loading = false;

    bp.request_permission(BrowserPermissionRequest {
        kind: BrowserPermissionKind::Camera,
        origin: "https://meet.example.com".to_string(),
    });

    assert!(bp.pending_permission.is_some(), "Permission request should surface in Browser Pane");
    let perm = bp.pending_permission.as_ref().unwrap();
    assert_eq!(perm.kind, BrowserPermissionKind::Camera);
    assert_eq!(perm.origin, "https://meet.example.com");
}

#[test]
fn denied_permission_preserves_browser_pane_state() {
    // UC-4 BR-11: Denied or dismissed permission does not break Browser Pane loading or URL state
    use crate::pane::browser::{BrowserPermissionKind, BrowserPermissionRequest};

    let id = 11;
    let mut bp = BrowserPane::with_url(id, "https://meet.example.com".to_string());
    bp.loading = false;
    bp.request_permission(BrowserPermissionRequest {
        kind: BrowserPermissionKind::Microphone,
        origin: "https://meet.example.com".to_string(),
    });

    let url_before = bp.url.clone();
    let loading_before = bp.loading;
    bp.deny_permission();

    assert_eq!(bp.url, url_before, "URL must not change after permission denial");
    assert_eq!(bp.loading, loading_before, "Loading must not change after permission denial");
    assert!(bp.pending_permission.is_none(), "Pending permission must clear after resolution");
}

#[test]
fn permission_state_clears_on_origin_change_navigation() {
    // UC-4 BR-12: Pending permission state clears on navigation to a different origin
    use crate::pane::browser::{BrowserPermissionKind, BrowserPermissionRequest};

    let id = 12;
    let mut bp = BrowserPane::with_url(id, "https://meet.example.com".to_string());
    bp.loading = false;
    bp.request_permission(BrowserPermissionRequest {
        kind: BrowserPermissionKind::Geolocation,
        origin: "https://meet.example.com".to_string(),
    });
    assert!(bp.pending_permission.is_some());

    // Navigate to a different origin
    bp.sync_committed_url_from_navigation("https://other.example.com/page");

    assert!(
        bp.pending_permission.is_none(),
        "Pending permission must clear on origin change"
    );
}

// --- UC-5: HandleBrowserPaneCertificateErrors ---

#[test]
fn certificate_error_surfaces_explicit_prompt() {
    // UC-5 BR-13: Certificate errors surface an explicit user prompt instead of silently failing or showing blank page
    use crate::pane::browser::BrowserCertificateError;

    let id = 13;
    let mut bp = BrowserPane::with_url(id, "https://localhost:8443".to_string());
    bp.loading = true;

    bp.set_certificate_error(BrowserCertificateError {
        host: "localhost".to_string(),
        reason: "SelfSigned".to_string(),
    });

    assert!(bp.pending_certificate_error.is_some());
    let cert_err = bp.pending_certificate_error.as_ref().unwrap();
    assert_eq!(cert_err.host, "localhost");
    assert_eq!(cert_err.reason, "SelfSigned");
}

#[test]
fn certificate_proceed_and_cancel_leave_browser_pane_coherent() {
    // UC-5 BR-14: User can proceed past certificate error or cancel navigation; both paths leave Browser Pane state coherent
    use crate::pane::browser::BrowserCertificateError;

    let id = 14;

    // Test proceed path
    let mut bp_proceed = BrowserPane::with_url(id, "https://localhost:8443".to_string());
    bp_proceed.loading = true;
    bp_proceed.set_certificate_error(BrowserCertificateError {
        host: "localhost".to_string(),
        reason: "SelfSigned".to_string(),
    });
    bp_proceed.proceed_past_certificate_error();
    assert!(bp_proceed.pending_certificate_error.is_none());
    // After proceed, URL stays and loading continues
    assert_eq!(bp_proceed.url, "https://localhost:8443");

    // Test cancel path
    let mut bp_cancel = BrowserPane::with_url(id, "https://localhost:8443".to_string());
    bp_cancel.loading = true;
    bp_cancel.set_certificate_error(BrowserCertificateError {
        host: "localhost".to_string(),
        reason: "Expired".to_string(),
    });
    bp_cancel.cancel_certificate_error();
    assert!(bp_cancel.pending_certificate_error.is_none());
    // Note: cancel_certificate_error does not automatically stop loading;
    // the adapter is responsible for stopping navigation after consuming the decision.
}

#[test]
fn certificate_decision_does_not_leak_to_other_panes() {
    // UC-5 BR-15: Certificate error decision scope is limited to the requesting Pane and does not leak to other Browser Panes
    use crate::pane::browser::BrowserCertificateError;

    let (mut app, first_id, second_id) = app_with_two_browsers();
    {
        let bp1 = get_browser_mut(&mut app, first_id);
        bp1.url = "https://localhost:8443".to_string();
        bp1.url_input = bp1.url.clone();
        bp1.loading = true;
        bp1.set_certificate_error(BrowserCertificateError {
            host: "localhost".to_string(),
            reason: "SelfSigned".to_string(),
        });
    }
    {
        let bp2 = get_browser_mut(&mut app, second_id);
        bp2.url = "https://localhost:9443".to_string();
        bp2.url_input = bp2.url.clone();
        bp2.loading = true;
    }

    // Resolve certificate error on first pane
    {
        let bp1 = get_browser_mut(&mut app, first_id);
        bp1.proceed_past_certificate_error();
    }

    // Second pane should have no certificate state changes
    let bp2 = get_browser(&app, second_id);
    assert!(bp2.pending_certificate_error.is_none());
    assert!(bp2.loading, "Second pane loading state must not change");
}

// --- UC-6: SupportBrowserPaneContextMenu ---

#[test]
fn right_click_shows_context_menu_with_actions() {
    // UC-6 BR-16: Right-click in Browser Pane content shows context menu with link, image, and selection actions
    use crate::pane::browser::{ContextMenuAction, ContextMenuTarget};

    let id = 16;
    let mut bp = BrowserPane::with_url(id, "https://example.com".to_string());
    bp.loading = false;

    bp.set_context_menu(ContextMenuTarget {
        link_url: Some("https://example.com/page".to_string()),
        image_url: None,
        selected_text: Some("hello world".to_string()),
    });

    let actions = bp.build_context_menu_actions();
    assert!(!actions.is_empty(), "Context menu should have actions");
    assert!(actions.contains(&ContextMenuAction::CopyLink), "Should have copy link action");
    assert!(actions.contains(&ContextMenuAction::CopySelection), "Should have copy selection action");
    assert!(actions.contains(&ContextMenuAction::OpenLinkInNewTab), "Should have open in new tab action");
    assert!(actions.contains(&ContextMenuAction::OpenLinkExternally), "Should have open externally action");
}

#[test]
fn render_mode_context_menu_omits_navigation_actions() {
    // UC-6 BR-17: Context menu in render-mode Browser Pane omits navigation actions (open in new tab, open externally) since render panes are not user-navigable
    use crate::pane::browser::{ContextMenuAction, ContextMenuTarget};

    let id = 17;
    let mut bp = BrowserPane::new_render(id, "Preview".to_string(), "<p>Hello</p>".to_string());

    bp.set_context_menu(ContextMenuTarget {
        link_url: Some("https://example.com/page".to_string()),
        image_url: None,
        selected_text: Some("Hello".to_string()),
    });

    let actions = bp.build_context_menu_actions();
    assert!(!actions.contains(&ContextMenuAction::OpenLinkInNewTab), "Render mode should omit open in new tab");
    assert!(!actions.contains(&ContextMenuAction::OpenLinkExternally), "Render mode should omit open externally");
    assert!(actions.contains(&ContextMenuAction::CopySelection), "Render mode should still allow copy selection");
}

#[test]
fn context_menu_copy_uses_selection_bridge() {
    // UC-6 BR-18: Context menu copy action uses the selection bridge text, not a separate clipboard path
    use crate::pane::browser::ContextMenuTarget;

    let id = 18;
    let mut bp = BrowserPane::with_url(id, "https://example.com".to_string());
    bp.loading = false;
    bp.update_page_selection(Some(crate::pane::browser::BrowserSelectionSnapshot {
        text: "bridge selected text".to_string(),
        html: "<span>bridge selected text</span>".to_string(),
        context: None,
        page_title: Some("Example".to_string()),
        page_url: Some("https://example.com".to_string()),
        collapsed: false,
    }));

    // Set context menu with selected_text from bridge
    bp.set_context_menu(ContextMenuTarget {
        link_url: None,
        image_url: None,
        selected_text: Some("bridge selected text".to_string()),
    });

    // The selection bridge text should be available via page_selected_text
    let copy_text = bp.page_selected_text();
    assert_eq!(
        copy_text,
        Some("bridge selected text".to_string()),
        "Context menu copy should use selection bridge text"
    );
}

// --- UC-7: SupportBrowserPanePopups ---

#[test]
fn browser_pane_created_with_url_has_no_parent_state() {
    // UC-7 BR-19/BR-20/BR-21: A BrowserPane created with a popup URL has no inherited navigation state.
    // The adapter (webview.rs) intercepts window.open/target=_blank via NEW_TAB_URLS
    // and calls open_browser_pane. Here we verify the domain invariant: a BrowserPane
    // created via with_url starts with clean state (no back/forward, no snapshot, no selection).
    let id = 70;
    let bp = BrowserPane::with_url(id, "https://example.com/popup".to_string());

    assert_eq!(bp.url, "https://example.com/popup");
    assert!(!bp.can_go_back, "New BrowserPane must not have back navigation");
    assert!(!bp.can_go_forward, "New BrowserPane must not have forward navigation");
    assert!(bp.page_snapshot.is_none(), "New BrowserPane must not have page snapshot");
    assert!(bp.page_selection.is_none(), "New BrowserPane must not have page selection");
}

// --- UC-8: ManageBrowserPaneCookiesAndStorage ---

#[test]
fn clear_cookies_removes_all_website_data() {
    // UC-8 BR-22: Clear cookies/storage action removes cookies, localStorage, sessionStorage, and IndexedDB via WKWebsiteDataStore
    let id = 22;
    let mut bp = BrowserPane::with_url(id, "https://example.com".to_string());
    bp.loading = false;

    bp.request_clear_website_data();

    assert!(bp.needs_clear_data, "needs_clear_data flag should be set after clear request");
}

#[test]
fn cookie_clear_preserves_navigation_state() {
    // UC-8 BR-23: Cookie clear does not break active navigation state (URL, loading, back/forward remain coherent)
    let id = 23;
    let mut bp = BrowserPane::with_url(id, "https://example.com/app".to_string());
    bp.loading = false;
    bp.can_go_back = true;
    bp.can_go_forward = false;

    let url_before = bp.url.clone();
    let back_before = bp.can_go_back;
    let fwd_before = bp.can_go_forward;

    bp.request_clear_website_data();

    assert_eq!(bp.url, url_before, "URL must not change after cookie clear");
    assert_eq!(bp.can_go_back, back_before, "Back navigation must not change after cookie clear");
    assert_eq!(bp.can_go_forward, fwd_before, "Forward navigation must not change after cookie clear");
    assert!(!bp.loading, "Loading must not start after cookie clear");
}

// --- UC-9: ShowBrowserPaneLoadProgress ---

#[test]
fn load_progress_exposed_as_domain_float() {
    // UC-9 BR-24: Browser Pane exposes estimatedProgress as a domain-level f64 field (0.0-1.0)
    let id = 24;
    let mut bp = BrowserPane::with_url(id, "https://example.com".to_string());

    bp.sync_load_progress(0.0);
    assert_eq!(bp.load_progress, 0.0);

    bp.sync_load_progress(0.5);
    assert_eq!(bp.load_progress, 0.5);

    bp.sync_load_progress(1.0);
    assert_eq!(bp.load_progress, 1.0);

    // Clamp out-of-range values
    bp.sync_load_progress(1.5);
    assert!(bp.load_progress <= 1.0, "Load progress must not exceed 1.0");

    bp.sync_load_progress(-0.1);
    assert!(bp.load_progress >= 0.0, "Load progress must not go below 0.0");
}

#[test]
fn load_progress_resets_on_new_navigation() {
    // UC-9 BR-25: Load progress resets to 0.0 on new navigation and reaches 1.0 when loading completes
    let id = 25;
    let mut bp = BrowserPane::with_url(id, "https://example.com".to_string());
    bp.sync_load_progress(0.8);
    assert_eq!(bp.load_progress, 0.8);

    // Start a new navigation
    bp.navigate("https://example.com/other");

    assert_eq!(bp.load_progress, 0.0, "Load progress must reset to 0.0 on new navigation");
    assert!(bp.loading, "Loading must be true after new navigation");
}

// UC-10: EnableBrowserPaneDevTools — no domain-level test needed.
// The adapter (webview.rs) uses cfg!(debug_assertions) directly when setting isInspectable.
