// Command handlers for Agent Gateway.
// All command functions are free functions taking port trait bounds.
// App.handle_cli_command() is the thin dispatch bridge.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::agent::notification::{
    classify_codex_completed_turn_payload, codex_stop_notification_snippet,
    resolve_codex_stop_payload, wrapped_agent_notification_snippet_from_payload,
    CodexStopResolution,
};
use crate::pane::browser::{
    BrowserActionHistoryEntry, BrowserAutomationCursor, BrowserListGroup, BrowserListItem,
    BrowserListSnapshot, BrowserNetworkEntry, BrowserNetworkLog, BrowserPageElement,
    BrowserPageElementKind, BrowserPageMap, BrowserPane, BrowserPaneScreenshot,
    BrowserReviewHistoryEntry, BrowserSelectionSnapshot, BrowserSnapshot,
    BROWSER_ACTION_HISTORY_LIMIT, BROWSER_LIST_GROUP_LIMIT, BROWSER_LIST_ITEM_LIMIT,
    BROWSER_LIST_TEXT_LIMIT_BYTES, BROWSER_NETWORK_LOG_LIMIT, BROWSER_NETWORK_TEXT_LIMIT_BYTES,
    BROWSER_PAGE_MAP_INTERACTABLE_LIMIT, BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES,
    BROWSER_PAGE_MAP_REGION_LIMIT, BROWSER_PAGE_MAP_TEXT_LIMIT_BYTES,
    BROWSER_SNAPSHOT_TEXT_LIMIT_BYTES,
};
use crate::pane::PaneKind;
use crate::state::gateway_status::{AgentInfo, AgentStatus};
use crate::state::FocusArea;
use crate::tide_core::{CursorShape, PaneId, Rect, SplitDirection, TerminalBackend};
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
            "observe-terminal" => cli_observe_terminal(self, params),
            "find-in-terminal" => cli_find_in_terminal(self, params),
            "find-in-editor" => cli_find_in_editor(self, params),
            "replace-in-editor" => cli_replace_in_editor(self, params),
            "rename-workspace" => cli_rename_workspace(self, params),
            "capture-pane" => cli_capture_pane(self, params),
            "capture-selection" => cli_capture_selection(self, params),
            "get-layout" => cli_get_layout(self),
            "browser-observe" => cli_browser_observe(self, params),
            "browser-read-snapshot" => cli_browser_read_snapshot(self, params),
            "browser-find-in-snapshot" => cli_browser_find_in_snapshot(self, params),
            "browser-diff-since" => cli_browser_diff_since(self, params),
            "browser-inspect-network" => cli_browser_inspect_network(self, params),
            "browser-collect-list" => cli_browser_collect_list(self, params),
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
            "test-inject-event" if test_driver_enabled() => cli_test_inject_event(self, params),
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

/// Inject a synthetic `PlatformEvent` (deserialized from `params.event`) into the
/// app's queue. The app-thread loop drains it through the **same**
/// `handle_platform_event` path as real OS input — so the full Modal → FocusArea
/// → Router → TextInput stack gets exercised over the gateway, no display needed.
pub(crate) fn cli_test_inject_event(
    ctx: &mut crate::App,
    params: Value,
) -> Result<Value, CliError> {
    let event_value = params
        .get("event")
        .ok_or_else(|| CliError::InvalidParams("test-inject-event requires `event`".into()))?;
    let event: crate::tide_platform::PlatformEvent = serde_json::from_value(event_value.clone())
        .map_err(|e| CliError::InvalidParams(format!("invalid PlatformEvent: {e}")))?;
    ctx.injected_events.push(event);
    Ok(json!({"ok": true}))
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TerminalObserveDetail {
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

/// Pixel-vision axis for `browser-observe`, orthogonal to `detail`/`mode` (which is a
/// text-verbosity alias). `text` = no screenshot (default, back-compat + token cost);
/// `screenshot` = image without the full BrowserSnapshot body; `both` = image + the
/// detail-governed text. See `docs/specs/browser-agent-pixel-vision.md`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BrowserObserveVision {
    Text,
    Screenshot,
    Both,
}

fn browser_observe_vision(params: &Value) -> Result<BrowserObserveVision, CliError> {
    let Some(value) = params.get("vision").and_then(|value| value.as_str()) else {
        return Ok(BrowserObserveVision::Text);
    };
    match value {
        "text" => Ok(BrowserObserveVision::Text),
        "screenshot" => Ok(BrowserObserveVision::Screenshot),
        "both" => Ok(BrowserObserveVision::Both),
        other => Err(CliError::InvalidParams(format!(
            "unsupported browser observe vision: {other}"
        ))),
    }
}

fn browser_screenshot_json(screenshot: Option<&BrowserPaneScreenshot>) -> Value {
    match screenshot {
        Some(screenshot) => json!({
            "data": screenshot.png_base64.clone(),
            "mime_type": "image/png",
            "width": screenshot.width,
            "height": screenshot.height,
            "device_scale": screenshot.device_scale,
            "generation": screenshot.generation,
        }),
        None => Value::Null,
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

fn terminal_observe_detail(params: &Value) -> Result<TerminalObserveDetail, CliError> {
    if param_bool(params, &["compact", "summary"]) {
        return Ok(TerminalObserveDetail::Compact);
    }
    let Some(detail) = params
        .get("detail")
        .or_else(|| params.get("mode"))
        .and_then(|value| value.as_str())
    else {
        return Ok(TerminalObserveDetail::Compact);
    };

    match detail {
        "full" => Ok(TerminalObserveDetail::Full),
        "compact" | "summary" => Ok(TerminalObserveDetail::Compact),
        other => Err(CliError::InvalidParams(format!(
            "unsupported terminal observe detail: {other}"
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

fn browser_page_point_json(point: Option<&crate::pane::browser::BrowserPagePoint>) -> Value {
    point
        .map(|point| json!({ "x": point.x, "y": point.y }))
        .unwrap_or(Value::Null)
}

fn browser_page_hit_test_json(hit_test: &crate::pane::browser::BrowserPageHitTest) -> Value {
    json!({
        "clickable": hit_test.clickable,
        "center_blocked": hit_test.center_blocked,
        "point_source": hit_test.point_source,
    })
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
        "click_point": browser_page_point_json(element.click_point.as_ref()),
        "hit_test": browser_page_hit_test_json(&element.hit_test),
        "scrollable": element.scrollable,
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
        "click_point": browser_page_point_json(element.click_point.as_ref()),
        "hit_test": browser_page_hit_test_json(&element.hit_test),
        "scrollable": element.scrollable,
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

fn browser_interaction_graph_json(page_map: Option<&BrowserPageMap>, generation: u64) -> Value {
    let interactables = page_map
        .map(|page_map| {
            page_map
                .interactables
                .iter()
                .map(browser_page_element_summary_json)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let scrollables = page_map
        .map(|page_map| {
            page_map
                .interactables
                .iter()
                .chain(page_map.regions.iter())
                .filter(|element| element.scrollable)
                .map(browser_page_element_summary_json)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "generation": generation,
        "status": if page_map.is_some() { "ok" } else { "missing" },
        "source": "dom_geometry_hit_test",
        "interactables": interactables,
        "scrollables": scrollables,
        "targeting": {
            "semantic_target_supported": true,
            "target_ref_supported": true,
            "click_point_preferred_over_rect_center": true,
            "hit_tested": true,
        },
    })
}

fn browser_network_entry_json(entry: &BrowserNetworkEntry) -> Value {
    json!({
        "id": entry.id,
        "source": entry.source,
        "method": entry.method,
        "url": bounded_json_string(&entry.url, BROWSER_PAGE_MAP_TEXT_LIMIT_BYTES),
        "status": entry.status,
        "ok": entry.ok,
        "mime_type": entry.mime_type,
        "request_body": optional_bounded_json_string(entry.request_body.as_ref(), BROWSER_NETWORK_TEXT_LIMIT_BYTES),
        "response_excerpt": optional_bounded_json_string(entry.response_excerpt.as_ref(), BROWSER_NETWORK_TEXT_LIMIT_BYTES),
        "started_ms": entry.started_ms,
        "duration_ms": entry.duration_ms,
    })
}

fn browser_network_log_json(network_log: Option<&BrowserNetworkLog>) -> Value {
    let entries = network_log
        .map(|network_log| {
            network_log
                .entries
                .iter()
                .map(browser_network_entry_json)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "status": if network_log.is_some() { "ok" } else { "missing" },
        "entries": entries,
        "limits": {
            "entry_limit": BROWSER_NETWORK_LOG_LIMIT,
            "text_limit_bytes": BROWSER_NETWORK_TEXT_LIMIT_BYTES,
            "truncated": network_log.map(|network_log| network_log.truncated).unwrap_or(false),
        }
    })
}

fn browser_list_item_json(item: &BrowserListItem) -> Value {
    json!({
        "ref": item.reference,
        "index": item.index,
        "label": bounded_json_string(&item.label, BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES),
        "text": bounded_json_string(&item.text, BROWSER_LIST_TEXT_LIMIT_BYTES),
        "href": item.href,
        "rect": rect_value(item.rect),
        "click_point": browser_page_point_json(item.click_point.as_ref()),
    })
}

fn browser_list_group_json(group: &BrowserListGroup) -> Value {
    let items = group
        .items
        .iter()
        .map(browser_list_item_json)
        .collect::<Vec<_>>();
    json!({
        "ref": group.reference,
        "signature": group.signature,
        "label": bounded_json_string(&group.label, BROWSER_PAGE_MAP_LABEL_LIMIT_BYTES),
        "rect": rect_value(group.rect),
        "scroll": {
            "top": group.scroll_top,
            "height": group.scroll_height,
            "client_height": group.client_height,
            "at_top": group.at_top,
            "at_bottom": group.at_bottom,
        },
        "items": items,
        "truncated": group.truncated,
    })
}

fn browser_list_snapshot_json(list_snapshot: Option<&BrowserListSnapshot>) -> Value {
    let groups = list_snapshot
        .map(|list_snapshot| {
            list_snapshot
                .groups
                .iter()
                .map(browser_list_group_json)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "status": if list_snapshot.is_some() { "ok" } else { "missing" },
        "page_title": list_snapshot.and_then(|snapshot| snapshot.page_title.clone()),
        "page_url": list_snapshot.and_then(|snapshot| snapshot.page_url.clone()),
        "groups": groups,
        "limits": {
            "group_limit": BROWSER_LIST_GROUP_LIMIT,
            "item_limit": BROWSER_LIST_ITEM_LIMIT,
            "text_limit_bytes": BROWSER_LIST_TEXT_LIMIT_BYTES,
            "truncated": list_snapshot.map(|snapshot| snapshot.truncated).unwrap_or(false),
        },
    })
}

fn browser_list_next_action_json(
    pane_id: PaneId,
    observation_id: &str,
    list_snapshot: Option<&BrowserListSnapshot>,
) -> Value {
    let Some(snapshot) = list_snapshot else {
        return json!({
            "next_tool": "tide_browser_collect_list",
            "message": "No list snapshot is cached yet; call again after observe/wait-for refresh.",
        });
    };
    let Some(group) = snapshot.groups.first() else {
        return json!({
            "next_tool": Value::Null,
            "message": "No repeated visible list candidates found.",
        });
    };
    if group.at_bottom {
        return json!({
            "next_tool": Value::Null,
            "message": "Primary list candidate is at bottom; stop scrolling or verify with a final observe.",
        });
    }
    let x = f64::from(group.rect.x + group.rect.width * 0.5);
    let y = f64::from(group.rect.y + group.rect.height * 0.85);
    json!({
        "next_tool": "tide_browser_action",
        "action": {
            "pane_id": pane_id,
            "observation_id": observation_id,
            "action": "scroll",
            "x": x,
            "y": y,
            "delta_y": group.client_height.max(480.0) * 0.8,
        },
        "then": "tide_browser_collect_list",
        "message": "Scroll the primary list candidate, then collect again; do not run a long click/scroll JS loop.",
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

fn browser_action_history_entry_json(entry: &BrowserActionHistoryEntry) -> Value {
    json!({
        "generation": entry.generation,
        "action": entry.action.clone(),
        "target_ref": entry.target_ref.clone(),
        "target_label": entry.target_label.clone(),
        "x": entry.x,
        "y": entry.y,
        "text_bytes": entry.text_bytes,
        "key": entry.key.clone(),
        "url": entry.url.clone(),
        "dispatched": entry.dispatched,
        "observe_after_action": entry.observe_after_action,
    })
}

fn browser_action_history_json(browser: &BrowserPane) -> Value {
    json!({
        "entries": browser
            .action_history()
            .iter()
            .map(browser_action_history_entry_json)
            .collect::<Vec<_>>(),
        "limits": {
            "entry_limit": BROWSER_ACTION_HISTORY_LIMIT,
            "typed_text_retained": false,
        },
    })
}

fn browser_observation_id(pane_id: PaneId, generation: u64) -> String {
    format!("browser:{pane_id}:g{generation}")
}

fn browser_readiness_state(browser: &BrowserPane, modal_open: bool) -> &'static str {
    if modal_open {
        "blocked_by_modal"
    } else if browser.loading {
        "loading"
    } else if browser.page_map.is_none() && browser.page_snapshot.is_none() {
        "unavailable"
    } else if browser.page_map.is_none() {
        "page_map_missing"
    } else {
        "ready"
    }
}

fn browser_readiness_json(browser: &BrowserPane, modal_open: bool) -> Value {
    let state = browser_readiness_state(browser, modal_open);
    let mut reasons = Vec::new();
    match state {
        "blocked_by_modal" => {
            reasons.push("ModalStack hides the Browser Pane webview".to_string());
        }
        "loading" => {
            reasons.push("Browser Pane is still loading".to_string());
        }
        "unavailable" => {
            reasons.push("No BrowserSnapshot or Browser Page Map has been captured".to_string());
        }
        "page_map_missing" => {
            reasons.push("BrowserSnapshot exists but Browser Page Map is missing".to_string());
        }
        _ => {}
    }
    json!({
        "state": state,
        "reasons": reasons,
    })
}

fn browser_allowed_actions_json(browser: &BrowserPane, modal_open: bool) -> Value {
    let mut actions = vec!["navigate", "move", "clear-cursor", "wait-for"];
    if modal_open {
        actions.push("close-modal");
        actions.push("press");
        return json!(actions);
    }
    if browser.can_go_back {
        actions.push("back");
    }
    if browser.can_go_forward {
        actions.push("forward");
    }
    if !browser.url.is_empty() {
        actions.push("reload");
    }
    if browser.page_map.is_some() {
        actions.push("click");
        actions.push("type");
        actions.push("scroll");
        actions.push("press");
    } else if browser.page_snapshot.is_some() {
        actions.push("scroll");
        actions.push("press");
    }
    json!(actions)
}

fn browser_recovery_json(browser: &BrowserPane, modal_open: bool, visual_fit: &Value) -> Value {
    if modal_open {
        return json!({
            "status": "blocked",
            "next_tool": "tide_browser_action",
            "action": { "action": "close-modal" },
            "message": "ModalStack is hiding the Browser Pane webview; close the modal or use modal targets before page content actions."
        });
    }
    if browser.loading {
        return json!({
            "status": "wait",
            "next_tool": "tide_browser_observe",
            "message": "Browser Pane is loading; observe again before content actions."
        });
    }
    if let Some(tool_selection) = visual_fit.get("tool_selection") {
        if tool_selection.get("next_tool").and_then(Value::as_str) == Some("tide_layout_action") {
            return json!({
                "status": "layout_required",
                "next_tool": "tide_layout_action",
                "action": tool_selection.get("action").cloned().unwrap_or(Value::Null),
                "message": "Browser visual fit is insufficient; adjust layout before Browser Pane content actions."
            });
        }
    }
    if browser.page_map.is_none() {
        return json!({
            "status": "observe_required",
            "next_tool": "tide_browser_observe",
            "message": "Browser Page Map is missing; re-observe or request screenshot evidence before target_ref actions."
        });
    }
    json!({
        "status": "ok",
        "next_tool": Value::Null,
        "message": Value::Null,
    })
}

fn browser_validate_observation_id(
    params: &Value,
    pane_id: PaneId,
    browser: &BrowserPane,
) -> Result<(), CliError> {
    let Some(observation_id) = params.get("observation_id").and_then(Value::as_str) else {
        return Ok(());
    };
    let expected = browser_observation_id(pane_id, browser.generation);
    if observation_id == expected {
        return Ok(());
    }
    Err(CliError::InvalidParams(format!(
        "stale Browser observation_id {observation_id}; current observation_id is {expected}"
    )))
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
        "navigate"
            | "move"
            | "click"
            | "type"
            | "press"
            | "scroll"
            | "back"
            | "forward"
            | "reload"
            | "wait-for"
            | "close-modal"
            | "clear-cursor"
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

fn browser_action_semantic_target(params: &Value) -> Option<&Value> {
    params
        .get("target")
        .or_else(|| params.get("semantic_target"))
        .filter(|target| {
            target
                .get("kind")
                .and_then(Value::as_str)
                .map(|kind| kind == "semantic")
                .unwrap_or(true)
        })
}

fn semantic_target_string<'a>(target: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| target.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn semantic_normalize(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
}

#[derive(Debug, Default)]
struct SemanticQuery {
    label: Option<String>,
    text: Option<String>,
    placeholder: Option<String>,
    action: Option<String>,
    role: Option<String>,
    tag: Option<String>,
}

impl SemanticQuery {
    fn new(target: &Value) -> Self {
        Self {
            label: semantic_target_string(target, &["label", "name", "accessible_name"])
                .map(semantic_normalize),
            text: semantic_target_string(target, &["text"]).map(semantic_normalize),
            placeholder: semantic_target_string(target, &["placeholder"]).map(semantic_normalize),
            action: semantic_target_string(target, &["action"]).map(semantic_normalize),
            role: semantic_target_string(target, &["role"]).map(semantic_normalize),
            tag: semantic_target_string(target, &["tag"]).map(semantic_normalize),
        }
    }

    fn has_role_or_tag(&self) -> bool {
        self.role.is_some() || self.tag.is_some()
    }
}

fn semantic_field_score(
    field: &str,
    normalized_query: &str,
    exact_score: i32,
    contains_score: i32,
) -> i32 {
    let field = semantic_normalize(field);
    if field.is_empty() || normalized_query.is_empty() {
        0
    } else if field == normalized_query {
        exact_score
    } else if field.contains(normalized_query) {
        contains_score
    } else {
        0
    }
}

fn semantic_optional_field_score(
    field: Option<&String>,
    normalized_query: &str,
    exact_score: i32,
    contains_score: i32,
) -> i32 {
    field
        .map(|field| semantic_field_score(field, normalized_query, exact_score, contains_score))
        .unwrap_or(0)
}

fn browser_page_element_matches_kind(element: &BrowserPageElement, target: &Value) -> bool {
    let Some(kind) = semantic_target_string(target, &["element_kind", "page_map_kind"]) else {
        return true;
    };
    matches!(
        (kind, &element.kind),
        ("interactable", BrowserPageElementKind::Interactable)
            | ("region", BrowserPageElementKind::Region)
    )
}

fn browser_page_element_semantic_score(
    element: &BrowserPageElement,
    target: &Value,
    query: &SemanticQuery,
) -> Option<i32> {
    if element.disabled || !element.hit_test.clickable {
        return None;
    }
    if !browser_page_element_matches_kind(element, target) {
        return None;
    }
    if let Some(role) = query.role.as_ref() {
        if element.role.as_deref().map(semantic_normalize).as_ref() != Some(role) {
            return None;
        }
    }
    if let Some(tag) = query.tag.as_ref() {
        if semantic_normalize(&element.tag) != *tag {
            return None;
        }
    }

    let mut score = 0;
    if let Some(label) = query.label.as_ref() {
        score += semantic_field_score(&element.label, label, 120, 70);
        score += semantic_field_score(&element.text, label, 80, 45);
        score += semantic_optional_field_score(element.placeholder.as_ref(), label, 70, 35);
        score += semantic_optional_field_score(element.value.as_ref(), label, 40, 20);
        score += semantic_optional_field_score(element.action.as_ref(), label, 30, 15);
    }
    if let Some(text) = query.text.as_ref() {
        score += semantic_field_score(&element.text, text, 100, 55);
        score += semantic_field_score(&element.label, text, 70, 35);
    }
    if let Some(placeholder) = query.placeholder.as_ref() {
        score += semantic_optional_field_score(element.placeholder.as_ref(), placeholder, 100, 50);
    }
    if let Some(action) = query.action.as_ref() {
        score += semantic_optional_field_score(element.action.as_ref(), action, 100, 50);
    }

    if score == 0 && query.has_role_or_tag() {
        score = 1;
    }
    (score > 0).then_some(score)
}

fn browser_semantic_target_candidates<'a>(
    page_map: &'a BrowserPageMap,
    target: &Value,
) -> Vec<(i32, &'a BrowserPageElement)> {
    let query = SemanticQuery::new(target);
    let mut candidates = page_map
        .interactables
        .iter()
        .chain(page_map.regions.iter())
        .filter_map(|element| {
            browser_page_element_semantic_score(element, target, &query)
                .map(|score| (score, element))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.reference.cmp(&right.1.reference))
    });
    candidates
}

fn browser_semantic_target_error(
    kind: &str,
    candidates: &[(i32, &BrowserPageElement)],
) -> CliError {
    let labels = candidates
        .iter()
        .take(5)
        .map(|(score, element)| {
            format!(
                "{}:{}:{}",
                element.reference,
                score,
                if element.label.is_empty() {
                    element.text.as_str()
                } else {
                    element.label.as_str()
                }
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    CliError::InvalidParams(if labels.is_empty() {
        format!("Browser semantic target {kind}")
    } else {
        format!("Browser semantic target {kind}; candidates: {labels}")
    })
}

fn resolve_browser_action_target(
    browser: &BrowserPane,
    params: &Value,
    action: &str,
) -> Result<Option<BrowserPageElement>, CliError> {
    if let Some(target_ref) = browser_action_target_ref(params) {
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
        if !element.hit_test.clickable {
            return Err(CliError::InvalidParams(format!(
                "Browser Page Element ref {target_ref} is not hit-test clickable"
            )));
        }
        return Ok(Some(element));
    }

    let Some(semantic_target) = browser_action_semantic_target(params) else {
        return Ok(None);
    };
    if !matches!(action, "click" | "type") {
        return Err(CliError::InvalidParams(
            "semantic target is supported only for click and type Browser Pane actions".into(),
        ));
    }
    let Some(page_map) = browser.page_map.as_ref() else {
        return Err(CliError::InvalidParams(
            "semantic target requires a Browser Page Map from tide_browser_observe".into(),
        ));
    };
    let candidates = browser_semantic_target_candidates(page_map, semantic_target);
    let Some((top_score, top_element)) = candidates.first() else {
        return Err(browser_semantic_target_error("not found", &candidates));
    };
    if candidates
        .get(1)
        .is_some_and(|(score, _)| score == top_score)
    {
        return Err(browser_semantic_target_error("ambiguous", &candidates));
    }
    Ok(Some((*top_element).clone()))
}

fn browser_action_requires_fresh_observe(action: &str) -> bool {
    matches!(
        action,
        "navigate" | "click" | "type" | "press" | "scroll" | "back" | "forward" | "reload"
    )
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
    matches!(action, "click" | "type" | "press" | "scroll")
}

fn browser_action_requires_observe_after(action: &str) -> bool {
    matches!(
        action,
        "navigate"
            | "click"
            | "type"
            | "press"
            | "scroll"
            | "back"
            | "forward"
            | "reload"
            | "wait-for"
            | "close-modal"
    )
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

fn browser_external_runtime_json(browser: &BrowserPane) -> Value {
    match browser.last_external_handoff() {
        Some(handoff) => json!({
            "kind": "external_browser_runtime_handoff",
            "runtime": "external_default_browser",
            "explicit": true,
            "visible_in_tide": false,
            "reason": handoff.reason.clone(),
            "url": handoff.url.clone(),
            "tide_browser_pane_retained": true,
        }),
        None => Value::Null,
    }
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

fn path_json(path: Option<&Path>) -> Value {
    path.map(|path| json!(path.to_string_lossy()))
        .unwrap_or(Value::Null)
}

fn project_config_start_path(
    ctx: &crate::App,
    caller_terminal_id: Option<PaneId>,
) -> Option<PathBuf> {
    caller_terminal_id
        .or_else(|| ctx.focused_terminal_id())
        .and_then(|terminal_id| match ctx.pane(terminal_id) {
            Some(PaneKind::Terminal(terminal)) => terminal
                .context
                .cwd
                .clone()
                .or_else(|| terminal.backend.detect_cwd_fallback()),
            _ => None,
        })
        .or_else(|| std::env::current_dir().ok())
}

fn workspace_project_config_json(ctx: &crate::App, caller_terminal_id: Option<PaneId>) -> Value {
    let start = project_config_start_path(ctx, caller_terminal_id);
    match crate::state::project_config::load_project_config_for_start(start.as_deref()) {
        crate::state::project_config::ProjectConfigLoad::Loaded(loaded) => json!({
            "kind": "project_local_config",
            "state": "loaded",
            "convention": crate::state::project_config::PROJECT_CONFIG_RELATIVE_PATH,
            "start": path_json(start.as_deref()),
            "root": loaded.root.to_string_lossy(),
            "path": loaded.path.to_string_lossy(),
            "workspace_count": loaded.config.workspaces.len(),
            "action_count": loaded.config.actions.len(),
            "workspaces": loaded.config.workspaces,
            "actions": loaded.config.actions,
            "execution": {
                "automatic": false,
                "recommended_tool": "tide_send_keys",
                "reason": "project actions are visible recipes and are not run without explicit terminal input",
            },
        }),
        crate::state::project_config::ProjectConfigLoad::Invalid {
            start,
            root,
            path,
            error,
        } => json!({
            "kind": "project_local_config",
            "state": "invalid",
            "convention": crate::state::project_config::PROJECT_CONFIG_RELATIVE_PATH,
            "start": path_json(start.as_deref()),
            "root": root.to_string_lossy(),
            "path": path.to_string_lossy(),
            "error": error,
            "workspace_count": 0,
            "action_count": 0,
            "workspaces": [],
            "actions": [],
        }),
        crate::state::project_config::ProjectConfigLoad::NotFound { start } => json!({
            "kind": "project_local_config",
            "state": "not_found",
            "convention": crate::state::project_config::PROJECT_CONFIG_RELATIVE_PATH,
            "start": path_json(start.as_deref()),
            "workspace_count": 0,
            "action_count": 0,
            "workspaces": [],
            "actions": [],
        }),
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

fn terminal_context_surface_mode_label(mode: crate::state::ViewMode) -> &'static str {
    match mode {
        crate::state::ViewMode::Split => "split",
        crate::state::ViewMode::Stacked => "stacked",
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

fn browser_review_entry_json(pane_id: PaneId, entry: &BrowserReviewHistoryEntry) -> Value {
    json!({
        "pane_id": pane_id,
        "artifact_id": entry.artifact_id,
        "comment": entry.comment,
        "source_label": entry.source_label,
        "delivered": entry.delivered,
        "delivery_count": entry.delivery_count,
    })
}

fn browser_review_history_json(pane_id: PaneId, browser: &BrowserPane) -> Value {
    let delivered = browser
        .review_history()
        .iter()
        .filter(|entry| entry.delivered)
        .count();
    let recent = browser
        .review_history()
        .iter()
        .rev()
        .take(3)
        .map(|entry| browser_review_entry_json(pane_id, entry))
        .collect::<Vec<_>>();

    json!({
        "total": browser.review_history().len(),
        "delivered": delivered,
        "pending_delivery": browser.review_history().len().saturating_sub(delivered),
        "latest": browser
            .latest_review()
            .map(|entry| browser_review_entry_json(pane_id, entry))
            .unwrap_or(Value::Null),
        "recent": recent,
    })
}

fn workspace_agent_status_label(status: Option<AgentStatus>) -> &'static str {
    match status {
        Some(AgentStatus::Running) => "running",
        Some(AgentStatus::Idle) => "idle",
        Some(AgentStatus::NeedsInput) => "needs_input",
        None => "unknown",
    }
}

struct WorkspaceContextArtifactCounts {
    total: usize,
    pinned: usize,
    delivered: usize,
    pending_delivery: usize,
    delivery_count: usize,
}

fn workspace_context_artifact_counts(
    app: &crate::App,
    workspace_idx: usize,
    caller_terminal_id: Option<PaneId>,
) -> WorkspaceContextArtifactCounts {
    let artifacts = if workspace_idx == app.ws.active {
        Some(&app.context_artifacts)
    } else {
        app.ws.workspace_context_artifacts.get(workspace_idx)
    };
    let Some(artifacts) = artifacts else {
        return WorkspaceContextArtifactCounts {
            total: 0,
            pinned: 0,
            delivered: 0,
            pending_delivery: 0,
            delivery_count: 0,
        };
    };

    artifacts
        .artifacts
        .values()
        .filter(|artifact| {
            caller_terminal_id
                .map(|caller| artifact.associated_terminal_id == caller)
                .unwrap_or(true)
        })
        .fold(
            WorkspaceContextArtifactCounts {
                total: 0,
                pinned: 0,
                delivered: 0,
                pending_delivery: 0,
                delivery_count: 0,
            },
            |mut counts, artifact| {
                counts.total += 1;
                counts.pinned += usize::from(artifact.pinned);
                counts.delivery_count += artifact.deliveries.len();
                if artifact.deliveries.is_empty() {
                    counts.pending_delivery += 1;
                } else {
                    counts.delivered += 1;
                }
                counts
            },
        )
}

fn workspace_task_pane_entries<'a>(
    app: &'a crate::App,
    workspace_idx: usize,
    caller_terminal_id: Option<PaneId>,
) -> Vec<(PaneId, &'a PaneKind)> {
    let raw_entries = if workspace_idx == app.ws.active {
        app.panes
            .iter()
            .map(|(id, pane)| (*id, pane))
            .collect::<Vec<_>>()
    } else {
        app.ws
            .workspaces
            .get(workspace_idx)
            .map(|workspace| {
                workspace
                    .panes
                    .iter()
                    .map(|(id, pane)| (*id, pane))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };

    raw_entries
        .into_iter()
        .filter(|(id, _pane)| {
            let Some(caller_terminal_id) = caller_terminal_id else {
                return true;
            };
            if workspace_idx != app.ws.active {
                return false;
            }
            let owner_terminal_id = app.terminal_owning(*id);
            pane_is_in_caller_terminal_scope(*id, owner_terminal_id, caller_terminal_id)
        })
        .collect()
}

fn workspace_task_stage_terminal_ids(
    app: &crate::App,
    workspace_idx: usize,
    caller_terminal_id: Option<PaneId>,
) -> HashSet<PaneId> {
    if let Some(caller_terminal_id) = caller_terminal_id {
        return [caller_terminal_id].into_iter().collect();
    }

    if workspace_idx == app.ws.active {
        return app
            .panes
            .iter()
            .filter_map(|(&pane_id, pane)| {
                (matches!(pane, PaneKind::Terminal(_)) && !app.is_pane_in_dock(pane_id))
                    .then_some(pane_id)
            })
            .collect();
    }

    let Some(workspace) = app.ws.workspaces.get(workspace_idx) else {
        return HashSet::new();
    };
    let stage_pane_ids = workspace.layout.all_pane_ids();
    if stage_pane_ids.is_empty() {
        workspace
            .panes
            .iter()
            .filter_map(|(&pane_id, pane)| matches!(pane, PaneKind::Terminal(_)).then_some(pane_id))
            .collect()
    } else {
        stage_pane_ids
            .into_iter()
            .filter(|pane_id| matches!(workspace.panes.get(pane_id), Some(PaneKind::Terminal(_))))
            .collect()
    }
}

fn workspace_task_state(
    running_agents: usize,
    idle_agents: usize,
    needs_input_agents: usize,
    terminal_count: usize,
) -> &'static str {
    if needs_input_agents > 0 {
        "needs_input"
    } else if idle_agents > 0 {
        "ready"
    } else if running_agents > 0 {
        "running"
    } else if terminal_count > 0 {
        "active"
    } else {
        "empty"
    }
}

fn workspace_agent_lifecycle_label(agent: &AgentInfo) -> &'static str {
    match agent.status {
        Some(AgentStatus::Running) => "running",
        Some(AgentStatus::Idle) => "idle",
        Some(AgentStatus::NeedsInput) => "needs_input",
        None if agent.gateway_connected => "connected",
        None => "unknown",
    }
}

fn workspace_agent_notification_state(
    status: Option<AgentStatus>,
    routed: bool,
    has_snippet: bool,
) -> &'static str {
    match (status, routed, has_snippet) {
        (Some(AgentStatus::NeedsInput), true, _) => "needs_input_routed",
        (Some(AgentStatus::NeedsInput), false, _) => "needs_input",
        (Some(AgentStatus::Idle), true, _) => "idle_routed",
        (Some(AgentStatus::Idle), false, _) => "idle",
        (_, true, _) => "routed",
        (_, false, true) => "snippet",
        _ => "none",
    }
}

struct WorkspaceTaskEventCandidate {
    priority: u8,
    kind: &'static str,
    pane_id: Option<PaneId>,
    agent_status: Option<AgentStatus>,
    summary: String,
    restore_event: Option<crate::state::WorkspaceRestoreEvent>,
}

fn browser_task_event_candidate(
    pane_id: PaneId,
    browser: &BrowserPane,
) -> Option<WorkspaceTaskEventCandidate> {
    if let Some(permission) = browser.pending_permission.as_ref() {
        return Some(WorkspaceTaskEventCandidate {
            priority: 5,
            kind: "browser_permission",
            pane_id: Some(pane_id),
            agent_status: None,
            summary: format!("browser permission: {}", permission.origin),
            restore_event: None,
        });
    }
    if let Some(certificate) = browser.pending_certificate_error.as_ref() {
        return Some(WorkspaceTaskEventCandidate {
            priority: 6,
            kind: "browser_certificate",
            pane_id: Some(pane_id),
            agent_status: None,
            summary: format!("browser certificate: {}", certificate.host),
            restore_event: None,
        });
    }
    if let Some(download) = browser.download_state.as_ref() {
        return Some(WorkspaceTaskEventCandidate {
            priority: 15,
            kind: "browser_download",
            pane_id: Some(pane_id),
            agent_status: None,
            summary: if download.completed {
                "browser download complete".to_string()
            } else {
                "browser downloading".to_string()
            },
            restore_event: None,
        });
    }
    if browser.streaming {
        return Some(WorkspaceTaskEventCandidate {
            priority: 22,
            kind: "render_streaming",
            pane_id: Some(pane_id),
            agent_status: None,
            summary: "render streaming".to_string(),
            restore_event: None,
        });
    }
    if browser.loading {
        return Some(WorkspaceTaskEventCandidate {
            priority: 25,
            kind: "browser_loading",
            pane_id: Some(pane_id),
            agent_status: None,
            summary: "browser loading".to_string(),
            restore_event: None,
        });
    }
    if let Some(review) = browser.latest_review() {
        let (comment, truncated) = truncate_utf8_to_byte_limit(&review.comment, 80);
        let summary = if comment.trim().is_empty() {
            format!("browser review #{}", review.artifact_id)
        } else if truncated {
            format!("browser review: {}...", comment)
        } else {
            format!("browser review: {}", comment)
        };
        return Some(WorkspaceTaskEventCandidate {
            priority: 55,
            kind: "browser_review",
            pane_id: Some(pane_id),
            agent_status: None,
            summary,
            restore_event: None,
        });
    }

    None
}

fn diff_task_event_candidate(
    pane_id: PaneId,
    diff: &crate::pane::diff::DiffPane,
) -> Option<WorkspaceTaskEventCandidate> {
    if !diff.loaded {
        return Some(WorkspaceTaskEventCandidate {
            priority: 45,
            kind: "diff_loading",
            pane_id: Some(pane_id),
            agent_status: None,
            summary: "diff loading".to_string(),
            restore_event: None,
        });
    }
    if !diff.files.is_empty() {
        return Some(WorkspaceTaskEventCandidate {
            priority: 50,
            kind: "diff_changes",
            pane_id: Some(pane_id),
            agent_status: None,
            summary: format!("diff {} files", diff.files.len()),
            restore_event: None,
        });
    }

    None
}

fn restore_task_event_candidate(
    event: &crate::state::WorkspaceRestoreEvent,
) -> WorkspaceTaskEventCandidate {
    let (kind, summary) = match event.kind {
        crate::state::RestoreEventKind::SessionRestored => (
            "session_restore",
            if event.crash_recovery {
                "session restored after crash"
            } else {
                "session restored"
            },
        ),
        crate::state::RestoreEventKind::SessionRestoreFailed => {
            ("session_restore_failed", "session restore failed")
        }
        crate::state::RestoreEventKind::SessionRestoreMissing => {
            ("session_restore_missing", "session restore missing")
        }
        crate::state::RestoreEventKind::PreferencesRestored => (
            "preferences_restore",
            "preferences restored from saved session",
        ),
    };

    WorkspaceTaskEventCandidate {
        priority: 70,
        kind,
        pane_id: None,
        agent_status: None,
        summary: summary.to_string(),
        restore_event: Some(event.clone()),
    }
}

fn workspace_task_last_event_json(candidates: &[WorkspaceTaskEventCandidate]) -> Value {
    let Some(selected) = candidates.iter().min_by_key(|candidate| candidate.priority) else {
        return Value::Null;
    };

    let mut event = json!({
        "kind": selected.kind,
        "pane_id": selected.pane_id,
        "summary": selected.summary,
    });

    if selected.kind == "agent_notification" {
        event["agent_status"] = json!(workspace_agent_status_label(selected.agent_status));
    }
    if let Some(restore_event) = selected.restore_event.as_ref() {
        event["crash_recovery"] = json!(restore_event.crash_recovery);
        event["restored_panes"] = json!(restore_event.restored_panes);
        event["restored_context_panes"] = json!(restore_event.restored_context_panes);
    }

    event
}

fn workspace_task_attention_panel_json(workspaces: &[Value]) -> Value {
    let mut items = Vec::new();
    let mut running_count = 0usize;

    for workspace in workspaces {
        if workspace["agent_lifecycle"]["state"] == "running" {
            running_count += 1;
        }
        let pending = workspace["agent_lifecycle"]["notifications"]["pending"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        for notification in pending {
            items.push(json!({
                "workspace_index": workspace["workspace_index"],
                "workspace_name": workspace["name"],
                "pane_id": notification["pane_id"],
                "agent": notification["name"],
                "status": notification["status"],
                "state": notification["state"],
                "attention": notification["attention"],
                "routed": notification["routed"],
                "summary": notification["snippet"],
            }));
        }
    }

    json!({
        "kind": "workspace_attention_panel",
        "visible": !items.is_empty() || running_count > 0,
        "unread_count": items.len(),
        "running_count": running_count,
        "items": items,
    })
}

fn workspace_agent_resume_provider_policy_json(
    provider: &str,
    display_name: &str,
    wrapper_command: &str,
) -> Value {
    json!({
        "provider": provider,
        "display_name": display_name,
        "wrapper_command": wrapper_command,
        "wrapped_agent_supported": true,
        "resume_mode": "explicit_provider_cli_only",
        "automatic_process_resume": false,
        "provider_resume_invoked_by_tide": false,
        "restored_by_tide": [
            "workspace_layout",
            "terminal_cwd",
            "terminal_context_surface",
            "side_surface_preferences"
        ],
        "not_restored_by_tide": [
            "live_child_process",
            "provider_conversation",
            "terminal_scrollback"
        ],
        "agent_action": "relaunch this provider in the restored Terminal cwd; use provider-native resume only when the user or agent explicitly chooses it",
    })
}

fn workspace_agent_resume_policy_json() -> Value {
    json!({
        "kind": "agent_resume_policy",
        "provider_neutral": true,
        "session_restore_scope": {
            "workspace_layout": true,
            "terminal_cwd": true,
            "terminal_context_surface": true,
            "side_surface_preferences": true,
            "live_child_processes": false,
            "terminal_scrollback": false,
            "provider_conversations": false,
        },
        "automatic_agent_process_resume": false,
        "provider_resume_invoked_by_tide": false,
        "default_resume_mode": "explicit_provider_cli_only",
        "providers": [
            workspace_agent_resume_provider_policy_json("claude", "Claude Code", "claude"),
            workspace_agent_resume_provider_policy_json("codex", "Codex", "codex"),
            workspace_agent_resume_provider_policy_json("agy", "Antigravity", "agy"),
            workspace_agent_resume_provider_policy_json("opencode", "opencode", "opencode"),
        ],
    })
}

fn workspace_task_entry_json(
    app: &crate::App,
    workspace_idx: usize,
    caller_terminal_id: Option<PaneId>,
) -> Value {
    let active = workspace_idx == app.ws.active;
    let name = if active {
        app.active_workspace_name()
    } else {
        app.ws
            .workspaces
            .get(workspace_idx)
            .map(|workspace| workspace.name.clone())
            .unwrap_or_else(|| format!("Workspace {}", workspace_idx + 1))
    };
    let focused_pane_id = if active {
        app.focus.focused
    } else {
        app.ws
            .workspaces
            .get(workspace_idx)
            .and_then(|workspace| workspace.focused)
    };
    let pane_entries = workspace_task_pane_entries(app, workspace_idx, caller_terminal_id);
    let stage_terminal_ids =
        workspace_task_stage_terminal_ids(app, workspace_idx, caller_terminal_id);

    let mut terminal_count = 0usize;
    let mut editor_count = 0usize;
    let mut browser_count = 0usize;
    let mut diff_count = 0usize;
    let mut launcher_count = 0usize;
    let mut context_pane_count = 0usize;
    let mut running_agents = 0usize;
    let mut idle_agents = 0usize;
    let mut needs_input_agents = 0usize;
    let mut unknown_agents = 0usize;
    let mut terminals = Vec::new();
    let mut agents = Vec::new();
    let mut lifecycle_agents = Vec::new();
    let mut lifecycle_wrapper_managed = 0usize;
    let mut lifecycle_gateway_connected = 0usize;
    let mut lifecycle_running = 0usize;
    let mut lifecycle_idle = 0usize;
    let mut lifecycle_needs_input = 0usize;
    let mut lifecycle_connected = 0usize;
    let mut lifecycle_unknown = 0usize;
    let mut notification_with_snippet = 0usize;
    let mut notification_routed = 0usize;
    let mut notification_attention = 0usize;
    let mut notification_pending = Vec::new();
    let mut last_event_candidates = Vec::new();
    let mut browser_reviews: Vec<(PaneId, BrowserReviewHistoryEntry)> = Vec::new();

    for (pane_id, pane) in pane_entries {
        match pane {
            PaneKind::Terminal(terminal) => {
                terminal_count += 1;
                let context_panes = terminal.dock_layout.all_pane_ids();
                terminals.push(json!({
                    "pane_id": pane_id,
                    "title": if active { app.pane_title(pane_id) } else { format!("Terminal {pane_id}") },
                    "cwd": terminal_cwd_json(Some(pane)),
                    "shell_idle": terminal.context.shell_idle,
                    "child_dead": terminal.context.child_dead,
                    "context_pane_count": context_panes.len(),
                    "terminal_context_surface": {
                        "mode": terminal_context_surface_mode_label(terminal.dock_view_mode),
                        "pane_count": context_panes.len(),
                        "focused_pane_id": terminal.dock_focused,
                    },
                }));
                if terminal.context.child_dead {
                    last_event_candidates.push(WorkspaceTaskEventCandidate {
                        priority: 40,
                        kind: "terminal_exit",
                        pane_id: Some(pane_id),
                        agent_status: None,
                        summary: "terminal exited".to_string(),
                        restore_event: None,
                    });
                }
            }
            PaneKind::Editor(_) => editor_count += 1,
            PaneKind::Browser(browser) => {
                browser_count += 1;
                browser_reviews.extend(
                    browser
                        .review_history()
                        .iter()
                        .cloned()
                        .map(|entry| (pane_id, entry)),
                );
                if let Some(event) = browser_task_event_candidate(pane_id, browser) {
                    last_event_candidates.push(event);
                }
            }
            PaneKind::Diff(diff) => {
                diff_count += 1;
                if let Some(event) = diff_task_event_candidate(pane_id, diff) {
                    last_event_candidates.push(event);
                }
            }
            PaneKind::Launcher(_) => launcher_count += 1,
        }

        if !matches!(pane, PaneKind::Terminal(_)) {
            context_pane_count += 1;
        }

        if let Some(agent) = app.gateway.detected_agents.get(&pane_id) {
            match agent.status {
                Some(AgentStatus::Running) => running_agents += 1,
                Some(AgentStatus::Idle) => idle_agents += 1,
                Some(AgentStatus::NeedsInput) => needs_input_agents += 1,
                None => unknown_agents += 1,
            }
            agents.push(json!({
                "pane_id": pane_id,
                "name": agent.name,
                "pid": agent.pid,
                "wrapper_managed": agent.wrapper_managed,
                "gateway_connected": agent.gateway_connected,
                "status": workspace_agent_status_label(agent.status),
                "notification_snippet": app.agent_notification_snippets.get(&pane_id),
            }));
            if agent.wrapper_managed && stage_terminal_ids.contains(&pane_id) {
                lifecycle_wrapper_managed += 1;
                lifecycle_gateway_connected += usize::from(agent.gateway_connected);
                match agent.status {
                    Some(AgentStatus::Running) => lifecycle_running += 1,
                    Some(AgentStatus::Idle) => lifecycle_idle += 1,
                    Some(AgentStatus::NeedsInput) => lifecycle_needs_input += 1,
                    None if agent.gateway_connected => lifecycle_connected += 1,
                    None => lifecycle_unknown += 1,
                }

                let snippet = app.agent_notification_snippets.get(&pane_id).cloned();
                let has_snippet = snippet
                    .as_deref()
                    .is_some_and(|snippet| !snippet.trim().is_empty());
                let routed = app.notified_panes.contains(&pane_id);
                let attention = matches!(
                    agent.status,
                    Some(AgentStatus::Idle | AgentStatus::NeedsInput)
                );
                let notification_state =
                    workspace_agent_notification_state(agent.status, routed, has_snippet);
                notification_with_snippet += usize::from(has_snippet);
                notification_routed += usize::from(routed);
                notification_attention += usize::from(attention);

                let lifecycle_entry = json!({
                    "pane_id": pane_id,
                    "name": agent.name,
                    "pid": agent.pid,
                    "status": workspace_agent_status_label(agent.status),
                    "lifecycle": workspace_agent_lifecycle_label(agent),
                    "gateway_connected": agent.gateway_connected,
                    "notification": {
                        "state": notification_state,
                        "attention": attention,
                        "routed": routed,
                        "snippet": snippet,
                    },
                });
                if attention || routed || has_snippet {
                    notification_pending.push(json!({
                        "pane_id": pane_id,
                        "name": agent.name,
                        "status": workspace_agent_status_label(agent.status),
                        "state": notification_state,
                        "attention": attention,
                        "routed": routed,
                        "snippet": app.agent_notification_snippets.get(&pane_id),
                    }));
                }
                lifecycle_agents.push(lifecycle_entry);
            }
            if agent.wrapper_managed {
                if let Some(snippet) = app
                    .agent_notification_snippets
                    .get(&pane_id)
                    .map(|snippet| snippet.trim())
                    .filter(|snippet| !snippet.is_empty())
                {
                    let priority = match agent.status {
                        Some(AgentStatus::NeedsInput) => 0,
                        Some(AgentStatus::Idle) => 10,
                        Some(AgentStatus::Running) => 20,
                        None => 30,
                    };
                    last_event_candidates.push(WorkspaceTaskEventCandidate {
                        priority,
                        kind: "agent_notification",
                        pane_id: Some(pane_id),
                        agent_status: agent.status,
                        summary: snippet.to_string(),
                        restore_event: None,
                    });
                }
            }
        }
    }

    if active {
        if let Some(restore_event) = app.last_restore_event.as_ref() {
            last_event_candidates.push(restore_task_event_candidate(restore_event));
        }
    }

    let artifact_counts = workspace_context_artifact_counts(app, workspace_idx, caller_terminal_id);
    browser_reviews.sort_by(|a, b| b.1.artifact_id.cmp(&a.1.artifact_id));
    let browser_reviews_delivered = browser_reviews
        .iter()
        .filter(|(_, review)| review.delivered)
        .count();
    let browser_reviews_recent = browser_reviews
        .iter()
        .take(3)
        .map(|(pane_id, review)| browser_review_entry_json(*pane_id, review))
        .collect::<Vec<_>>();
    let browser_reviews_latest = browser_reviews
        .first()
        .map(|(pane_id, review)| browser_review_entry_json(*pane_id, review))
        .unwrap_or(Value::Null);
    let has_agent_notification = if active {
        needs_input_agents > 0
            || idle_agents > 0
            || agents.iter().any(|agent| {
                agent["pane_id"]
                    .as_u64()
                    .is_some_and(|pane_id| app.notified_panes.contains(&pane_id))
            })
    } else {
        app.ws
            .workspace_extras
            .get(workspace_idx)
            .is_some_and(|extras| extras.has_agent_notification)
            || needs_input_agents > 0
            || idle_agents > 0
    };

    json!({
        "workspace_index": workspace_idx,
        "name": name,
        "active": active,
        "focused_pane_id": focused_pane_id,
        "state": workspace_task_state(
            running_agents,
            idle_agents,
            needs_input_agents,
            terminal_count,
        ),
        "has_agent_notification": has_agent_notification,
        "last_event": workspace_task_last_event_json(&last_event_candidates),
        "pane_counts": {
            "total": terminal_count + editor_count + browser_count + diff_count + launcher_count,
            "terminal": terminal_count,
            "editor": editor_count,
            "browser": browser_count,
            "diff": diff_count,
            "launcher": launcher_count,
            "terminal_context": context_pane_count,
        },
        "agent_counts": {
            "total": running_agents + idle_agents + needs_input_agents + unknown_agents,
            "running": running_agents,
            "idle": idle_agents,
            "needs_input": needs_input_agents,
            "unknown": unknown_agents,
        },
        "agent_lifecycle": {
            "scope": if caller_terminal_id.is_some() { "caller_terminal" } else { "workspace_stage" },
            "state": workspace_task_state(
                lifecycle_running,
                lifecycle_idle,
                lifecycle_needs_input,
                terminal_count,
            ),
            "wrapper_managed": lifecycle_wrapper_managed,
            "gateway_connected": lifecycle_gateway_connected,
            "running": lifecycle_running,
            "idle": lifecycle_idle,
            "needs_input": lifecycle_needs_input,
            "connected": lifecycle_connected,
            "unknown": lifecycle_unknown,
            "notifications": {
                "has_any": has_agent_notification,
                "with_snippet": notification_with_snippet,
                "routed": notification_routed,
                "attention": notification_attention,
                "pending": notification_pending,
            },
            "agents": lifecycle_agents,
        },
        "context_artifacts": {
            "total": artifact_counts.total,
            "pinned": artifact_counts.pinned,
            "delivered": artifact_counts.delivered,
            "pending_delivery": artifact_counts.pending_delivery,
            "delivery_count": artifact_counts.delivery_count,
        },
        "browser_reviews": {
            "total": browser_reviews.len(),
            "delivered": browser_reviews_delivered,
            "pending_delivery": browser_reviews.len().saturating_sub(browser_reviews_delivered),
            "latest": browser_reviews_latest,
            "recent": browser_reviews_recent,
        },
        "terminals": terminals,
        "agents": agents,
    })
}

fn workspace_task_monitor_json(app: &crate::App, caller_terminal_id: Option<PaneId>) -> Value {
    let workspace_count = app.ws.workspaces.len().max(app.ws.active + 1);
    let workspace_indices = if caller_terminal_id.is_some() {
        vec![app.ws.active]
    } else {
        (0..workspace_count).collect::<Vec<_>>()
    };
    let workspaces = workspace_indices
        .iter()
        .map(|workspace_idx| workspace_task_entry_json(app, *workspace_idx, caller_terminal_id))
        .collect::<Vec<_>>();
    let attention_panel = workspace_task_attention_panel_json(&workspaces);

    json!({
        "kind": "workspace_task_monitor",
        "scoped_to_caller": caller_terminal_id.is_some(),
        "active_workspace_index": app.ws.active,
        "workspace_count": workspace_count,
        "sidebar_visible": app.ws.show_sidebar,
        "project_config": workspace_project_config_json(app, caller_terminal_id),
        "attention_panel": attention_panel,
        "agent_resume_policy": workspace_agent_resume_policy_json(),
        "workspaces": workspaces,
        "next_tools": [
            "tide_observe_workspace",
            "tide_observe_terminal",
            "tide_find_in_terminal",
            "tide_send_keys",
            "tide_list_context_artifacts",
        ],
    })
}

fn cli_observe_workspace_compact(ctx: &crate::App, caller_terminal_id: Option<PaneId>) -> Value {
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

        if let PaneKind::Browser(browser) = pane {
            let visual_fit =
                browser_visual_fit(rect, owner_terminal_id, ctx.focused_terminal_id(), id);
            let visual_fit_summary = compact_visual_fit_summary(&visual_fit);
            let review_history = browser_review_history_json(id, browser);
            browser_targets.push(json!({
                "pane_id": id,
                "title": ctx.pane_title(id),
                "owner_terminal_id": owner_terminal_id,
                "visible": rect.is_some(),
                "visual_fit_status": visual_fit_summary["status"].clone(),
                "background_runtime_available": visual_fit_summary["background_runtime_available"].clone(),
                "next_tool": visual_fit_summary["next_tool"].clone(),
                "review_count": review_history["total"].clone(),
                "latest_review": review_history["latest"].clone(),
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
        "project_config": workspace_project_config_json(ctx, caller_terminal_id),
        "terminal_context_surface": surface_owner.map(|owner| json!({
            "owner_terminal_id": owner,
            "visible": surface_rect.is_some(),
            "rect": optional_rect_value(surface_rect),
            "active_pane_id": terminal_context_active_pane_id(ctx, owner),
        })),
        "panes": panes,
        "browser_targets": browser_targets,
        "task_monitor": workspace_task_monitor_json(ctx, caller_terminal_id),
    })
}

/// UC-1: ObserveTideWorkspace — return provider-neutral Tide surfaces and Pane geometry.
fn cli_observe_workspace(ctx: &mut crate::App, params: Value) -> Result<Value, CliError> {
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

        if let PaneKind::Browser(browser) = pane {
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
            entry.as_object_mut().unwrap().insert(
                "external_runtime".to_string(),
                browser_external_runtime_json(browser),
            );
            entry.as_object_mut().unwrap().insert(
                "review_history".to_string(),
                browser_review_history_json(id, browser),
            );
        }

        panes.push(entry);
    }

    Ok(json!({
        "runtime": "tide_mcp_runtime",
        "browser_runtime_router": {
            "default_runtime": "tide_browser_pane",
            "external_runtime": "explicit_fallback_only",
            "fallback_observable_field": "panes[].external_runtime",
            "provider_neutral": true,
            "human_visible_default": true,
        },
        "focus": {
            "pane_id": focused_id,
            "area": focus_area,
        },
        "surfaces": surfaces,
        "panes": panes,
        "project_config": workspace_project_config_json(ctx, caller_terminal_id),
        "task_monitor": workspace_task_monitor_json(ctx, caller_terminal_id),
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

const TERMINAL_OBSERVE_COMPACT_LINES: usize = 12;
const TERMINAL_OBSERVE_MAX_LINES: usize = 200;
const TERMINAL_FIND_DEFAULT_MATCH_LIMIT: usize = 50;
const TERMINAL_FIND_MAX_MATCH_LIMIT: usize = 200;
const TERMINAL_FIND_MAX_CONTEXT_LINES: usize = 5;
const EDITOR_FIND_DEFAULT_MATCH_LIMIT: usize = 50;
const EDITOR_FIND_MAX_MATCH_LIMIT: usize = 200;
const EDITOR_FIND_MAX_CONTEXT_LINES: usize = 5;
const EDITOR_REPLACE_DEFAULT_LIMIT: usize = 1;
const EDITOR_REPLACE_MAX_LIMIT: usize = 200;

fn terminal_observe_target_pane_id(
    ctx: &(impl FocusNavPort + GatewayPort + PaneAccessPort),
    params: &Value,
) -> Result<PaneId, CliError> {
    let pane_id = command_target_pane_id(ctx, params, "pane_id")?;
    if let Some(caller) = ctx.cli_caller_pane() {
        match ctx.pane(caller) {
            Some(PaneKind::Terminal(_)) => {}
            Some(other) => {
                return Err(CliError::InvalidPaneKind {
                    pane_id: caller,
                    expected: "terminal Caller Pane",
                    actual: pane_kind_label(other),
                });
            }
            None => return Err(CliError::PaneNotFound(caller)),
        }
        if pane_id != caller {
            return Err(CliError::InvalidParams(format!(
                "Terminal observation is caller-scoped: pane {pane_id} is not Caller Pane {caller}"
            )));
        }
    }
    match ctx.pane(pane_id) {
        Some(PaneKind::Terminal(_)) => Ok(pane_id),
        Some(other) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "terminal",
            actual: pane_kind_label(other),
        }),
        None => Err(CliError::PaneNotFound(pane_id)),
    }
}

fn terminal_observe_line_limit(
    params: &Value,
    detail: TerminalObserveDetail,
    visible_rows: usize,
) -> usize {
    let default = match detail {
        TerminalObserveDetail::Compact => TERMINAL_OBSERVE_COMPACT_LINES,
        TerminalObserveDetail::Full => visible_rows,
    };
    params
        .get("max_lines")
        .or_else(|| params.get("lines"))
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(default)
        .clamp(1, TERMINAL_OBSERVE_MAX_LINES)
        .min(visible_rows.max(1))
}

fn terminal_line_text(cells: &[crate::tide_core::TerminalCell]) -> String {
    let mut text = String::with_capacity(cells.len());
    for cell in cells {
        if cell.character != '\0' {
            text.push(cell.character);
        }
    }
    text.trim_end().to_string()
}

fn terminal_buffer_line_text(tp: &crate::pane::TerminalPane, absolute_row: usize) -> String {
    tp.backend
        .buffer_row_cells(absolute_row)
        .map(|cells| terminal_line_text(&cells))
        .unwrap_or_default()
}

fn terminal_find_match_limit(params: &Value) -> usize {
    params
        .get("max_matches")
        .or_else(|| params.get("limit"))
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(TERMINAL_FIND_DEFAULT_MATCH_LIMIT)
        .clamp(1, TERMINAL_FIND_MAX_MATCH_LIMIT)
}

fn terminal_find_context_lines(params: &Value) -> usize {
    params
        .get("context_lines")
        .or_else(|| params.get("context"))
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(0)
        .min(TERMINAL_FIND_MAX_CONTEXT_LINES)
}

fn editor_find_match_limit(params: &Value) -> usize {
    params
        .get("max_matches")
        .or_else(|| params.get("limit"))
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(EDITOR_FIND_DEFAULT_MATCH_LIMIT)
        .clamp(1, EDITOR_FIND_MAX_MATCH_LIMIT)
}

fn editor_find_context_lines(params: &Value) -> usize {
    params
        .get("context_lines")
        .or_else(|| params.get("context"))
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(0)
        .min(EDITOR_FIND_MAX_CONTEXT_LINES)
}

fn editor_replace_limit(params: &Value) -> usize {
    let default = if param_bool(params, &["all", "replace_all"]) {
        EDITOR_REPLACE_MAX_LIMIT
    } else {
        EDITOR_REPLACE_DEFAULT_LIMIT
    };
    params
        .get("max_replacements")
        .or_else(|| params.get("limit"))
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(default)
        .clamp(1, EDITOR_REPLACE_MAX_LIMIT)
}

fn editor_tool_target_pane_id(
    ctx: &(impl DockPort + FocusNavPort + GatewayPort + PaneAccessPort),
    params: &Value,
) -> Result<PaneId, CliError> {
    let pane_id = command_target_pane_id(ctx, params, "pane_id")?;
    if let Some(caller) = caller_terminal_scope(ctx) {
        let owner_terminal_id = ctx
            .associated_terminal(pane_id)
            .or_else(|| ctx.terminal_owning(pane_id));
        if !pane_is_in_caller_terminal_scope(pane_id, owner_terminal_id, caller) {
            return Err(CliError::InvalidParams(format!(
                "Editor observation is caller-scoped: pane {pane_id} is not owned by Caller Pane {caller}"
            )));
        }
    }
    match ctx.pane(pane_id) {
        Some(PaneKind::Editor(_)) => Ok(pane_id),
        Some(other) => Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "editor",
            actual: pane_kind_label(other),
        }),
        None => Err(CliError::PaneNotFound(pane_id)),
    }
}

fn editor_mode_label(editor: &crate::pane::editor::EditorPane) -> &'static str {
    if editor.diff_mode {
        "diff"
    } else if editor.preview_mode {
        "preview"
    } else {
        "source"
    }
}

fn editor_byte_col_for_char_col(line: &str, char_col: usize) -> usize {
    line.char_indices()
        .nth(char_col)
        .map(|(idx, _)| idx)
        .unwrap_or(line.len())
}

fn editor_replace_match(
    editor: &mut crate::pane::editor::EditorPane,
    search_match: &crate::state::search::SearchMatch,
    replacement: &str,
) -> Option<serde_json::Value> {
    let line_text = editor.editor.buffer.line(search_match.line)?.to_string();
    let start_col = editor_byte_col_for_char_col(&line_text, search_match.col);
    let end_col = editor_byte_col_for_char_col(&line_text, search_match.col + search_match.len);
    let start = crate::tide_editor::EditorPosition {
        line: search_match.line,
        col: start_col,
    };
    let end = crate::tide_editor::EditorPosition {
        line: search_match.line,
        col: end_col,
    };
    let before = line_text[start_col..end_col].to_string();
    let replace_start = editor.editor.buffer.delete_range(start, end);
    let replace_end = editor.editor.buffer.insert_text(replace_start, replacement);
    editor.editor.cursor.set_position(replace_end);
    editor.editor.cursor.desired_col = replace_end.col;
    editor.selection = None;
    editor.search = None;
    Some(json!({
        "line": search_match.line,
        "col": search_match.col,
        "len": search_match.len,
        "before": before,
        "after": replacement,
    }))
}

fn terminal_cell_range_text(
    cells: &[crate::tide_core::TerminalCell],
    start: usize,
    end: usize,
) -> String {
    let mut text = String::new();
    for cell in cells
        .iter()
        .skip(start.min(cells.len()))
        .take(end.saturating_sub(start))
    {
        if cell.character != '\0' {
            text.push(cell.character);
        }
    }
    text.trim_end().to_string()
}

fn terminal_url_ranges_json(
    cells: &[crate::tide_core::TerminalCell],
    ranges: &[(usize, usize)],
) -> Value {
    Value::Array(
        ranges
            .iter()
            .map(|(start, end)| {
                json!({
                    "start_col": start,
                    "end_col": end,
                    "text": terminal_cell_range_text(cells, *start, *end),
                })
            })
            .collect(),
    )
}

fn terminal_hyperlink_ranges_json(
    cells: &[crate::tide_core::TerminalCell],
    ranges: &[(usize, usize, String)],
) -> Value {
    Value::Array(
        ranges
            .iter()
            .map(|(start, end, uri)| {
                json!({
                    "start_col": start,
                    "end_col": end,
                    "text": terminal_cell_range_text(cells, *start, *end),
                    "uri": uri,
                })
            })
            .collect(),
    )
}

fn cursor_shape_label(shape: CursorShape) -> &'static str {
    match shape {
        CursorShape::Block => "block",
        CursorShape::Beam => "beam",
        CursorShape::Underline => "underline",
    }
}

/// ObserveTerminal — read the live terminal work surface as structured MCP data.
fn cli_observe_terminal(
    ctx: &(impl FocusNavPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let detail = terminal_observe_detail(&params)?;
    let pane_id = terminal_observe_target_pane_id(ctx, &params)?;
    let PaneKind::Terminal(tp) = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))? else {
        unreachable!("terminal_observe_target_pane_id validates terminal pane kind");
    };

    let grid = tp.backend.grid();
    let visible_rows = grid.cells.len();
    let line_limit = terminal_observe_line_limit(&params, detail, visible_rows);
    let first_row = visible_rows.saturating_sub(line_limit);
    let history_size = tp.backend.history_size();
    let display_offset = tp.backend.display_offset();
    let visible_start_absolute_row = history_size.saturating_sub(display_offset);
    let url_ranges = tp.backend.url_ranges();
    let hyperlink_ranges = tp.backend.hyperlink_ranges();

    let mut rows = Vec::new();
    for row_idx in first_row..visible_rows {
        let cells = &grid.cells[row_idx];
        rows.push(json!({
            "row": row_idx,
            "absolute_row": visible_start_absolute_row + row_idx,
            "text": terminal_line_text(cells),
            "wrapped": tp.backend.visible_row_is_wrapped(row_idx),
            "urls": terminal_url_ranges_json(
                cells,
                url_ranges.get(row_idx).map(Vec::as_slice).unwrap_or(&[]),
            ),
            "hyperlinks": terminal_hyperlink_ranges_json(
                cells,
                hyperlink_ranges
                    .get(row_idx)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]),
            ),
        }));
    }

    let selection = tp
        .selection
        .as_ref()
        .map(|selection| {
            json!({
                "active": true,
                "range": serialize_selection(selection),
                "content": tp.selected_text(selection),
            })
        })
        .unwrap_or_else(|| json!({"active": false}));
    let cursor = tp.backend.cursor();
    let detail_label = match detail {
        TerminalObserveDetail::Full => "full",
        TerminalObserveDetail::Compact => "compact",
    };
    let content = rows
        .iter()
        .filter_map(|row| row.get("text").and_then(|text| text.as_str()))
        .collect::<Vec<_>>()
        .join("\n");

    Ok(json!({
        "pane_id": pane_id,
        "kind": "terminal",
        "detail": detail_label,
        "title": ctx.pane_title(pane_id),
        "cwd": terminal_cwd_json(ctx.pane(pane_id)),
        "pid": tp.backend.child_pid(),
        "shell_idle": tp.context.shell_idle,
        "child_dead": tp.context.child_dead,
        "osc_title": tp.context.osc_title,
        "grid": {
            "cols": grid.cols,
            "rows": grid.rows,
            "visible_rows": visible_rows,
            "history_lines": history_size,
            "display_offset": display_offset,
            "visible_start_absolute_row": visible_start_absolute_row,
        },
        "cursor": {
            "row": cursor.row,
            "col": cursor.col,
            "visible": cursor.visible,
            "shape": cursor_shape_label(cursor.shape),
        },
        "screen": {
            "content": content,
            "rows": rows,
            "truncation": {
                "rows_truncated": first_row > 0,
                "original_rows": visible_rows,
                "returned_rows": visible_rows.saturating_sub(first_row),
                "limit_rows": line_limit,
            },
        },
        "selection": selection,
    }))
}

/// FindInTerminal — search the caller terminal scrollback + visible screen.
fn cli_find_in_terminal(
    ctx: &(impl FocusNavPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = terminal_observe_target_pane_id(ctx, &params)?;
    let query = params
        .get("query")
        .or_else(|| params.get("text"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CliError::InvalidParams("find-in-terminal requires non-empty query".into())
        })?;
    let match_limit = terminal_find_match_limit(&params);
    let context_lines = terminal_find_context_lines(&params);
    let PaneKind::Terminal(tp) = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))? else {
        unreachable!("terminal_observe_target_pane_id validates terminal pane kind");
    };

    let all_matches = tp.backend.search_buffer(query);
    let returned_matches = all_matches
        .iter()
        .take(match_limit)
        .map(|(absolute_row, col, len)| {
            let context_start = absolute_row.saturating_sub(context_lines);
            let context_end = absolute_row.saturating_add(context_lines);
            let context = (context_start..=context_end)
                .filter_map(|row| {
                    tp.backend.buffer_row_cells(row).map(|cells| {
                        json!({
                            "absolute_row": row,
                            "text": terminal_line_text(&cells),
                        })
                    })
                })
                .collect::<Vec<_>>();
            json!({
                "absolute_row": absolute_row,
                "col": col,
                "len": len,
                "line": terminal_buffer_line_text(tp, *absolute_row),
                "context": context,
            })
        })
        .collect::<Vec<_>>();
    let grid = tp.backend.grid();
    let visible_start_absolute_row = tp
        .backend
        .history_size()
        .saturating_sub(tp.backend.display_offset());

    Ok(json!({
        "pane_id": pane_id,
        "kind": "terminal",
        "query": query,
        "case_sensitive": false,
        "search_scope": {
            "history_lines": tp.backend.history_size(),
            "visible_rows": grid.cells.len(),
            "visible_start_absolute_row": visible_start_absolute_row,
        },
        "matches": returned_matches,
        "truncation": {
            "matches_truncated": all_matches.len() > match_limit,
            "total_matches": all_matches.len(),
            "returned_matches": all_matches.len().min(match_limit),
            "limit_matches": match_limit,
            "context_lines": context_lines,
        },
    }))
}

/// FindInEditor — search an Editor Pane buffer and return bounded structured matches.
fn cli_find_in_editor(
    ctx: &(impl DockPort + FocusNavPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = editor_tool_target_pane_id(ctx, &params)?;
    let query = params
        .get("query")
        .or_else(|| params.get("text"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| CliError::InvalidParams("find-in-editor requires non-empty query".into()))?;
    let match_limit = editor_find_match_limit(&params);
    let context_lines = editor_find_context_lines(&params);
    let PaneKind::Editor(editor) = ctx.pane(pane_id).ok_or(CliError::PaneNotFound(pane_id))? else {
        unreachable!("editor_tool_target_pane_id validates editor pane kind");
    };

    let mut search = crate::state::search::SearchState::new();
    search.input = crate::state::InputLine::with_text(query.to_string());
    crate::state::search::execute_search_editor(&mut search, &editor.editor.buffer.lines);

    let line_count = editor.editor.buffer.line_count();
    let returned_matches = search
        .matches
        .iter()
        .take(match_limit)
        .map(|search_match| {
            let context_start = search_match.line.saturating_sub(context_lines);
            let context_end = search_match
                .line
                .saturating_add(context_lines)
                .min(line_count.saturating_sub(1));
            let context = if line_count == 0 {
                Vec::new()
            } else {
                (context_start..=context_end)
                    .filter_map(|line| {
                        editor.editor.buffer.line(line).map(|text| {
                            json!({
                                "line": line,
                                "text": text,
                            })
                        })
                    })
                    .collect::<Vec<_>>()
            };
            json!({
                "line": search_match.line,
                "col": search_match.col,
                "len": search_match.len,
                "line_text": editor
                    .editor
                    .buffer
                    .line(search_match.line)
                    .unwrap_or_default(),
                "context": context,
            })
        })
        .collect::<Vec<_>>();
    let cursor = editor.editor.cursor_position();

    Ok(json!({
        "pane_id": pane_id,
        "kind": "editor",
        "query": query,
        "case_sensitive": false,
        "file_path": editor
            .editor
            .file_path()
            .map(|path| path.to_string_lossy().to_string()),
        "dirty": editor.editor.is_modified(),
        "mode": editor_mode_label(editor),
        "cursor": {
            "line": cursor.line,
            "col": cursor.col,
        },
        "search_scope": {
            "source": "buffer",
            "line_count": line_count,
        },
        "matches": returned_matches,
        "truncation": {
            "matches_truncated": search.matches.len() > match_limit,
            "total_matches": search.matches.len(),
            "returned_matches": search.matches.len().min(match_limit),
            "limit_matches": match_limit,
            "context_lines": context_lines,
        },
    }))
}

/// ReplaceInEditor — apply bounded literal replacements to an owned Editor Pane.
fn cli_replace_in_editor(
    ctx: &mut (impl DockPort + FocusNavPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = editor_tool_target_pane_id(ctx, &params)?;
    let query = params
        .get("query")
        .or_else(|| params.get("text"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CliError::InvalidParams("replace-in-editor requires non-empty query".into())
        })?;
    let replacement = params
        .get("replacement")
        .or_else(|| params.get("replace_with"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| CliError::InvalidParams("replacement required".into()))?;
    let replacement_limit = editor_replace_limit(&params);

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;
    let PaneKind::Editor(editor) = pane else {
        unreachable!("editor_tool_target_pane_id validates editor pane kind");
    };
    if editor.preview_mode {
        return Err(CliError::InvalidParams(
            "replace-in-editor requires source mode; switch the Editor Pane out of preview first"
                .into(),
        ));
    }

    let mut search = crate::state::search::SearchState::new();
    search.input = crate::state::InputLine::with_text(query.to_string());
    crate::state::search::execute_search_editor(&mut search, &editor.editor.buffer.lines);
    let total_matches = search.matches.len();
    let to_replace = search
        .matches
        .iter()
        .take(replacement_limit)
        .cloned()
        .collect::<Vec<_>>();

    let was_dirty = editor.editor.is_modified();
    let mut replaced = Vec::new();
    for search_match in to_replace.iter().rev() {
        if let Some(result) = editor_replace_match(editor, search_match, replacement) {
            replaced.push(result);
        }
    }
    replaced.reverse();
    let cursor = editor.editor.cursor_position();

    Ok(json!({
        "ok": true,
        "pane_id": pane_id,
        "kind": "editor",
        "query": query,
        "replacement": replacement,
        "case_sensitive": false,
        "file_path": editor
            .editor
            .file_path()
            .map(|path| path.to_string_lossy().to_string()),
        "mode": editor_mode_label(editor),
        "dirty_before": was_dirty,
        "dirty_after": editor.editor.is_modified(),
        "cursor": {
            "line": cursor.line,
            "col": cursor.col,
        },
        "replacements": replaced,
        "truncation": {
            "matches_truncated": total_matches > replacement_limit,
            "total_matches": total_matches,
            "applied_replacements": replaced.len(),
            "limit_replacements": replacement_limit,
        },
    }))
}

/// UC-1: ObserveBrowserPaneAutomationState — read structured Browser Pane state.
fn cli_browser_observe(
    ctx: &mut (impl AppCorePort
              + DockPort
              + FocusNavPort
              + GatewayPort
              + LayoutPort
              + ModalPort
              + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let detail = browser_observe_detail(&params)?;
    let vision = browser_observe_vision(&params)?;
    let pane_id = command_target_pane_id(ctx, &params, "pane_id")?;
    let _auth = ensure_browser_tool_authorized_if_caller(ctx, pane_id)?;
    ctx.compute_layout();
    let owner_terminal_id = ctx.terminal_owning(pane_id);
    let rect = pane_rect(ctx, pane_id);
    let visual_fit =
        browser_visual_fit(rect, owner_terminal_id, ctx.focused_terminal_id(), pane_id);
    let modal_open = ctx.modal().is_any_open();
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

    // Screenshot-only vision omits the full BrowserSnapshot body (BR-3): force the compact
    // summary regardless of detail. text/both keep the detail-governed body.
    let effective_detail = if matches!(vision, BrowserObserveVision::Screenshot) {
        BrowserObserveDetail::Compact
    } else {
        detail
    };
    let (detail_label, snapshot, page_map) = match effective_detail {
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
    // Pixel vision (BR-1): attach the cached Browser Pane Screenshot only for
    // screenshot/both; text returns none.
    let vision_label = match vision {
        BrowserObserveVision::Text => "text",
        BrowserObserveVision::Screenshot => "screenshot",
        BrowserObserveVision::Both => "both",
    };
    let screenshot_json = if matches!(vision, BrowserObserveVision::Text) {
        Value::Null
    } else {
        // Kick off a fresh native capture (async) for the next observe; return the current
        // cached capture now (the first screenshot observe may be null until one lands).
        browser.request_agent_screenshot_refresh();
        browser_screenshot_json(browser.agent_screenshot())
    };
    let observation_id = browser_observation_id(pane_id, browser.generation);

    let result = json!({
        "pane_id": pane_id,
        "generation": browser.generation,
        "observation_id": observation_id,
        "detail": detail_label,
        "title": title,
        "url": browser.url.clone(),
        "loading": browser.loading,
        "load_progress": browser.load_progress,
        "can_go_back": browser.can_go_back,
        "can_go_forward": browser.can_go_forward,
        "snapshot": snapshot,
        "page_map": page_map,
        "interaction_graph": browser_interaction_graph_json(browser.page_map.as_ref(), browser.generation),
        "selection": browser_selection_json(browser.page_selection.as_ref()),
        "automation_cursor": browser_automation_cursor_json(browser.automation_cursor()),
        "action_history": browser_action_history_json(browser),
        "vision": vision_label,
        "screenshot": screenshot_json,
        "readiness": browser_readiness_json(browser, modal_open),
        "allowed_actions": browser_allowed_actions_json(browser, modal_open),
        "recovery": browser_recovery_json(browser, modal_open, &visual_fit),
        "browser_primitives": {
            "network_evidence": {
                "next_tool": "tide_browser_inspect_network",
                "cached_entries": browser.network_log.as_ref().map(|log| log.entries.len()).unwrap_or(0),
                "source": "in_page_fetch_xhr_and_resource_timing",
            },
            "list_collection": {
                "next_tool": "tide_browser_collect_list",
                "cached_groups": browser.list_snapshot.as_ref().map(|snapshot| snapshot.groups.len()).unwrap_or(0),
                "loop": ["collect", "scroll_small", "collect"],
            },
        },
        "runtime": "tide_browser_pane",
        "external_runtime": browser_external_runtime_json(browser),
        "operation": browser_operation_json(control_decision.active),
        "requires_prior_observe_for_actions": true,
        "observation_id_semantics": {
            "generation_scoped": true,
            "required_for_new_clients": true,
            "legacy_actions_without_observation_id_allowed": true,
        },
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

fn cli_browser_inspect_network(
    ctx: &mut (impl DockPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = required_browser_pane_id(&params)?;
    let auth = ensure_snapshot_tool_authorized(ctx, pane_id)?;
    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;
    let PaneKind::Browser(browser) = pane else {
        return Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: pane_kind_label(pane),
        });
    };

    browser.request_network_log_refresh();
    let network = browser_network_log_json(browser.network_log.as_ref());
    Ok(json!({
        "pane_id": pane_id,
        "caller_pane": auth.caller_pane_id,
        "associated_terminal": auth.associated_terminal_id,
        "generation": browser.generation,
        "observation_id": browser_observation_id(pane_id, browser.generation),
        "network": network,
        "refreshed_live_page": true,
        "runtime": "tide_browser_pane",
        "usage": {
            "purpose": "network_evidence",
            "notes": [
                "Entries are observed from the in-page fetch/XMLHttpRequest bridge and PerformanceResourceTiming.",
                "Call after navigate/wait-for/interaction; direct external API calls should not replace browser-context evidence when sites depend on headers/cookies."
            ]
        },
    }))
}

fn cli_browser_collect_list(
    ctx: &mut (impl DockPort + GatewayPort + PaneAccessPort),
    params: Value,
) -> Result<Value, CliError> {
    let pane_id = required_browser_pane_id(&params)?;
    let auth = ensure_snapshot_tool_authorized(ctx, pane_id)?;
    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;
    let PaneKind::Browser(browser) = pane else {
        return Err(CliError::InvalidPaneKind {
            pane_id,
            expected: "browser",
            actual: pane_kind_label(pane),
        });
    };

    browser.request_list_snapshot_refresh();
    let observation_id = browser_observation_id(pane_id, browser.generation);
    let list_snapshot = browser_list_snapshot_json(browser.list_snapshot.as_ref());
    let next_action =
        browser_list_next_action_json(pane_id, &observation_id, browser.list_snapshot.as_ref());
    Ok(json!({
        "pane_id": pane_id,
        "caller_pane": auth.caller_pane_id,
        "associated_terminal": auth.associated_terminal_id,
        "generation": browser.generation,
        "observation_id": observation_id,
        "list_snapshot": list_snapshot,
        "next_action": next_action,
        "refreshed_live_page": true,
        "runtime": "tide_browser_pane",
        "usage": {
            "purpose": "bounded_virtual_list_collection",
            "loop": ["tide_browser_collect_list", "tide_browser_action scroll", "tide_browser_collect_list"],
            "anti_pattern": "Do not run a long page JS loop that clicks or scrolls dozens of times in one tool call."
        },
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

    if action == "close-modal" {
        let closed = ctx.modal().is_any_open();
        ctx.modal_mut().close_all();
        let pane = ctx
            .pane_mut(pane_id)
            .ok_or(CliError::PaneNotFound(pane_id))?;
        let browser = navigation_browser_mut(pane_id, pane)?;
        let observe_after_action = browser_action_requires_observe_after(action);
        if observe_after_action {
            browser.mark_agent_action_requires_reobserve();
        }
        set_agent_browser_control_mode(browser, &control_decision);
        browser.record_agent_action(BrowserActionHistoryEntry {
            generation: browser.generation,
            action: action.to_string(),
            target_ref: None,
            target_label: Some("ModalStack".to_string()),
            x: None,
            y: None,
            text_bytes: None,
            key: None,
            url: None,
            dispatched: closed,
            observe_after_action,
        });
        return Ok(json!({
            "pane_id": pane_id,
            "generation": browser.generation,
            "observation_id": browser_observation_id(pane_id, browser.generation),
            "action": action,
            "dispatched": closed,
            "runtime": "tide_browser_pane",
            "external_runtime": Value::Null,
            "requires_prior_observe": false,
            "observe_after_action": observe_after_action,
            "modal_closed": closed,
            "cursor_semantics": browser_cursor_semantics_json(),
            "automation_cursor": browser_automation_cursor_json(browser.automation_cursor()),
            "agent_browser_control_mode": agent_browser_control_mode_json(&control_decision, browser),
        }));
    }

    let pane = ctx
        .pane_mut(pane_id)
        .ok_or(CliError::PaneNotFound(pane_id))?;
    let browser = navigation_browser_mut(pane_id, pane)?;
    browser_validate_observation_id(&params, pane_id, browser)?;

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
        "scroll" => {
            let delta_x = params
                .get("delta_x")
                .or_else(|| params.get("dx"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let delta_y = params
                .get("delta_y")
                .or_else(|| params.get("dy"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            if delta_x == 0.0 && delta_y == 0.0 {
                return Err(CliError::InvalidParams(
                    "delta_x or delta_y required for scroll".into(),
                ));
            }
            let x = params.get("x").and_then(|v| v.as_f64());
            let y = params.get("y").and_then(|v| v.as_f64());
            let dispatched = browser.dispatch_automation_scroll(delta_x, delta_y, x, y);
            if dispatched {
                browser.request_page_snapshot_refresh();
            }
            dispatched
        }
        "back" => {
            let dispatched = browser.webview.is_some() && browser.can_go_back;
            if dispatched {
                browser.go_back();
                browser.request_page_snapshot_refresh();
            }
            dispatched
        }
        "forward" => {
            let dispatched = browser.webview.is_some() && browser.can_go_forward;
            if dispatched {
                browser.go_forward();
                browser.request_page_snapshot_refresh();
            }
            dispatched
        }
        "reload" => {
            let dispatched = browser.webview.is_some();
            browser.reload();
            browser.request_page_snapshot_refresh();
            dispatched
        }
        "wait-for" => {
            browser.request_page_snapshot_refresh();
            browser.webview.is_some()
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
    let history_coordinates = action_target
        .as_ref()
        .map(BrowserPageElement::center)
        .or_else(|| match action {
            "move" | "click" | "scroll" => {
                let x = params.get("x").and_then(|value| value.as_f64())?;
                let y = params.get("y").and_then(|value| value.as_f64())?;
                Some((x, y))
            }
            _ => None,
        });
    browser.record_agent_action(BrowserActionHistoryEntry {
        generation: browser.generation,
        action: action.to_string(),
        target_ref: browser_action_target_ref(&params).map(str::to_string),
        target_label: action_target
            .as_ref()
            .and_then(|target| (!target.label.trim().is_empty()).then(|| target.label.clone())),
        x: history_coordinates.map(|coordinates| coordinates.0),
        y: history_coordinates.map(|coordinates| coordinates.1),
        text_bytes: if action == "type" {
            params
                .get("text")
                .and_then(|value| value.as_str())
                .map(str::len)
        } else {
            None
        },
        key: if action == "press" {
            params
                .get("key")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        } else {
            None
        },
        url: if action == "navigate" {
            params
                .get("url")
                .and_then(|value| value.as_str())
                .map(BrowserPane::normalize_navigation_url)
        } else {
            None
        },
        dispatched,
        observe_after_action,
    });

    Ok(json!({
        "pane_id": pane_id,
        "generation": browser.generation,
        "observation_id": browser_observation_id(pane_id, browser.generation),
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
fn cli_rename_workspace(ctx: &mut impl WorkspaceNavPort, params: Value) -> Result<Value, CliError> {
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
        deliveries: Vec::new(),
    };
    let artifact_id = artifact.artifact_id;
    ctx.context_artifacts
        .artifacts
        .insert(artifact_id, artifact.clone());
    ctx.record_browser_review_from_artifact(&artifact);

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

    let terminal_input_injected = ctx
        .deliver_context_artifact(artifact_id)
        .ok_or(CliError::PaneNotFound(artifact_id))?;
    let artifact = ctx
        .context_artifacts
        .artifacts
        .get(&artifact_id)
        .cloned()
        .ok_or(CliError::PaneNotFound(artifact_id))?;

    Ok(json!({
        "ok": true,
        "artifact_id": artifact_id,
        "terminal_input_injected": terminal_input_injected,
        "artifact": active_artifact_json(&artifact),
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
                        .map(|v| {
                            v.get("mcpServers")
                                .and_then(|m| m.get("tide-terminal"))
                                .is_some()
                        })
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
