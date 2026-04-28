use crate::tide_core::PaneId;
use crate::tide_platform::macos::webview::WebViewHandle;

use crate::state::search::SearchState;

/// The kind of permission a website is requesting.
/// BR-10: Permission requests surface through WKUIDelegate instead of silently failing.
#[derive(Debug, Clone, PartialEq)]
pub enum BrowserPermissionKind {
    Camera,
    Microphone,
    Geolocation,
    CameraAndMicrophone,
}

/// A pending permission request from a website.
/// BR-10: Permission requests surface through WKUIDelegate instead of silently failing.
#[derive(Debug, Clone)]
pub struct BrowserPermissionRequest {
    pub kind: BrowserPermissionKind,
    pub origin: String,
}

/// The user's decision on a permission request.
#[derive(Debug, Clone, PartialEq)]
pub enum BrowserPermissionDecision {
    Pending,
    Granted,
    Denied,
}

/// A certificate error encountered during page navigation.
/// BR-13: Certificate errors surface explicit user prompt.
#[derive(Debug, Clone)]
pub struct BrowserCertificateError {
    pub host: String,
    pub reason: String,
}

/// The user's decision on a certificate error prompt.
/// BR-14: User can proceed or cancel; both leave state coherent.
#[derive(Debug, Clone, PartialEq)]
pub enum BrowserCertificateDecision {
    Pending,
    Proceed,
    Cancel,
}

/// Snapshot of a Browser Pane selection captured from the webview bridge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserSelectionSnapshot {
    pub text: String,
    pub html: String,
    pub context: Option<String>,
    pub page_title: Option<String>,
    pub page_url: Option<String>,
    pub collapsed: bool,
}

/// Right-click target captured from the webview contextmenu bridge event.
/// BR-16: Right-click shows context menu with link, image, selection actions.
#[derive(Debug, Clone, Default)]
pub struct ContextMenuTarget {
    pub link_url: Option<String>,
    pub image_url: Option<String>,
    pub selected_text: Option<String>,
}

/// Actions available in a Browser Pane context menu.
/// BR-17: Render-mode context menu omits navigation actions.
#[derive(Debug, Clone, PartialEq)]
pub enum ContextMenuAction {
    CopyLink,
    CopySelection,
    OpenLinkInNewTab,
    OpenLinkExternally,
    CopyImageUrl,
}

/// Current state of an in-app download.
/// UC-1 BR-1: Browser Pane does not immediately hand every non-renderable response to NSWorkspace.
#[derive(Debug, Clone)]
pub struct BrowserDownloadState {
    pub url: String,
    pub destination: String,
    pub completed: bool,
}

/// Snapshot of Browser Pane state for workspace cold-storage.
/// UC-3 BR-9: Capability state survives transitions only when explicitly specified.
#[derive(Debug, Clone)]
pub struct BrowserWorkspaceSnapshot {
    pub url: String,
    pub url_input: String,
}

/// Cached Browser Pane page text and metadata captured from the webview bridge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserSnapshot {
    pub text: String,
    pub page_title: Option<String>,
    pub page_url: Option<String>,
}

/// Visible Browser Pane automation marker owned by Browser Pane state.
#[derive(Debug, Clone, PartialEq)]
pub struct BrowserAutomationCursor {
    pub x: f64,
    pub y: f64,
    pub label: Option<String>,
    pub visible: bool,
}

/// A browser pane backed by a native WKWebView.
pub struct BrowserPane {
    /// Stable PaneId, used to route bridge messages back to the owning pane.
    pub id: PaneId,
    /// Current URL displayed by the webview.
    pub url: String,
    /// Editable URL bar text.
    pub url_input: String,
    /// Cursor position within url_input (char index, not byte offset).
    pub url_input_cursor: usize,
    /// Whether the URL bar has keyboard focus.
    pub url_input_focused: bool,
    /// Whether the webview is currently loading.
    pub loading: bool,
    /// Estimated page load progress (0.0–1.0).
    /// BR-24: Exposed as a domain-level f64 field from WKWebView estimatedProgress.
    pub load_progress: f64,
    /// Whether back navigation is available.
    pub can_go_back: bool,
    /// Whether forward navigation is available.
    pub can_go_forward: bool,
    /// The native WKWebView handle (created lazily when content_view_ptr is available).
    pub webview: Option<WebViewHandle>,
    /// Generation counter for dirty tracking.
    pub generation: u64,
    /// Whether this browser pane currently holds first responder status.
    pub is_first_responder: bool,
    /// Whether the webview needs to navigate to `url` once visible with a proper frame.
    pub needs_initial_navigate: bool,
    /// Find-in-page search state (Cmd+F).
    pub search: Option<SearchState>,
    /// URL bar text selection range (start_char, end_char). None = no selection.
    pub url_selection: Option<(usize, usize)>,
    /// Latest BrowserSnapshot captured from the WKWebView bridge.
    pub page_snapshot: Option<BrowserSnapshot>,
    /// Latest page selection snapshot captured from the WKWebView bridge.
    pub page_selection: Option<BrowserSelectionSnapshot>,
    /// Visible Browser Automation Cursor state for agent-driven Browser Pane actions.
    automation_cursor: Option<BrowserAutomationCursor>,
    /// Browser Pane Generation last observed by an agent before structured action.
    agent_observed_generation: Option<u64>,
    /// Whether the agent must observe again before content-changing Browser Pane actions.
    agent_reobserve_required: bool,
    /// Whether the selection bridge has been injected into the current page context.
    selection_bridge_installed: bool,
    /// Current context menu target captured from the webview bridge.
    /// BR-16: Right-click shows context menu with link, image, selection actions.
    pub context_menu: Option<ContextMenuTarget>,
    /// Pending permission request from the page (e.g. camera, geolocation).
    /// BR-10: Surfaced through WKUIDelegate; BR-12: Cleared on navigation.
    pub pending_permission: Option<BrowserPermissionRequest>,
    /// User decision on the pending permission request.
    /// BR-10: Adapter consumes this to call the WKUIDelegate completion handler, then clears it.
    pub permission_decision: Option<BrowserPermissionDecision>,
    /// Pending certificate error from the page (e.g. expired cert, self-signed).
    /// BR-13: Certificate errors surface explicit user prompt.
    pub pending_certificate_error: Option<BrowserCertificateError>,
    /// User decision on the pending certificate error.
    /// BR-14: Adapter consumes this to call the completion handler, then clears it.
    /// BR-15: Scoped to requesting Pane only.
    pub certificate_decision: Option<BrowserCertificateDecision>,

    // --- Render Pane fields (Phase 3: Generative UI) ---
    /// Whether this pane is in render mode (agent-provided HTML via loadHTMLString).
    /// Render-mode panes hide the URL bar and show `render_title` in the tab.
    pub render_mode: bool,
    /// Title set by the agent for render-mode panes (shown in tab chrome).
    pub render_title: Option<String>,
    /// The latest agent-provided HTML content (without render runtime wrapper).
    pub render_html: Option<String>,
    /// Whether this render pane has an active streaming connection.
    pub streaming: bool,
    /// Whether the webview needs to load render HTML once visible with a proper frame.
    pub needs_render_load: bool,
    /// Whether the adapter should clear all website data (cookies, localStorage, sessionStorage, IndexedDB).
    /// BR-22: Domain sets this flag; adapter consumes it via WKWebsiteDataStore.
    /// BR-23: Clearing does not break active navigation state.
    pub needs_clear_data: bool,
    /// Current in-app download state, if a download is in progress.
    /// UC-1 BR-1: Browser Pane enters download state instead of immediately handing off.
    pub download_state: Option<BrowserDownloadState>,
}

impl BrowserPane {
    pub fn new(id: PaneId) -> Self {
        Self {
            id,
            url: String::new(),
            url_input: String::new(),
            url_input_cursor: 0,
            url_input_focused: true,
            loading: false,
            load_progress: 0.0,
            can_go_back: false,
            can_go_forward: false,
            webview: None,
            generation: 0,
            is_first_responder: false,
            needs_initial_navigate: false,
            search: None,
            url_selection: None,
            page_snapshot: None,
            page_selection: None,
            automation_cursor: None,
            agent_observed_generation: None,
            agent_reobserve_required: true,
            selection_bridge_installed: false,
            context_menu: None,
            pending_permission: None,
            permission_decision: None,
            pending_certificate_error: None,
            certificate_decision: None,
            render_mode: false,
            render_title: None,
            render_html: None,
            streaming: false,
            needs_render_load: false,
            needs_clear_data: false,
            download_state: None,
        }
    }

    pub fn with_url(id: PaneId, url: String) -> Self {
        let url_input = url.clone();
        let cursor = url_input.chars().count();
        Self {
            id,
            url: url.clone(),
            url_input,
            url_input_cursor: cursor,
            url_input_focused: false,
            loading: false,
            load_progress: 0.0,
            can_go_back: false,
            can_go_forward: false,
            webview: None,
            generation: 0,
            is_first_responder: false,
            needs_initial_navigate: true,
            search: None,
            url_selection: None,
            page_snapshot: None,
            page_selection: None,
            automation_cursor: None,
            agent_observed_generation: None,
            agent_reobserve_required: true,
            selection_bridge_installed: false,
            context_menu: None,
            pending_permission: None,
            permission_decision: None,
            pending_certificate_error: None,
            certificate_decision: None,
            render_mode: false,
            render_title: None,
            render_html: None,
            streaming: false,
            needs_render_load: false,
            needs_clear_data: false,
            download_state: None,
        }
    }

    /// Create a new render-mode Browser pane for generative UI.
    /// BR-26: No URL bar, title in tab.
    pub fn new_render(id: PaneId, title: String, html: String) -> Self {
        Self {
            id,
            url: String::new(),
            url_input: String::new(),
            url_input_cursor: 0,
            url_input_focused: false,
            loading: true,
            load_progress: 0.0,
            can_go_back: false,
            can_go_forward: false,
            webview: None,
            generation: 0,
            is_first_responder: false,
            needs_initial_navigate: false,
            search: None,
            url_selection: None,
            page_snapshot: None,
            page_selection: None,
            automation_cursor: None,
            agent_observed_generation: None,
            agent_reobserve_required: true,
            selection_bridge_installed: false,
            context_menu: None,
            pending_permission: None,
            permission_decision: None,
            pending_certificate_error: None,
            certificate_decision: None,
            render_mode: true,
            render_title: Some(title),
            render_html: Some(html),
            streaming: false,
            needs_render_load: true,
            needs_clear_data: false,
            download_state: None,
        }
    }

    /// Create a new render-mode Browser pane for streaming generative UI.
    pub fn new_render_stream(id: PaneId, title: String) -> Self {
        Self {
            id,
            url: String::new(),
            url_input: String::new(),
            url_input_cursor: 0,
            url_input_focused: false,
            loading: false,
            load_progress: 0.0,
            can_go_back: false,
            can_go_forward: false,
            webview: None,
            generation: 0,
            is_first_responder: false,
            needs_initial_navigate: false,
            search: None,
            url_selection: None,
            page_snapshot: None,
            page_selection: None,
            automation_cursor: None,
            agent_observed_generation: None,
            agent_reobserve_required: true,
            selection_bridge_installed: false,
            context_menu: None,
            pending_permission: None,
            permission_decision: None,
            pending_certificate_error: None,
            certificate_decision: None,
            render_mode: true,
            render_title: Some(title),
            render_html: None,
            streaming: true,
            needs_render_load: true,
            needs_clear_data: false,
            download_state: None,
        }
    }

    /// Display title for the tab.
    /// BR-26: Render-mode panes show render_title instead of page title.
    pub fn title(&self) -> String {
        if self.render_mode {
            if let Some(ref t) = self.render_title {
                return t.clone();
            }
        }
        if let Some(ref wv) = self.webview {
            if let Some(t) = wv.current_title() {
                if !t.is_empty() {
                    return t;
                }
            }
        }
        if self.url.is_empty() {
            "New Tab".to_string()
        } else {
            self.url.clone()
        }
    }

    /// Build the full HTML document with render runtime + agent HTML.
    /// BR-31: Render runtime (morphdom, Tailwind, theme vars, bridge) pre-injected.
    pub fn full_render_html(&self) -> Option<String> {
        let html = self.render_html.as_deref().unwrap_or("");
        Some(build_render_document(html))
    }

    /// Navigate to a URL. Normalizes bare domains to https://.
    /// Localhost and 127.0.0.1 URLs default to http:// instead.
    pub fn navigate(&mut self, url: &str) {
        let normalized = normalize_navigation_url(url);
        self.url = normalized.clone();
        self.url_input = normalized.clone();
        self.url_input_cursor = normalized.chars().count();
        self.loading = true;
        self.load_progress = 0.0;
        self.pending_permission = None; // BR-12: clear on navigation
        self.permission_decision = None; // BR-12: clear on navigation
        self.pending_certificate_error = None; // BR-13: clear on navigation
        self.certificate_decision = None; // BR-14: clear on navigation
        self.selection_bridge_installed = false;
        self.clear_page_snapshot();
        self.clear_page_selection();
        let mut dispatched = false;
        if let Some(ref wv) = self.webview {
            wv.navigate(&normalized);
            dispatched = true;
        }
        self.needs_initial_navigate = !dispatched;
        self.generation = self.generation.wrapping_add(1);
        self.agent_reobserve_required = true;
    }

    /// Set a pending permission request from the page.
    /// BR-10: Permission requests surface through WKUIDelegate instead of silently failing.
    pub fn request_permission(&mut self, request: BrowserPermissionRequest) {
        self.pending_permission = Some(request);
        self.generation = self.generation.wrapping_add(1);
    }

    /// Grant the pending permission request.
    /// BR-11: Denied/dismissed permission does not break loading or URL state.
    pub fn grant_permission(&mut self) {
        self.pending_permission = None;
        self.permission_decision = Some(BrowserPermissionDecision::Granted);
        self.generation = self.generation.wrapping_add(1);
    }

    /// Deny the pending permission request.
    /// BR-11: Denied/dismissed permission does not break loading or URL state.
    pub fn deny_permission(&mut self) {
        self.pending_permission = None;
        self.permission_decision = Some(BrowserPermissionDecision::Denied);
        self.generation = self.generation.wrapping_add(1);
    }

    /// Set a pending certificate error from the page.
    /// BR-13: Certificate errors surface explicit user prompt.
    pub fn set_certificate_error(&mut self, error: BrowserCertificateError) {
        self.pending_certificate_error = Some(error);
        self.generation = self.generation.wrapping_add(1);
    }

    /// User chose to proceed past the certificate error.
    /// BR-14: Clears pending error and signals adapter via certificate_decision.
    pub fn proceed_past_certificate_error(&mut self) {
        self.certificate_decision = Some(BrowserCertificateDecision::Proceed);
        self.pending_certificate_error = None;
        self.generation = self.generation.wrapping_add(1);
    }

    /// User chose to cancel the certificate error navigation.
    /// BR-14: Clears pending error and signals adapter via certificate_decision.
    pub fn cancel_certificate_error(&mut self) {
        self.certificate_decision = Some(BrowserCertificateDecision::Cancel);
        self.pending_certificate_error = None;
        self.generation = self.generation.wrapping_add(1);
    }

    /// Adapter calls this after consuming the certificate decision.
    pub fn clear_certificate_decision(&mut self) {
        self.certificate_decision = None;
    }

    /// Adapter calls this after consuming the permission decision.
    pub fn clear_permission_decision(&mut self) {
        self.permission_decision = None;
    }

    /// Set the context menu target from a right-click bridge event.
    /// BR-16: Right-click shows context menu with link, image, selection actions.
    pub fn set_context_menu(&mut self, target: ContextMenuTarget) {
        self.context_menu = Some(target);
        self.generation = self.generation.wrapping_add(1);
    }

    /// Clear the context menu target.
    pub fn clear_context_menu(&mut self) {
        self.context_menu = None;
    }

    /// Build the list of available context menu actions based on the current target.
    /// BR-17: Render-mode context menu omits OpenLinkInNewTab and OpenLinkExternally.
    /// BR-18: Context menu copy uses selection bridge text.
    pub fn build_context_menu_actions(&self) -> Vec<ContextMenuAction> {
        let Some(ref target) = self.context_menu else {
            return Vec::new();
        };
        let mut actions = Vec::new();
        if target.link_url.is_some() {
            actions.push(ContextMenuAction::CopyLink);
            if !self.render_mode {
                actions.push(ContextMenuAction::OpenLinkInNewTab);
                actions.push(ContextMenuAction::OpenLinkExternally);
            }
        }
        if target.image_url.is_some() {
            actions.push(ContextMenuAction::CopyImageUrl);
        }
        if target.selected_text.is_some() {
            actions.push(ContextMenuAction::CopySelection);
        }
        actions
    }

    /// Request clearing all website data (cookies, localStorage, sessionStorage, IndexedDB).
    /// BR-22: Domain sets the flag; adapter consumes it via WKWebsiteDataStore.
    /// BR-23: Does not affect active navigation state.
    pub fn request_clear_website_data(&mut self) {
        self.needs_clear_data = true;
        self.generation = self.generation.wrapping_add(1);
    }

    /// Adapter calls this after website data has been cleared.
    pub fn clear_data_completed(&mut self) {
        self.needs_clear_data = false;
    }

    /// Begin an in-app download.
    /// UC-1 BR-1: Browser Pane enters download state instead of immediately handing off.
    /// UC-1 BR-2: Loading clears when download takes over.
    pub fn begin_download(&mut self, url: &str, destination: &str) {
        self.download_state = Some(BrowserDownloadState {
            url: url.to_string(),
            destination: destination.to_string(),
            completed: false,
        });
        self.loading = false;
        self.generation = self.generation.wrapping_add(1);
    }

    /// Mark a download as successfully completed.
    /// UC-1 BR-1: Download state transitions to completed.
    pub fn complete_download(&mut self) {
        if let Some(ref mut state) = self.download_state {
            state.completed = true;
        }
        self.loading = false;
        self.generation = self.generation.wrapping_add(1);
    }

    /// Mark a download capability failure (URL could not be downloaded in-app).
    /// UC-1 BR-3: Falls back to explicit external handoff when in-app download fails.
    pub fn fail_download(&mut self, _url: &str) {
        self.download_state = None;
        self.loading = false;
        self.generation = self.generation.wrapping_add(1);
    }

    /// Serialize Browser Pane state for workspace cold-storage.
    /// UC-3 BR-9: Only explicitly specified state survives transitions.
    /// Strip transient capability state in-place for workspace cold-storage.
    /// UC-3 BR-9: Only url and url_input survive; downloads, permissions,
    /// certificates, context menus, and selection state are cleared.
    pub fn clear_transient_state(&mut self) {
        self.download_state = None;
        self.pending_permission = None;
        self.permission_decision = None;
        self.pending_certificate_error = None;
        self.certificate_decision = None;
        self.context_menu = None;
        self.page_selection = None;
        self.page_snapshot = None;
        self.search = None;
        self.agent_observed_generation = None;
        self.agent_reobserve_required = true;
    }

    pub fn to_workspace_snapshot(&self) -> BrowserWorkspaceSnapshot {
        BrowserWorkspaceSnapshot {
            url: self.url.clone(),
            url_input: self.url_input.clone(),
        }
    }

    /// Restore a Browser Pane from a workspace snapshot.
    /// UC-3 BR-9: Transient capability state (downloads, etc.) is NOT restored.
    pub fn from_workspace_snapshot(id: PaneId, snapshot: &BrowserWorkspaceSnapshot) -> Self {
        let mut bp = if snapshot.url.is_empty() {
            Self::new(id)
        } else {
            Self::with_url(id, snapshot.url.clone())
        };
        bp.url_input = snapshot.url_input.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp
    }

    pub fn go_back(&mut self) {
        if let Some(ref wv) = self.webview {
            wv.go_back();
        }
    }

    pub fn go_forward(&mut self) {
        if let Some(ref wv) = self.webview {
            wv.go_forward();
        }
    }

    pub fn reload(&mut self) {
        if let Some(ref wv) = self.webview {
            wv.reload();
        }
    }

    /// Set the webview frame rect (logical points).
    pub fn set_frame(&self, x: f64, y: f64, w: f64, h: f64) {
        if let Some(ref wv) = self.webview {
            wv.set_frame(x, y, w, h);
        }
    }

    /// Show or hide the webview.
    pub fn set_visible(&self, visible: bool) {
        if let Some(ref wv) = self.webview {
            wv.set_visible(visible);
        }
    }

    /// Convert char-based cursor position to byte offset for String operations.
    pub fn cursor_byte_offset(&self) -> usize {
        self.url_input
            .char_indices()
            .nth(self.url_input_cursor)
            .map(|(i, _)| i)
            .unwrap_or(self.url_input.len())
    }

    /// Number of characters in the URL input.
    pub fn url_input_char_len(&self) -> usize {
        self.url_input.chars().count()
    }

    /// Empty navigation state: no committed URL yet and not in render mode.
    pub fn is_empty_navigation_state(&self) -> bool {
        !self.render_mode && self.url.is_empty()
    }

    /// The native `WKWebView` stays hidden for empty navigation-mode panes so
    /// Tide's own Pane background remains visible instead of the default white surface.
    pub fn native_webview_should_be_visible(&self, obscured_by_overlay: bool) -> bool {
        !obscured_by_overlay && !self.is_empty_navigation_state()
    }

    /// Browser Pane content clicks should keep URL-bar focus only while the
    /// Browser Pane has no committed URL yet (nothing to interact with).
    /// Once a URL is committed, content is interactable even if still loading.
    pub fn content_click_routes_to_url_bar(&self) -> bool {
        !self.render_mode && self.is_empty_navigation_state()
    }

    /// Apply Browser Pane first-action routing for a click in Browser Pane content.
    /// Returns true when the Browser URL bar should own focus after the click.
    pub fn handle_content_click(&mut self) -> bool {
        if self.content_click_routes_to_url_bar() {
            self.url_input_focused = true;
            true
        } else {
            self.url_input_focused = false;
            self.url_selection = None;
            false
        }
    }

    /// A Browser URL draft is distinct only when the user is actively editing
    /// text that differs from the last committed Browser URL.
    pub fn has_distinct_url_draft(&self) -> bool {
        self.url_input_focused && self.url_input != self.url
    }

    /// Native WebView focus is an explicit request to move interaction into page
    /// content. Empty Browser Panes (no committed URL) stay chrome-first.
    /// Once a URL is committed, clicking the webview always gives content focus,
    /// even if the page is still loading sub-resources.
    pub fn handle_webview_focused(&mut self) -> bool {
        if self.is_empty_navigation_state() {
            self.url_input_focused = true;
            return true;
        }

        self.url_input_focused = false;
        self.url_selection = None;
        false
    }

    /// Browser URL state to copy for Browser Pane chrome or Cmd+C behavior.
    pub fn url_state_for_copy(&self) -> Option<String> {
        if self.has_distinct_url_draft() {
            self.url_selected_text()
                .or_else(|| Some(self.url_input.clone()).filter(|s| !s.is_empty()))
                .or_else(|| Some(self.url.clone()).filter(|s| !s.is_empty()))
        } else {
            Some(self.url.clone())
                .filter(|s| !s.is_empty())
                .or_else(|| Some(self.url_input.clone()).filter(|s| !s.is_empty()))
        }
    }

    /// Browser URL state to hand off to the system browser.
    pub fn url_state_for_external_open(&self) -> Option<String> {
        let input = Some(self.url_input.clone()).filter(|s| !s.is_empty());
        let committed = Some(self.url.clone()).filter(|s| !s.is_empty());
        if self.has_distinct_url_draft() {
            input.or(committed)
        } else {
            committed.or(input)
        }
    }

    /// Apply an explicit external handoff for a Browser Pane flow that Tide
    /// cannot complete in-app in this pass, such as a download fallback.
    pub fn apply_external_handoff(&mut self, url: Option<&str>) {
        let keep_distinct_draft = self.has_distinct_url_draft();

        if let Some(url) = url.filter(|s| !s.is_empty()) {
            self.url = url.to_string();
            if !keep_distinct_draft {
                self.url_input = self.url.clone();
                self.url_input_cursor = self.url_input.chars().count();
            }
        }

        self.loading = false;
        self.selection_bridge_installed = false;
        self.clear_page_snapshot();
        self.clear_page_selection();
        self.generation = self.generation.wrapping_add(1);
    }

    /// Sync the committed Browser URL from content-driven navigation. The
    /// visible Browser URL bar follows unless the user is editing a distinct
    /// draft.
    pub fn sync_committed_url_from_navigation(&mut self, current: &str) -> bool {
        if current.is_empty() || current == self.url {
            return false;
        }

        let previous_committed = self.url.clone();
        self.url = current.to_string();
        self.selection_bridge_installed = false;
        self.clear_page_snapshot();
        self.clear_page_selection();

        // BR-12: Clear pending permission on origin change.
        if extract_origin(&previous_committed) != extract_origin(current) {
            self.pending_permission = None;
            self.permission_decision = None;
        }

        let visible_url_is_stale_committed =
            self.url_input_focused && self.url_input == previous_committed;
        if !self.has_distinct_url_draft() || visible_url_is_stale_committed {
            self.url_input = current.to_string();
            self.url_input_cursor = self.url_input.chars().count();
            self.url_selection = None;
        }

        true
    }

    pub(crate) fn sync_webview_state_from_poll(
        &mut self,
        current_url: Option<String>,
        loading: bool,
        back: bool,
        fwd: bool,
    ) -> bool {
        let mut changed = false;

        // Sync URL: update url + url_input when webview navigated internally
        if let Some(current) = current_url {
            if self.sync_committed_url_from_navigation(&current) {
                changed = true;
            }
        }

        // Sync loading state
        if loading != self.loading {
            // BR-25: When loading completes, set load_progress to 1.0
            if !loading {
                self.load_progress = 1.0;
            }
            self.loading = loading;
            changed = true;
        }

        // Sync back/forward availability
        if back != self.can_go_back {
            self.can_go_back = back;
            changed = true;
        }
        if fwd != self.can_go_forward {
            self.can_go_forward = fwd;
            changed = true;
        }
        if !self.selection_bridge_installed && !self.loading {
            self.install_selection_bridge();
        }
        if changed {
            self.generation = self.generation.wrapping_add(1);
        }
        changed
    }

    /// Poll the webview for state changes (URL, loading, back/forward, progress).
    /// Returns true if any state changed (caller should invalidate chrome).
    pub fn sync_webview_state(&mut self) -> bool {
        let Some(ref wv) = self.webview else {
            return false;
        };

        let current_url = wv.current_url();
        let loading = wv.is_loading();
        let can_go_back = wv.can_go_back();
        let can_go_forward = wv.can_go_forward();
        let progress = wv.estimated_progress();

        let mut changed =
            self.sync_webview_state_from_poll(current_url, loading, can_go_back, can_go_forward);
        if self.sync_load_progress(progress) {
            changed = true;
        }
        changed
    }

    /// Sync estimated load progress from the webview.
    /// BR-24: Browser Pane exposes estimatedProgress as a domain-level f64 field (0.0–1.0).
    /// Returns true if the value changed.
    pub fn sync_load_progress(&mut self, progress: f64) -> bool {
        let clamped = progress.clamp(0.0, 1.0);
        if (self.load_progress - clamped).abs() < f64::EPSILON {
            return false;
        }
        self.load_progress = clamped;
        self.generation = self.generation.wrapping_add(1);
        true
    }

    pub fn automation_cursor(&self) -> Option<&BrowserAutomationCursor> {
        self.automation_cursor.as_ref()
    }

    pub fn normalize_navigation_url(url: &str) -> String {
        normalize_navigation_url(url)
    }

    pub fn mark_agent_observed(&mut self) {
        self.agent_observed_generation = Some(self.generation);
        self.agent_reobserve_required = false;
    }

    pub fn agent_has_fresh_observation(&self) -> bool {
        self.agent_observed_generation == Some(self.generation) && !self.agent_reobserve_required
    }

    pub fn mark_agent_action_requires_reobserve(&mut self) {
        self.agent_reobserve_required = true;
    }

    pub fn mark_human_intervention(&mut self) {
        self.agent_reobserve_required = true;
        self.generation = self.generation.wrapping_add(1);
    }

    pub fn set_automation_cursor(&mut self, cursor: BrowserAutomationCursor) {
        if self.automation_cursor.as_ref() == Some(&cursor) {
            self.sync_automation_cursor_overlay();
            return;
        }
        self.automation_cursor = Some(cursor);
        self.generation = self.generation.wrapping_add(1);
        self.sync_automation_cursor_overlay();
    }

    pub fn clear_automation_cursor(&mut self) {
        if self.automation_cursor.is_none() {
            self.sync_automation_cursor_overlay();
            return;
        }
        self.automation_cursor = None;
        self.generation = self.generation.wrapping_add(1);
        self.sync_automation_cursor_overlay();
    }

    pub fn sync_automation_cursor_overlay(&self) -> bool {
        let Some(ref wv) = self.webview else {
            return false;
        };
        let js = match self.automation_cursor.as_ref() {
            Some(cursor) if cursor.visible => {
                let label = cursor
                    .label
                    .as_deref()
                    .map(escape_js_string_literal)
                    .unwrap_or_default();
                format!(
                    "if (window.__tideSetAutomationCursor) {{ window.__tideSetAutomationCursor({{x:{}, y:{}, visible:true, label:`{}`}}); }}",
                    cursor.x, cursor.y, label
                )
            }
            _ => {
                "if (window.__tideClearAutomationCursor) { window.__tideClearAutomationCursor(); }"
                    .to_string()
            }
        };
        wv.evaluate_javascript(&js);
        true
    }

    pub fn dispatch_automation_click(&self, x: f64, y: f64) -> bool {
        let Some(ref wv) = self.webview else {
            return false;
        };
        let js = format!(
            "if (window.__tideBrowserAutomationClick) {{ window.__tideBrowserAutomationClick({}, {}); }}",
            x, y
        );
        wv.evaluate_javascript(&js);
        true
    }

    pub fn dispatch_automation_type(&self, text: &str) -> bool {
        let Some(ref wv) = self.webview else {
            return false;
        };
        let escaped = escape_js_string_literal(text);
        let js = format!(
            "if (window.__tideBrowserAutomationType) {{ window.__tideBrowserAutomationType(`{}`); }}",
            escaped
        );
        wv.evaluate_javascript(&js);
        true
    }

    pub fn dispatch_automation_press(&self, key: &str) -> bool {
        let Some(ref wv) = self.webview else {
            return false;
        };
        let escaped = escape_js_string_literal(key);
        let js = format!(
            "if (window.__tideBrowserAutomationPress) {{ window.__tideBrowserAutomationPress(`{}`); }}",
            escaped
        );
        wv.evaluate_javascript(&js);
        true
    }

    /// Get the selected text in the URL bar, if any.
    pub fn url_selected_text(&self) -> Option<String> {
        let (start, end) = self.url_selection?;
        let (lo, hi) = if start <= end {
            (start, end)
        } else {
            (end, start)
        };
        let text: String = self.url_input.chars().skip(lo).take(hi - lo).collect();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    /// Delete the selected text and place cursor at the start of the selection.
    pub fn url_delete_selection(&mut self) {
        if let Some((start, end)) = self.url_selection.take() {
            let (lo, hi) = if start <= end {
                (start, end)
            } else {
                (end, start)
            };
            let lo_byte = self
                .url_input
                .char_indices()
                .nth(lo)
                .map(|(i, _)| i)
                .unwrap_or(self.url_input.len());
            let hi_byte = self
                .url_input
                .char_indices()
                .nth(hi)
                .map(|(i, _)| i)
                .unwrap_or(self.url_input.len());
            self.url_input.replace_range(lo_byte..hi_byte, "");
            self.url_input_cursor = lo;
        }
    }

    /// Ordered selection bounds (lo, hi) in char indices.
    pub fn url_selection_ordered(&self) -> Option<(usize, usize)> {
        let (s, e) = self.url_selection?;
        Some(if s <= e { (s, e) } else { (e, s) })
    }

    /// Load render HTML into the webview via loadHTMLString.
    /// Called from layout_compute when the webview is ready and needs_render_load is true.
    pub fn load_render_content(&mut self) {
        if !self.render_mode || !self.needs_render_load {
            return;
        }
        let Some(ref wv) = self.webview else { return };
        let full_html = self.full_render_html().unwrap_or_default();
        wv.load_html_string(&full_html);
        self.selection_bridge_installed = false;
        self.clear_page_snapshot();
        self.clear_page_selection();
        self.install_selection_bridge();
        self.needs_render_load = false;
        self.generation = self.generation.wrapping_add(1);
    }

    /// Update render HTML content and trigger morphdom diff via JS eval.
    /// BR-27, BR-33: morphdom diffs against current DOM, preserving scroll/focus/input.
    pub fn update_render_content(&mut self, html: &str) {
        self.render_html = Some(html.to_string());
        self.clear_page_snapshot();
        self.clear_page_selection();
        if let Some(ref wv) = self.webview {
            // Escape for JS string literal
            let escaped = html
                .replace('\\', "\\\\")
                .replace('`', "\\`")
                .replace("${", "\\${");
            let js = format!(
                "morphdom(document.getElementById('root'), '<div id=\"root\">' + `{}` + '</div>');",
                escaped
            );
            wv.evaluate_javascript(&js);
        }
        self.generation = self.generation.wrapping_add(1);
    }

    /// Install the Browser selection bridge in the current page context.
    pub fn install_selection_bridge(&mut self) -> bool {
        let Some(ref wv) = self.webview else {
            return false;
        };
        if self.selection_bridge_installed {
            return false;
        }
        wv.evaluate_javascript(&browser_selection_bridge_script(self.id));
        self.selection_bridge_installed = true;
        self.sync_automation_cursor_overlay();
        true
    }

    /// Request a BrowserSnapshot refresh from the injected page bridge.
    pub fn request_page_snapshot_refresh(&self) {
        let Some(ref wv) = self.webview else { return };
        wv.evaluate_javascript(
            "if (window.__tideRequestPageSnapshot) { window.__tideRequestPageSnapshot(); }",
        );
    }

    /// Update the latest BrowserSnapshot from the WKWebView bridge.
    pub fn update_page_snapshot(&mut self, snapshot: Option<BrowserSnapshot>) -> bool {
        if self.page_snapshot == snapshot {
            return false;
        }
        self.page_snapshot = snapshot;
        self.generation = self.generation.wrapping_add(1);
        true
    }

    /// Clear any cached BrowserSnapshot.
    pub fn clear_page_snapshot(&mut self) {
        let _ = self.update_page_snapshot(None);
    }

    /// Update the latest page selection snapshot from the WKWebView bridge.
    pub fn update_page_selection(&mut self, selection: Option<BrowserSelectionSnapshot>) -> bool {
        if self.page_selection == selection {
            return false;
        }
        self.page_selection = selection;
        self.generation = self.generation.wrapping_add(1);
        true
    }

    /// Clear any browser page selection snapshot.
    pub fn clear_page_selection(&mut self) {
        let _ = self.update_page_selection(None);
    }

    /// Selected browser text, if the bridge has captured one.
    pub fn page_selected_text(&self) -> Option<String> {
        let selection = self.page_selection.as_ref()?;
        let text = selection.text.trim();
        if text.is_empty() {
            None
        } else {
            Some(selection.text.clone())
        }
    }

    /// Browser selection content normalized into a plain string for artifact capture.
    pub fn page_selection_content(&self) -> Option<String> {
        let selection = self.page_selection.as_ref()?;
        let mut parts = Vec::new();
        let text = selection.text.trim();
        if !text.is_empty() {
            parts.push(text.to_string());
        }
        if let Some(context) = selection
            .context
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if !parts.is_empty() {
                parts.push(String::new());
            }
            parts.push(context.to_string());
        }
        if parts.is_empty() {
            let html = selection.html.trim();
            if !html.is_empty() {
                return Some(html.to_string());
            }
            return selection.page_title.clone();
        }
        Some(parts.join("\n"))
    }

    /// BR-32: Update theme CSS variables in a render pane when dark/light mode changes.
    pub fn sync_theme_vars(&self, dark_mode: bool) {
        let Some(ref wv) = self.webview else { return };
        let vars = if dark_mode {
            "--tide-bg:#1e1e2e;--tide-fg:#cdd6f4;--tide-accent:#89b4fa;\
             --tide-surface:#313244;--tide-border:#45475a;\
             --tide-success:#a6e3a1;--tide-warning:#f9e2af;--tide-error:#f38ba8"
        } else {
            "--tide-bg:#eff1f5;--tide-fg:#4c4f69;--tide-accent:#1e66f5;\
             --tide-surface:#ccd0da;--tide-border:#bcc0cc;\
             --tide-success:#40a02b;--tide-warning:#df8e1d;--tide-error:#d20f39"
        };
        let js = format!(
            "var s=document.documentElement.style;'{}'\
             .split(';').forEach(function(v){{var p=v.split(':');s.setProperty(p[0],p[1])}})",
            vars
        );
        wv.evaluate_javascript(&js);
    }

    /// Remove the webview from the view hierarchy and drop the handle.
    pub fn destroy(&mut self) {
        if let Some(wv) = self.webview.take() {
            // WebViewHandle owns MainThreadOnly AppKit/WebKit ivars, so it
            // tears itself down on the main thread before dropping.
            wv.destroy();
        }
    }
}

/// Extract the origin (scheme + host + port) from a URL for same-origin comparison.
/// Returns the original string if parsing fails.
fn extract_origin(url: &str) -> String {
    // Find scheme://
    if let Some(scheme_end) = url.find("://") {
        let after_scheme = &url[scheme_end + 3..];
        // Find end of authority (host + port)
        let authority_end = after_scheme.find('/').unwrap_or(after_scheme.len());
        url[..scheme_end + 3 + authority_end].to_string()
    } else {
        url.to_string()
    }
}

fn normalize_navigation_url(url: &str) -> String {
    if url.contains("://") {
        url.to_string()
    } else if url.starts_with("localhost")
        || url.starts_with("127.0.0.1")
        || url.starts_with("[::1]")
    {
        format!("http://{}", url)
    } else {
        format!("https://{}", url)
    }
}

fn escape_js_string_literal(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace("${", "\\${")
}

/// Build the full render HTML document with render runtime injected.
/// BR-31: morphdom, Tailwind CSS, Tide theme CSS vars, JS bridge.
fn build_render_document(agent_html: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://unpkg.com/morphdom@2/dist/morphdom-umd.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {{
      --tide-bg: #1e1e2e;
      --tide-fg: #cdd6f4;
      --tide-accent: #89b4fa;
      --tide-surface: #313244;
      --tide-border: #45475a;
      --tide-success: #a6e3a1;
      --tide-warning: #f9e2af;
      --tide-error: #f38ba8;
    }}
    body {{ background: var(--tide-bg); color: var(--tide-fg); font-family: system-ui; margin: 0; padding: 16px; }}
  </style>
  <script>
    window.tide = {{
      send: (msg) => window.webkit.messageHandlers.tide.postMessage(JSON.stringify(msg)),
      _listeners: [],
      onMessage: (cb) => window.tide._listeners.push(cb),
      _dispatch: (msg) => window.tide._listeners.forEach(cb => cb(msg)),
    }};
  </script>
</head>
<body>
  <div id="root">{agent_html}</div>
</body>
</html>"#
    )
}

fn browser_selection_bridge_script(pane_id: PaneId) -> String {
    format!(
        r#"(() => {{
  if (window.__tideSelectionBridgeInstalled) return;
  window.__tideSelectionBridgeInstalled = true;
  const paneId = {pane_id};
  const post = (payload) => {{
    try {{
      window.webkit.messageHandlers.tide.postMessage(JSON.stringify(payload));
    }} catch (_e) {{}}
  }};
  const postPageSnapshot = () => {{
    const title = document.title || "";
    const url = window.location ? window.location.href : "";
    const root = document.body || document.documentElement;
    const text = root && typeof root.innerText === "string" ? root.innerText : "";
    post({{kind: "browser-snapshot", pane_id: paneId, text, title, url}});
  }};
  const postSelectionSnapshot = () => {{
    const selection = window.getSelection ? window.getSelection() : null;
    const title = document.title || "";
    const url = window.location ? window.location.href : "";
    if (!selection || selection.rangeCount === 0) {{
      post({{kind: "browser-selection", pane_id: paneId, text: "", html: "", context: null, title, url, collapsed: true}});
      return;
    }}
    const text = selection.toString();
    if (!text || !text.trim()) {{
      post({{kind: "browser-selection", pane_id: paneId, text: "", html: "", context: null, title, url, collapsed: true}});
      return;
    }}
    const range = selection.getRangeAt(0);
    const fragment = document.createElement("div");
    fragment.appendChild(range.cloneContents());
    const anchor = range.commonAncestorContainer && range.commonAncestorContainer.parentElement
      ? range.commonAncestorContainer.parentElement
      : document.body;
    const context = anchor && anchor.innerText ? anchor.innerText : "";
    post({{
      kind: "browser-selection",
      pane_id: paneId,
      text,
      html: fragment.innerHTML,
      context,
      title,
      url,
      collapsed: !!selection.isCollapsed
    }});
  }};
  const snapshot = () => {{
    postPageSnapshot();
    postSelectionSnapshot();
  }};
  const ensureAutomationCursor = () => {{
    let cursor = document.getElementById('__tide-automation-cursor');
    if (cursor) return cursor;
    cursor = document.createElement('div');
    cursor.id = '__tide-automation-cursor';
    cursor.style.position = 'fixed';
    cursor.style.left = '0px';
    cursor.style.top = '0px';
    cursor.style.width = '16px';
    cursor.style.height = '16px';
    cursor.style.borderRadius = '999px';
    cursor.style.background = 'rgba(255, 90, 31, 0.92)';
    cursor.style.border = '2px solid white';
    cursor.style.boxShadow = '0 0 0 2px rgba(0,0,0,0.24)';
    cursor.style.transform = 'translate(-50%, -50%)';
    cursor.style.pointerEvents = 'none';
    cursor.style.zIndex = '2147483647';
    cursor.style.display = 'none';
    cursor.style.transition = 'left 120ms ease, top 120ms ease, opacity 120ms ease';
    const label = document.createElement('div');
    label.dataset.role = 'label';
    label.style.position = 'absolute';
    label.style.left = '18px';
    label.style.top = '-10px';
    label.style.padding = '2px 6px';
    label.style.borderRadius = '999px';
    label.style.background = 'rgba(17, 24, 39, 0.92)';
    label.style.color = 'white';
    label.style.font = '12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif';
    label.style.whiteSpace = 'nowrap';
    label.style.display = 'none';
    cursor.appendChild(label);
    (document.body || document.documentElement).appendChild(cursor);
    return cursor;
  }};
  window.__tideSetAutomationCursor = (payload) => {{
    if (!payload || payload.visible === false) {{
      if (window.__tideClearAutomationCursor) window.__tideClearAutomationCursor();
      return;
    }}
    const cursor = ensureAutomationCursor();
    cursor.style.display = 'block';
    cursor.style.left = `${{payload.x || 0}}px`;
    cursor.style.top = `${{payload.y || 0}}px`;
    const label = cursor.querySelector('[data-role="label"]');
    const text = payload.label || '';
    if (label) {{
      label.textContent = text;
      label.style.display = text ? 'block' : 'none';
    }}
  }};
  window.__tideClearAutomationCursor = () => {{
    const cursor = document.getElementById('__tide-automation-cursor');
    if (cursor) cursor.style.display = 'none';
  }};
  const dispatchMouse = (target, type, x, y) => {{
    target.dispatchEvent(new MouseEvent(type, {{
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      view: window
    }}));
  }};
  window.__tideBrowserAutomationClick = (x, y) => {{
    const target = document.elementFromPoint(x, y);
    if (!target) return false;
    if (typeof target.focus === 'function') target.focus();
    dispatchMouse(target, 'mousemove', x, y);
    dispatchMouse(target, 'mouseover', x, y);
    dispatchMouse(target, 'mousedown', x, y);
    dispatchMouse(target, 'mouseup', x, y);
    dispatchMouse(target, 'click', x, y);
    return true;
  }};
  window.__tideBrowserAutomationType = (text) => {{
    const target = document.activeElement;
    if (!target) return false;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {{
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.setRangeText(text, start, end, 'end');
      target.dispatchEvent(new InputEvent('input', {{bubbles: true, data: text, inputType: 'insertText'}}));
      return true;
    }}
    if (target.isContentEditable) {{
      if (document.execCommand) {{
        document.execCommand('insertText', false, text);
      }} else {{
        target.textContent = (target.textContent || '') + text;
      }}
      target.dispatchEvent(new InputEvent('input', {{bubbles: true, data: text, inputType: 'insertText'}}));
      return true;
    }}
    return false;
  }};
  window.__tideBrowserAutomationPress = (key) => {{
    const target = document.activeElement || document.body || document.documentElement;
    if (!target) return false;
    const init = {{key, bubbles: true, cancelable: true}};
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    if ((key === 'Enter' || key === ' ') && typeof target.click === 'function' &&
        (target.tagName === 'BUTTON' || target.tagName === 'A')) {{
      target.click();
    }}
    return true;
  }};
  let scheduled = false;
  const schedule = () => {{
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {{
      scheduled = false;
      snapshot();
    }}, 0);
  }};
  window.__tideRequestPageSnapshot = schedule;
  const root = document.documentElement || document.body;
  if (root && typeof MutationObserver !== "undefined") {{
    const observer = new MutationObserver(schedule);
    observer.observe(root, {{
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    }});
  }}
  document.addEventListener("contextmenu", (e) => {{
    let link_url = null;
    let image_url = null;
    let el = e.target;
    while (el && el !== document) {{
      if (!link_url && el.tagName === "A" && el.href) link_url = el.href;
      if (!image_url && el.tagName === "IMG" && el.src) image_url = el.src;
      el = el.parentElement;
    }}
    const sel = window.getSelection ? window.getSelection() : null;
    const selected_text = (sel && sel.toString().trim()) ? sel.toString() : null;
    post({{
      kind: "browser-context-menu",
      pane_id: paneId,
      link_url,
      image_url,
      selected_text
    }});
  }}, true);
  document.addEventListener("selectionchange", schedule, true);
  document.addEventListener("mouseup", schedule, true);
  document.addEventListener("keyup", schedule, true);
  document.addEventListener("input", schedule, true);
  document.addEventListener("change", schedule, true);
  document.addEventListener("touchend", schedule, true);
  window.addEventListener("focus", schedule, true);
  window.addEventListener("load", schedule, true);
  schedule();
}})();"#,
        pane_id = pane_id
    )
}
