use crate::tide_core::PaneId;
use crate::tide_platform::macos::webview::WebViewHandle;

use crate::state::search::SearchState;

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

/// Cached Browser Pane page text and metadata captured from the webview bridge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserSnapshot {
    pub text: String,
    pub page_title: Option<String>,
    pub page_url: Option<String>,
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
    /// Whether the selection bridge has been injected into the current page context.
    selection_bridge_installed: bool,

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
            selection_bridge_installed: false,
            render_mode: false,
            render_title: None,
            render_html: None,
            streaming: false,
            needs_render_load: false,
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
            selection_bridge_installed: false,
            render_mode: false,
            render_title: None,
            render_html: None,
            streaming: false,
            needs_render_load: false,
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
            selection_bridge_installed: false,
            render_mode: true,
            render_title: Some(title),
            render_html: Some(html),
            streaming: false,
            needs_render_load: true,
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
            selection_bridge_installed: false,
            render_mode: true,
            render_title: Some(title),
            render_html: None,
            streaming: true,
            needs_render_load: true,
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
        let normalized = if url.contains("://") {
            url.to_string()
        } else if url.starts_with("localhost")
            || url.starts_with("127.0.0.1")
            || url.starts_with("[::1]")
        {
            format!("http://{}", url)
        } else {
            format!("https://{}", url)
        };
        self.url = normalized.clone();
        self.url_input = normalized.clone();
        self.url_input_cursor = normalized.chars().count();
        self.loading = true;
        self.selection_bridge_installed = false;
        self.clear_page_snapshot();
        self.clear_page_selection();
        if let Some(ref wv) = self.webview {
            wv.navigate(&normalized);
        }
        self.generation = self.generation.wrapping_add(1);
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

    /// Browser Pane content clicks should keep URL-bar focus only while the
    /// Browser Pane is empty or loading (nothing to interact with in content).
    pub fn content_click_routes_to_url_bar(&self) -> bool {
        !self.render_mode
            && (self.loading || self.is_empty_navigation_state())
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

    /// Browser URL state to copy for Browser Pane chrome or Cmd+C behavior.
    pub fn url_state_for_copy(&self) -> Option<String> {
        if self.url_input_focused {
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
        if self.url_input_focused {
            input.or(committed)
        } else {
            committed.or(input)
        }
    }

    /// Poll the webview for state changes (URL, loading, back/forward).
    /// Returns true if any state changed (caller should invalidate chrome).
    pub fn sync_webview_state(&mut self) -> bool {
        let Some(ref wv) = self.webview else {
            return false;
        };

        let current_url = wv.current_url();
        let loading = wv.is_loading();
        let back = wv.can_go_back();
        let fwd = wv.can_go_forward();

        let mut changed = false;

        // Sync URL: update url + url_input when webview navigated internally
        if let Some(current) = current_url {
            if current != self.url && !current.is_empty() {
                self.url = current.clone();
                self.selection_bridge_installed = false;
                self.clear_page_snapshot();
                self.clear_page_selection();
                // Only update the input text if user isn't actively editing
                if !self.url_input_focused {
                    self.url_input = current.clone();
                    self.url_input_cursor = current.chars().count();
                }
                changed = true;
            }
        }

        // Sync loading state
        if loading != self.loading {
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

        if changed {
            self.generation = self.generation.wrapping_add(1);
        }
        if !self.selection_bridge_installed && !self.loading {
            self.install_selection_bridge();
        }
        changed
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
            wv.remove_from_parent();
        }
    }
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
