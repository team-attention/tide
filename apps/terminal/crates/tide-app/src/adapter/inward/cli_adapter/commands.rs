// Command handlers for Agent Gateway.
// All command functions are free functions taking port trait bounds.
// App.handle_cli_command() is the thin dispatch bridge.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::pane::browser::{
    BrowserAutomationCursor, BrowserPageElement, BrowserPageElementKind, BrowserPageMap,
    BrowserPane, BrowserSelectionSnapshot, BrowserSnapshot, BROWSER_PAGE_MAP_INTERACTABLE_LIMIT,
    BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES, BROWSER_PAGE_MAP_REGION_LIMIT,
    BROWSER_PAGE_MAP_TEXT_LIMIT_BYTES, BROWSER_SNAPSHOT_TEXT_LIMIT_BYTES,
};
use crate::agent::notification::{
    classify_codex_completed_turn_payload, codex_stop_notification_snippet,
    resolve_codex_stop_payload, wrapped_agent_notification_snippet_from_payload, CodexStopResolution,
};
use crate::pane::PaneKind;
use crate::state::gateway_status::{AgentInfo, AgentStatus};
use crate::state::FocusArea;
use crate::tide_core::{PaneId, Rect, SplitDirection, TerminalBackend};
use crate::tide_layout::LayoutSnapshot;
use crate::ActionPort;
use crate::AppCorePort;
use crate::DockPort;
use crate::FocusNavPort;
use crate::GatewayPort;
use crate::LayoutPort;
use crate::ModalPort;
use crate::PaneAccessPort;
use crate::PaneLifecyclePort;
use crate::WorkspaceNavPort;

use super::protocol::CliError;

// ── Trait alias for CLI ports ──

pub(crate) trait CliPorts:
    ActionPort
    + AppCorePort
    + FocusNavPort
    + GatewayPort
    + LayoutPort
    + PaneAccessPort
    + PaneLifecyclePort
    + WorkspaceNavPort
{
}
impl<
        T: ActionPort
            + AppCorePort
            + FocusNavPort
            + GatewayPort
            + LayoutPort
            + PaneAccessPort
            + PaneLifecyclePort
            + WorkspaceNavPort,
    > CliPorts for T
{
}

// ── Dispatch (remains on App) ──

impl crate::App {
    /// Dispatch a CLI command by method name.
    /// Handles cross-workspace routing: if `_caller_pane` is present in params,
    /// the command executes in the workspace that owns that pane, then swaps back.
    pub(crate) fn handle_cli_command(
        &mut self,
        method: &str,
        params: Value,
    ) -> Result<Value, CliError> {
        self.handle_cli_command_with_subscribe(method, params, None)
    }

    /// Dispatch a CLI command, supplying the `subscribe` notification channel.
    /// Establishes the per-dispatch [`CliDispatch`] context (caller pane +
    /// subscribe channel), set and cleared here and nowhere else, so handlers
    /// can read it through `cli_caller_pane()` / `take_subscribe_tx()` only
    /// while a command is in flight.
    pub(crate) fn handle_cli_command_with_subscribe(
        &mut self,
        method: &str,
        mut params: Value,
        subscribe_tx: Option<std::sync::mpsc::Sender<String>>,
    ) -> Result<Value, CliError> {
        // Extract and strip _caller_pane so handlers never see it (BR-5)
        let caller_pane = params
            .as_object_mut()
            .and_then(|m| m.remove("_caller_pane"))
            .and_then(|v| v.as_u64());

        self.cli_dispatch = Some(crate::app::CliDispatch {
            caller_pane,
            subscribe_tx,
        });

        // Find target workspace for the caller pane (UC-2, UC-4)
        let need_swap = caller_pane
            .and_then(|pid| self.find_workspace_for_pane(pid))
            .filter(|&ws_idx| ws_idx != self.ws.active);

        let original_ws = self.ws.active;
        let original_transient_state = need_swap.is_some().then(|| {
            (
                self.pane_rects.clone(),
                self.visual_pane_rects.clone(),
                self.dock.visibility_animation,
            )
        });

        // Swap to target workspace if needed (BR-1, BR-4: raw save/load, not switch_workspace)
        if let Some(target) = need_swap {
            self.save_active_workspace();
            self.ws.active = target;
            self.load_active_workspace();
        }

        // Execute command
        let result = self.dispatch_cli_command(method, params);

        // Swap back if we swapped (BR-2: restore even on error)
        if need_swap.is_some() {
            self.save_active_workspace();
            self.ws.active = original_ws;
            self.load_active_workspace();
            if let Some((pane_rects, visual_pane_rects, dock_visibility_animation)) =
                original_transient_state
            {
                self.pane_rects = pane_rects;
                self.visual_pane_rects = visual_pane_rects;
                self.dock.visibility_animation = dock_visibility_animation;
                self.sync_browser_webview_frames();
            }
        }

        // Clear the dispatch context — the single place it is torn down. The
        // flow above has no early return between set and clear, so the context
        // never outlives a dispatch.
        self.cli_dispatch = None;

        result
    }

    /// Inner dispatch — routes to the appropriate command handler.
    fn dispatch_cli_command(&mut self, method: &str, params: Value) -> Result<Value, CliError> {
        match method {
            // Phase 1 — Observe
            "list-panes" => cli_list_panes(self),
            "observe-workspace" => cli_observe_workspace(self, params),
            "rename-workspace" => cli_rename_workspace(self, params),
            "capture-pane" => cli_capture_pane(self, params),
            "capture-selection" => cli_capture_selection(self, params),
            "get-layout" => cli_get_layout(self),
            "browser-observe" => cli_browser_observe(self, params),
            "browser-read-snapshot" => cli_browser_read_snapshot(self, params),
            "browser-find-in-snapshot" => cli_browser_find_in_snapshot(self, params),
            "browser-diff-since" => cli_browser_diff_since(self, params),
            // Phase 2 — Act
            "browser-eval" => cli_browser_eval(self, params),
            "browser-operation" => cli_browser_operation(self, params),
            "browser-action" => cli_browser_action(self, params),
            "send-keys" => cli_send_keys(self, params),
            "split-vertical" => cli_split(self, SplitDirection::Vertical, params),
            "split-horizontal" => cli_split(self, SplitDirection::Horizontal, params),
            "close-pane" => cli_close_pane(self, params),
            "focus-pane" => cli_focus_pane(self, params),
            "activate-notification-target" => cli_activate_notification_target(self, params),
            "layout-action" => cli_layout_action(self, params),
            "resize-pane" => cli_resize_pane(self, params),
            "open-terminal" => cli_open_terminal(self, params),
            "open-editor" => cli_open_editor(self, params),
            "open-browser" => cli_open_browser(self, params),
            // Phase 3 — Show (Generative UI)
            "render-html" => cli_render_html(self, params),
            "render-stream" => cli_render_stream(self, params),
            "stream-chunk" => cli_stream_chunk(self, params),
            "stream-end" => cli_stream_end(self, params),
            // Phase 4 — Discover + React
            "subscribe" => cli_subscribe(self, params),
            "enable-integration" => cli_enable_integration(params),
            "remove-integration" => cli_remove_integration(params),
            "list-integrations" => Ok(json!(list_integration_status())),
            // Phase 5 — Agent lifecycle
            "create-context-artifact" => cli_create_context_artifact(self, params),
            "list-context-artifacts" => cli_list_context_artifacts(self),
            "read-context-artifact" => cli_read_context_artifact(self, params),
            "pin-context-artifact" => cli_pin_context_artifact(self, params),
            "remove-context-artifact" => cli_remove_context_artifact(self, params),
            "send-context-artifact" => cli_send_context_artifact(self, params),
            "notify" => cli_notify(self, params),
            // Test driver (E2E harness) — inert unless TIDE_TERMINAL_TEST_DRIVER=1.
            "test-poll-state" if test_driver_enabled() => Ok(cli_test_poll_state(self)),
            _ => Err(CliError::MethodNotFound(method.to_string())),
        }
    }
}

/// Whether the E2E test-driver gateway methods are enabled. Off by default so
/// they are inert in normal use; the harness sets the env var. (A future
/// `#[cfg(feature = "test-driver")]` gate would also keep them out of the
/// compiled release binary — see docs/testing/e2e-tests.md.)
fn test_driver_enabled() -> bool {
    std::env::var("TIDE_TERMINAL_TEST_DRIVER").as_deref() == Ok("1")
}

/// Report app-thread quiescence so the E2E harness can wait for idle instead of
/// racing async PTY/render side effects. Runs on the app thread between event
/// batches, so the event queue is already drained when this is read.
pub(crate) fn cli_test_poll_state(ctx: &crate::App) -> Value {
    let needs_redraw = ctx.cache.needs_redraw;
    let animating = ctx.layout_animation_active();
    json!({
        "needs_redraw": needs_redraw,
        "animating": animating,
        "idle": !needs_redraw && !animating,
    })
}

// ── Phase 1: Observe ─────────────────────────────────────────────

fn pane_kind_label(pane: &PaneKind) -> &'static str {
    match pane {
        PaneKind::Terminal(_) => "terminal",
        PaneKind::Editor(_) => "editor",
        PaneKind::Diff(_) => "diff",
        PaneKind::Browser(browser) if browser.render_mode => "render-mode browser",
        PaneKind::Browser(_) => "browser",
        PaneKind::Launcher(_) => "launcher",
    }
}

fn pane_id_param(params: &Value, key: &str) -> Option<PaneId> {
    params.get(key).and_then(|value| value.as_u64())
}

fn command_target_pane_id(
    ctx: &(impl FocusNavPort + GatewayPort),
    params: &Value,
    key: &str,
) -> Result<PaneId, CliError> {
    pane_id_param(params, key)
        .or_else(|| ctx.cli_caller_pane())
        .or_else(|| ctx.focused_pane())
        .ok_or_else(|| CliError::InvalidParams(format!("no {key}, Caller Pane, or focused pane")))
}

fn terminal_context_owner_for_pane(
    ctx: &(impl DockPort + PaneAccessPort),
    pane_id: PaneId,
) -> Option<PaneId> {
    if matches!(ctx.pane(pane_id), Some(PaneKind::Terminal(_))) {
        return Some(pane_id);
    }
    ctx.terminal_owning(pane_id)
        .or_else(|| ctx.associated_terminal(pane_id))
        .filter(|owner| matches!(ctx.pane(*owner), Some(PaneKind::Terminal(_))))
}

fn caller_terminal_scope(ctx: &(impl GatewayPort + PaneAccessPort)) -> Option<PaneId> {
    ctx.cli_caller_pane()
        .filter(|caller| matches!(ctx.pane(*caller), Some(PaneKind::Terminal(_))))
}

fn pane_is_in_caller_terminal_scope(
    pane_id: PaneId,
    owner_terminal_id: Option<PaneId>,
    caller_terminal_id: PaneId,
) -> bool {
    pane_id == caller_terminal_id || owner_terminal_id == Some(caller_terminal_id)
}

fn terminal_context_surface_target_owner(
    ctx: &(impl DockPort + GatewayPort + PaneAccessPort),
    target: &Value,
) -> Result<PaneId, CliError> {
    if let Some(owner) = target.get("owner_terminal_id").and_then(|v| v.as_u64()) {
        return match ctx.pane(owner) {
            Some(PaneKind::Terminal(_)) => Ok(owner),
            Some(_) => Err(CliError::InvalidParams(
                "owner_terminal_id must reference a Terminal Pane".into(),
            )),
            None => Err(CliError::PaneNotFound(owner)),
        };
    }

    if let Some(caller) = ctx.cli_caller_pane() {
        if let Some(owner) = terminal_context_owner_for_pane(ctx, caller) {
            return Ok(owner);
        }
    }

    ctx.focused_terminal_id().ok_or_else(|| {
        CliError::InvalidParams(
            "terminal_context_surface target requires owner_terminal_id, Caller Pane, or active Stage Terminal"
                .into(),
        )
    })
}

const BROWSER_OBSERVATION_SUMMARY_TEXT_LIMIT_BYTES: usize = 2 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BrowserObserveDetail {
    Full,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WorkspaceObserveDetail {
    Full,
    Compact,
}

fn browser_observe_detail(params: &Value) -> Result<BrowserObserveDetail, CliError> {
    if param_bool(params, &["compact", "summary"]) {
        return Ok(BrowserObserveDetail::Compact);
    }
    let Some(detail) = params
        .get("detail")
        .or_else(|| params.get("mode"))
        .and_then(|value| value.as_str())
    else {
        return Ok(BrowserObserveDetail::Full);
    };

    match detail {
        "full" => Ok(BrowserObserveDetail::Full),
        "compact" | "summary" => Ok(BrowserObserveDetail::Compact),
        other => Err(CliError::InvalidParams(format!(
            "unsupported browser observe detail: {other}"
        ))),
    }
}

fn workspace_observe_detail(params: &Value) -> Result<WorkspaceObserveDetail, CliError> {
    if param_bool(params, &["compact", "summary"]) {
        return Ok(WorkspaceObserveDetail::Compact);
    }
    let Some(detail) = params
        .get("detail")
        .or_else(|| params.get("mode"))
        .and_then(|value| value.as_str())
    else {
        return Ok(WorkspaceObserveDetail::Full);
    };

    match detail {
        "full" => Ok(WorkspaceObserveDetail::Full),
        "compact" | "summary" => Ok(WorkspaceObserveDetail::Compact),
        other => Err(CliError::InvalidParams(format!(
            "unsupported workspace observe detail: {other}"
        ))),
    }
}

fn browser_snapshot_json(snapshot: Option<&BrowserSnapshot>) -> Value {
    match snapshot {
        Some(snapshot) => json!({
            "text": snapshot.text.clone(),
            "title": snapshot.page_title.clone(),
            "url": snapshot.page_url.clone(),
        }),
        None => Value::Null,
    }
}

fn browser_snapshot_summary_json(snapshot: Option<&BrowserSnapshot>) -> Value {
    match snapshot {
        Some(snapshot) => {
            let (text_excerpt, text_truncated) = truncate_utf8_to_byte_limit(
                &snapshot.text,
                BROWSER_OBSERVATION_SUMMARY_TEXT_LIMIT_BYTES,
            );
            let returned_bytes = text_excerpt.len();
            json!({
                "status": "ok",
                "title": snapshot.page_title.clone(),
                "url": snapshot.page_url.clone(),
                "text_excerpt": text_excerpt,
                "truncation": {
                    "text_truncated": text_truncated,
                    "original_bytes": snapshot.text.len(),
                    "returned_bytes": returned_bytes,
                    "limit_bytes": BROWSER_OBSERVATION_SUMMARY_TEXT_LIMIT_BYTES,
                },
            })
        }
        None => json!({
            "status": "missing",
            "title": Value::Null,
            "url": Value::Null,
            "text_excerpt": "",
            "truncation": {
                "text_truncated": false,
                "original_bytes": 0,
                "returned_bytes": 0,
                "limit_bytes": BROWSER_OBSERVATION_SUMMARY_TEXT_LIMIT_BYTES,
            },
        }),
    }
}

fn browser_page_element_kind_label(kind: &BrowserPageElementKind) -> &'static str {
    match kind {
        BrowserPageElementKind::Region => "region",
        BrowserPageElementKind::Interactable => "interactable",
    }
}

fn bounded_json_string(value: &str, limit: usize) -> Value {
    let (bounded, _truncated) = truncate_utf8_to_byte_limit(value, limit);
    json!(bounded)
}

fn optional_bounded_json_string(value: Option<&String>, limit: usize) -> Value {
    value
        .map(|value| bounded_json_string(value, limit))
        .unwrap_or(Value::Null)
}

fn browser_page_element_json(element: &BrowserPageElement) -> Value {
    json!({
        "ref": element.reference.clone(),
        "kind": browser_page_element_kind_label(&element.kind),
        "role": element.role.clone(),
        "tag": element.tag.clone(),
        "label": bounded_json_string(&element.label, BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES),
        "text": bounded_json_string(&element.text, BROWSER_PAGE_MAP_TEXT_LIMIT_BYTES),
        "value": optional_bounded_json_string(element.value.as_ref(), BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES),
        "placeholder": optional_bounded_json_string(element.placeholder.as_ref(), BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES),
        "action": element.action.clone(),
        "disabled": element.disabled,
        "enabled": !element.disabled,
        "rect": rect_value(element.rect),
    })
}

fn browser_page_element_summary_json(element: &BrowserPageElement) -> Value {
    json!({
        "ref": element.reference.clone(),
        "kind": browser_page_element_kind_label(&element.kind),
        "role": element.role.clone(),
        "tag": element.tag.clone(),
        "label": bounded_json_string(&element.label, BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES),
        "value": optional_bounded_json_string(element.value.as_ref(), BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES),
        "placeholder": optional_bounded_json_string(element.placeholder.as_ref(), BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES),
        "action": element.action.clone(),
        "disabled": element.disabled,
        "enabled": !element.disabled,
        "rect": rect_value(element.rect),
    })
}

fn browser_page_map_json(page_map: Option<&BrowserPageMap>, generation: u64) -> Value {
    let regions = page_map
        .map(|page_map| {
            page_map
                .regions
                .iter()
                .map(browser_page_element_json)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let interactables = page_map
        .map(|page_map| {
            page_map
                .interactables
                .iter()
                .map(browser_page_element_json)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "generation": generation,
        "status": if page_map.is_some() { "ok" } else { "missing" },
        "regions": regions,
        "interactables": interactables,
        "limits": {
            "region_limit": BROWSER_PAGE_MAP_REGION_LIMIT,
            "interactable_limit": BROWSER_PAGE_MAP_INTERACTABLE_LIMIT,
            "label_limit_bytes": BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES,
            "text_limit_bytes": BROWSER_PAGE_MAP_TEXT_LIMIT_BYTES,
            "regions_truncated": page_map.map(|page_map| page_map.truncated_regions).unwrap_or(false),
            "interactables_truncated": page_map.map(|page_map| page_map.truncated_interactables).unwrap_or(false),
        },
        "ref_semantics": {
            "generation_scoped": true,
            "persistent_dom_identity": false,
            "css_selector_identity": false,
            "authorization": false,
        }
    })
}

fn browser_page_map_summary_json(page_map: Option<&BrowserPageMap>, generation: u64) -> Value {
    let regions = page_map
        .map(|page_map| {
            page_map
                .regions
                .iter()
                .map(browser_page_element_summary_json)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let interactables = page_map
        .map(|page_map| {
            page_map
                .interactables
                .iter()
                .map(browser_page_element_summary_json)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "generation": generation,
        "status": if page_map.is_some() { "ok" } else { "missing" },
        "detail": "compact",
        "regions": regions,
        "interactables": interactables,
        "limits": {
            "region_limit": BROWSER_PAGE_MAP_REGION_LIMIT,
            "interactable_limit": BROWSER_PAGE_MAP_INTERACTABLE_LIMIT,
            "label_limit_bytes": BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES,
            "text_limit_bytes": 0,
            "regions_truncated": page_map.map(|page_map| page_map.truncated_regions).unwrap_or(false),
            "interactables_truncated": page_map.map(|page_map| page_map.truncated_interactables).unwrap_or(false),
        },
        "ref_semantics": {
            "generation_scoped": true,
            "persistent_dom_identity": false,
            "css_selector_identity": false,
            "authorization": false,
        }
    })
}

fn browser_selection_json(selection: Option<&BrowserSelectionSnapshot>) -> Value {
    match selection {
        Some(selection) => json!({
            "text": selection.text.clone(),
            "html": selection.html.clone(),
            "context": selection.context.clone(),
            "title": selection.page_title.clone(),
            "url": selection.page_url.clone(),
            "collapsed": selection.collapsed,
        }),
        None => Value::Null,
    }
}

fn browser_automation_cursor_json(cursor: Option<&BrowserAutomationCursor>) -> Value {
    match cursor {
        Some(cursor) => json!({
            "x": cursor.x,
            "y": cursor.y,
            "label": cursor.label.clone(),
            "visible": cursor.visible,
        }),
        None => Value::Null,
    }
}

fn browser_cursor_semantics_json() -> Value {
    json!({
        "marker_only": true,
        "element_identity": false,
        "pointer_ownership": false,
        "human_consent": false,
    })
}

const BROWSER_SNAPSHOT_FIND_MATCH_LIMIT: usize = 50;
const BROWSER_SNAPSHOT_MATCH_CONTEXT_LIMIT_BYTES: usize = 2 * 1024;
const BROWSER_SNAPSHOT_DIFF_LIMIT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy)]
struct BrowserToolAuthorization {
    caller_pane_id: u64,
    associated_terminal_id: u64,
}

#[derive(Debug, Clone)]
struct AgentBrowserControlDecision {
    active: bool,
    caller_pane_id: Option<u64>,
    associated_terminal_id: Option<u64>,
    wrapper_managed: bool,
    gateway_connected: bool,
    status: Option<AgentStatus>,
    reason: &'static str,
}

fn param_bool(params: &Value, names: &[&str]) -> bool {
    names
        .iter()
        .any(|name| params.get(*name).and_then(|value| value.as_bool()) == Some(true))
}

fn ensure_sensitive_action_approval(params: &Value, surface: &str) -> Result<(), CliError> {
    let marked_sensitive = param_bool(
        params,
        &["sensitive", "data_transmitting", "requires_approval"],
    );
    if marked_sensitive && !param_bool(params, &["approved", "human_approved"]) {
        return Err(CliError::InvalidParams(format!(
            "{surface} marked sensitive requires approved=true"
        )));
    }
    Ok(())
}

fn browser_action_is_supported(action: &str) -> bool {
    matches!(
        action,
        "navigate" | "move" | "click" | "type" | "press" | "clear-cursor"
    )
}

fn browser_operation_action_is_supported(action: &str) -> bool {
    matches!(action, "start" | "finish")
}

fn browser_action_target_ref(params: &Value) -> Option<&str> {
    params
        .get("target_ref")
        .or_else(|| params.get("ref"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
}

fn resolve_browser_action_target(
    browser: &BrowserPane,
    params: &Value,
    action: &str,
) -> Result<Option<BrowserPageElement>, CliError> {
    let Some(target_ref) = browser_action_target_ref(params) else {
        return Ok(None);
    };
    if !matches!(action, "click" | "type") {
        return Err(CliError::InvalidParams(
            "target_ref is supported only for click and type Browser Pane actions".into(),
        ));
    }
    let Some(page_map) = browser.page_map.as_ref() else {
        return Err(CliError::InvalidParams(
            "target_ref requires a Browser Page Map from tide_browser_observe".into(),
        ));
    };
    let element = page_map
        .element_by_ref(target_ref)
        .cloned()
        .ok_or_else(|| {
            CliError::InvalidParams(format!(
                "Browser Page Element ref {target_ref} is unknown for the current Browser Pane Generation"
            ))
        })?;
    if element.disabled {
        return Err(CliError::InvalidParams(format!(
            "Browser Page Element ref {target_ref} is disabled"
        )));
    }
    Ok(Some(element))
}

fn browser_action_requires_fresh_observe(action: &str) -> bool {
    matches!(action, "navigate" | "click" | "type" | "press")
}

fn browser_action_can_use_current_page_map_target_without_fresh_observe(
    browser: &BrowserPane,
    action: &str,
    action_target: Option<&BrowserPageElement>,
) -> bool {
    browser.agent_has_observed_browser_pane()
        && matches!(action, "click" | "type")
        && action_target.is_some_and(|target| !target.disabled)
}

fn browser_action_interacts_with_page_content(action: &str) -> bool {
    matches!(action, "click" | "type" | "press")
}

fn browser_action_requires_observe_after(action: &str) -> bool {
    matches!(action, "navigate" | "click" | "type" | "press")
}

fn browser_eval_contains_any(script: &str, patterns: &[&str]) -> bool {
    let compact = script
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    patterns.iter().any(|pattern| compact.contains(pattern))
}

fn reject_browser_eval_if_it_bypasses_structured_action(script: &str) -> Result<(), CliError> {
    const INTERACTIVE_PATTERNS: &[&str] = &[
        ".click(",
        ".submit(",
        "dispatchevent(",
        "mouseevent(",
        "keyboardevent(",
        "inputevent(",
        "__tidebrowserautomationclick(",
        "__tidebrowserautomationtype(",
        "__tidebrowserautomationtypeat(",
        "__tidebrowserautomationpress(",
    ];
    if browser_eval_contains_any(script, INTERACTIVE_PATTERNS) {
        return Err(CliError::InvalidParams(
            "browser-eval cannot perform Browser Pane interaction; use tide_browser_action so Browser Automation Cursor and Agent Browser Control Mode stay visible"
                .into(),
        ));
    }

    const DOM_MUTATION_PATTERNS: &[&str] = &[
        "createelement(",
        "appendchild(",
        "prepend(",
        "insertadjacent",
        "replacechildren(",
        "removechild(",
        ".remove(",
        "innerhtml=",
        "outerhtml=",
        "innertext=",
        "textcontent=",
        "setattribute(",
    ];
    if browser_eval_contains_any(script, DOM_MUTATION_PATTERNS) {
        return Err(CliError::InvalidParams(
            "browser-eval cannot mutate Browser Pane DOM; use structured Tide tools or a Render Pane instead"
                .into(),
        ));
    }

    Ok(())
}

fn truncate_utf8_to_byte_limit(text: &str, limit: usize) -> (String, bool) {
    if text.len() <= limit {
        return (text.to_string(), false);
    }
    let mut end = limit;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_string(), true)
}

fn truncation_json(original_bytes: usize, returned_bytes: usize, limit_bytes: usize) -> Value {
    json!({
        "text_truncated": original_bytes > returned_bytes,
        "original_bytes": original_bytes,
        "returned_bytes": returned_bytes,
        "limit_bytes": limit_bytes,
    })
}

fn agent_status_json(status: Option<AgentStatus>) -> Value {
    match status {
        Some(AgentStatus::Running) => json!("running"),
        Some(AgentStatus::Idle) => json!("idle"),
        Some(AgentStatus::NeedsInput) => json!("needs_input"),
        None => Value::Null,
    }
}

fn required_browser_pane_id(params: &Value) -> Result<u64, CliError> {
    params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))
}

fn ensure_browser_tool_authorized(
    ctx: &(impl DockPort + GatewayPort + PaneAccessPort),
    pane_id: u64,
) -> Result<BrowserToolAuthorization, CliError> {
    let caller_pane_id = ctx
        .cli_caller_pane()
        .ok_or_else(|| CliError::InvalidParams("Caller Pane required".into()))?;

    match ctx.pane(caller_pane_id) {
        Some(PaneKind::Terminal(_)) => {}
        Some(other) => {
            return Err(CliError::InvalidPaneKind {
                pane_id: caller_pane_id,
                expected: "terminal Caller Pane",
                actual: pane_kind_label(other),
            });
        }
        None => return Err(CliError::PaneNotFound(caller_pane_id)),
    }

    let pane = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))?;
    if !matches!(pane, PaneKind::Browser(_)) {
        return Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: pane_kind_label(pane),
        });
    }

    let associated_terminal_id = ctx.associated_terminal(pane_id).ok_or_else(|| {
        CliError::InvalidParams(format!("Browser Pane {pane_id} has no Associated Terminal"))
    })?;
    if associated_terminal_id != caller_pane_id {
        return Err(CliError::InvalidParams(format!(
            "Browser Pane {pane_id} is owned by Associated Terminal {associated_terminal_id}, not Caller Pane {caller_pane_id}"
        )));
    }

    Ok(BrowserToolAuthorization {
        caller_pane_id,
        associated_terminal_id,
    })
}

fn ensure_browser_tool_authorized_if_caller(
    ctx: &(impl DockPort + GatewayPort + PaneAccessPort),
    pane_id: u64,
) -> Result<Option<BrowserToolAuthorization>, CliError> {
    if ctx.cli_caller_pane().is_none() {
        return Ok(None);
    }
    ensure_browser_tool_authorized(ctx, pane_id).map(Some)
}

fn ensure_snapshot_tool_authorized(
    ctx: &(impl DockPort + GatewayPort + PaneAccessPort),
    pane_id: u64,
) -> Result<BrowserToolAuthorization, CliError> {
    ensure_browser_tool_authorized(ctx, pane_id)
}

fn agent_browser_control_decision(
    ctx: &(impl DockPort + GatewayPort + PaneAccessPort),
    pane_id: u64,
) -> AgentBrowserControlDecision {
    let caller_pane_id = ctx.cli_caller_pane();
    let Some(caller) = caller_pane_id else {
        return AgentBrowserControlDecision {
            active: false,
            caller_pane_id,
            associated_terminal_id: None,
            wrapper_managed: false,
            gateway_connected: false,
            status: None,
            reason: "missing_caller_pane",
        };
    };

    if !matches!(ctx.pane(caller), Some(PaneKind::Terminal(_))) {
        return AgentBrowserControlDecision {
            active: false,
            caller_pane_id,
            associated_terminal_id: ctx.associated_terminal(pane_id),
            wrapper_managed: false,
            gateway_connected: false,
            status: None,
            reason: "caller_pane_not_terminal",
        };
    }
    if ctx.is_pane_in_dock(caller) {
        return AgentBrowserControlDecision {
            active: false,
            caller_pane_id,
            associated_terminal_id: ctx.associated_terminal(pane_id),
            wrapper_managed: false,
            gateway_connected: false,
            status: None,
            reason: "caller_pane_not_direct_stage_terminal",
        };
    }

    let associated_terminal_id = ctx.associated_terminal(pane_id);
    if associated_terminal_id != Some(caller) {
        let agent = ctx.detected_agent(caller);
        return AgentBrowserControlDecision {
            active: false,
            caller_pane_id,
            associated_terminal_id,
            wrapper_managed: agent.as_ref().is_some_and(|agent| agent.wrapper_managed),
            gateway_connected: agent.as_ref().is_some_and(|agent| agent.gateway_connected),
            status: agent.and_then(|agent| agent.status),
            reason: "wrong_associated_terminal",
        };
    }

    let agent: Option<AgentInfo> = ctx.detected_agent(caller);
    let wrapper_managed = agent.as_ref().is_some_and(|agent| agent.wrapper_managed);
    let gateway_connected = agent.as_ref().is_some_and(|agent| agent.gateway_connected);
    let status = agent.as_ref().and_then(|agent| agent.status);
    let active =
        wrapper_managed && gateway_connected && matches!(status, Some(AgentStatus::Running));
    let reason = if active {
        "authorized"
    } else if !wrapper_managed {
        "not_wrapper_managed"
    } else if !gateway_connected {
        "gateway_disconnected"
    } else {
        "incompatible_agent_status"
    };

    AgentBrowserControlDecision {
        active,
        caller_pane_id,
        associated_terminal_id,
        wrapper_managed,
        gateway_connected,
        status,
        reason,
    }
}

fn agent_browser_control_mode_json(
    decision: &AgentBrowserControlDecision,
    browser: &BrowserPane,
) -> Value {
    let state = browser.agent_browser_control_mode();
    json!({
        "active": decision.active && state.is_some(),
        "reason": decision.reason,
        "caller_pane": state
            .map(|state| state.caller_pane_id)
            .or(decision.caller_pane_id),
        "associated_terminal": state
            .map(|state| state.associated_terminal_id)
            .or(decision.associated_terminal_id),
        "generation": state.map(|state| state.generation),
        "wrapper_managed": decision.wrapper_managed,
        "gateway_connected": decision.gateway_connected,
        "agent_status": agent_status_json(decision.status),
    })
}

fn browser_operation_json(active: bool) -> Value {
    json!({
        "kind": "browser_operation",
        "active": active,
        "human_like_browser_pane_work": true,
        "avoid_shortcuts": [
            "app_internal_api_shortcuts",
            "credential_bearing_url_shortcuts",
            "url_parameter_shortcuts",
            "dom_mutation_shortcuts",
        ],
    })
}

fn set_agent_browser_control_mode(
    browser: &mut BrowserPane,
    decision: &AgentBrowserControlDecision,
) {
    if decision.active {
        browser.enter_agent_browser_control_mode(
            decision
                .caller_pane_id
                .expect("active control mode requires Caller Pane"),
            decision
                .associated_terminal_id
                .expect("active control mode requires Associated Terminal"),
        );
    } else {
        browser.clear_agent_browser_control_mode();
    }
}

fn ensure_browser_operation_visuals(
    browser: &mut BrowserPane,
    decision: &AgentBrowserControlDecision,
) {
    if !decision.active {
        browser.clear_agent_browser_control_mode();
        return;
    }

    match browser.automation_cursor().cloned() {
        Some(mut cursor) if !cursor.visible => {
            cursor.visible = true;
            browser.set_automation_cursor(cursor);
        }
        Some(_) => {
            browser.sync_automation_cursor_overlay();
        }
        None => {
            browser.set_automation_cursor(BrowserAutomationCursor {
                x: 24.0,
                y: 24.0,
                label: None,
                visible: true,
            });
        }
    }
    set_agent_browser_control_mode(browser, decision);
}

fn clear_browser_operation_visuals_for_terminal(
    ctx: &mut (impl DockPort + PaneAccessPort),
    terminal_id: PaneId,
) {
    let browser_ids: Vec<_> = ctx
        .pane_entries()
        .into_iter()
        .filter_map(|(pane_id, pane)| match pane {
            PaneKind::Browser(browser)
                if ctx.associated_terminal(pane_id) == Some(terminal_id)
                    && browser
                        .agent_browser_control_mode()
                        .is_some_and(|state| state.associated_terminal_id == terminal_id) =>
            {
                Some(pane_id)
            }
            _ => None,
        })
        .collect();

    for pane_id in browser_ids {
        if let Some(PaneKind::Browser(browser)) = ctx.pane_mut(pane_id) {
            browser.clear_agent_browser_control_mode();
            browser.clear_automation_cursor();
        }
    }
}

fn navigation_browser<'a>(pane_id: u64, pane: &'a PaneKind) -> Result<&'a BrowserPane, CliError> {
    if let PaneKind::Browser(browser) = pane {
        if !browser.render_mode {
            return Ok(browser);
        }
        return Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "navigation-mode browser",
            actual: "render-mode browser",
        });
    }

    Err(CliError::InvalidPaneKind {
        pane_id,
        expected: "navigation-mode browser",
        actual: pane_kind_label(pane),
    })
}

fn navigation_browser_mut<'a>(
    pane_id: u64,
    pane: &'a mut PaneKind,
) -> Result<&'a mut BrowserPane, CliError> {
    if let PaneKind::Browser(browser) = pane {
        if !browser.render_mode {
            return Ok(browser);
        }
        return Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "navigation-mode browser",
            actual: "render-mode browser",
        });
    }

    Err(CliError::InvalidPaneKind {
        pane_id,
        expected: "navigation-mode browser",
        actual: pane_kind_label(pane),
    })
}

fn focus_area_label(area: FocusArea) -> &'static str {
    match area {
        FocusArea::FileTree => "file_tree",
        FocusArea::Stage => "stage",
        FocusArea::Dock => "terminal_context_surface",
    }
}

fn rect_value(rect: Rect) -> Value {
    json!({
        "x": rect.x,
        "y": rect.y,
        "width": rect.width,
        "height": rect.height,
    })
}

fn optional_rect_value(rect: Option<Rect>) -> Value {
    rect.map(rect_value).unwrap_or(Value::Null)
}

fn pane_rect(ctx: &(impl AppCorePort + ?Sized), pane_id: PaneId) -> Option<Rect> {
    ctx.pane_rects()
        .iter()
        .find(|(id, _)| *id == pane_id)
        .map(|(_, rect)| *rect)
}

fn browser_layout_correction_action(owner_terminal_id: Option<PaneId>, pane_id: PaneId) -> Value {
    const RECOMMENDED_CONTEXT_WIDTH: f32 = 720.0;

    if let Some(owner_terminal_id) = owner_terminal_id {
        json!({
            "tool": "tide_layout_action",
            "action": "resize",
            "target": {
                "kind": "terminal_context_surface",
                "owner_terminal_id": owner_terminal_id,
            },
            "width_px": RECOMMENDED_CONTEXT_WIDTH,
        })
    } else {
        json!({
            "tool": "tide_layout_action",
            "action": "resize",
            "target": {
                "kind": "pane_split",
                "pane_id": pane_id,
            },
            "ratio": 0.65,
        })
    }
}

fn browser_background_runtime_action(owner_terminal_id: Option<PaneId>, pane_id: PaneId) -> Value {
    json!({
        "kind": "background_browser_runtime",
        "pane_id": pane_id,
        "owner_terminal_id": owner_terminal_id,
        "preserve_focus": true,
    })
}

fn browser_fit_tool_selection(status: &str, recommended_action: Option<&Value>) -> Value {
    if let Some(action) = recommended_action {
        let next_tool = action
            .get("tool")
            .and_then(|value| value.as_str())
            .unwrap_or("tide_layout_action");
        return json!({
            "status": "layout_correction_recommended",
            "next_tool": next_tool,
            "reason": status,
            "action": action,
            "then": ["tide_observe_workspace", "tide_browser_observe"],
            "do_not_substitute": [
                "tide_browser_eval",
                "app_internal_api_shortcuts",
                "credential_bearing_url_shortcuts",
                "url_parameter_shortcuts",
                "url_shortening",
                "browser_snapshot_only_targeting"
            ],
        });
    }

    json!({
        "status": "ready_for_browser_action",
        "next_tool": "tide_browser_action",
        "reason": status,
    })
}

fn browser_background_runtime_tool_selection(status: &str, action: &Value) -> Value {
    json!({
        "status": "background_runtime_available",
        "next_tool": "tide_browser_observe",
        "reason": status,
        "action": action,
        "then": ["tide_browser_observe", "tide_browser_action"],
        "do_not_substitute": [
            "tide_browser_eval",
            "app_internal_api_shortcuts",
            "credential_bearing_url_shortcuts",
            "url_parameter_shortcuts",
            "url_shortening",
            "browser_snapshot_only_targeting"
        ],
    })
}

fn browser_visual_fit(
    rect: Option<Rect>,
    owner_terminal_id: Option<PaneId>,
    active_owner_terminal_id: Option<PaneId>,
    pane_id: PaneId,
) -> Value {
    const MIN_BROWSER_WIDTH: f32 = 640.0;
    const MIN_BROWSER_HEIGHT: f32 = 360.0;

    let Some(rect) = rect else {
        if owner_terminal_id.is_some() && owner_terminal_id != active_owner_terminal_id {
            let recommended_action = browser_background_runtime_action(owner_terminal_id, pane_id);
            return json!({
                "status": "not_visible",
                "visible": false,
                "background_runtime_available": true,
                "min_width": MIN_BROWSER_WIDTH,
                "min_height": MIN_BROWSER_HEIGHT,
                "recommended_action": recommended_action,
                "tool_selection": browser_background_runtime_tool_selection("not_visible", &recommended_action),
            });
        }

        let recommended_action = browser_layout_correction_action(owner_terminal_id, pane_id);
        return json!({
            "status": "not_visible",
            "visible": false,
            "background_runtime_available": false,
            "min_width": MIN_BROWSER_WIDTH,
            "min_height": MIN_BROWSER_HEIGHT,
            "recommended_action": recommended_action,
            "tool_selection": browser_fit_tool_selection("not_visible", Some(&recommended_action)),
        });
    };

    let too_small = rect.width < MIN_BROWSER_WIDTH || rect.height < MIN_BROWSER_HEIGHT;
    let mut fit = json!({
        "status": if too_small { "too_small" } else { "ok" },
        "visible": true,
        "background_runtime_available": false,
        "rect": rect_value(rect),
        "min_width": MIN_BROWSER_WIDTH,
        "min_height": MIN_BROWSER_HEIGHT,
    });

    if too_small {
        let recommended_action = browser_layout_correction_action(owner_terminal_id, pane_id);

        fit.as_object_mut().unwrap().insert(
            "tool_selection".to_string(),
            browser_fit_tool_selection("too_small", Some(&recommended_action)),
        );
        fit.as_object_mut()
            .unwrap()
            .insert("recommended_action".to_string(), recommended_action);
    } else {
        fit.as_object_mut().unwrap().insert(
            "tool_selection".to_string(),
            browser_fit_tool_selection("ok", None),
        );
    }

    fit
}

fn terminal_cwd_json(pane: Option<&PaneKind>) -> Value {
    match pane {
        Some(PaneKind::Terminal(terminal)) => terminal
            .context
            .cwd
            .as_ref()
            .map(|cwd| json!(cwd.to_string_lossy()))
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn terminal_context_active_pane_id(
    ctx: &impl PaneAccessPort,
    owner_terminal_id: PaneId,
) -> Option<PaneId> {
    match ctx.pane(owner_terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal
            .dock_focused
            .or_else(|| terminal.dock_layout.all_pane_ids().into_iter().next()),
        _ => None,
    }
}

fn scoped_pane_entries<'a>(
    ctx: &'a (impl DockPort + GatewayPort + PaneAccessPort),
    caller_terminal_id: Option<PaneId>,
) -> Vec<(PaneId, &'a PaneKind)> {
    ctx.pane_entries()
        .into_iter()
        .filter(|(id, _pane)| {
            let Some(caller_terminal_id) = caller_terminal_id else {
                return true;
            };
            let owner_terminal_id = ctx.terminal_owning(*id);
            pane_is_in_caller_terminal_scope(*id, owner_terminal_id, caller_terminal_id)
        })
        .collect()
}

fn compact_visual_fit_summary(visual_fit: &Value) -> Value {
    json!({
        "status": visual_fit.get("status").cloned().unwrap_or(Value::Null),
        "background_runtime_available": visual_fit
            .get("background_runtime_available")
            .cloned()
            .unwrap_or(json!(false)),
        "next_tool": visual_fit
            .get("tool_selection")
            .and_then(|selection| selection.get("next_tool"))
            .cloned()
            .unwrap_or(Value::Null),
    })
}

fn cli_observe_workspace_compact(
    ctx: &(impl AppCorePort + DockPort + FocusNavPort + GatewayPort + PaneAccessPort),
    caller_terminal_id: Option<PaneId>,
) -> Value {
    let active_terminal_id = ctx.focused_terminal_id();
    let focused_id = caller_terminal_id.or_else(|| ctx.focused_pane());
    let focus_area = if caller_terminal_id.is_some() {
        "stage"
    } else {
        focus_area_label(ctx.current_focus_area())
    };
    let surface_owner = caller_terminal_id.or(active_terminal_id);
    let surface_rect = surface_owner
        .filter(|owner| active_terminal_id == Some(*owner))
        .and_then(|_| ctx.dock_area_rect());

    let mut panes = Vec::new();
    let mut browser_targets = Vec::new();
    for (id, pane) in scoped_pane_entries(ctx, caller_terminal_id) {
        let owner_terminal_id = ctx.terminal_owning(id);
        let rect = pane_rect(ctx, id);
        let surface = if owner_terminal_id.is_some() {
            "terminal_context_surface"
        } else {
            "stage"
        };
        panes.push(json!({
            "pane_id": id,
            "id": id,
            "kind": pane_kind_label(pane),
            "title": ctx.pane_title(id),
            "surface": surface,
            "owner_terminal_id": owner_terminal_id,
            "visible": rect.is_some(),
            "focused": focused_id == Some(id),
        }));

        if matches!(pane, PaneKind::Browser(_)) {
            let visual_fit =
                browser_visual_fit(rect, owner_terminal_id, ctx.focused_terminal_id(), id);
            let visual_fit_summary = compact_visual_fit_summary(&visual_fit);
            browser_targets.push(json!({
                "pane_id": id,
                "title": ctx.pane_title(id),
                "owner_terminal_id": owner_terminal_id,
                "visible": rect.is_some(),
                "visual_fit_status": visual_fit_summary["status"].clone(),
                "background_runtime_available": visual_fit_summary["background_runtime_available"].clone(),
                "next_tool": visual_fit_summary["next_tool"].clone(),
            }));
        }
    }

    json!({
        "runtime": "tide_mcp_runtime",
        "detail": "compact",
        "focus": {
            "pane_id": focused_id,
            "area": focus_area,
        },
        "caller": caller_terminal_id.map(|caller| json!({
            "pane_id": caller,
            "terminal_id": caller,
            "title": ctx.pane_title(caller),
            "cwd": terminal_cwd_json(ctx.pane(caller)),
        })),
        "terminal_context_surface": surface_owner.map(|owner| json!({
            "owner_terminal_id": owner,
            "visible": surface_rect.is_some(),
            "rect": optional_rect_value(surface_rect),
            "active_pane_id": terminal_context_active_pane_id(ctx, owner),
        })),
        "panes": panes,
        "browser_targets": browser_targets,
    })
}

/// UC-1: ObserveTideWorkspace — return provider-neutral Tide surfaces and Pane geometry.
fn cli_observe_workspace(
    ctx: &mut (impl AppCorePort + DockPort + FocusNavPort + GatewayPort + LayoutPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let detail = workspace_observe_detail(&params)?;
    ctx.compute_layout();

    let caller_terminal_id = caller_terminal_scope(ctx);
    if detail == WorkspaceObserveDetail::Compact {
        return Ok(cli_observe_workspace_compact(ctx, caller_terminal_id));
    }

    let active_terminal_id = ctx.focused_terminal_id();
    let mut surfaces = vec![json!({
        "kind": "stage",
        "rect": optional_rect_value(ctx.pane_area_rect()),
        "visible": ctx.pane_area_rect().is_some(),
        "capabilities": ["pane_split"],
    })];

    if let Some(owner_terminal_id) = caller_terminal_id {
        let rect = (active_terminal_id == Some(owner_terminal_id))
            .then(|| ctx.dock_area_rect())
            .flatten();
        surfaces.push(json!({
            "kind": "terminal_context_surface",
            "owner_terminal_id": owner_terminal_id,
            "rect": optional_rect_value(rect),
            "visible": rect.is_some(),
            "capabilities": ["resize_width", "pane_split"],
        }));
    } else if let Some(rect) = ctx.dock_area_rect() {
        surfaces.push(json!({
            "kind": "terminal_context_surface",
            "owner_terminal_id": active_terminal_id,
            "rect": rect_value(rect),
            "visible": true,
            "capabilities": ["resize_width", "pane_split"],
        }));
    }

    let focused_id = caller_terminal_id.or_else(|| ctx.focused_pane());
    let focus_area = if caller_terminal_id.is_some() {
        "stage"
    } else {
        focus_area_label(ctx.current_focus_area())
    };
    let mut panes = Vec::new();
    for (id, pane) in ctx.pane_entries() {
        let owner_terminal_id = ctx.terminal_owning(id);
        if let Some(caller_terminal_id) = caller_terminal_id {
            if !pane_is_in_caller_terminal_scope(id, owner_terminal_id, caller_terminal_id) {
                continue;
            }
        }
        let surface = if owner_terminal_id.is_some() {
            "terminal_context_surface"
        } else {
            "stage"
        };
        let rect = pane_rect(ctx, id);
        let mut entry = json!({
            "pane_id": id,
            "id": id,
            "kind": pane_kind_label(pane),
            "title": ctx.pane_title(id),
            "surface": surface,
            "owner_terminal_id": owner_terminal_id,
            "rect": optional_rect_value(rect),
            "focused": focused_id == Some(id),
        });

        if matches!(pane, PaneKind::Browser(_)) {
            entry.as_object_mut().unwrap().insert(
                "visual_fit".to_string(),
                browser_visual_fit(rect, owner_terminal_id, ctx.focused_terminal_id(), id),
            );
            entry
                .as_object_mut()
                .unwrap()
                .insert("runtime".to_string(), json!("tide_browser_pane"));
            entry
                .as_object_mut()
                .unwrap()
                .insert("human_visible".to_string(), json!(rect.is_some()));
        }

        panes.push(entry);
    }

    Ok(json!({
        "runtime": "tide_mcp_runtime",
        "browser_runtime_router": {
            "default_runtime": "tide_browser_pane",
            "external_runtime": "explicit_fallback_only",
            "provider_neutral": true,
            "human_visible_default": true,
        },
        "focus": {
            "pane_id": focused_id,
            "area": focus_area,
        },
        "surfaces": surfaces,
        "panes": panes,
    }))
}

/// UC-1: ListPanes — return all panes in the active workspace.
fn cli_list_panes(
    ctx: &(impl AppCorePort + DockPort + FocusNavPort + GatewayPort + PaneAccessPort),
) -> Result<Value, CliError> {
    let caller_terminal_id = caller_terminal_scope(ctx);
    let focused_id = caller_terminal_id.or_else(|| ctx.focused_pane());
    let mut result = Vec::new();

    for (id, pane) in scoped_pane_entries(ctx, caller_terminal_id) {
        let kind_str = match pane {
            PaneKind::Terminal(_) => "terminal",
            PaneKind::Editor(_) => "editor",
            PaneKind::Diff(_) => "diff",
            PaneKind::Browser(_) => "browser",
            PaneKind::Launcher(_) => "launcher",
        };

        let focused = focused_id == Some(id);

        let rect = ctx
            .pane_rects()
            .iter()
            .find(|(pid, _)| *pid == id)
            .map(|(_, r)| json!({"x": r.x, "y": r.y, "width": r.width, "height": r.height}))
            .unwrap_or(Value::Null);

        let title = ctx.pane_title(id);

        let mut entry = json!({
            "id": id,
            "kind": kind_str,
            "title": title,
            "rect": rect,
            "focused": focused,
        });

        // BR-3: Terminal-specific fields
        if let PaneKind::Terminal(tp) = pane {
            let obj = entry.as_object_mut().unwrap();
            if let Some(ref cwd) = tp.context.cwd {
                obj.insert("cwd".to_string(), json!(cwd.to_string_lossy()));
            }
            obj.insert("shell_idle".to_string(), json!(tp.context.shell_idle));
            obj.insert("pid".to_string(), json!(tp.backend.child_pid()));
        }

        // BR-4: Editor-specific fields
        if let PaneKind::Editor(ep) = pane {
            let obj = entry.as_object_mut().unwrap();
            if let Some(path) = ep.editor.file_path() {
                obj.insert("file_path".to_string(), json!(path.to_string_lossy()));
            }
            obj.insert("dirty".to_string(), json!(ep.editor.is_modified()));
        }

        // BR-5: Render pane fields
        if let PaneKind::Browser(bp) = pane {
            if bp.render_mode {
                let obj = entry.as_object_mut().unwrap();
                obj.insert("render_mode".to_string(), json!(true));
                obj.insert("streaming".to_string(), json!(bp.streaming));
                if let Some(ref t) = bp.render_title {
                    obj.insert("render_title".to_string(), json!(t));
                }
            }
        }

        result.push(entry);
    }

    result.sort_by_key(|v| v["id"].as_u64().unwrap_or(0));
    Ok(Value::Array(result))
}

/// UC-2: CapturePaneContent — read text from a terminal, editor, or Browser Pane.
fn cli_capture_pane(
    ctx: &(impl FocusNavPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;

    let pane = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Terminal(tp) => {
            let grid = tp.backend.grid();
            let start = params.get("start").and_then(|v| v.as_i64()).unwrap_or(0);
            let end = params
                .get("end")
                .and_then(|v| v.as_i64())
                .unwrap_or(grid.rows as i64);

            let mut lines = Vec::new();
            for row_idx in 0..grid.rows as usize {
                let row_i = row_idx as i64;
                if row_i >= start && row_i < end {
                    let line: String = grid.cells[row_idx]
                        .iter()
                        .map(|c| c.character)
                        .collect::<String>()
                        .trim_end()
                        .to_string();
                    lines.push(line);
                }
            }

            Ok(json!({
                "pane_id": pane_id,
                "content": lines.join("\n"),
                "lines": lines,
            }))
        }
        PaneKind::Editor(ep) => {
            let start = params.get("start").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let end = params
                .get("end")
                .and_then(|v| v.as_u64())
                .unwrap_or(ep.editor.buffer.line_count() as u64) as usize;

            let mut lines = Vec::new();
            for i in start..end.min(ep.editor.buffer.line_count()) {
                if let Some(line) = ep.editor.buffer.line(i) {
                    lines.push(line.to_string());
                }
            }

            Ok(json!({
                "pane_id": pane_id,
                "content": lines.join("\n"),
                "lines": lines,
            }))
        }
        PaneKind::Browser(browser) => {
            let snapshot = browser.page_snapshot.as_ref();
            let content = snapshot.map(|s| s.text.as_str()).unwrap_or_default();
            let lines = if content.is_empty() {
                Vec::new()
            } else {
                content.lines().map(str::to_string).collect::<Vec<_>>()
            };

            Ok(json!({
                "pane_id": pane_id,
                "kind": "browser",
                "title": snapshot.and_then(|s| s.page_title.as_deref()),
                "url": snapshot.and_then(|s| s.page_url.as_deref()),
                "content": content,
                "lines": lines,
            }))
        }
        PaneKind::Launcher(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "terminal, editor, or browser",
            actual: "launcher",
        }),
        PaneKind::Diff(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "terminal, editor, or browser",
            actual: "diff",
        }),
    }
}

/// UC-1: ObserveBrowserPaneAutomationState — read structured Browser Pane state.
fn cli_browser_observe(
    ctx: &mut (impl AppCorePort + DockPort + FocusNavPort + GatewayPort + LayoutPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let detail = browser_observe_detail(&params)?;
    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;
    let _auth = ensure_browser_tool_authorized_if_caller(ctx, pane_id)?;
    ctx.compute_layout();
    let owner_terminal_id = ctx.terminal_owning(pane_id);
    let rect = pane_rect(ctx, pane_id);
    let visual_fit =
        browser_visual_fit(rect, owner_terminal_id, ctx.focused_terminal_id(), pane_id);
    let control_decision = agent_browser_control_decision(ctx, pane_id);

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;
    let browser = navigation_browser_mut(pane_id, pane)?;
    ensure_browser_operation_visuals(browser, &control_decision);

    let title = browser
        .page_snapshot
        .as_ref()
        .and_then(|snapshot| snapshot.page_title.clone())
        .or_else(|| {
            browser
                .page_selection
                .as_ref()
                .and_then(|selection| selection.page_title.clone())
        })
        .unwrap_or_else(|| browser.title());

    let (detail_label, snapshot, page_map) = match detail {
        BrowserObserveDetail::Full => (
            "full",
            browser_snapshot_json(browser.page_snapshot.as_ref()),
            browser_page_map_json(browser.page_map.as_ref(), browser.generation),
        ),
        BrowserObserveDetail::Compact => (
            "compact",
            browser_snapshot_summary_json(browser.page_snapshot.as_ref()),
            browser_page_map_summary_json(browser.page_map.as_ref(), browser.generation),
        ),
    };

    let result = json!({
        "pane_id": pane_id,
        "detail": detail_label,
        "title": title,
        "url": browser.url.clone(),
        "loading": browser.loading,
        "load_progress": browser.load_progress,
        "can_go_back": browser.can_go_back,
        "can_go_forward": browser.can_go_forward,
        "snapshot": snapshot,
        "page_map": page_map,
        "selection": browser_selection_json(browser.page_selection.as_ref()),
        "automation_cursor": browser_automation_cursor_json(browser.automation_cursor()),
        "runtime": "tide_browser_pane",
        "external_runtime": Value::Null,
        "operation": browser_operation_json(control_decision.active),
        "requires_prior_observe_for_actions": true,
        "cursor_semantics": browser_cursor_semantics_json(),
        "rect": optional_rect_value(rect),
        "visual_fit": visual_fit,
        "agent_browser_control_mode": agent_browser_control_mode_json(&control_decision, browser),
    });
    browser.mark_agent_observed();
    Ok(result)
}

fn cli_browser_read_snapshot(
    ctx: &(impl DockPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = required_browser_pane_id(&params)?;
    let auth = ensure_snapshot_tool_authorized(ctx, pane_id)?;
    let pane = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))?;
    let PaneKind::Browser(browser) = pane else {
        return Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: pane_kind_label(pane),
        });
    };

    let Some(snapshot) = browser.page_snapshot.as_ref() else {
        return Ok(json!({
            "pane_id": pane_id,
            "caller_pane": auth.caller_pane_id,
            "associated_terminal": auth.associated_terminal_id,
            "status": "missing",
            "generation": Value::Null,
            "page_title": Value::Null,
            "page_url": Value::Null,
            "text": "",
            "truncation": truncation_json(0, 0, BROWSER_SNAPSHOT_TEXT_LIMIT_BYTES),
            "refreshed_live_page": false,
        }));
    };

    let (text, text_truncated) =
        truncate_utf8_to_byte_limit(&snapshot.text, BROWSER_SNAPSHOT_TEXT_LIMIT_BYTES);
    let returned_bytes = text.len();
    let original_bytes = snapshot.text.len();
    let mut truncation = truncation_json(
        original_bytes,
        returned_bytes,
        BROWSER_SNAPSHOT_TEXT_LIMIT_BYTES,
    );
    truncation["text_truncated"] = json!(text_truncated);

    Ok(json!({
        "pane_id": pane_id,
        "caller_pane": auth.caller_pane_id,
        "associated_terminal": auth.associated_terminal_id,
        "status": "ok",
        "generation": browser.current_snapshot_generation(),
        "anchor": {
            "pane_id": pane_id,
            "generation": browser.current_snapshot_generation(),
        },
        "page_title": snapshot.page_title.clone(),
        "page_url": snapshot.page_url.clone(),
        "text": text,
        "truncation": truncation,
        "refreshed_live_page": false,
    }))
}

fn cli_browser_find_in_snapshot(
    ctx: &(impl DockPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = required_browser_pane_id(&params)?;
    let auth = ensure_snapshot_tool_authorized(ctx, pane_id)?;
    let query = params
        .get("query")
        .or_else(|| params.get("literal"))
        .and_then(|value| value.as_str())
        .filter(|query| !query.is_empty())
        .ok_or_else(|| CliError::InvalidParams("query required".into()))?;

    let pane = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))?;
    let PaneKind::Browser(browser) = pane else {
        return Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: pane_kind_label(pane),
        });
    };

    let Some(snapshot) = browser.page_snapshot.as_ref() else {
        return Ok(json!({
            "pane_id": pane_id,
            "caller_pane": auth.caller_pane_id,
            "associated_terminal": auth.associated_terminal_id,
            "status": "missing",
            "generation": Value::Null,
            "query": query,
            "matches": [],
            "truncation": {
                "matches_truncated": false,
                "match_limit": BROWSER_SNAPSHOT_FIND_MATCH_LIMIT,
                "context_limit_bytes": BROWSER_SNAPSHOT_MATCH_CONTEXT_LIMIT_BYTES,
            },
            "refreshed_live_page": false,
        }));
    };

    let mut matches = Vec::new();
    let mut total_matches = 0usize;
    for (offset, _) in snapshot.text.match_indices(query) {
        total_matches += 1;
        if matches.len() >= BROWSER_SNAPSHOT_FIND_MATCH_LIMIT {
            continue;
        }
        let prefix = &snapshot.text[..offset];
        let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
        let line_start = snapshot.text[..offset]
            .rfind('\n')
            .map(|idx| idx + 1)
            .unwrap_or(0);
        let line_end = snapshot.text[offset..]
            .find('\n')
            .map(|idx| offset + idx)
            .unwrap_or(snapshot.text.len());
        let column = snapshot.text[line_start..offset].chars().count() + 1;
        let (context, context_truncated) = truncate_utf8_to_byte_limit(
            &snapshot.text[line_start..line_end],
            BROWSER_SNAPSHOT_MATCH_CONTEXT_LIMIT_BYTES,
        );
        matches.push(json!({
            "offset": offset,
            "line": line,
            "column": column,
            "context": context,
            "context_truncated": context_truncated,
        }));
    }

    Ok(json!({
        "pane_id": pane_id,
        "caller_pane": auth.caller_pane_id,
        "associated_terminal": auth.associated_terminal_id,
        "status": "ok",
        "generation": browser.current_snapshot_generation(),
        "anchor": {
            "pane_id": pane_id,
            "generation": browser.current_snapshot_generation(),
        },
        "query": query,
        "matches": matches,
        "truncation": {
            "matches_truncated": total_matches > BROWSER_SNAPSHOT_FIND_MATCH_LIMIT,
            "match_limit": BROWSER_SNAPSHOT_FIND_MATCH_LIMIT,
            "total_matches": total_matches,
            "context_limit_bytes": BROWSER_SNAPSHOT_MATCH_CONTEXT_LIMIT_BYTES,
        },
        "refreshed_live_page": false,
    }))
}

fn parse_snapshot_anchor(params: &Value, pane_id: u64) -> Result<(u64, u64), CliError> {
    if let Some(anchor) = params.get("anchor") {
        let anchor_pane_id = anchor
            .get("pane_id")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| CliError::InvalidParams("anchor.pane_id required".into()))?;
        let generation = anchor
            .get("generation")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| CliError::InvalidParams("anchor.generation required".into()))?;
        return Ok((anchor_pane_id, generation));
    }

    let generation = params
        .get("since_generation")
        .or_else(|| params.get("generation"))
        .and_then(|value| value.as_u64())
        .ok_or_else(|| CliError::InvalidParams("anchor generation required".into()))?;
    let anchor_pane_id = params
        .get("since_pane_id")
        .and_then(|value| value.as_u64())
        .unwrap_or(pane_id);
    Ok((anchor_pane_id, generation))
}

fn line_diff(before: &str, after: &str) -> String {
    let before_lines: Vec<&str> = before.lines().collect();
    let after_lines: Vec<&str> = after.lines().collect();
    let mut lines = Vec::new();

    for line in &before_lines {
        if !after_lines.contains(line) {
            lines.push(format!("-{line}"));
        }
    }
    for line in &after_lines {
        if !before_lines.contains(line) {
            lines.push(format!("+{line}"));
        }
    }

    lines.join("\n")
}

fn cli_browser_diff_since(
    ctx: &(impl DockPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = required_browser_pane_id(&params)?;
    let auth = ensure_snapshot_tool_authorized(ctx, pane_id)?;
    let (anchor_pane_id, anchor_generation) = parse_snapshot_anchor(&params, pane_id)?;
    if anchor_pane_id != pane_id {
        return Err(CliError::InvalidParams(format!(
            "anchor PaneId {anchor_pane_id} does not match target Browser Pane {pane_id}"
        )));
    }

    let pane = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))?;
    let PaneKind::Browser(browser) = pane else {
        return Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: pane_kind_label(pane),
        });
    };
    let Some(current_snapshot) = browser.page_snapshot.as_ref() else {
        return Err(CliError::InvalidParams(
            "current BrowserSnapshot is missing".into(),
        ));
    };
    let baseline = browser
        .snapshot_history_entry(anchor_generation)
        .ok_or_else(|| {
            CliError::InvalidParams(format!(
                "BrowserSnapshot Generation {anchor_generation} is stale or missing"
            ))
        })?;

    let diff = line_diff(&baseline.snapshot.text, &current_snapshot.text);
    let (bounded_diff, diff_truncated) =
        truncate_utf8_to_byte_limit(&diff, BROWSER_SNAPSHOT_DIFF_LIMIT_BYTES);
    let returned_diff_bytes = bounded_diff.len();

    Ok(json!({
        "pane_id": pane_id,
        "caller_pane": auth.caller_pane_id,
        "associated_terminal": auth.associated_terminal_id,
        "status": "ok",
        "from_generation": anchor_generation,
        "generation": browser.current_snapshot_generation(),
        "anchor": {
            "pane_id": pane_id,
            "generation": browser.current_snapshot_generation(),
        },
        "diff": bounded_diff,
        "truncation": {
            "diff_truncated": diff_truncated,
            "original_bytes": diff.len(),
            "returned_bytes": returned_diff_bytes,
            "limit_bytes": BROWSER_SNAPSHOT_DIFF_LIMIT_BYTES,
            "retained_generations": browser.snapshot_history().len(),
        },
        "refreshed_live_page": false,
    }))
}

/// UC-12: BrowserControl — evaluate JavaScript in a Browser Pane.
fn cli_browser_eval(
    ctx: &mut (impl DockPort + FocusNavPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    ensure_sensitive_action_approval(&params, "browser-eval")?;

    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;
    let _auth = ensure_browser_tool_authorized_if_caller(ctx, pane_id)?;
    let script = params
        .get("script")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("script required".into()))?;
    reject_browser_eval_if_it_bypasses_structured_action(script)?;

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Browser(browser) => {
            if let Some(webview) = browser.webview.as_ref() {
                webview.evaluate_javascript(script);
            }
            browser.request_page_snapshot_refresh();
            browser.mark_agent_action_requires_reobserve();
            Ok(json!({
                "ok": true,
                "runtime": "tide_browser_pane",
                "external_runtime": Value::Null,
                "escape_hatch": true,
                "prefer_structured_tools": true,
                "observe_after_action": true,
            }))
        }
        other => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: match other {
                PaneKind::Terminal(_) => "terminal",
                PaneKind::Editor(_) => "editor",
                PaneKind::Diff(_) => "diff",
                PaneKind::Launcher(_) => "launcher",
                PaneKind::Browser(_) => unreachable!(),
            },
        }),
    }
}

/// UC-11: HoldBrowserOperation — hold visible browser-operation state across a task.
fn cli_browser_operation(
    ctx: &mut (impl DockPort + FocusNavPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;
    let action = params
        .get("action")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("action required".into()))?;
    if !browser_operation_action_is_supported(action) {
        return Err(CliError::InvalidParams(format!(
            "unsupported browser operation action: {action}"
        )));
    }
    let _auth = ensure_browser_tool_authorized_if_caller(ctx, pane_id)?;

    let control_decision = agent_browser_control_decision(ctx, pane_id);
    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;
    let browser = navigation_browser_mut(pane_id, pane)?;

    match action {
        "start" => {
            let existing_cursor = browser.automation_cursor().cloned();
            let x = params
                .get("x")
                .and_then(|value| value.as_f64())
                .or_else(|| existing_cursor.as_ref().map(|cursor| cursor.x))
                .unwrap_or(24.0);
            let y = params
                .get("y")
                .and_then(|value| value.as_f64())
                .or_else(|| existing_cursor.as_ref().map(|cursor| cursor.y))
                .unwrap_or(24.0);
            let label = params
                .get("label")
                .and_then(|value| value.as_str())
                .map(String::from)
                .or_else(|| existing_cursor.and_then(|cursor| cursor.label))
                .or_else(|| Some("Browser Operation".to_string()));
            browser.set_automation_cursor(BrowserAutomationCursor {
                x,
                y,
                label,
                visible: true,
            });
            set_agent_browser_control_mode(browser, &control_decision);
        }
        "finish" => {
            browser.clear_agent_browser_control_mode();
            browser.clear_automation_cursor();
        }
        _ => unreachable!("browser operation action support is checked before dispatch"),
    }

    Ok(json!({
        "pane_id": pane_id,
        "action": action,
        "runtime": "tide_browser_pane",
        "external_runtime": Value::Null,
        "operation": browser_operation_json(action == "start" && control_decision.active),
        "cursor_semantics": browser_cursor_semantics_json(),
        "automation_cursor": browser_automation_cursor_json(browser.automation_cursor()),
        "agent_browser_control_mode": agent_browser_control_mode_json(&control_decision, browser),
    }))
}

/// UC-2: ActOnBrowserPaneWithStructuredCommands — drive a navigation-mode Browser Pane.
fn cli_browser_action(
    ctx: &mut (impl DockPort + FocusNavPort + GatewayPort + ModalPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    ensure_sensitive_action_approval(&params, "browser-action")?;

    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;
    let action = params
        .get("action")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("action required".into()))?;
    if !browser_action_is_supported(action) {
        return Err(CliError::InvalidParams(format!(
            "unsupported browser action: {action}"
        )));
    }
    let _auth = ensure_browser_tool_authorized_if_caller(ctx, pane_id)?;
    let modal_open = ctx.modal().is_any_open();
    let control_decision = agent_browser_control_decision(ctx, pane_id);

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;
    let browser = navigation_browser_mut(pane_id, pane)?;

    if modal_open && browser_action_interacts_with_page_content(action) {
        return Err(CliError::InvalidParams(
            "Browser Pane content interaction is unavailable while ModalStack hides the webview"
                .into(),
        ));
    }

    let action_target = resolve_browser_action_target(browser, &params, action)?;
    let used_current_page_map_target_without_fresh_observe =
        browser_action_requires_fresh_observe(action)
            && !browser.agent_has_fresh_observation()
            && browser_action_can_use_current_page_map_target_without_fresh_observe(
                browser,
                action,
                action_target.as_ref(),
            );

    if browser_action_requires_fresh_observe(action)
        && !browser.agent_has_fresh_observation()
        && !used_current_page_map_target_without_fresh_observe
    {
        return Err(CliError::InvalidParams(
            "tide_browser_observe required before this Browser Pane action".into(),
        ));
    }

    let mut targeted_focus = false;
    let mut cursor_motion_ms = 0_u64;
    let mut dispatch_delay_ms = 0_u64;
    let dispatched = match action {
        "navigate" => {
            let url = params
                .get("url")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| CliError::InvalidParams("url required for navigate".into()))?;
            let normalized = BrowserPane::normalize_navigation_url(url);
            let intentional_reload = param_bool(&params, &["reload", "intentional_reload"]);
            if browser.url == normalized && !intentional_reload {
                return Err(CliError::InvalidParams(
                    "navigate target is already loaded; pass reload=true for an intentional reload"
                        .into(),
                ));
            }
            browser.navigate(&normalized);
            !browser.needs_initial_navigate
        }
        "move" => {
            let x = params
                .get("x")
                .and_then(|v| v.as_f64())
                .ok_or_else(|| CliError::InvalidParams("x required for move".into()))?;
            let y = params
                .get("y")
                .and_then(|v| v.as_f64())
                .ok_or_else(|| CliError::InvalidParams("y required for move".into()))?;
            let label = params
                .get("label")
                .and_then(|v| v.as_str())
                .map(String::from);
            cursor_motion_ms = browser.automation_cursor_motion_duration_ms(x, y);
            browser.set_automation_cursor_with_motion_duration(
                BrowserAutomationCursor {
                    x,
                    y,
                    label,
                    visible: true,
                },
                cursor_motion_ms,
            );
            browser.webview.is_some()
        }
        "click" => {
            let (x, y, target_label) =
                match action_target.as_ref() {
                    Some(target) => {
                        let (x, y) = target.center();
                        let label = if target.label.trim().is_empty() {
                            None
                        } else {
                            Some(target.label.clone())
                        };
                        (x, y, label)
                    }
                    None => {
                        let x = params.get("x").and_then(|v| v.as_f64()).ok_or_else(|| {
                            CliError::InvalidParams("x required for click".into())
                        })?;
                        let y = params.get("y").and_then(|v| v.as_f64()).ok_or_else(|| {
                            CliError::InvalidParams("y required for click".into())
                        })?;
                        (x, y, None)
                    }
                };
            let label = params
                .get("label")
                .and_then(|v| v.as_str())
                .map(String::from)
                .or(target_label);
            cursor_motion_ms = browser.automation_cursor_motion_duration_ms(x, y);
            dispatch_delay_ms = BrowserPane::automation_cursor_action_delay_ms(cursor_motion_ms);
            browser.set_automation_cursor_with_motion_duration(
                BrowserAutomationCursor {
                    x,
                    y,
                    label,
                    visible: true,
                },
                cursor_motion_ms,
            );
            let dispatched = browser.dispatch_automation_click_after(x, y, dispatch_delay_ms);
            if dispatched {
                browser.request_page_snapshot_refresh();
            }
            dispatched
        }
        "type" => {
            let text = params
                .get("text")
                .and_then(|v| v.as_str())
                .ok_or_else(|| CliError::InvalidParams("text required for type".into()))?;
            let dispatched = match action_target.as_ref() {
                Some(target) => {
                    let (x, y) = target.center();
                    let label = if target.label.trim().is_empty() {
                        None
                    } else {
                        Some(target.label.clone())
                    };
                    cursor_motion_ms = browser.automation_cursor_motion_duration_ms(x, y);
                    dispatch_delay_ms =
                        BrowserPane::automation_cursor_action_delay_ms(cursor_motion_ms);
                    browser.set_automation_cursor_with_motion_duration(
                        BrowserAutomationCursor {
                            x,
                            y,
                            label,
                            visible: true,
                        },
                        cursor_motion_ms,
                    );
                    targeted_focus = true;
                    browser.dispatch_automation_type_at_after(x, y, text, dispatch_delay_ms)
                }
                None => browser.dispatch_automation_type(text),
            };
            if dispatched {
                browser.request_page_snapshot_refresh();
            }
            dispatched
        }
        "press" => {
            let key = params
                .get("key")
                .and_then(|v| v.as_str())
                .ok_or_else(|| CliError::InvalidParams("key required for press".into()))?;
            let dispatched = browser.dispatch_automation_press(key);
            if dispatched {
                browser.request_page_snapshot_refresh();
            }
            dispatched
        }
        "clear-cursor" => {
            browser.clear_automation_cursor();
            browser.webview.is_some()
        }
        _ => unreachable!("browser action support is checked before dispatch"),
    };
    let observe_after_action = browser_action_requires_observe_after(action);
    if observe_after_action {
        browser.mark_agent_action_requires_reobserve();
    }
    set_agent_browser_control_mode(browser, &control_decision);
    if browser.automation_cursor().is_some() && cursor_motion_ms == 0 {
        browser.sync_automation_cursor_overlay();
    }

    Ok(json!({
        "pane_id": pane_id,
        "action": action,
        "dispatched": dispatched,
        "runtime": "tide_browser_pane",
        "external_runtime": Value::Null,
        "requires_prior_observe": browser_action_requires_fresh_observe(action),
        "observe_after_action": observe_after_action,
        "used_current_page_map_target_without_fresh_observe": used_current_page_map_target_without_fresh_observe,
        "cursor_motion_ms": cursor_motion_ms,
        "dispatch_delay_ms": dispatch_delay_ms,
        "target": action_target
            .as_ref()
            .map(browser_page_element_json)
            .unwrap_or(Value::Null),
        "targeted_focus": targeted_focus,
        "cursor_semantics": browser_cursor_semantics_json(),
        "automation_cursor": browser_automation_cursor_json(browser.automation_cursor()),
        "agent_browser_control_mode": agent_browser_control_mode_json(&control_decision, browser),
    }))
}

/// UC-4: GetLayout — return the layout tree as recursive JSON.
fn cli_get_layout(ctx: &impl LayoutPort) -> Result<Value, CliError> {
    match ctx.layout_snapshot() {
        Some(snap) => Ok(serialize_snapshot(&snap)),
        None => Ok(Value::Null),
    }
}

// ── Phase 2: Act ─────────────────────────────────────────────────

/// UC-3: SendKeys — write key sequences to a terminal pane's PTY.
fn cli_send_keys(
    ctx: &mut (impl FocusNavPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Terminal(tp) => {
            let keys = params
                .get("keys")
                .and_then(|v| v.as_array())
                .ok_or_else(|| CliError::InvalidParams("keys array required".into()))?;

            for key in keys {
                let key_str = key.as_str().unwrap_or("");
                let bytes = crate::tide_input::translate_key(key_str);
                tp.backend.write(&bytes);
            }

            Ok(json!({"ok": true}))
        }
        _ => {
            let kind_str = match pane {
                PaneKind::Editor(_) => "editor",
                PaneKind::Diff(_) => "diff",
                PaneKind::Browser(_) => "browser",
                PaneKind::Launcher(_) => "launcher",
                _ => unreachable!(),
            };
            Err(CliError::InvalidPaneKind {
                pane_id,
                expected: "terminal",
                actual: kind_str,
            })
        }
    }
}

fn capture_selection_details(
    ctx: &crate::App,
    pane_id: crate::tide_core::PaneId,
) -> Result<(String, Option<crate::pane::Selection>, String), CliError> {
    let pane = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Terminal(tp) => Ok((
            tp.selection
                .as_ref()
                .map(|sel| tp.selected_text(sel))
                .unwrap_or_default(),
            tp.selection.clone(),
            "terminal".to_string(),
        )),
        PaneKind::Editor(ep) => Ok((
            ep.selection
                .as_ref()
                .map(|sel| ep.selected_text(sel))
                .unwrap_or_default(),
            ep.selection.clone(),
            "editor".to_string(),
        )),
        PaneKind::Diff(dp) => Ok((
            dp.selection
                .as_ref()
                .map(|sel| dp.selected_text(sel))
                .unwrap_or_default(),
            dp.selection.clone(),
            "diff".to_string(),
        )),
        PaneKind::Browser(bp) => {
            let content = if bp.url_input_focused && bp.url_selection.is_some() {
                bp.url_selected_text().unwrap_or_default()
            } else if bp
                .page_selection
                .as_ref()
                .is_some_and(|selection| !selection.collapsed)
            {
                bp.page_selection_content().unwrap_or_default()
            } else if bp.render_mode {
                bp.render_html.clone().unwrap_or_default()
            } else {
                bp.url_selected_text().unwrap_or_default()
            };
            Ok((
                content,
                None,
                if bp.render_mode {
                    "browser-render".to_string()
                } else {
                    "browser".to_string()
                },
            ))
        }
        PaneKind::Launcher(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "terminal, editor, diff, or browser",
            actual: "launcher",
        }),
    }
}

fn serialize_selection(selection: &crate::pane::Selection) -> Value {
    crate::state::context_artifact::serialize_selection(selection)
}

fn browser_capture_selection_source(bp: &BrowserPane) -> &'static str {
    if bp.url_input_focused && bp.url_selected_text().is_some() {
        return "url";
    }
    if bp
        .page_selection
        .as_ref()
        .is_some_and(|selection| !selection.collapsed)
        && bp.page_selection_content().is_some()
    {
        return "page";
    }
    if bp.render_mode
        && bp
            .render_html
            .as_deref()
            .is_some_and(|html| !html.trim().is_empty())
    {
        return "render-html";
    }
    "none"
}

fn requested_browser_selection_kind(params: &Value) -> Option<&str> {
    params
        .get("selection_kind")
        .or_else(|| params.get("kind"))
        .or_else(|| params.get("mode"))
        .and_then(|value| value.as_str())
}

fn cli_capture_selection(ctx: &crate::App, params: Value) -> Result<Value, CliError> {
    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;

    let pane = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))?;
    if matches!(
        (pane, requested_browser_selection_kind(&params)),
        (PaneKind::Browser(_), Some("region" | "element"))
    ) {
        return Err(CliError::InvalidParams(
            "Browser Pane element and region selection are unsupported until a V1 data model exists"
                .into(),
        ));
    }

    let (content, selection, kind) = capture_selection_details(ctx, pane_id)?;
    let mut result = json!({
        "pane_id": pane_id,
        "kind": kind,
        "content": content,
        "selection": selection.as_ref().map(serialize_selection).unwrap_or(Value::Null),
    });
    if let PaneKind::Browser(bp) = pane {
        let obj = result.as_object_mut().expect("selection result is object");
        obj.insert(
            "selection_source".to_string(),
            json!(browser_capture_selection_source(bp)),
        );
        obj.insert(
            "browser_selection".to_string(),
            browser_selection_json(bp.page_selection.as_ref()),
        );
        obj.insert(
            "future_region_selection".to_string(),
            json!({
                "supported": false,
                "reason": "element identity, screenshot crop, and arbitrary region capture are future Browser Pane work",
            }),
        );
    }
    Ok(result)
}

/// UC-5: Split — split from a source pane, creating a new terminal.
fn cli_split(
    ctx: &mut (impl ActionPort + FocusNavPort + GatewayPort + PaneAccessPort),
    direction: SplitDirection,
    params: Value,
) -> Result<Value, CliError> {
    let source = command_target_pane_id(ctx, &params, "pane_id")?;

    if !ctx.has_pane(source) {
        return Err(CliError::PaneNotFound(source));
    }

    let cwd = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(PathBuf::from);

    match ctx.split_pane_from(source, direction, cwd) {
        Some(new_id) => Ok(json!({"pane_id": new_id})),
        None => Err(CliError::InvalidParams("split failed".into())),
    }
}

/// UC-5: ClosePaneCli — close a specific pane.
fn cli_close_pane(
    ctx: &mut (impl FocusNavPort + GatewayPort + PaneAccessPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;

    if !ctx.has_pane(pane_id) {
        return Err(CliError::PaneNotFound(pane_id));
    }

    ctx.close_specific_pane_with_split_animation(pane_id);
    Ok(json!({"ok": true}))
}

/// UC-5: FocusPane — change focus to a specific pane.
fn cli_focus_pane(
    ctx: &mut (impl DockPort + FocusNavPort + GatewayPort + PaneAccessPort + WorkspaceNavPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;

    if !ctx.has_pane(pane_id) {
        return Err(CliError::PaneNotFound(pane_id));
    }

    let allow_text_focus_transfer = param_bool(
        &params,
        &[
            "allow_text_focus_transfer",
            "text_focus_transfer",
            "explicit_focus",
        ],
    );
    if ctx.cli_caller_pane().is_some() {
        if let Some(owner) = ctx.terminal_owning(pane_id) {
            ctx.dock_layout_set_focused(owner, pane_id);
            ctx.dock_layout_set_active_tab(owner, pane_id);
            return Ok(json!({
                "ok": true,
                "pane_id": pane_id,
                "owner_terminal_id": owner,
                "focus_preserved": true,
                "text_focus_transferred": false,
                "ignored_text_focus_transfer": allow_text_focus_transfer,
            }));
        }

        return Ok(json!({
            "ok": true,
            "pane_id": pane_id,
            "focus_preserved": true,
            "text_focus_transferred": false,
            "ignored_text_focus_transfer": allow_text_focus_transfer,
        }));
    }

    if let Some(owner) = ctx.terminal_owning(pane_id) {
        if ctx.focused_terminal_id() != Some(owner) {
            ctx.focus_terminal(owner);
        }
    }
    ctx.focus_terminal(pane_id);
    ctx.gateway_notify("focus-changed", json!({"pane_id": pane_id}));
    Ok(json!({
        "ok": true,
        "pane_id": pane_id,
        "focus_preserved": false,
        "text_focus_transferred": true,
    }))
}

fn cli_activate_notification_target(
    ctx: &mut (impl AppCorePort + PaneAccessPort + WorkspaceNavPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;

    if !ctx.has_pane_in_any_workspace(pane_id) {
        return Ok(json!({"ok": true}));
    }

    ctx.activate_notification_target(pane_id);
    ctx.queue_show_window();
    ctx.request_redraw();
    Ok(json!({"ok": true}))
}

/// UC-3: RenameWorkspaceViaMcp — rename a Workspace by index (defaults to active).
fn cli_rename_workspace(
    ctx: &mut impl WorkspaceNavPort,
    params: Value,
) -> Result<Value, CliError> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("name is required".into()))?
        .to_string();

    let ws_index = match params.get("ws_index") {
        Some(v) => v
            .as_u64()
            .ok_or_else(|| CliError::InvalidParams("ws_index must be a number".into()))?
            as usize,
        None => ctx.ws_active(),
    };

    ctx.rename_workspace(ws_index, name);

    if ws_index >= ctx.ws_workspaces_len() {
        return Err(CliError::InvalidParams(format!(
            "ws_index {ws_index} out of bounds (len {})",
            ctx.ws_workspaces_len()
        )));
    }

    let resolved_name = ctx.workspace_name(ws_index).unwrap_or_default();
    Ok(json!({
        "ws_index": ws_index,
        "name": resolved_name,
    }))
}

fn layout_action_number(params: &Value, target: &Value, key: &str) -> Option<f32> {
    params
        .get(key)
        .and_then(|value| value.as_f64())
        .or_else(|| target.get(key).and_then(|value| value.as_f64()))
        .map(|value| value as f32)
}

/// UC-2: ResizeLayoutTarget — mutate a product-level Tide Layout Target.
fn cli_layout_action(
    ctx: &mut (impl AppCorePort + DockPort + FocusNavPort + GatewayPort + LayoutPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let action = params
        .get("action")
        .and_then(|value| value.as_str())
        .ok_or_else(|| CliError::InvalidParams("action required".into()))?;
    if action != "resize" {
        return Err(CliError::InvalidParams(format!(
            "unsupported layout action: {action}"
        )));
    }

    let target = params
        .get("target")
        .ok_or_else(|| CliError::InvalidParams("target required".into()))?;
    let target_kind = target
        .get("kind")
        .and_then(|value| value.as_str())
        .ok_or_else(|| CliError::InvalidParams("target.kind required".into()))?;

    match target_kind {
        "terminal_context_surface" => {
            let width = layout_action_number(&params, target, "width_px")
                .or_else(|| layout_action_number(&params, target, "width"))
                .ok_or_else(|| {
                    CliError::InvalidParams(
                        "width_px required for terminal_context_surface resize".into(),
                    )
                })?;
            let owner = terminal_context_surface_target_owner(ctx, target)?;

            let from_width = ctx.animate_dock_width(width);
            ctx.compute_layout();
            ctx.invalidate_chrome();
            ctx.request_redraw();
            let animation_active = (from_width - width).abs() >= 0.5;

            Ok(json!({
                "ok": true,
                "runtime": "tide_mcp_runtime",
                "action": action,
                "target": {
                    "kind": "terminal_context_surface",
                    "owner_terminal_id": owner,
                },
                "requested": {
                    "width_px": width,
                },
                "animation": {
                    "active": animation_active,
                    "from_width_px": from_width,
                    "to_width_px": width,
                },
                "effective_rect": optional_rect_value(ctx.dock_area_rect()),
            }))
        }
        "pane_split" => {
            let pane_id = target
                .get("pane_id")
                .and_then(|value| value.as_u64())
                .ok_or_else(|| CliError::InvalidParams("target.pane_id required".into()))?;
            if !ctx.has_pane(pane_id) {
                return Err(CliError::PaneNotFound(pane_id));
            }
            let ratio = layout_action_number(&params, target, "ratio")
                .ok_or_else(|| CliError::InvalidParams("ratio required for pane_split".into()))?;

            let owner_terminal_id = ctx.terminal_owning(pane_id);
            let resized = if let Some(owner) = owner_terminal_id {
                ctx.dock_layout_set_split_ratio(owner, pane_id, ratio)
            } else {
                ctx.layout_set_split_ratio(pane_id, ratio)
            };

            if !resized {
                return Err(CliError::InvalidParams("pane is not in a split".into()));
            }

            ctx.compute_layout();
            ctx.invalidate_chrome();
            ctx.request_redraw();

            Ok(json!({
                "ok": true,
                "runtime": "tide_mcp_runtime",
                "action": action,
                "target": {
                    "kind": "pane_split",
                    "pane_id": pane_id,
                    "surface": if owner_terminal_id.is_some() { "terminal_context_surface" } else { "stage" },
                    "owner_terminal_id": owner_terminal_id,
                },
                "requested": {
                    "ratio": ratio,
                },
                "effective_rect": optional_rect_value(pane_rect(ctx, pane_id)),
            }))
        }
        other => Err(CliError::InvalidParams(format!(
            "unsupported layout target kind: {other}"
        ))),
    }
}

/// UC-5: ResizePane — adjust the split ratio of the parent split.
fn cli_resize_pane(
    ctx: &mut (impl FocusNavPort + GatewayPort + LayoutPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;

    if !ctx.has_pane(pane_id) {
        return Err(CliError::PaneNotFound(pane_id));
    }

    let ratio = params
        .get("ratio")
        .and_then(|v| v.as_f64())
        .map(|r| r as f32)
        .ok_or_else(|| CliError::InvalidParams("ratio (float) required".into()))?;

    if ctx.layout_set_split_ratio(pane_id, ratio) {
        ctx.compute_layout();
        Ok(json!({"ok": true}))
    } else {
        Err(CliError::InvalidParams("pane is not in a split".into()))
    }
}

/// UC-6: OpenTerminal — create a new terminal pane.
fn cli_open_terminal(
    ctx: &mut (impl ActionPort + DockPort + FocusNavPort + PaneAccessPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let cwd = params
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(PathBuf::from);

    let source = ctx
        .resolve_context_terminal_id()
        .or_else(|| ctx.focused_pane())
        .ok_or_else(|| CliError::InvalidParams("no pane_id and no focused pane".into()))?;

    if !ctx.has_pane(source) {
        return Err(CliError::PaneNotFound(source));
    }

    let activate = ctx.focused_terminal_id() == Some(source);

    let direction = match params.get("position").and_then(|v| v.as_str()) {
        Some("split-below") => SplitDirection::Horizontal,
        _ => SplitDirection::Vertical,
    };

    match ctx.split_pane_from_with_activation(source, direction, cwd, activate) {
        Some(new_id) => Ok(json!({"pane_id": new_id})),
        None => Err(CliError::InvalidParams("terminal creation failed".into())),
    }
}

fn open_editor_target_owner(params: &Value) -> Result<Option<PaneId>, CliError> {
    if let Some(target) = params.get("target") {
        let kind = target
            .get("kind")
            .and_then(|value| value.as_str())
            .ok_or_else(|| CliError::InvalidParams("target.kind required".into()))?;
        if kind != "terminal_context_surface" {
            return Err(CliError::InvalidParams(
                "target.kind must be terminal_context_surface".into(),
            ));
        }
        let owner = target
            .get("owner_terminal_id")
            .and_then(|value| value.as_u64())
            .ok_or_else(|| {
                CliError::InvalidParams(
                    "target.owner_terminal_id required for terminal_context_surface".into(),
                )
            })?;
        return Ok(Some(owner));
    }

    match params.get("owner_terminal_id") {
        Some(value) => value
            .as_u64()
            .map(Some)
            .ok_or_else(|| CliError::InvalidParams("owner_terminal_id must be an integer".into())),
        None => Ok(None),
    }
}

fn ensure_open_editor_owner_terminal(
    ctx: &impl PaneAccessPort,
    owner_terminal_id: PaneId,
) -> Result<(), CliError> {
    match ctx.pane(owner_terminal_id) {
        Some(PaneKind::Terminal(_)) => Ok(()),
        Some(_) => Err(CliError::InvalidParams(
            "owner_terminal_id must reference a Terminal Pane".into(),
        )),
        None => Err(CliError::PaneNotFound(owner_terminal_id)),
    }
}

/// UC-6: OpenEditor — open a file in an editor pane.
fn cli_open_editor(
    ctx: &mut (impl DockPort + FocusNavPort + PaneAccessPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let file = params
        .get("file")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("file path required".into()))?;

    let path = PathBuf::from(file);

    let explicit_owner = open_editor_target_owner(&params)?;
    if let Some(owner) = explicit_owner {
        ensure_open_editor_owner_terminal(ctx, owner)?;
    }
    let context_terminal = explicit_owner.or_else(|| ctx.resolve_context_terminal_id());
    let activate = context_terminal
        .map(|owner| ctx.focused_terminal_id() == Some(owner))
        .unwrap_or(true);

    let before_ids: Vec<PaneId> = ctx.pane_entries().into_iter().map(|(id, _)| id).collect();

    let opened_id = ctx
        .open_editor_pane_in_context_with_activation(path.clone(), context_terminal, activate)
        .ok_or_else(|| CliError::InvalidParams("editor creation failed".into()))?;

    let already_open = before_ids.contains(&opened_id)
        && matches!(
            ctx.pane(opened_id),
            Some(PaneKind::Editor(editor)) if editor.editor.file_path() == Some(path.as_path())
        );
    let mut result = json!({"pane_id": opened_id});
    if already_open {
        result["already_open"] = json!(true);
    }
    Ok(result)
}

/// UC-6: OpenBrowser — open a URL in a browser pane.
fn cli_open_browser(
    ctx: &mut (impl DockPort + FocusNavPort + GatewayPort + PaneAccessPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let url = params.get("url").and_then(|v| v.as_str()).map(String::from);
    let context_terminal = ctx.resolve_context_terminal_id();
    let activate = if ctx.cli_caller_pane().is_some() {
        false
    } else {
        context_terminal
            .map(|owner| ctx.focused_terminal_id() == Some(owner))
            .unwrap_or(true)
    };

    if let Some(opened_id) =
        ctx.open_browser_pane_in_context_with_activation(url, context_terminal, activate)
    {
        let control_decision = agent_browser_control_decision(ctx, opened_id);
        let pane = ctx
            .pane_mut(opened_id)
            .ok_or(CliError::PaneNotFound(opened_id))?;
        let browser = navigation_browser_mut(opened_id, pane)?;
        ensure_browser_operation_visuals(browser, &control_decision);
        Ok(json!({
            "pane_id": opened_id,
            "runtime": "tide_browser_pane",
            "external_runtime": Value::Null,
            "operation": browser_operation_json(control_decision.active),
            "cursor_semantics": browser_cursor_semantics_json(),
            "automation_cursor": browser_automation_cursor_json(browser.automation_cursor()),
            "agent_browser_control_mode": agent_browser_control_mode_json(&control_decision, browser),
        }))
    } else {
        Err(CliError::InvalidParams("browser creation failed".into()))
    }
}

// ── Phase 3: Show (Generative UI) ────────────────────────────────

fn validate_render_root_fragment(html: &str) -> Result<(), CliError> {
    let lower = html.to_ascii_lowercase();
    if lower.contains("<!doctype")
        || lower.contains("<html")
        || lower.contains("<head")
        || lower.contains("<body")
    {
        return Err(CliError::InvalidParams(
            "html must be a #root fragment; do not include <!doctype>, <html>, <head>, or <body>"
                .into(),
        ));
    }
    Ok(())
}

/// UC-7: RenderHTML — render agent-provided HTML in a Browser pane.
/// Now uses PaneLifecyclePort::open_render_pane which places the pane in the Dock.
fn cli_render_html(
    ctx: &mut (impl AppCorePort + FocusNavPort + PaneAccessPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("title required".into()))?
        .to_string();
    let html = params
        .get("html")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("html required".into()))?
        .to_string();
    validate_render_root_fragment(&html)?;

    // If pane_id is specified, update existing render pane
    if let Some(pane_id) = params.get("pane_id").and_then(|v| v.as_u64()) {
        let pane = ctx
            .pane_mut(pane_id)
            .ok_or(CliError::PaneNotFound(pane_id))?;
        match pane {
            PaneKind::Browser(bp) if bp.render_mode => {
                bp.render_title = Some(title);
                bp.update_render_content(&html);
                ctx.invalidate_chrome();
                return Ok(json!({"pane_id": pane_id}));
            }
            PaneKind::Browser(_) => {
                return Err(CliError::InvalidPaneKind {
                    pane_id,
                    expected: "render-mode browser",
                    actual: "browser",
                });
            }
            _ => {
                return Err(CliError::InvalidPaneKind {
                    pane_id,
                    expected: "render-mode browser",
                    actual: "non-browser",
                });
            }
        }
    }

    // Create new render pane via port — goes to Dock!
    let new_id = ctx.open_render_pane(title, html);
    Ok(json!({"pane_id": new_id}))
}

/// UC-8: RenderStream — create a streaming render pane.
fn cli_render_stream(
    ctx: &mut (impl FocusNavPort + PaneLifecyclePort),
    params: Value,
) -> Result<Value, CliError> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("title required".into()))?
        .to_string();

    // Create new render stream pane via port — goes to Dock!
    let new_id = ctx.open_render_stream_pane(title);
    Ok(json!({"pane_id": new_id}))
}

/// UC-8: StreamChunk — send an HTML chunk to a streaming render pane.
fn cli_stream_chunk(ctx: &mut impl PaneAccessPort, params: Value) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;
    let html = params
        .get("html")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("html required".into()))?;
    validate_render_root_fragment(html)?;

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Browser(bp) if bp.render_mode => {
            bp.update_render_content(html);
            Ok(json!({"ok": true}))
        }
        PaneKind::Browser(_) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "render-mode browser",
            actual: "browser",
        }),
        _ => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "render-mode browser",
            actual: "non-browser",
        }),
    }
}

/// UC-8: StreamEnd — end a streaming connection.
fn cli_stream_end(
    ctx: &mut (impl AppCorePort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;

    match pane {
        PaneKind::Browser(bp) if bp.render_mode && bp.streaming => {
            bp.streaming = false;
            ctx.gateway_dec_streams();
            ctx.invalidate_chrome();
            Ok(json!({"ok": true}))
        }
        PaneKind::Browser(bp) if bp.render_mode => {
            Err(CliError::InvalidParams("pane is not streaming".into()))
        }
        _ => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "streaming render-mode browser",
            actual: "non-render",
        }),
    }
}

// ── Phase 4: Discover + React ─────────────────────────────────────

/// UC-9: Subscribe — register for event notifications.
fn cli_subscribe(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let event_filter: Vec<String> = params
        .get("events")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let caller_pane = ctx.cli_dispatch.as_ref().and_then(|d| d.caller_pane);
    let tx = ctx
        .take_subscribe_tx()
        .ok_or_else(|| CliError::InvalidParams("subscribe requires notification channel".into()))?;

    ctx.gateway_subscribe(caller_pane, tx, event_filter);
    Ok(json!({"ok": true}))
}

fn active_artifact_json(artifact: &crate::ContextArtifact) -> Value {
    crate::state::context_artifact::context_artifact_json(artifact)
}

fn caller_terminal_id(ctx: &crate::App) -> Result<crate::tide_core::PaneId, CliError> {
    ctx.cli_dispatch
        .as_ref()
        .and_then(|d| d.caller_pane)
        .ok_or_else(|| CliError::InvalidParams("caller pane required".into()))
}

fn source_terminal_for_pane(
    ctx: &crate::App,
    pane_id: crate::tide_core::PaneId,
) -> Result<crate::tide_core::PaneId, CliError> {
    match ctx.pane(pane_id) {
        Some(PaneKind::Terminal(_)) => {
            if ctx.is_pane_in_dock(pane_id) {
                ctx.assoc
                    .associated_terminal
                    .get(&pane_id)
                    .copied()
                    .or_else(|| ctx.terminal_owning(pane_id))
                    .ok_or_else(|| {
                        CliError::InvalidParams(format!(
                            "pane {pane_id} has no associated terminal"
                        ))
                    })
            } else {
                Ok(pane_id)
            }
        }
        Some(_) => ctx
            .assoc
            .associated_terminal
            .get(&pane_id)
            .copied()
            .ok_or_else(|| {
                CliError::InvalidParams(format!("pane {pane_id} has no associated terminal"))
            }),
        None => Err(CliError::PaneNotFound(pane_id)),
    }
}

fn ensure_artifact_owner(
    caller_terminal_id: crate::tide_core::PaneId,
    associated_terminal_id: crate::tide_core::PaneId,
) -> Result<(), CliError> {
    if caller_terminal_id != associated_terminal_id {
        return Err(CliError::InvalidParams(format!(
            "pane is owned by terminal {associated_terminal_id}, not {caller_terminal_id}"
        )));
    }
    Ok(())
}

fn cli_create_context_artifact(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let pane_id = params
        .get("pane_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane_id required".into()))?;
    let comment = params
        .get("comment")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let pinned = params
        .get("pin")
        .and_then(|v| v.as_bool())
        .or_else(|| params.get("pinned").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    let caller_terminal_id = caller_terminal_id(ctx)?;
    let associated_terminal_id = source_terminal_for_pane(ctx, pane_id)?;
    ensure_artifact_owner(caller_terminal_id, associated_terminal_id)?;
    let (content, selection, kind) = capture_selection_details(ctx, pane_id)?;
    let source_label = ctx.context_artifact_source_label(pane_id);

    let artifact = crate::ContextArtifact {
        artifact_id: ctx.context_artifacts.allocate_id(),
        source_pane_id: pane_id,
        associated_terminal_id,
        pane_kind: kind,
        source_label,
        selection,
        content,
        comment,
        pinned,
    };
    let artifact_id = artifact.artifact_id;
    ctx.context_artifacts
        .artifacts
        .insert(artifact_id, artifact.clone());

    Ok(active_artifact_json(&artifact))
}

fn cli_list_context_artifacts(ctx: &crate::App) -> Result<Value, CliError> {
    let caller_terminal_id = caller_terminal_id(ctx)?;
    let mut artifacts: Vec<_> = ctx
        .context_artifacts
        .artifacts
        .values()
        .filter(|artifact| artifact.associated_terminal_id == caller_terminal_id)
        .cloned()
        .collect();
    artifacts.sort_by_key(|artifact| artifact.artifact_id);
    Ok(Value::Array(
        artifacts.iter().map(active_artifact_json).collect(),
    ))
}

fn cli_read_context_artifact(ctx: &crate::App, params: Value) -> Result<Value, CliError> {
    let artifact_id = params
        .get("artifact_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("artifact_id required".into()))?;
    let caller_terminal_id = caller_terminal_id(ctx)?;
    let artifact = ctx
        .context_artifacts
        .artifacts
        .get(&artifact_id)
        .cloned()
        .ok_or(CliError::PaneNotFound(artifact_id))?;
    ensure_artifact_owner(caller_terminal_id, artifact.associated_terminal_id)?;
    Ok(active_artifact_json(&artifact))
}

fn cli_pin_context_artifact(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let artifact_id = params
        .get("artifact_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("artifact_id required".into()))?;
    let pinned = params
        .get("pinned")
        .and_then(|v| v.as_bool())
        .or_else(|| params.get("pin").and_then(|v| v.as_bool()))
        .unwrap_or(true);

    let caller_terminal_id = caller_terminal_id(ctx)?;
    let associated_terminal_id = ctx
        .context_artifacts
        .artifacts
        .get(&artifact_id)
        .ok_or(CliError::PaneNotFound(artifact_id))?
        .associated_terminal_id;
    ensure_artifact_owner(caller_terminal_id, associated_terminal_id)?;

    let artifact = ctx
        .context_artifacts
        .artifacts
        .get_mut(&artifact_id)
        .ok_or(CliError::PaneNotFound(artifact_id))?;
    artifact.pinned = pinned;
    Ok(active_artifact_json(artifact))
}

fn cli_remove_context_artifact(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let artifact_id = params
        .get("artifact_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("artifact_id required".into()))?;
    let caller_terminal_id = caller_terminal_id(ctx)?;
    let artifact = ctx
        .context_artifacts
        .artifacts
        .get(&artifact_id)
        .cloned()
        .ok_or(CliError::PaneNotFound(artifact_id))?;
    ensure_artifact_owner(caller_terminal_id, artifact.associated_terminal_id)?;
    ctx.context_artifacts.artifacts.remove(&artifact_id);
    Ok(json!({"ok": true, "artifact_id": artifact_id}))
}

fn cli_send_context_artifact(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
    let artifact_id = params
        .get("artifact_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("artifact_id required".into()))?;
    let caller_terminal_id = caller_terminal_id(ctx)?;
    let artifact = ctx
        .context_artifacts
        .artifacts
        .get(&artifact_id)
        .cloned()
        .ok_or(CliError::PaneNotFound(artifact_id))?;
    ensure_artifact_owner(caller_terminal_id, artifact.associated_terminal_id)?;

    let terminal_input_injected = ctx.deliver_context_artifact(&artifact);

    Ok(json!({
        "ok": true,
        "artifact_id": artifact_id,
        "terminal_input_injected": terminal_input_injected
    }))
}

fn cli_enable_integration(params: Value) -> Result<Value, CliError> {
    let tool = params
        .get("tool")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("tool name required".into()))?;

    match enable_integration(tool) {
        Ok(path) => Ok(json!({"ok": true, "config_path": path})),
        Err(e) => Err(CliError::InvalidParams(e)),
    }
}

fn cli_remove_integration(params: Value) -> Result<Value, CliError> {
    let tool = params
        .get("tool")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("tool name required".into()))?;

    match remove_integration(tool) {
        Ok(()) => Ok(json!({"ok": true})),
        Err(e) => Err(CliError::InvalidParams(e)),
    }
}

// ── Helper functions (pure, no App dependency) ───────────────────

/// Integration tool definitions.
struct IntegrationTool {
    name: &'static str,
    detection: IntegrationDetection,
    config_path: &'static str,
    enable_method: EnableMethod,
}

enum IntegrationDetection {
    #[allow(dead_code)]
    Which(&'static str),
    DirExists(&'static str),
}

enum EnableMethod {
    JsonMcpServers,
    #[allow(dead_code)]
    JsonMcpServersSnake,
    CliCommand(&'static str),
}

const INTEGRATION_TOOLS: &[IntegrationTool] = &[
    IntegrationTool {
        name: "claude-code",
        detection: IntegrationDetection::DirExists("~/.claude"),
        config_path: "~/.claude.json",
        enable_method: EnableMethod::JsonMcpServers,
    },
    IntegrationTool {
        name: "codex",
        detection: IntegrationDetection::DirExists("~/.codex"),
        config_path: "~/.codex/config.toml",
        enable_method: EnableMethod::CliCommand("codex"),
    },
    IntegrationTool {
        name: "gemini",
        detection: IntegrationDetection::DirExists("~/.gemini"),
        config_path: "~/.gemini/settings.json",
        enable_method: EnableMethod::JsonMcpServers,
    },
    IntegrationTool {
        name: "cursor",
        detection: IntegrationDetection::DirExists("~/.cursor"),
        config_path: "~/.cursor/mcp.json",
        enable_method: EnableMethod::JsonMcpServers,
    },
    IntegrationTool {
        name: "windsurf",
        detection: IntegrationDetection::DirExists("~/.windsurf"),
        config_path: "~/.windsurf/mcp.json",
        enable_method: EnableMethod::JsonMcpServers,
    },
];

fn expand_home(path: &str) -> std::path::PathBuf {
    if path.starts_with("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home).join(&path[2..]);
        }
    }
    std::path::PathBuf::from(path)
}

pub(crate) fn list_integration_status() -> Vec<Value> {
    INTEGRATION_TOOLS
        .iter()
        .map(|tool| {
            let installed = match &tool.detection {
                IntegrationDetection::Which(cmd) => std::process::Command::new("which")
                    .arg(cmd)
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false),
                IntegrationDetection::DirExists(dir) => expand_home(dir).exists(),
            };

            let config_path = expand_home(tool.config_path);
            let enabled = if config_path.exists() {
                let content = std::fs::read_to_string(&config_path).unwrap_or_default();
                match &tool.enable_method {
                    EnableMethod::CliCommand(_) => content.contains("[mcp_servers.tide-terminal]"),
                    _ => serde_json::from_str::<Value>(&content)
                        .ok()
                        .map(|v| v.get("mcpServers").and_then(|m| m.get("tide-terminal")).is_some())
                        .unwrap_or(false),
                }
            } else {
                false
            };

            json!({
                "tool": tool.name,
                "installed": installed,
                "enabled": enabled,
                "config_path": tool.config_path,
            })
        })
        .collect()
}

pub(crate) fn enable_integration(tool_name: &str) -> Result<String, String> {
    let tool = INTEGRATION_TOOLS
        .iter()
        .find(|t| t.name == tool_name)
        .ok_or_else(|| format!("unknown tool: {tool_name}"))?;

    let tide_bin = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "tide-terminal".to_string());

    match &tool.enable_method {
        EnableMethod::CliCommand(binary) => {
            let output = std::process::Command::new(binary)
                .args(["mcp", "add", "tide-terminal", &tide_bin, "mcp"])
                .output()
                .map_err(|e| format!("failed to run {binary} mcp add: {e}"))?;
            if output.status.success() {
                Ok(format!("{binary} mcp add tide"))
            } else {
                Err(format!(
                    "{binary} mcp add failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ))
            }
        }
        _ => {
            let config_path = expand_home(tool.config_path);
            if let Some(parent) = config_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("cannot create dir: {e}"))?;
            }

            let tide_entry = json!({"command": tide_bin, "args": ["mcp"]});

            let mut config: Value = if config_path.exists() {
                let content = std::fs::read_to_string(&config_path)
                    .map_err(|e| format!("cannot read config: {e}"))?;
                serde_json::from_str(&content).unwrap_or(json!({}))
            } else {
                json!({})
            };

            let obj = config.as_object_mut().ok_or("config is not an object")?;
            let servers = obj.entry("mcpServers").or_insert(json!({}));
            let servers_obj = servers
                .as_object_mut()
                .ok_or("mcpServers is not an object")?;
            servers_obj.insert("tide-terminal".to_string(), tide_entry);

            let output = serde_json::to_string_pretty(&config).unwrap();
            std::fs::write(&config_path, &output)
                .map_err(|e| format!("cannot write config: {e}"))?;

            Ok(config_path.to_string_lossy().into_owned())
        }
    }
}

pub(crate) fn remove_integration(tool_name: &str) -> Result<(), String> {
    let tool = INTEGRATION_TOOLS
        .iter()
        .find(|t| t.name == tool_name)
        .ok_or_else(|| format!("unknown tool: {tool_name}"))?;

    match &tool.enable_method {
        EnableMethod::CliCommand(binary) => {
            let _ = std::process::Command::new(binary)
                .args(["mcp", "remove", "tide-terminal"])
                .output();
            Ok(())
        }
        _ => {
            let config_path = expand_home(tool.config_path);
            if !config_path.exists() {
                return Ok(());
            }

            let content = std::fs::read_to_string(&config_path)
                .map_err(|e| format!("cannot read config: {e}"))?;
            let mut config: Value =
                serde_json::from_str(&content).map_err(|e| format!("invalid JSON: {e}"))?;

            if let Some(servers) = config.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
                servers.remove("tide-terminal");
            }

            let output = serde_json::to_string_pretty(&config).unwrap();
            std::fs::write(&config_path, &output)
                .map_err(|e| format!("cannot write config: {e}"))?;

            Ok(())
        }
    }
}

fn serialize_snapshot(snap: &LayoutSnapshot) -> Value {
    match snap {
        LayoutSnapshot::Leaf { tabs, active } => {
            let id = tabs
                .get(*active)
                .or_else(|| tabs.first())
                .copied()
                .unwrap_or(0);
            json!({
                "type": "leaf",
                "pane_id": id,
            })
        }
        LayoutSnapshot::LeafGroup { tabs, active } => {
            json!({
                "type": "tab_group",
                "tabs": tabs,
                "active": *active,
                "active_pane_id": tabs.get(*active).copied().unwrap_or(0),
            })
        }
        LayoutSnapshot::Split {
            direction,
            ratio,
            left,
            right,
        } => {
            let dir = match direction {
                crate::tide_core::SplitDirection::Horizontal => "horizontal",
                crate::tide_core::SplitDirection::Vertical => "vertical",
            };
            json!({
                "type": "split",
                "direction": dir,
                "ratio": ratio,
                "left": serialize_snapshot(left),
                "right": serialize_snapshot(right),
            })
        }
    }
}

// ── Phase 5: Agent Lifecycle ──────────────────────────────────────

/// Handle agent lifecycle notifications sent by wrapper hooks.
/// Updates AgentInfo.status for the given pane and bumps chrome generation.
fn cli_notify(
    ctx: &mut (impl AppCorePort + DockPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    use crate::state::gateway_status::AgentStatus;

    let event = params
        .get("event")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CliError::InvalidParams("event (string) required".into()))?;

    let pane_id = params
        .get("pane")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| CliError::InvalidParams("pane (u64) required".into()))?;

    let matches_current_tide_instance = params
        .get("tide_instance_pid")
        .and_then(|v| v.as_u64())
        .map_or(true, |pid| pid == std::process::id() as u64);

    let codex_stop_resolution = if event == "codex-stop" {
        Some(resolve_codex_stop_payload(params.get("payload")))
    } else {
        None
    };
    let (normalized_event, status) = match event {
        "agent-attached" => ("agent-attached", None),
        "agent-detached" => ("agent-detached", None),
        "agent-running" => ("agent-running", Some(AgentStatus::Running)),
        "agent-idle" => ("agent-idle", Some(AgentStatus::Idle)),
        "agent-needs-input" => ("agent-needs-input", Some(AgentStatus::NeedsInput)),
        "codex-stop" => {
            let status = match codex_stop_resolution.as_ref() {
                Some(CodexStopResolution::IgnoreSubagent) => AgentStatus::Idle,
                Some(CodexStopResolution::Resolved { .. }) => AgentStatus::Idle,
                None => AgentStatus::Idle,
            };
            let normalized_event = match status {
                AgentStatus::Running => "agent-running",
                AgentStatus::Idle => "agent-idle",
                AgentStatus::NeedsInput => "agent-needs-input",
            };
            (normalized_event, Some(status))
        }
        "codex-turn-complete" => {
            let status = classify_codex_completed_turn_payload(params.get("payload"));
            let normalized_event = match status {
                AgentStatus::Running => "agent-running",
                AgentStatus::Idle => "agent-idle",
                AgentStatus::NeedsInput => "agent-needs-input",
            };
            (normalized_event, Some(status))
        }
        _ => return Err(CliError::InvalidParams(format!("unknown event: {event}"))),
    };

    if !matches_current_tide_instance {
        return Ok(json!({"ok": true}));
    }

    // Only process notify for panes that actually exist (in any workspace)
    if !ctx.has_pane_in_any_workspace(pane_id) {
        return Ok(json!({"ok": true}));
    }

    if matches!(
        codex_stop_resolution,
        Some(CodexStopResolution::IgnoreSubagent)
    ) {
        return Ok(json!({"ok": true}));
    }

    if event == "agent-detached" {
        let agent_key = params
            .get("agent")
            .and_then(|v| v.as_str())
            .unwrap_or("agent");
        ctx.handle_terminal_notification(
            pane_id,
            &format!("tide:wrapped-agent:{agent_key}:agent-detached"),
        );
        return Ok(json!({"ok": true}));
    }

    // Update status if this pane has a detected agent.
    // If no agent is registered yet (wrapper hook fired before process scan),
    // auto-register from the agent name hint or with a generic name.
    let agent_display_name = params.get("agent").and_then(|v| v.as_str()).unwrap_or(
        if matches!(event, "codex-turn-complete" | "codex-stop") {
            "codex"
        } else {
            "Agent"
        },
    );
    let agent_name = {
        let agents = ctx.detected_agents_mut();
        if let Some(agent) = agents.get_mut(&pane_id) {
            agent.wrapper_managed = true;
            agent.gateway_connected = true;
            agent.status = status;
            Some(agent.name)
        } else {
            // Auto-register: wrapper hook arrived before gateway modal scan.
            // Use a static str for the display name based on the hint.
            let name = crate::state::gateway_status::wrapped_agent_display_name(agent_display_name)
                .unwrap_or("Agent");
            agents.insert(
                pane_id,
                crate::state::gateway_status::AgentInfo {
                    name,
                    pid: 0, // PID unknown from hook — will be updated on next process scan
                    wrapper_managed: true,
                    gateway_connected: true, // wrapper implies MCP is connected
                    status,
                },
            );
            Some(name)
        }
    };

    if let Some(name) = agent_name {
        ctx.invalidate_chrome();
        ctx.gateway_notify(
            "agent-status-changed",
            json!({
                "pane_id": pane_id,
                "status": normalized_event,
                "agent": name,
            }),
        );
        if let Some(status) = status {
            let mut notification_snippet =
                if matches!(status, AgentStatus::Idle | AgentStatus::NeedsInput) {
                    codex_stop_resolution
                        .as_ref()
                        .and_then(codex_stop_notification_snippet)
                        .or_else(|| {
                            wrapped_agent_notification_snippet_from_payload(
                                event,
                                agent_display_name,
                                params.get("payload"),
                            )
                        })
                } else {
                    None
                };
            if matches!(event, "codex-turn-complete" | "codex-stop")
                && matches!(status, AgentStatus::Idle | AgentStatus::NeedsInput)
                && notification_snippet.is_none()
            {
                notification_snippet = Some(match status {
                    AgentStatus::Idle => format!("{name} finished"),
                    AgentStatus::NeedsInput => format!("{name} needs your input"),
                    AgentStatus::Running => unreachable!(),
                });
            }
            ctx.set_agent_notification_snippet(pane_id, notification_snippet.clone());
            if matches!(status, AgentStatus::Idle | AgentStatus::NeedsInput) {
                clear_browser_operation_visuals_for_terminal(ctx, pane_id);
            }
            // Route notification based on user context (UC-1)
            ctx.route_agent_notification(pane_id, status, notification_snippet);
        } else {
            ctx.set_agent_notification_snippet(pane_id, None);
        }
    }

    Ok(json!({"ok": true}))
}


