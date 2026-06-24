// Spec: docs/specs/tide-mcp-runtime.md

use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use crate::adapter::inward::cli_adapter::mcp;
use crate::pane::browser::BrowserPane;
use crate::pane::diff::{DiffFileEntry, DiffPane};
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::{FocusArea, SplitTransitionScope};
use crate::tide_core::{LayoutEngine, PaneId, SplitDirection};
use crate::App;
use crate::DockPort;
use crate::LayoutPort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_terminal() -> (App, PaneId) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);
    app.compute_layout();
    (app, terminal_id)
}

fn app_with_context_browser(dock_width: f32) -> (App, PaneId, PaneId) {
    let (mut app, terminal_id) = app_with_terminal();
    app.dock.dock_width = dock_width;
    let browser_id = app.layout.alloc_id();
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "http://localhost:4174".to_string(),
        )),
    );
    app.add_pane_to_dock(browser_id, Some(terminal_id));
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);
    app.compute_layout();
    (app, terminal_id, browser_id)
}

fn pane_entry<'a>(observed: &'a serde_json::Value, pane_id: PaneId) -> &'a serde_json::Value {
    observed["panes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["pane_id"].as_u64() == Some(pane_id))
        .expect("pane entry should be reported")
}

fn mcp_tool_description(tools: &[serde_json::Value], name: &str) -> String {
    tools
        .iter()
        .find(|tool| tool.get("name").and_then(|value| value.as_str()) == Some(name))
        .and_then(|tool| tool.get("description").and_then(|value| value.as_str()))
        .unwrap_or_default()
        .to_string()
}

// --- UC-1: ObserveTideWorkspace ---

#[test]
fn observing_workspace_reports_provider_neutral_surfaces_and_panes() {
    // UC-1 BR-1 / BR-2 / BR-4: workspace observe returns provider-neutral runtime, surfaces, and Pane membership.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(400.0);
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 4242,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );
    app.agent_notification_snippets
        .insert(terminal_id, "approval needed".to_string());
    let artifact_id = app.context_artifacts.allocate_id();
    app.context_artifacts.artifacts.insert(
        artifact_id,
        crate::state::ContextArtifact {
            artifact_id,
            source_pane_id: browser_id,
            associated_terminal_id: terminal_id,
            pane_kind: "browser".to_string(),
            source_label: "Browser".to_string(),
            selection: None,
            content: "review target".to_string(),
            comment: "check this".to_string(),
            pinned: true,
            deliveries: vec![crate::state::context_artifact::ContextArtifactDelivery {
                sequence: 1,
                terminal_input_injected: true,
            }],
        },
    );

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");

    assert_eq!(observed["runtime"], "tide_mcp_runtime");
    assert_eq!(
        observed["browser_runtime_router"]["default_runtime"],
        "tide_browser_pane"
    );
    assert_eq!(
        observed["browser_runtime_router"]["external_runtime"],
        "explicit_fallback_only"
    );
    assert_eq!(observed["browser_runtime_router"]["provider_neutral"], true);
    let resume_policy = &observed["task_monitor"]["agent_resume_policy"];
    assert_eq!(resume_policy["kind"], "agent_resume_policy");
    assert_eq!(resume_policy["provider_neutral"], true);
    assert_eq!(resume_policy["automatic_agent_process_resume"], false);
    assert_eq!(resume_policy["provider_resume_invoked_by_tide"], false);
    assert_eq!(resume_policy["session_restore_scope"]["terminal_cwd"], true);
    assert_eq!(
        resume_policy["session_restore_scope"]["live_child_processes"],
        false
    );
    let providers = resume_policy["providers"].as_array().unwrap();
    for provider in ["claude", "codex", "agy", "opencode"] {
        assert!(
            providers
                .iter()
                .any(|entry| entry["provider"].as_str() == Some(provider)),
            "resume policy should include {provider}"
        );
    }

    let surfaces = observed["surfaces"].as_array().unwrap();
    assert!(surfaces.iter().any(|surface| surface["kind"] == "stage"));
    let terminal_context_surface = surfaces
        .iter()
        .find(|surface| surface["kind"] == "terminal_context_surface")
        .expect("active Terminal Context Surface should be reported");
    assert_eq!(
        terminal_context_surface["owner_terminal_id"].as_u64(),
        Some(terminal_id)
    );
    assert!(terminal_context_surface["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|capability| capability == "resize_width"));

    let browser = pane_entry(&observed, browser_id);
    assert_eq!(browser["kind"], "browser");
    assert_eq!(browser["surface"], "terminal_context_surface");
    assert_eq!(browser["owner_terminal_id"].as_u64(), Some(terminal_id));

    let terminal = pane_entry(&observed, terminal_id);
    assert_eq!(terminal["kind"], "terminal");
    assert_eq!(terminal["surface"], "stage");

    let task_monitor = &observed["task_monitor"];
    assert_eq!(task_monitor["kind"], "workspace_task_monitor");
    assert_eq!(task_monitor["active_workspace_index"].as_u64(), Some(0));
    assert_eq!(task_monitor["workspace_count"].as_u64(), Some(1));
    assert_eq!(task_monitor["scoped_to_caller"], false);
    assert_eq!(
        task_monitor["attention_panel"]["kind"],
        "workspace_attention_panel"
    );
    assert_eq!(task_monitor["attention_panel"]["visible"], true);
    assert_eq!(
        task_monitor["attention_panel"]["unread_count"].as_u64(),
        Some(1)
    );
    let active_task = &task_monitor["workspaces"][0];
    assert_eq!(active_task["name"], "Workspace 1");
    assert_eq!(active_task["state"], "needs_input");
    assert_eq!(active_task["pane_counts"]["terminal"].as_u64(), Some(1));
    assert_eq!(active_task["pane_counts"]["browser"].as_u64(), Some(1));
    assert_eq!(
        active_task["pane_counts"]["terminal_context"].as_u64(),
        Some(1)
    );
    assert_eq!(active_task["agent_counts"]["needs_input"].as_u64(), Some(1));
    let terminal_context_summary = &active_task["terminals"][0]["terminal_context_surface"];
    assert_eq!(terminal_context_summary["mode"], "stacked");
    assert_eq!(terminal_context_summary["pane_count"].as_u64(), Some(1));
    assert_eq!(
        terminal_context_summary["focused_pane_id"].as_u64(),
        Some(browser_id)
    );
    assert_eq!(active_task["agents"][0]["name"], "Codex");
    assert_eq!(
        active_task["agents"][0]["notification_snippet"],
        "approval needed"
    );
    assert_eq!(active_task["agent_lifecycle"]["scope"], "workspace_stage");
    assert_eq!(active_task["agent_lifecycle"]["state"], "needs_input");
    assert_eq!(
        active_task["agent_lifecycle"]["wrapper_managed"].as_u64(),
        Some(1)
    );
    assert_eq!(
        active_task["agent_lifecycle"]["gateway_connected"].as_u64(),
        Some(1)
    );
    assert_eq!(
        active_task["agent_lifecycle"]["needs_input"].as_u64(),
        Some(1)
    );
    assert_eq!(
        active_task["agent_lifecycle"]["notifications"]["with_snippet"].as_u64(),
        Some(1)
    );
    assert_eq!(
        active_task["agent_lifecycle"]["notifications"]["attention"].as_u64(),
        Some(1)
    );
    assert_eq!(
        active_task["agent_lifecycle"]["notifications"]["pending"][0]["pane_id"].as_u64(),
        Some(terminal_id)
    );
    assert_eq!(
        task_monitor["attention_panel"]["items"][0]["pane_id"].as_u64(),
        Some(terminal_id)
    );
    assert_eq!(
        task_monitor["attention_panel"]["items"][0]["summary"],
        "approval needed"
    );
    assert_eq!(
        active_task["agent_lifecycle"]["notifications"]["pending"][0]["state"],
        "needs_input"
    );
    assert_eq!(
        active_task["agent_lifecycle"]["agents"][0]["lifecycle"],
        "needs_input"
    );
    assert_eq!(active_task["last_event"]["kind"], "agent_notification");
    assert_eq!(
        active_task["last_event"]["pane_id"].as_u64(),
        Some(terminal_id)
    );
    assert_eq!(active_task["last_event"]["agent_status"], "needs_input");
    assert_eq!(active_task["last_event"]["summary"], "approval needed");
    assert_eq!(active_task["context_artifacts"]["total"].as_u64(), Some(1));
    assert_eq!(active_task["context_artifacts"]["pinned"].as_u64(), Some(1));
    assert_eq!(
        active_task["context_artifacts"]["delivered"].as_u64(),
        Some(1)
    );
    assert_eq!(
        active_task["context_artifacts"]["pending_delivery"].as_u64(),
        Some(0)
    );
    assert_eq!(
        active_task["context_artifacts"]["delivery_count"].as_u64(),
        Some(1)
    );
}

#[test]
fn task_monitor_reports_wrapped_agent_lifecycle_and_notifications_per_workspace() {
    // UC-1 BR-10: task_monitor exposes Workspace-scoped wrapped-agent lifecycle and notification state.
    let mut app = test_app();
    let active_workspace = crate::Workspace {
        name: "Active".to_string(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    };
    let (inactive_layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    let inactive_terminal = TerminalPane::with_cwd(
        terminal_id,
        80,
        24,
        Some(PathBuf::from("/tmp/tide-review")),
        true,
    )
    .unwrap();
    let mut inactive_panes = HashMap::new();
    inactive_panes.insert(terminal_id, PaneKind::Terminal(inactive_terminal));
    let inactive_workspace = crate::Workspace {
        name: "Review".to_string(),
        layout: inactive_layout,
        focused: Some(terminal_id),
        panes: inactive_panes,
    };
    app.ws.workspaces = vec![active_workspace, inactive_workspace];
    app.ws.workspace_extras = vec![crate::WorkspaceExtras::new(), crate::WorkspaceExtras::new()];
    app.ws.active = 0;
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 4242,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::Idle),
        },
    );
    app.agent_notification_snippets
        .insert(terminal_id, "tests are green".to_string());
    app.notified_panes.insert(terminal_id);

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");
    let inactive_task = observed["task_monitor"]["workspaces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|workspace| workspace["workspace_index"].as_u64() == Some(1))
        .expect("inactive Workspace should be reported");

    assert_eq!(inactive_task["name"], "Review");
    assert_eq!(inactive_task["state"], "ready");
    assert_eq!(inactive_task["agent_lifecycle"]["scope"], "workspace_stage");
    assert_eq!(inactive_task["agent_lifecycle"]["state"], "ready");
    assert_eq!(
        inactive_task["agent_lifecycle"]["wrapper_managed"].as_u64(),
        Some(1)
    );
    assert_eq!(inactive_task["agent_lifecycle"]["idle"].as_u64(), Some(1));
    assert_eq!(
        inactive_task["agent_lifecycle"]["notifications"]["has_any"],
        true
    );
    assert_eq!(
        inactive_task["agent_lifecycle"]["notifications"]["routed"].as_u64(),
        Some(1)
    );
    assert_eq!(
        inactive_task["agent_lifecycle"]["notifications"]["pending"][0]["state"],
        "idle_routed"
    );
    assert_eq!(
        inactive_task["agent_lifecycle"]["agents"][0]["notification"]["snippet"],
        "tests are green"
    );
    assert_eq!(
        observed["task_monitor"]["attention_panel"]["unread_count"].as_u64(),
        Some(1)
    );
    assert_eq!(
        observed["task_monitor"]["attention_panel"]["items"][0]["workspace_index"].as_u64(),
        Some(1)
    );
    assert_eq!(
        observed["task_monitor"]["attention_panel"]["items"][0]["summary"],
        "tests are green"
    );
}

#[test]
fn observing_workspace_reports_terminal_exit_as_task_event() {
    // UC-1 BR-6: task_monitor reports terminal exit even when no wrapped agent notification exists.
    let (mut app, terminal_id) = app_with_terminal();
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&terminal_id) {
        terminal.context.child_dead = true;
    }

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");
    let active_task = &observed["task_monitor"]["workspaces"][0];

    assert_eq!(active_task["state"], "active");
    assert_eq!(active_task["last_event"]["kind"], "terminal_exit");
    assert_eq!(
        active_task["last_event"]["pane_id"].as_u64(),
        Some(terminal_id)
    );
    assert_eq!(active_task["last_event"]["summary"], "terminal exited");
    assert_eq!(active_task["terminals"][0]["child_dead"], true);
}

#[test]
fn observing_workspace_reports_browser_state_as_task_event() {
    // UC-1 BR-7: task_monitor reports Browser Pane operation state as a Workspace event.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(400.0);
    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.loading = true;
        browser.load_progress = 0.42;
    }

    let observed = app
        .handle_cli_command(
            "observe-workspace",
            json!({"detail": "full", "_caller_pane": terminal_id}),
        )
        .expect("workspace observe should succeed");
    let active_task = &observed["task_monitor"]["workspaces"][0];

    assert_eq!(active_task["last_event"]["kind"], "browser_loading");
    assert_eq!(
        active_task["last_event"]["pane_id"].as_u64(),
        Some(browser_id)
    );
    assert_eq!(active_task["last_event"]["summary"], "browser loading");
}

#[test]
fn observing_workspace_reports_browser_review_history() {
    // UC-1 BR-8: task_monitor and Browser Pane entries expose Browser review comments and delivery history.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(400.0);
    assert!(app.apply_webview_bridge_message(
        &json!({
            "kind": "browser-selection",
            "pane_id": browser_id,
            "text": "selected browser text",
            "html": "<p>selected browser text</p>",
            "context": "browser context",
            "title": "Example page",
            "url": "https://example.com/docs",
            "collapsed": false
        })
        .to_string()
    ));

    let created = app
        .handle_cli_command(
            "create-context-artifact",
            json!({"pane_id": browser_id, "comment": "review the empty state", "_caller_pane": terminal_id}),
        )
        .expect("browser review artifact should be created");
    app.handle_cli_command(
        "send-context-artifact",
        json!({"artifact_id": created["artifact_id"].as_u64().unwrap(), "_caller_pane": terminal_id}),
    )
    .expect("browser review artifact should be delivered");

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");
    let browser = pane_entry(&observed, browser_id);
    let review_history = &browser["review_history"];
    assert_eq!(review_history["total"].as_u64(), Some(1));
    assert_eq!(
        review_history["latest"]["comment"],
        "review the empty state"
    );
    assert_eq!(review_history["latest"]["delivered"], true);
    assert_eq!(review_history["latest"]["delivery_count"].as_u64(), Some(1));

    let active_task = &observed["task_monitor"]["workspaces"][0];
    assert_eq!(active_task["browser_reviews"]["total"].as_u64(), Some(1));
    assert_eq!(
        active_task["browser_reviews"]["latest"]["pane_id"].as_u64(),
        Some(browser_id)
    );
    assert_eq!(active_task["last_event"]["kind"], "browser_review");
    assert_eq!(
        active_task["last_event"]["summary"],
        "browser review: review the empty state"
    );
}

#[test]
fn observing_workspace_reports_diff_state_as_task_event() {
    // UC-1 BR-8: task_monitor reports Diff Pane review state as a Workspace event.
    let (mut app, terminal_id) = app_with_terminal();
    let diff_id = app.layout.alloc_id();
    let mut diff = DiffPane::new_empty(diff_id, PathBuf::from("/tmp/tide-diff"));
    diff.loaded = true;
    diff.files = vec![DiffFileEntry {
        status: "M".to_string(),
        path: "src/main.rs".to_string(),
        additions: 3,
        deletions: 1,
    }];
    app.panes.insert(diff_id, PaneKind::Diff(diff));
    app.add_pane_to_dock(diff_id, Some(terminal_id));

    let observed = app
        .handle_cli_command(
            "observe-workspace",
            json!({"detail": "full", "_caller_pane": terminal_id}),
        )
        .expect("workspace observe should succeed");
    let active_task = &observed["task_monitor"]["workspaces"][0];

    assert_eq!(active_task["last_event"]["kind"], "diff_changes");
    assert_eq!(active_task["last_event"]["pane_id"].as_u64(), Some(diff_id));
    assert_eq!(active_task["last_event"]["summary"], "diff 1 files");
}

#[test]
fn find_in_editor_returns_matches_context_and_editor_metadata() {
    // UC-1 BR-10: Wrapped Agents can search owned Editor Panes as task-local work surfaces.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = app.layout.alloc_id();
    let mut editor = EditorPane::new_empty(editor_id);
    editor.editor.buffer.file_path = Some(PathBuf::from("/tmp/tide-editor/src/lib.rs"));
    editor.editor.buffer.lines = vec![
        "fn before() {}".to_string(),
        "let needle = compute();".to_string(),
        "let other = 1;".to_string(),
        "NEEDLE_AGAIN();".to_string(),
    ];
    app.panes.insert(editor_id, PaneKind::Editor(editor));
    app.add_pane_to_dock(editor_id, Some(terminal_id));
    app.assoc.associated_terminal.insert(editor_id, terminal_id);

    let found = app
        .handle_cli_command(
            "find-in-editor",
            json!({
                "pane_id": editor_id,
                "query": "needle",
                "context_lines": 1,
                "max_matches": 1,
                "_caller_pane": terminal_id
            }),
        )
        .expect("owned Editor Pane search should succeed");

    assert_eq!(found["kind"], "editor");
    assert_eq!(found["pane_id"].as_u64(), Some(editor_id));
    assert_eq!(found["file_path"], "/tmp/tide-editor/src/lib.rs");
    assert_eq!(found["mode"], "source");
    assert_eq!(found["search_scope"]["source"], "buffer");
    assert_eq!(found["search_scope"]["line_count"].as_u64(), Some(4));
    assert_eq!(found["truncation"]["total_matches"].as_u64(), Some(2));
    assert_eq!(found["truncation"]["returned_matches"].as_u64(), Some(1));
    assert_eq!(found["truncation"]["matches_truncated"], true);

    let first_match = &found["matches"][0];
    assert_eq!(first_match["line"].as_u64(), Some(1));
    assert_eq!(first_match["col"].as_u64(), Some(4));
    assert_eq!(first_match["len"].as_u64(), Some(6));
    assert_eq!(first_match["line_text"], "let needle = compute();");
    let context = first_match["context"].as_array().unwrap();
    assert_eq!(context.len(), 3);
    assert_eq!(context[0]["line"].as_u64(), Some(0));
    assert_eq!(context[2]["line"].as_u64(), Some(2));
}

#[test]
fn replace_in_editor_applies_bounded_focused_edit() {
    // UC-1 BR-11: Wrapped Agents can apply bounded focused edits to owned Editor Panes.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = app.layout.alloc_id();
    let editor_path = std::env::temp_dir().join(format!(
        "tide_replace_in_editor_{}_{}.rs",
        std::process::id(),
        editor_id
    ));
    std::fs::write(
        &editor_path,
        "let needle = 1;\nlet keep = true;\nlet needle = 2;\n",
    )
    .unwrap();
    let editor = EditorPane::open(editor_id, &editor_path).unwrap();
    app.panes.insert(editor_id, PaneKind::Editor(editor));
    app.add_pane_to_dock(editor_id, Some(terminal_id));
    app.assoc.associated_terminal.insert(editor_id, terminal_id);

    let replaced = app
        .handle_cli_command(
            "replace-in-editor",
            json!({
                "pane_id": editor_id,
                "query": "needle",
                "replacement": "renamed",
                "_caller_pane": terminal_id
            }),
        )
        .expect("owned Editor Pane replace should succeed");

    assert_eq!(replaced["ok"], true);
    assert_eq!(replaced["pane_id"].as_u64(), Some(editor_id));
    assert_eq!(replaced["kind"], "editor");
    assert_eq!(replaced["dirty_before"], false);
    assert_eq!(replaced["dirty_after"], true);
    assert_eq!(replaced["truncation"]["total_matches"].as_u64(), Some(2));
    assert_eq!(
        replaced["truncation"]["applied_replacements"].as_u64(),
        Some(1)
    );
    assert_eq!(replaced["truncation"]["matches_truncated"], true);
    assert_eq!(replaced["replacements"][0]["line"].as_u64(), Some(0));
    assert_eq!(replaced["replacements"][0]["before"], "needle");
    assert_eq!(replaced["replacements"][0]["after"], "renamed");

    let Some(PaneKind::Editor(editor)) = app.panes.get(&editor_id) else {
        panic!("editor should remain open");
    };
    assert_eq!(editor.editor.buffer.line(0), Some("let renamed = 1;"));
    assert_eq!(editor.editor.buffer.line(2), Some("let needle = 2;"));
    assert!(editor.editor.is_modified());
}

#[test]
fn observing_workspace_reports_restore_state_as_task_event() {
    // UC-1 BR-9: task_monitor reports launch/session restore state as a Workspace event.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(400.0);
    app.last_restore_event = Some(crate::state::WorkspaceRestoreEvent {
        kind: crate::state::RestoreEventKind::SessionRestored,
        crash_recovery: true,
        restored_panes: 2,
        restored_context_panes: 1,
    });

    let observed = app
        .handle_cli_command(
            "observe-workspace",
            json!({"detail": "full", "_caller_pane": terminal_id}),
        )
        .expect("workspace observe should succeed");
    let active_task = &observed["task_monitor"]["workspaces"][0];

    assert_eq!(active_task["last_event"]["kind"], "session_restore");
    assert!(active_task["last_event"]["pane_id"].is_null());
    assert_eq!(
        active_task["last_event"]["summary"],
        "session restored after crash"
    );
    assert_eq!(active_task["last_event"]["crash_recovery"], true);
    assert_eq!(
        active_task["last_event"]["restored_panes"].as_u64(),
        Some(2)
    );
    assert_eq!(
        active_task["last_event"]["restored_context_panes"].as_u64(),
        Some(1)
    );
    let resume_policy = &observed["task_monitor"]["agent_resume_policy"];
    assert_eq!(
        resume_policy["default_resume_mode"],
        "explicit_provider_cli_only"
    );
    assert_eq!(
        resume_policy["session_restore_scope"]["provider_conversations"],
        false
    );

    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.loading = true;
    }
    let observed = app
        .handle_cli_command(
            "observe-workspace",
            json!({"detail": "full", "_caller_pane": terminal_id}),
        )
        .expect("workspace observe should succeed");
    assert_eq!(
        observed["task_monitor"]["workspaces"][0]["last_event"]["kind"],
        "browser_loading"
    );
}

#[test]
fn observing_workspace_reports_browser_visual_fit() {
    // UC-1 BR-3: Browser Pane entries report visual_fit from their visible Rect.
    let (mut app, _terminal_id, browser_id) = app_with_context_browser(400.0);

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");
    let browser = pane_entry(&observed, browser_id);

    assert_eq!(browser["visual_fit"]["status"], "too_small");
    assert_eq!(browser["visual_fit"]["min_width"], 640.0);
    assert_eq!(browser["visual_fit"]["min_height"], 360.0);
    assert_eq!(
        browser["visual_fit"]["recommended_action"]["tool"],
        "tide_layout_action"
    );
    assert_eq!(
        browser["visual_fit"]["recommended_action"]["target"]["kind"],
        "terminal_context_surface"
    );
}

#[test]
fn observing_workspace_guides_layout_correction_before_browser_workarounds() {
    // UC-1 BR-5: poor Browser Pane visual fit returns Tool Selection Guidance for layout correction before browser workarounds.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(398.0);

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");
    let browser = pane_entry(&observed, browser_id);

    assert_eq!(
        browser["visual_fit"]["tool_selection"]["status"],
        "layout_correction_recommended"
    );
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["next_tool"],
        "tide_layout_action"
    );
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["action"]["target"]["owner_terminal_id"].as_u64(),
        Some(terminal_id)
    );
    let blocked_substitutes = browser["visual_fit"]["tool_selection"]["do_not_substitute"]
        .as_array()
        .expect("substitute guidance should be listed");
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "tide_browser_eval"));
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "app_internal_api_shortcuts"));
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "credential_bearing_url_shortcuts"));
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "url_parameter_shortcuts"));
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "url_shortening"));
}

#[test]
fn observing_background_browser_reports_background_runtime_without_focus_tool() {
    // UC-1 BR-5: a not-visible Browser Pane owned by a background Terminal Context Surface reports background runtime availability without guiding focus-pane.
    let (mut app, focused_terminal_id) = app_with_terminal();
    let owner_terminal_id = app
        .layout
        .split(focused_terminal_id, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(owner_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(owner_terminal_id, PaneKind::Terminal(terminal));

    let browser_id = app.layout.alloc_id();
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "http://localhost:4174".to_string(),
        )),
    );
    app.add_pane_to_dock(browser_id, Some(owner_terminal_id));
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    app.focus.focused = Some(focused_terminal_id);
    app.focus.stage_focused = Some(focused_terminal_id);
    app.compute_layout();

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");
    let browser = pane_entry(&observed, browser_id);

    assert_eq!(browser["visual_fit"]["status"], "not_visible");
    assert_eq!(browser["visual_fit"]["background_runtime_available"], true);
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["status"],
        "background_runtime_available"
    );
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["next_tool"],
        "tide_browser_observe"
    );
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["action"]["kind"],
        "background_browser_runtime"
    );
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["action"]["pane_id"].as_u64(),
        Some(browser_id)
    );
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["action"]["owner_terminal_id"].as_u64(),
        Some(owner_terminal_id)
    );
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["action"]["preserve_focus"],
        true
    );
    let active_surface_rect = app
        .dock_area_rect
        .expect("active Terminal Context Surface rect should be computed");
    let background_rect = app
        .background_browser_visual_rect_for_layout(browser_id, owner_terminal_id)
        .expect("background Browser Pane rect should be computed from owner Terminal Context Surface layout");
    assert!(background_rect.x < 0.0);
    assert!((background_rect.width - active_surface_rect.width).abs() < f32::EPSILON);
    assert!((background_rect.height - active_surface_rect.height).abs() < f32::EPSILON);
    assert!(
        !browser["visual_fit"]["tool_selection"]["do_not_substitute"]
            .as_array()
            .expect("substitute guidance should be listed")
            .iter()
            .any(|value| value == "tide_focus_pane")
    );
    assert_eq!(app.focus.stage_focused, Some(focused_terminal_id));
    assert_eq!(app.focus.focused, Some(focused_terminal_id));
}

#[test]
fn background_browser_in_inactive_tab_still_gets_offscreen_rect_for_snapshot() {
    // UC-1 BR-9: a Browser Pane that is an INACTIVE TabGroup tab in a non-focused
    // Terminal Context Surface must still receive a background offscreen rect, so it
    // navigates and installs its snapshot bridge. pane_ids() excludes inactive tabs,
    // which previously left such panes with no rect and a permanently empty snapshot.
    let (mut app, focused_terminal_id) = app_with_terminal();
    let owner_terminal_id = app
        .layout
        .split(focused_terminal_id, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(owner_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(owner_terminal_id, PaneKind::Terminal(terminal));

    // First dock pane becomes the active tab.
    let active_pane_id = app.layout.alloc_id();
    app.panes.insert(
        active_pane_id,
        PaneKind::Browser(BrowserPane::with_url(
            active_pane_id,
            "http://localhost:4100".to_string(),
        )),
    );
    app.add_pane_to_dock(active_pane_id, Some(owner_terminal_id));

    // Browser pane is added as an inactive tab behind the active one.
    let browser_id = app.layout.alloc_id();
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "http://localhost:4174".to_string(),
        )),
    );
    if let Some(PaneKind::Terminal(tp)) = app.panes.get_mut(&owner_terminal_id) {
        assert!(tp.dock_layout.add_tab(active_pane_id, browser_id));
        assert!(tp.dock_layout.set_active_tab(active_pane_id));
    }
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    app.focus.focused = Some(focused_terminal_id);
    app.focus.stage_focused = Some(focused_terminal_id);
    app.compute_layout();

    // Precondition: the browser is in the surface but is NOT the active tab.
    let tp = match app.panes.get(&owner_terminal_id) {
        Some(PaneKind::Terminal(tp)) => tp,
        _ => panic!("owner terminal missing"),
    };
    assert!(tp.dock_layout.all_pane_ids().contains(&browser_id));
    assert!(!tp.dock_layout.pane_ids().contains(&browser_id));

    let rect = app
        .background_browser_visual_rect_for_layout(browser_id, owner_terminal_id)
        .expect("inactive-tab background Browser Pane must still get an offscreen rect");
    assert!(rect.x < 0.0);
}

#[test]
fn observing_workspace_from_caller_scopes_panes_to_caller_terminal_context_surface() {
    // UC-1 BR-6: Caller-scoped workspace observe returns only the caller Terminal boundary as ordinary targets.
    let (mut app, caller_terminal_id, caller_browser_id) = app_with_context_browser(400.0);
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&caller_terminal_id) {
        terminal.dock_view_mode = crate::state::ViewMode::Split;
    }
    let other_terminal_id = app
        .layout
        .split(caller_terminal_id, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(other_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(other_terminal_id, PaneKind::Terminal(terminal));

    let other_browser_id = app.layout.alloc_id();
    app.panes.insert(
        other_browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            other_browser_id,
            "http://localhost:4174".to_string(),
        )),
    );
    app.add_pane_to_dock(other_browser_id, Some(other_terminal_id));
    app.focus.focused = Some(other_terminal_id);
    app.focus.stage_focused = Some(other_terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(other_terminal_id);
    app.compute_layout();

    let observed = app
        .handle_cli_command(
            "observe-workspace",
            json!({"_caller_pane": caller_terminal_id}),
        )
        .expect("caller-scoped workspace observe should succeed");
    let pane_ids: Vec<PaneId> = observed["panes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["pane_id"].as_u64().unwrap())
        .collect();

    assert!(pane_ids.contains(&caller_terminal_id));
    assert!(pane_ids.contains(&caller_browser_id));
    assert!(!pane_ids.contains(&other_terminal_id));
    assert!(!pane_ids.contains(&other_browser_id));
    assert_eq!(
        observed["focus"]["pane_id"].as_u64(),
        Some(caller_terminal_id)
    );
    assert_eq!(observed["focus"]["area"], "stage");

    let terminal_context_surface = observed["surfaces"]
        .as_array()
        .unwrap()
        .iter()
        .find(|surface| surface["kind"] == "terminal_context_surface")
        .expect("caller Terminal Context Surface should be reported");
    assert_eq!(
        terminal_context_surface["owner_terminal_id"].as_u64(),
        Some(caller_terminal_id)
    );
    assert_eq!(terminal_context_surface["visible"], false);
    assert!(terminal_context_surface["rect"].is_null());
    assert_eq!(observed["task_monitor"]["scoped_to_caller"], true);
    let terminal_context_summary =
        &observed["task_monitor"]["workspaces"][0]["terminals"][0]["terminal_context_surface"];
    assert_eq!(terminal_context_summary["mode"], "split");
    assert_eq!(terminal_context_summary["pane_count"].as_u64(), Some(1));
    assert_eq!(
        terminal_context_summary["focused_pane_id"].as_u64(),
        Some(caller_browser_id)
    );
}

#[test]
fn observing_workspace_compact_reports_caller_orientation_without_full_visual_payload() {
    // UC-1 BR-7: compact workspace observe gives mechanical Caller Pane orientation without full visual-fit guidance payload.
    let (mut app, caller_terminal_id, caller_browser_id) = app_with_context_browser(400.0);
    let other_terminal_id = app
        .layout
        .split(caller_terminal_id, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(other_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(other_terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(other_terminal_id);
    app.focus.stage_focused = Some(other_terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(other_terminal_id);
    app.compute_layout();

    let observed = app
        .handle_cli_command(
            "observe-workspace",
            json!({"_caller_pane": caller_terminal_id, "detail": "compact"}),
        )
        .expect("compact caller-scoped workspace observe should succeed");

    assert_eq!(observed["detail"], "compact");
    assert_eq!(
        observed["caller"]["pane_id"].as_u64(),
        Some(caller_terminal_id)
    );
    assert_eq!(
        observed["terminal_context_surface"]["owner_terminal_id"].as_u64(),
        Some(caller_terminal_id)
    );
    assert_eq!(observed["terminal_context_surface"]["visible"], false);
    assert_eq!(
        observed["terminal_context_surface"]["active_pane_id"].as_u64(),
        Some(caller_browser_id)
    );
    assert_eq!(observed["task_monitor"]["scoped_to_caller"], true);
    assert_eq!(
        observed["task_monitor"]["workspaces"][0]["pane_counts"]["total"].as_u64(),
        Some(2)
    );

    let pane_ids: Vec<PaneId> = observed["panes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["pane_id"].as_u64().unwrap())
        .collect();
    assert!(pane_ids.contains(&caller_terminal_id));
    assert!(pane_ids.contains(&caller_browser_id));
    assert!(!pane_ids.contains(&other_terminal_id));

    let browser_target = observed["browser_targets"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["pane_id"].as_u64() == Some(caller_browser_id))
        .expect("caller Browser Pane should be summarized as a target");
    assert_eq!(browser_target["visible"], false);
    assert_eq!(browser_target["visual_fit_status"], "not_visible");
    assert_eq!(browser_target["next_tool"], "tide_browser_observe");
    assert!(browser_target.get("tool_selection").is_none());
    assert!(observed.get("browser_runtime_router").is_none());
}

#[test]
fn list_panes_from_caller_scopes_to_caller_terminal_context_surface() {
    // UC-1 BR-8: Caller-scoped list-panes lists only the caller Terminal boundary.
    let (mut app, caller_terminal_id, caller_browser_id) = app_with_context_browser(400.0);
    let other_terminal_id = app
        .layout
        .split(caller_terminal_id, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(other_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(other_terminal_id, PaneKind::Terminal(terminal));

    let other_browser_id = app.layout.alloc_id();
    app.panes.insert(
        other_browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            other_browser_id,
            "http://localhost:4174".to_string(),
        )),
    );
    app.add_pane_to_dock(other_browser_id, Some(other_terminal_id));
    app.focus.focused = Some(other_terminal_id);
    app.focus.stage_focused = Some(other_terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(other_terminal_id);
    app.compute_layout();

    let listed = app
        .handle_cli_command("list-panes", json!({"_caller_pane": caller_terminal_id}))
        .expect("caller-scoped list-panes should succeed");
    let pane_ids: Vec<PaneId> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_u64().unwrap())
        .collect();

    assert!(pane_ids.contains(&caller_terminal_id));
    assert!(pane_ids.contains(&caller_browser_id));
    assert!(!pane_ids.contains(&other_terminal_id));
    assert!(!pane_ids.contains(&other_browser_id));
    assert_eq!(listed.as_array().unwrap().len(), 2);
}

#[test]
fn observing_terminal_reports_live_work_surface() {
    // UC-1 BR-10: Terminal observation exposes the live work surface as structured data for MCP agents.
    let (mut app, terminal_id) = app_with_terminal();
    {
        let terminal = match app.panes.get_mut(&terminal_id) {
            Some(PaneKind::Terminal(terminal)) => terminal,
            _ => panic!("terminal should exist"),
        };
        terminal.context.cwd = Some(PathBuf::from("/tmp/tide-observe"));
        terminal.context.shell_idle = false;
        terminal.backend.bench_sync_grid();
        terminal
            .backend
            .bench_write_to_term(b"\x1b[2J\x1b[Hneedle failure: compile broke\r\n");
        for line in 0..36 {
            terminal
                .backend
                .bench_write_to_term(format!("line {line:02} ordinary output\r\n").as_bytes());
        }
        terminal.backend.bench_write_to_term(
            b"building https://example.test\r\n\
              \x1b]8;id=docs;https://docs.example\x07docs\x1b]8;;\x07\r\n\
              done",
        );
        terminal.backend.bench_sync_grid();
        terminal.backend.bench_sync_grid();
    }

    let observed = app
        .handle_cli_command(
            "observe-terminal",
            json!({"pane_id": terminal_id, "detail": "full"}),
        )
        .expect("terminal observe should succeed");

    assert_eq!(observed["pane_id"].as_u64(), Some(terminal_id));
    assert_eq!(observed["kind"], "terminal");
    assert_eq!(observed["detail"], "full");
    assert_eq!(observed["cwd"], "/tmp/tide-observe");
    assert_eq!(observed["shell_idle"], false);
    assert!(observed["grid"]["cols"].as_u64().unwrap_or_default() >= 80);
    assert_eq!(observed["cursor"]["shape"], "block");
    assert_eq!(observed["selection"]["active"], false);
    assert!(observed["screen"]["content"]
        .as_str()
        .unwrap_or_default()
        .contains("building https://example.test"));

    let rows = observed["screen"]["rows"].as_array().unwrap();
    let url_row = rows
        .iter()
        .find(|row| {
            row["text"]
                .as_str()
                .is_some_and(|text| text.contains("example.test"))
        })
        .expect("URL row should be present");
    assert!(!url_row["urls"].as_array().unwrap().is_empty());

    let hyperlink_row = rows
        .iter()
        .find(|row| {
            row["text"]
                .as_str()
                .is_some_and(|text| text.contains("docs"))
                && !row["hyperlinks"].as_array().unwrap().is_empty()
        })
        .expect("OSC8 row should be present");
    assert_eq!(
        hyperlink_row["hyperlinks"][0]["uri"].as_str(),
        Some("https://docs.example")
    );

    let found = app
        .handle_cli_command(
            "find-in-terminal",
            json!({
                "query": "NEEDLE FAILURE",
                "context_lines": 1,
                "_caller_pane": terminal_id
            }),
        )
        .expect("terminal find should search scrollback and visible output");
    assert_eq!(found["pane_id"].as_u64(), Some(terminal_id));
    assert_eq!(found["case_sensitive"], false);
    assert!(
        found["search_scope"]["history_lines"]
            .as_u64()
            .unwrap_or_default()
            > 0
    );
    assert_eq!(found["truncation"]["total_matches"].as_u64(), Some(1));
    assert!(found["matches"][0]["line"]
        .as_str()
        .unwrap_or_default()
        .contains("needle failure"));
    assert_eq!(
        found["matches"][0]["context"]
            .as_array()
            .expect("context should be returned")
            .len(),
        3
    );
}

#[test]
fn observing_terminal_from_caller_is_scoped_to_caller_terminal() {
    // UC-1 BR-11: Wrapped Agents can observe their own live Terminal but not a sibling Terminal.
    let (mut app, caller_terminal_id) = app_with_terminal();
    let other_terminal_id = app
        .layout
        .split(caller_terminal_id, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(other_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(other_terminal_id, PaneKind::Terminal(terminal));

    let own = app
        .handle_cli_command(
            "observe-terminal",
            json!({"_caller_pane": caller_terminal_id}),
        )
        .expect("caller should observe its own Terminal by default");
    assert_eq!(own["pane_id"].as_u64(), Some(caller_terminal_id));

    let rejected = app.handle_cli_command(
        "observe-terminal",
        json!({"pane_id": other_terminal_id, "_caller_pane": caller_terminal_id}),
    );
    assert!(
        rejected.is_err(),
        "caller-scoped Terminal observation must reject sibling Terminals"
    );

    let rejected_find = app.handle_cli_command(
        "find-in-terminal",
        json!({
            "pane_id": other_terminal_id,
            "query": "anything",
            "_caller_pane": caller_terminal_id
        }),
    );
    assert!(
        rejected_find.is_err(),
        "caller-scoped Terminal find must reject sibling Terminals"
    );
}

// --- UC-2: ResizeLayoutTarget ---

#[test]
fn layout_action_resizes_terminal_context_surface_target() {
    // UC-2 BR-1 / BR-2 / BR-4 / BR-5: Terminal Context Surface width is resized through Layout Target action with surface animation.
    let (mut app, terminal_id, _browser_id) = app_with_context_browser(360.0);

    let result = app
        .handle_cli_command(
            "layout-action",
            json!({
                "action": "resize",
                "target": {
                    "kind": "terminal_context_surface",
                    "owner_terminal_id": terminal_id
                },
                "width_px": 720.0
            }),
        )
        .expect("Terminal Context Surface resize should succeed");

    assert_eq!(result["ok"], true);
    assert_eq!(result["action"], "resize");
    assert_eq!(result["target"]["kind"], "terminal_context_surface");
    assert_eq!(
        result["target"]["owner_terminal_id"].as_u64(),
        Some(terminal_id)
    );
    assert!((app.dock.dock_width - 720.0).abs() < 0.1);
    assert_eq!(result["animation"]["active"], true);
    assert_eq!(result["animation"]["from_width_px"], 360.0);
    assert_eq!(result["animation"]["to_width_px"], 720.0);
    assert!(app.dock.visibility_animation.is_some());
    assert!(app.surface_visibility_animation_active());
}

#[test]
fn layout_action_resizes_explicit_terminal_context_surface_owner_without_starting_focus() {
    // UC-2 BR-6: explicit owner_terminal_id targets that Terminal Context Surface even when another Stage Terminal is focused at command start, without moving human-visible focus.
    let (mut app, focused_terminal_id) = app_with_terminal();
    let owner_terminal_id = app
        .layout
        .split(focused_terminal_id, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(owner_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(owner_terminal_id, PaneKind::Terminal(terminal));

    let browser_id = app.layout.alloc_id();
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "http://localhost:4174".to_string(),
        )),
    );
    app.add_pane_to_dock(browser_id, Some(owner_terminal_id));
    app.dock.dock_width = 360.0;
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    app.focus.focused = Some(focused_terminal_id);
    app.focus.stage_focused = Some(focused_terminal_id);
    app.compute_layout();

    let result = app
        .handle_cli_command(
            "layout-action",
            json!({
                "action": "resize",
                "target": {
                    "kind": "terminal_context_surface",
                    "owner_terminal_id": owner_terminal_id
                },
                "width_px": 720.0
            }),
        )
        .expect("Terminal Context Surface resize should not depend on starting focus");

    assert_eq!(result["ok"], true);
    assert_eq!(
        result["target"]["owner_terminal_id"].as_u64(),
        Some(owner_terminal_id)
    );
    assert_eq!(app.focus.stage_focused, Some(focused_terminal_id));
    assert_eq!(app.focus.focused, Some(focused_terminal_id));
}

#[test]
fn layout_action_resizes_terminal_context_surface_pane_split() {
    // UC-2 BR-3: pane_split Layout Target works for Panes inside Terminal Context Surface.
    let (mut app, terminal_id, first_browser_id) = app_with_context_browser(720.0);
    let second_browser_id = app.layout.alloc_id();
    app.panes.insert(
        second_browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            second_browser_id,
            "http://localhost:5173".to_string(),
        )),
    );
    app.add_pane_to_dock(second_browser_id, Some(terminal_id));
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    app.set_active_terminal_context_stacked(false);
    app.split_transition_animation = None;
    app.compute_layout();

    let result = app
        .handle_cli_command(
            "layout-action",
            json!({
                "action": "resize",
                "target": {
                    "kind": "pane_split",
                    "pane_id": second_browser_id
                },
                "ratio": 0.7
            }),
        )
        .expect("Terminal Context Surface pane split resize should succeed");

    assert_eq!(result["ok"], true);
    assert_eq!(result["target"]["surface"], "terminal_context_surface");
    assert_eq!(
        result["target"]["owner_terminal_id"].as_u64(),
        Some(terminal_id)
    );
    assert!(result["effective_rect"]["width"].as_f64().unwrap() > 0.0);

    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("owner terminal should exist"),
    };
    match terminal
        .dock_layout
        .snapshot()
        .expect("Terminal Context Surface should be split")
    {
        crate::tide_layout::LayoutSnapshot::Split { ratio, .. } => {
            assert!((ratio - 0.7).abs() < 0.01);
        }
        _ => panic!("Terminal Context Surface should have a split snapshot"),
    }
    assert!(terminal
        .dock_layout
        .all_pane_ids()
        .contains(&first_browser_id));
    assert!(terminal
        .dock_layout
        .all_pane_ids()
        .contains(&second_browser_id));
}

// --- UC-3: RouteBrowserRuntime ---

#[test]
fn mcp_instructions_route_browsers_provider_neutrally() {
    // UC-3 BR-1 / BR-2 / BR-3: MCP guidance requires Tide Browser Pane Runtime first and keeps fallback runtimes out of the normal browser path.
    let initialize = mcp::mcp_initialize_for_test();
    let instructions = initialize["result"]["instructions"]
        .as_str()
        .unwrap_or_default();

    assert!(instructions.contains("Tide MCP Runtime"));
    assert!(instructions.contains("Codex, Claude"));
    assert!(instructions.contains("Browser Runtime Router"));
    assert!(instructions.contains("Tide Browser Pane Runtime"));
    assert!(instructions.contains("tide_observe_terminal"));
    assert!(instructions.contains("tide_find_in_terminal"));
    assert!(instructions.contains("tide_find_in_editor"));
    assert!(instructions.contains("tide_replace_in_editor"));
    assert!(instructions.contains("live Terminal work surface"));
    assert!(instructions.contains("must use Tide Browser Pane Runtime as the first runtime"));
    assert!(instructions.contains("Tool Selection Guidance"));
    assert!(instructions.contains("Browser Operation"));
    assert!(instructions.contains("tide_browser_operation"));
    assert!(instructions.contains("visual_fit.tool_selection.next_tool=tide_layout_action"));
    assert!(instructions.contains("background_runtime_available"));
    assert!(instructions.contains("preserve human-visible focus"));
    assert!(instructions.contains("human-like Browser Pane"));
    assert!(!instructions.contains("External Browser Runtime"));
    assert!(!instructions.contains("fallback reason"));
    assert!(!instructions.contains("Do not mention unavailable provider-specific browser runtimes"));
    assert!(!instructions.contains("Do not use shell/backend/API shortcuts"));
    assert!(!instructions.contains("Node REPL"));

    let tools = mcp::mcp_tool_definitions();
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_observe_workspace")
    }));
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_observe_terminal")
    }));
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_find_in_terminal")
    }));
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_find_in_editor")
    }));
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_replace_in_editor")
    }));
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_layout_action")
    }));
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_browser_operation")
    }));
}

#[test]
fn observing_workspace_reports_project_local_workspace_action_config() {
    // UC-1 BR-12: observe-workspace exposes project-local Workspace presets and action recipes.
    let tmp = tempfile::TempDir::new().expect("project temp dir");
    let project_dir = tmp.path().join("packages/app");
    fs::create_dir_all(&project_dir).expect("project subdir");
    let tide_dir = tmp.path().join(".tide");
    fs::create_dir_all(&tide_dir).expect("tide config dir");
    let config_path = tide_dir.join("workspace.json");
    fs::write(
        &config_path,
        r#"{
            "workspaces": [
                {
                    "name": "Dev",
                    "cwd": ".",
                    "command": "npm run dev",
                    "agent": "codex"
                }
            ],
            "actions": [
                {
                    "name": "test",
                    "description": "Run focused tests",
                    "command": "cargo test -p tide-app tide_mcp_runtime",
                    "cwd": "apps/terminal"
                }
            ]
        }"#,
    )
    .expect("write project config");

    let (mut app, terminal_id) = app_with_terminal();
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&terminal_id) {
        terminal.context.cwd = Some(project_dir.clone());
    }

    let observed = app
        .handle_cli_command("observe-workspace", json!({"_caller_pane": terminal_id}))
        .expect("workspace observe should succeed");
    let project_config = &observed["project_config"];
    let root = tmp.path().to_string_lossy().to_string();
    let path = config_path.to_string_lossy().to_string();

    assert_eq!(project_config["state"], "loaded");
    assert_eq!(project_config["root"].as_str(), Some(root.as_str()));
    assert_eq!(project_config["path"].as_str(), Some(path.as_str()));
    assert_eq!(project_config["workspace_count"].as_u64(), Some(1));
    assert_eq!(project_config["action_count"].as_u64(), Some(1));
    assert_eq!(project_config["workspaces"][0]["name"], "Dev");
    assert_eq!(project_config["workspaces"][0]["agent"], "codex");
    assert_eq!(project_config["actions"][0]["name"], "test");
    assert_eq!(
        project_config["actions"][0]["command"],
        "cargo test -p tide-app tide_mcp_runtime"
    );
    assert_eq!(project_config["execution"]["automatic"], false);
    assert_eq!(
        observed["task_monitor"]["project_config"]["action_count"].as_u64(),
        Some(1)
    );
}

// --- UC-5: OrientWrappedAgentToTideStructure ---

#[test]
fn mcp_instructions_describe_tide_structure_and_capabilities() {
    // UC-5 BR-1 / BR-2 / BR-3 / BR-4: MCP startup instructions orient Wrapped Agents to Tide structure and keep exact intent boundaries in tool descriptions.
    let initialize = mcp::mcp_initialize_for_test();
    let instructions = initialize["result"]["instructions"]
        .as_str()
        .unwrap_or_default();

    assert!(instructions.contains("terminal-centered task Workspace"));
    assert!(instructions.contains("Stage is the primary live Terminal area"));
    assert!(instructions.contains("Terminal Context Surface is the right-side support surface"));
    assert!(instructions.contains("FileTree View is a separate filesystem view, not a Pane"));
    assert!(instructions.contains("Workspace rail is task navigation"));
    assert!(instructions.contains("Pane kinds are Terminal, Editor, Diff, Browser, and Launcher"));
    assert!(instructions.contains("observe surfaces and Pane geometry"));
    assert!(instructions.contains("open Editor and Browser Panes"));
    assert!(instructions.contains("send keys to the Terminal"));
    assert!(instructions.contains("manage Context Artifacts"));
    assert!(instructions.contains("project_config Workspace/Action recipes"));
    assert!(
        instructions.contains("Tool descriptions define the exact intent, placement, and limits")
    );

    let tools = mcp::mcp_tool_definitions();
    let observe_description = mcp_tool_description(&tools, "tide_observe_workspace");
    assert!(observe_description.contains("project_config Workspace/Action recipes"));
}

#[test]
fn mcp_tool_definitions_do_not_expose_focus_pane_or_text_focus_transfer() {
    // UC-5 BR-12: Wrapped Agent MCP tools do not include focus transfer primitives.
    let initialize = mcp::mcp_initialize_for_test();
    let instructions = initialize["result"]["instructions"]
        .as_str()
        .unwrap_or_default();
    let tools = mcp::mcp_tool_definitions();
    let serialized_tools = serde_json::to_string(&tools).expect("tools should serialize");

    assert!(!tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_focus_pane")
    }));
    assert!(!serialized_tools.contains("tide_focus_pane"));
    assert!(!serialized_tools.contains("allow_text_focus_transfer"));
    assert!(!serialized_tools.contains("text_focus_transfer"));
    assert!(!instructions.contains("tide_focus_pane"));
    assert!(!instructions.contains("allow_text_focus_transfer"));
}

#[test]
fn open_tool_descriptions_distinguish_content_from_surface_intent() {
    // UC-5 BR-5 / BR-6: open tools describe content-opening intent instead of treating every open request as Editor or Browser creation.
    let tools = mcp::mcp_tool_definitions();

    let editor = mcp_tool_description(&tools, "tide_open_editor");
    assert!(editor.contains("Open an existing file path"));
    assert!(editor.contains("Tide Editor Pane"));
    assert!(editor.contains("caller Terminal's Terminal Context Surface"));
    assert!(editor.contains("owner_terminal_id"));
    assert!(editor.contains("without moving visible focus"));

    let browser = mcp_tool_description(&tools, "tide_open_browser");
    assert!(browser.contains("Open a URL or empty browser"));
    assert!(browser.contains("Tide Browser Pane"));
    assert!(browser.contains("caller Terminal's Terminal Context Surface"));
    assert!(browser.contains("without depending on starting UI focus"));
    assert!(browser.contains("links, pages, previews, and web inspection inside Tide"));
    assert!(browser.contains("external/default browser"));
}

#[test]
fn mcp_open_browser_in_terminal_context_surface_starts_split_transition_animation() {
    // UC-6 BR-1: MCP-opened Terminal Context Surface Panes start SplitTransitionAnimation when they create a visible split.
    let (mut app, terminal_id, _browser_id) = app_with_context_browser(360.0);
    app.set_active_terminal_context_stacked(false);
    app.split_transition_animation = None;
    app.compute_layout();

    let result = app
        .handle_cli_command("open-browser", json!({"url": "http://localhost:4175"}))
        .expect("MCP open-browser should create a Browser Pane");
    let new_id = result["pane_id"]
        .as_u64()
        .expect("open-browser should return pane_id");

    let animation = app
        .split_transition_animation
        .expect("MCP-opened Browser Pane should start a split transition");
    assert_eq!(
        animation.scope,
        SplitTransitionScope::TerminalContextSurface { terminal_id }
    );
    assert_eq!(animation.pane_id, new_id);
    assert!(app.layout_animation_active());
}

#[test]
fn mcp_open_browser_uses_caller_terminal_context_surface_without_moving_focus() {
    // UC-6 BR-3: MCP-opened Terminal Context Surface Panes use Caller Pane context for placement even when another Stage Terminal is focused at command start, without moving human-visible focus.
    let (mut app, focused_terminal_id) = app_with_terminal();
    let caller_terminal_id = app
        .layout
        .split(focused_terminal_id, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(caller_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(caller_terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(focused_terminal_id);
    app.focus.stage_focused = Some(focused_terminal_id);
    app.compute_layout();

    let result = app
        .handle_cli_command(
            "open-browser",
            json!({"url": "http://localhost:4175", "_caller_pane": caller_terminal_id}),
        )
        .expect("MCP open-browser should create a Browser Pane for Caller Pane context");
    let browser_id = result["pane_id"]
        .as_u64()
        .expect("open-browser should return pane_id");

    assert_eq!(app.terminal_owning(browser_id), Some(caller_terminal_id));
    assert_eq!(app.focus.stage_focused, Some(focused_terminal_id));
    assert_eq!(app.focus.focused, Some(focused_terminal_id));
}

#[test]
fn mcp_open_browser_from_active_caller_reveals_without_stealing_text_focus() {
    // UC-6 BR-4: an active Caller Pane can reveal a Browser Pane in its Terminal Context Surface without moving Terminal text focus.
    let (mut app, terminal_id) = app_with_terminal();
    app.dock.dock_open = false;
    app.dock.visibility_animation = None;
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);

    let result = app
        .handle_cli_command(
            "open-browser",
            json!({
                "url": "http://localhost:4175",
                "_caller_pane": terminal_id
            }),
        )
        .expect("MCP open-browser should reveal Browser Pane for active caller");
    let browser_id = result["pane_id"]
        .as_u64()
        .expect("open-browser should return pane_id");

    assert_eq!(app.terminal_owning(browser_id), Some(terminal_id));
    assert!(
        app.dock.dock_open,
        "active caller Browser Pane should reveal the Terminal Context Surface"
    );
    match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => {
            assert_eq!(
                terminal.dock_focused,
                Some(browser_id),
                "Browser Pane should be the active context Pane"
            );
            assert!(terminal.dock_layout.all_pane_ids().contains(&browser_id));
        }
        _ => panic!("caller should be a Terminal Pane"),
    }
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.focused, Some(terminal_id));
    assert_eq!(app.focus.stage_focused, Some(terminal_id));
    assert_eq!(app.router.focused(), Some(terminal_id));
}

#[test]
fn mcp_focus_pane_from_caller_preserves_text_focus_without_explicit_transfer() {
    // UC-6 BR-5: focus-pane from a Caller Pane updates context focus without moving text focus unless transfer is explicit.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(400.0);
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);

    let result = app
        .handle_cli_command(
            "focus-pane",
            json!({
                "pane_id": browser_id,
                "_caller_pane": terminal_id
            }),
        )
        .expect("MCP focus-pane should preserve text focus by default");

    assert_eq!(result["ok"], true);
    assert_eq!(result["focus_preserved"], true);
    assert_eq!(result["text_focus_transferred"], false);
    match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => {
            assert_eq!(terminal.dock_focused, Some(browser_id));
            assert!(terminal.dock_layout.all_pane_ids().contains(&browser_id));
        }
        _ => panic!("caller should be a Terminal Pane"),
    }
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.focused, Some(terminal_id));
    assert_eq!(app.focus.stage_focused, Some(terminal_id));
    assert_eq!(app.router.focused(), Some(terminal_id));
}

#[test]
fn mcp_focus_pane_from_caller_ignores_text_focus_transfer_flag() {
    // UC-6 BR-5: Caller-scoped focus-pane never lets a Wrapped Agent self-authorize human-visible text focus transfer.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(400.0);
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);

    let result = app
        .handle_cli_command(
            "focus-pane",
            json!({
                "pane_id": browser_id,
                "allow_text_focus_transfer": true,
                "_caller_pane": terminal_id
            }),
        )
        .expect("MCP focus-pane should preserve text focus for Caller Pane calls");

    assert_eq!(result["ok"], true);
    assert_eq!(result["focus_preserved"], true);
    assert_eq!(result["text_focus_transferred"], false);
    assert_eq!(result["ignored_text_focus_transfer"], true);
    match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => {
            assert_eq!(terminal.dock_focused, Some(browser_id));
            assert!(terminal.dock_layout.all_pane_ids().contains(&browser_id));
        }
        _ => panic!("caller should be a Terminal Pane"),
    }
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.focused, Some(terminal_id));
    assert_eq!(app.focus.stage_focused, Some(terminal_id));
    assert_eq!(app.router.focused(), Some(terminal_id));
}

#[test]
fn mcp_close_pane_in_terminal_context_surface_starts_split_transition_animation() {
    // UC-6 BR-2: tide_close_pane uses the split close transition path for visible Terminal Context Surface splits.
    let (mut app, terminal_id, first_browser_id) = app_with_context_browser(360.0);
    let second_browser_id = app.layout.alloc_id();
    app.panes.insert(
        second_browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            second_browser_id,
            "http://localhost:4175".to_string(),
        )),
    );
    app.add_pane_to_dock(second_browser_id, Some(terminal_id));
    app.set_active_terminal_context_stacked(false);
    app.split_transition_animation = None;
    app.compute_layout();

    app.handle_cli_command("close-pane", json!({"pane_id": second_browser_id}))
        .expect("MCP close-pane should accept a context Browser Pane");

    assert!(app.panes.contains_key(&second_browser_id));
    assert!(app.panes.contains_key(&first_browser_id));
    let animation = app
        .split_transition_animation
        .expect("MCP close-pane should start a split transition");
    assert!(animation.is_closing());
    assert_eq!(
        animation.scope,
        SplitTransitionScope::TerminalContextSurface { terminal_id }
    );
    assert_eq!(animation.pane_id, second_browser_id);
}

#[test]
fn mcp_initialize_handshake_satisfies_antigravity_client_contract() {
    // Spec: docs/specs/antigravity-wrapped-agent.md UC-2 BR-1, BR-2, BR-3, BR-4
    // Antigravity's Go MCP SDK sends initialize (protocolVersion 2025-11-25) and
    // accepts our response; the handshake was verified to deliver all tools.
    // This guards the response contract every Wrapped Agent (Antigravity included)
    // relies on: a protocolVersion, a tools capability, and serverInfo.
    let initialize = mcp::mcp_initialize_for_test();
    let result = &initialize["result"];

    let version = result["protocolVersion"].as_str().unwrap_or_default();
    assert!(
        version.starts_with("20") && version.len() == 10,
        "initialize must advertise a dated MCP protocolVersion, got {version:?}"
    );
    assert!(
        result["capabilities"]["tools"].is_object(),
        "initialize must advertise a tools capability"
    );
    assert_eq!(result["serverInfo"]["name"].as_str(), Some("tide-terminal"));

    // tools/list contract the client calls right after initialize.
    let tools = mcp::mcp_tool_definitions();
    assert!(!tools.is_empty());
    assert!(tools
        .iter()
        .all(|t| t["name"].is_string() && t["inputSchema"].is_object()));
}
