//! Headless terminal compatibility diagnostics.
//!
//! This gives release checks and users a command they can run without opening
//! the GUI. It is deliberately fixture-based: broad enough to prove Tide's
//! documented terminal contract is wired, small enough to stay deterministic.

use serde::Serialize;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use alacritty_terminal::vte::ansi::NamedColor;

use crate::adapter::inward::cli_adapter::mcp;
use crate::pane::browser::BrowserPane;
use crate::pane::diff::{DiffFileEntry, DiffPane};
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, Selection, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::{Key, LayoutEngine, Modifiers, MouseButton, TerminalBackend};
use crate::tide_terminal::{
    apply_terminal_compat_env, ClipboardTarget, TitleChange, COLORTERM_ENV_VALUE, TERM_ENV_VALUE,
};
use crate::{App, DockPort, LayoutPort};

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompatibilityOptions {
    json: bool,
}

#[derive(Debug, Clone, Serialize)]
struct CompatibilityCase {
    name: &'static str,
    passed: bool,
    details: String,
}

#[derive(Debug, Clone, Serialize)]
struct CompatibilityReport {
    diagnostic: &'static str,
    version: &'static str,
    target: &'static str,
    passed: bool,
    cases: Vec<CompatibilityCase>,
}

pub(crate) fn run_compatibility(args: &[String]) -> i32 {
    match run_compatibility_inner(args) {
        Ok((output, passed)) => {
            println!("{output}");
            if passed {
                0
            } else {
                1
            }
        }
        Err(message) => {
            eprintln!("{message}");
            eprintln!("{}", usage());
            2
        }
    }
}

fn run_compatibility_inner(args: &[String]) -> Result<(String, bool), String> {
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        return Ok((usage(), true));
    }
    let target = args[0].as_str();
    let options = parse_options(&args[1..])?;
    let report = match target {
        "terminal" => run_terminal_compatibility().map_err(|err| err.to_string())?,
        "workbench" => run_workbench_compatibility().map_err(|err| err.to_string())?,
        _ => return Err(format!("unknown compatibility target '{}'", args[0])),
    };
    let passed = report.passed;
    if options.json {
        serde_json::to_string_pretty(&report)
            .map(|output| (output, passed))
            .map_err(|err| err.to_string())
    } else {
        Ok((format_terminal_report(&report), passed))
    }
}

fn parse_options(args: &[String]) -> Result<CompatibilityOptions, String> {
    let mut options = CompatibilityOptions { json: false };
    for arg in args {
        match arg.as_str() {
            "--json" => options.json = true,
            flag => return Err(format!("unknown compatibility option '{flag}'")),
        }
    }
    Ok(options)
}

fn run_terminal_compatibility() -> Result<CompatibilityReport, Box<dyn std::error::Error>> {
    let mut cases = Vec::new();

    let mut terminal = crate::tide_terminal::Terminal::new(80, 24)?;
    terminal.bench_sync_grid();
    terminal.bench_write_to_term(
        b"\x1b[2J\x1b[Hsmoke https://example.test\n\
          \x1b[31mred\x1b[0m\n\
          \x1b]8;id=docs;https://target.example/docs\x07link\x1b]8;;\x07\n\
          \x07\x1b]2;Tide Smoke\x07\x1b]52;c;T0s=\x07",
    );
    terminal.bench_sync_grid();
    terminal.bench_sync_grid();

    cases.push(case(
        "terminal_search",
        !terminal.search_buffer("smoke").is_empty(),
        "visible terminal text is searchable",
    ));
    cases.push(case(
        "plain_url_detection",
        terminal.url_ranges().iter().any(|row| !row.is_empty()),
        "http/https text creates URL ranges",
    ));
    cases.push(case(
        "osc8_hyperlink",
        terminal.hyperlink_ranges().iter().any(|row| {
            row.iter()
                .any(|(_, _, uri)| uri == "https://target.example/docs")
        }),
        "OSC 8 URI metadata is preserved",
    ));
    cases.push(case(
        "ansi_color",
        terminal.grid().cells.iter().flatten().any(|cell| {
            cell.character == 'r'
                && cell.style.foreground
                    == crate::tide_terminal::Terminal::named_color_to_rgb(true, NamedColor::Red)
        }),
        "ANSI named color maps into rendered grid cells",
    ));
    cases.push(case(
        "osc_title",
        terminal.drain_title() == Some(TitleChange::Set("Tide Smoke".to_string())),
        "OSC 0/2 title changes are queued",
    ));
    cases.push(case("bel", terminal.take_bell(), "BEL toggles bell state"));
    cases.push(case(
        "osc52_clipboard_write",
        terminal.drain_clipboard_writes() == vec![(ClipboardTarget::Clipboard, "OK".to_string())],
        "OSC 52 clipboard writes are decoded",
    ));

    let interactive = terminal_with_modes(&["\x1b[?1000h", "\x1b[?1006h", "\x1b[=1u"])?;
    cases.push(case(
        "sgr_mouse_reporting",
        interactive.mouse_press_to_bytes(MouseButton::Left, &Modifiers::default(), 4, 9)
            == Some(b"\x1b[<0;5;10M".to_vec()),
        "SGR mouse press uses 1-based coordinates",
    ));
    cases.push(case(
        "wheel_forwarding",
        interactive.wheel_to_bytes(true, 1, 4, 9) == Some(b"\x1b[<64;5;10M".to_vec()),
        "wheel events forward to mouse-reporting TUIs",
    ));
    cases.push(case(
        "kitty_keyboard",
        interactive.key_event_to_bytes(&Key::Enter, &Modifiers::default()) == b"\x1b[13u".to_vec(),
        "Kitty keyboard mode encodes Enter as CSI u",
    ));

    let mut env = std::collections::HashMap::new();
    apply_terminal_compat_env(&mut env, true);
    cases.push(case(
        "term_env",
        env.get("TERM").map(String::as_str) == Some(TERM_ENV_VALUE)
            && env.get("COLORTERM").map(String::as_str) == Some(COLORTERM_ENV_VALUE)
            && env.get("TERM").is_none_or(|term| !term.contains("tide")),
        "TERM stays xterm-256color with truecolor marker",
    ));

    let passed = cases.iter().all(|case| case.passed);
    Ok(CompatibilityReport {
        diagnostic: "terminal_compatibility",
        version: env!("CARGO_PKG_VERSION"),
        target: "terminal",
        passed,
        cases,
    })
}

fn run_workbench_compatibility() -> Result<CompatibilityReport, Box<dyn std::error::Error>> {
    let mut cases = Vec::new();

    cases.push(mcp_tool_contract_case());
    cases.push(observe_workspace_case()?);
    cases.push(browser_runtime_router_case()?);
    cases.push(workspace_task_monitor_case()?);
    cases.push(project_local_config_case()?);
    cases.push(observe_terminal_surface_case()?);
    cases.push(find_terminal_scrollback_case()?);
    cases.push(find_editor_buffer_case()?);
    cases.push(replace_editor_buffer_case()?);
    cases.push(caller_scoped_list_panes_case()?);
    cases.push(open_browser_context_surface_case()?);
    cases.push(context_artifact_round_trip_case()?);

    let passed = cases.iter().all(|case| case.passed);
    Ok(CompatibilityReport {
        diagnostic: "workbench_compatibility",
        version: env!("CARGO_PKG_VERSION"),
        target: "workbench",
        passed,
        cases,
    })
}

fn mcp_tool_contract_case() -> CompatibilityCase {
    let tools = mcp::mcp_tool_definitions();
    let has_tool = |name: &str| {
        tools
            .iter()
            .any(|tool| tool.get("name").and_then(|value| value.as_str()) == Some(name))
    };
    case(
        "mcp_tool_contract",
        has_tool("tide_observe_workspace")
            && has_tool("tide_observe_terminal")
            && has_tool("tide_find_in_terminal")
            && has_tool("tide_find_in_editor")
            && has_tool("tide_replace_in_editor")
            && has_tool("tide_list_panes")
            && has_tool("tide_open_browser")
            && has_tool("tide_capture_selection")
            && has_tool("tide_create_context_artifact")
            && has_tool("tide_list_context_artifacts")
            && has_tool("tide_read_context_artifact")
            && has_tool("tide_send_context_artifact"),
        "MCP tools expose workspace observe, terminal/editor find, Editor replace, pane, browser, selection, and Context Artifact surfaces",
    )
}

fn observe_workspace_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, terminal_id, browser_id) = app_with_context_browser(420.0)?;
    let observed = cli_command(
        &mut app,
        "observe-workspace",
        json!({"detail": "full", "_caller_pane": terminal_id}),
    )?;

    let surfaces = observed["surfaces"].as_array().cloned().unwrap_or_default();
    let has_stage = surfaces.iter().any(|surface| surface["kind"] == "stage");
    let context_surface = surfaces
        .iter()
        .find(|surface| surface["kind"] == "terminal_context_surface");
    let browser = pane_entry(&observed, browser_id);
    let passed = observed["runtime"] == "tide_mcp_runtime"
        && has_stage
        && context_surface.and_then(|surface| surface["owner_terminal_id"].as_u64())
            == Some(terminal_id)
        && browser.is_some_and(|entry| entry["surface"] == "terminal_context_surface");

    Ok(case(
        "observe_workspace_surfaces",
        passed,
        "observe-workspace reports Stage, Terminal Context Surface, and Browser Pane membership",
    ))
}

fn browser_runtime_router_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, terminal_id, browser_id) = app_with_context_browser(420.0)?;
    let before = cli_command(
        &mut app,
        "observe-workspace",
        json!({"detail": "full", "_caller_pane": terminal_id}),
    )?;
    let before_browser = pane_entry(&before, browser_id);

    let handoff_applied = app.apply_webview_bridge_message(
        &json!({
            "kind": "browser-external-handoff",
            "pane_id": browser_id,
            "reason": "download",
            "url": "https://example.test/report.pdf"
        })
        .to_string(),
    );
    let observed_browser = cli_command(
        &mut app,
        "browser-observe",
        json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
    )?;
    let observed_workspace = cli_command(
        &mut app,
        "observe-workspace",
        json!({"detail": "full", "_caller_pane": terminal_id}),
    )?;
    let browser_entry = pane_entry(&observed_workspace, browser_id);

    let passed = before["browser_runtime_router"]["default_runtime"] == "tide_browser_pane"
        && before["browser_runtime_router"]["external_runtime"] == "explicit_fallback_only"
        && before["browser_runtime_router"]["fallback_observable_field"]
            == "panes[].external_runtime"
        && before_browser.is_some_and(|entry| entry["external_runtime"].is_null())
        && handoff_applied
        && observed_browser["external_runtime"]["kind"] == "external_browser_runtime_handoff"
        && observed_browser["external_runtime"]["reason"] == "download"
        && observed_browser["external_runtime"]["url"] == "https://example.test/report.pdf"
        && browser_entry.is_some_and(|entry| {
            entry["external_runtime"]["kind"] == "external_browser_runtime_handoff"
                && entry["external_runtime"]["reason"] == "download"
        });

    Ok(case(
        "browser_runtime_router",
        passed,
        "Browser Runtime Router defaults to Tide Browser Pane Runtime and exposes explicit External Browser Runtime handoffs through MCP state",
    ))
}

fn workspace_task_monitor_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, terminal_id, browser_id) = app_with_context_browser(420.0)?;
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

    let observed = cli_command(
        &mut app,
        "observe-workspace",
        json!({"detail": "full", "_caller_pane": terminal_id}),
    )?;
    let task = &observed["task_monitor"]["workspaces"][0];
    let terminal_context_summary = &task["terminals"][0]["terminal_context_surface"];
    let (mut exit_app, exit_terminal_id) = app_with_terminal()?;
    if let Some(PaneKind::Terminal(terminal)) = exit_app.panes.get_mut(&exit_terminal_id) {
        terminal.context.child_dead = true;
    }
    let exit_observed = cli_command(
        &mut exit_app,
        "observe-workspace",
        json!({"detail": "full", "_caller_pane": exit_terminal_id}),
    )?;
    let exit_task = &exit_observed["task_monitor"]["workspaces"][0];
    let (mut browser_app, browser_terminal_id, browser_id) = app_with_context_browser(420.0)?;
    if let Some(PaneKind::Browser(browser)) = browser_app.panes.get_mut(&browser_id) {
        browser.loading = true;
        browser.load_progress = 0.42;
    }
    let browser_observed = cli_command(
        &mut browser_app,
        "observe-workspace",
        json!({"detail": "full", "_caller_pane": browser_terminal_id}),
    )?;
    let browser_task = &browser_observed["task_monitor"]["workspaces"][0];
    let (mut diff_app, diff_terminal_id) = app_with_terminal()?;
    let diff_id = diff_app.layout.alloc_id();
    let mut diff = DiffPane::new_empty(diff_id, std::path::PathBuf::from("/tmp/tide-diff"));
    diff.loaded = true;
    diff.files = vec![DiffFileEntry {
        status: "M".to_string(),
        path: "src/main.rs".to_string(),
        additions: 3,
        deletions: 1,
    }];
    diff_app.panes.insert(diff_id, PaneKind::Diff(diff));
    diff_app.add_pane_to_dock(diff_id, Some(diff_terminal_id));
    let diff_observed = cli_command(
        &mut diff_app,
        "observe-workspace",
        json!({"detail": "full", "_caller_pane": diff_terminal_id}),
    )?;
    let diff_task = &diff_observed["task_monitor"]["workspaces"][0];
    let (mut restore_app, restore_terminal_id, _) = app_with_context_browser(420.0)?;
    restore_app.last_restore_event = Some(crate::state::WorkspaceRestoreEvent {
        kind: crate::state::RestoreEventKind::SessionRestored,
        crash_recovery: true,
        restored_panes: 2,
        restored_context_panes: 1,
    });
    let restore_observed = cli_command(
        &mut restore_app,
        "observe-workspace",
        json!({"detail": "full", "_caller_pane": restore_terminal_id}),
    )?;
    let restore_task = &restore_observed["task_monitor"]["workspaces"][0];
    let passed = observed["task_monitor"]["kind"] == "workspace_task_monitor"
        && observed["task_monitor"]["scoped_to_caller"] == true
        && task["state"] == "needs_input"
        && task["pane_counts"]["terminal"].as_u64() == Some(1)
        && task["pane_counts"]["browser"].as_u64() == Some(1)
        && terminal_context_summary["mode"] == "stacked"
        && terminal_context_summary["pane_count"].as_u64() == Some(1)
        && terminal_context_summary["focused_pane_id"].as_u64() == Some(browser_id)
        && task["agent_counts"]["needs_input"].as_u64() == Some(1)
        && task["agent_lifecycle"]["scope"] == "caller_terminal"
        && task["agent_lifecycle"]["state"] == "needs_input"
        && task["agent_lifecycle"]["wrapper_managed"].as_u64() == Some(1)
        && task["agent_lifecycle"]["gateway_connected"].as_u64() == Some(1)
        && task["agent_lifecycle"]["notifications"]["with_snippet"].as_u64() == Some(1)
        && task["agent_lifecycle"]["notifications"]["attention"].as_u64() == Some(1)
        && task["agent_lifecycle"]["notifications"]["pending"][0]["state"] == "needs_input"
        && observed["task_monitor"]["attention_panel"]["kind"] == "workspace_attention_panel"
        && observed["task_monitor"]["attention_panel"]["visible"] == true
        && observed["task_monitor"]["attention_panel"]["unread_count"].as_u64() == Some(1)
        && observed["task_monitor"]["agent_resume_policy"]["kind"] == "agent_resume_policy"
        && observed["task_monitor"]["agent_resume_policy"]["automatic_agent_process_resume"]
            == false
        && observed["task_monitor"]["agent_resume_policy"]["provider_resume_invoked_by_tide"]
            == false
        && observed["task_monitor"]["agent_resume_policy"]["providers"]
            .as_array()
            .is_some_and(|providers| {
                ["claude", "codex", "agy", "opencode"]
                    .iter()
                    .all(|provider| {
                        providers
                            .iter()
                            .any(|entry| entry["provider"].as_str() == Some(provider))
                    })
            })
        && observed["task_monitor"]["attention_panel"]["items"][0]["pane_id"].as_u64()
            == Some(terminal_id)
        && observed["task_monitor"]["attention_panel"]["items"][0]["summary"] == "approval needed"
        && task["last_event"]["kind"] == "agent_notification"
        && task["last_event"]["pane_id"].as_u64() == Some(terminal_id)
        && task["last_event"]["summary"] == "approval needed"
        && task["context_artifacts"]["total"].as_u64() == Some(1)
        && task["context_artifacts"]["pinned"].as_u64() == Some(1)
        && task["context_artifacts"]["delivered"].as_u64() == Some(1)
        && task["context_artifacts"]["pending_delivery"].as_u64() == Some(0)
        && task["context_artifacts"]["delivery_count"].as_u64() == Some(1)
        && exit_task["last_event"]["kind"] == "terminal_exit"
        && exit_task["last_event"]["pane_id"].as_u64() == Some(exit_terminal_id)
        && exit_task["last_event"]["summary"] == "terminal exited"
        && browser_task["last_event"]["kind"] == "browser_loading"
        && browser_task["last_event"]["pane_id"].as_u64() == Some(browser_id)
        && browser_task["last_event"]["summary"] == "browser loading"
        && diff_task["last_event"]["kind"] == "diff_changes"
        && diff_task["last_event"]["pane_id"].as_u64() == Some(diff_id)
        && diff_task["last_event"]["summary"] == "diff 1 files"
        && restore_task["last_event"]["kind"] == "session_restore"
        && restore_task["last_event"]["pane_id"].is_null()
        && restore_task["last_event"]["summary"] == "session restored after crash"
        && restore_task["last_event"]["crash_recovery"] == true
        && restore_task["last_event"]["restored_panes"].as_u64() == Some(2)
        && restore_task["last_event"]["restored_context_panes"].as_u64() == Some(1);

    Ok(case(
        "workspace_task_monitor",
        passed,
        "observe-workspace includes a caller-scoped task monitor with pane, wrapped-agent lifecycle, notification, attention panel, agent resume policy, Terminal Context Surface, browser, diff, terminal-exit, restore, last-event, and Context Artifact delivery state",
    ))
}

fn observe_terminal_surface_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, terminal_id) = app_with_terminal()?;
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&terminal_id) {
        terminal.backend.bench_sync_grid();
        terminal
            .backend
            .bench_write_to_term(b"\x1b[2J\x1b[Hagent sees terminal output");
        terminal.backend.bench_sync_grid();
        terminal.backend.bench_sync_grid();
    }

    let observed = cli_command(
        &mut app,
        "observe-terminal",
        json!({"_caller_pane": terminal_id, "detail": "full"}),
    )?;
    let passed = observed["pane_id"].as_u64() == Some(terminal_id)
        && observed["kind"] == "terminal"
        && observed["screen"]["content"]
            .as_str()
            .is_some_and(|content| content.contains("agent sees terminal output"))
        && observed["cursor"]["shape"].as_str().is_some()
        && observed["grid"]["visible_rows"].as_u64().is_some()
        && observed["selection"]["active"] == false;

    Ok(case(
        "observe_terminal_surface",
        passed,
        "observe-terminal exposes the caller Terminal's visible output, cursor, grid, and selection state",
    ))
}

fn find_terminal_scrollback_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, terminal_id) = app_with_terminal()?;
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&terminal_id) {
        terminal.backend.bench_sync_grid();
        for line in 0..48 {
            let marker = if line == 6 {
                "agent-search-needle"
            } else {
                "ordinary-output"
            };
            terminal
                .backend
                .bench_write_to_term(format!("line {line:02} {marker}\r\n").as_bytes());
        }
        terminal.backend.bench_sync_grid();
        terminal.backend.bench_sync_grid();
    }

    let found = cli_command(
        &mut app,
        "find-in-terminal",
        json!({
            "query": "AGENT-SEARCH-NEEDLE",
            "context_lines": 1,
            "_caller_pane": terminal_id
        }),
    )?;
    let passed = found["pane_id"].as_u64() == Some(terminal_id)
        && found["case_sensitive"] == false
        && found["search_scope"]["history_lines"]
            .as_u64()
            .is_some_and(|lines| lines > 0)
        && found["matches"]
            .as_array()
            .is_some_and(|matches| !matches.is_empty())
        && found["matches"][0]["line"]
            .as_str()
            .is_some_and(|line| line.contains("agent-search-needle"));

    Ok(case(
        "find_terminal_scrollback",
        passed,
        "find-in-terminal searches caller Terminal scrollback and visible output with bounded results",
    ))
}

fn find_editor_buffer_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, terminal_id) = app_with_terminal()?;
    let editor_id = add_stage_editor(
        &mut app,
        terminal_id,
        &[
            "fn context() {}",
            "let agent_editor_needle = true;",
            "finish();",
        ],
    )?;
    app.assoc.associated_terminal.insert(editor_id, terminal_id);

    let found = cli_command(
        &mut app,
        "find-in-editor",
        json!({
            "pane_id": editor_id,
            "query": "AGENT_EDITOR_NEEDLE",
            "context_lines": 1,
            "_caller_pane": terminal_id
        }),
    )?;
    let passed = found["pane_id"].as_u64() == Some(editor_id)
        && found["kind"] == "editor"
        && found["case_sensitive"] == false
        && found["search_scope"]["line_count"].as_u64() == Some(3)
        && found["matches"]
            .as_array()
            .is_some_and(|matches| !matches.is_empty())
        && found["matches"][0]["line_text"]
            .as_str()
            .is_some_and(|line| line.contains("agent_editor_needle"))
        && found["matches"][0]["context"]
            .as_array()
            .is_some_and(|context| context.len() == 3);

    Ok(case(
        "find_editor_buffer",
        passed,
        "find-in-editor searches owned Editor Pane buffers with bounded context and metadata",
    ))
}

fn replace_editor_buffer_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, terminal_id) = app_with_terminal()?;
    let editor_id = add_stage_editor(
        &mut app,
        terminal_id,
        &[
            "let agent_editor_replace = 1;",
            "let untouched = true;",
            "let agent_editor_replace = 2;",
        ],
    )?;
    app.assoc.associated_terminal.insert(editor_id, terminal_id);

    let replaced = cli_command(
        &mut app,
        "replace-in-editor",
        json!({
            "pane_id": editor_id,
            "query": "AGENT_EDITOR_REPLACE",
            "replacement": "agent_editor_done",
            "_caller_pane": terminal_id
        }),
    )?;
    let first_line = app
        .panes
        .get(&editor_id)
        .and_then(|pane| match pane {
            PaneKind::Editor(editor) => editor.editor.buffer.line(0).map(str::to_string),
            _ => None,
        })
        .unwrap_or_default();
    let third_line = app
        .panes
        .get(&editor_id)
        .and_then(|pane| match pane {
            PaneKind::Editor(editor) => editor.editor.buffer.line(2).map(str::to_string),
            _ => None,
        })
        .unwrap_or_default();
    let passed = replaced["ok"] == true
        && replaced["pane_id"].as_u64() == Some(editor_id)
        && replaced["truncation"]["total_matches"].as_u64() == Some(2)
        && replaced["truncation"]["applied_replacements"].as_u64() == Some(1)
        && replaced["truncation"]["matches_truncated"] == true
        && first_line.contains("agent_editor_done")
        && third_line.contains("agent_editor_replace");

    Ok(case(
        "replace_editor_buffer",
        passed,
        "replace-in-editor applies bounded focused edits to owned Editor Pane buffers",
    ))
}

fn caller_scoped_list_panes_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, caller_terminal_id, caller_browser_id) = app_with_context_browser(420.0)?;
    let other_terminal_id = add_stage_terminal(&mut app, caller_terminal_id)?;
    let other_browser_id =
        add_context_browser(&mut app, other_terminal_id, "http://localhost:4175")?;
    app.focus.focused = Some(other_terminal_id);
    app.focus.stage_focused = Some(other_terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(other_terminal_id);
    app.compute_layout();

    let listed = cli_command(
        &mut app,
        "list-panes",
        json!({"_caller_pane": caller_terminal_id}),
    )?;
    let pane_ids: Vec<_> = listed
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry["id"].as_u64())
        .collect();
    let passed = pane_ids.contains(&caller_terminal_id)
        && pane_ids.contains(&caller_browser_id)
        && !pane_ids.contains(&other_terminal_id)
        && !pane_ids.contains(&other_browser_id);

    Ok(case(
        "caller_scoped_list_panes",
        passed,
        "list-panes is scoped to the caller Terminal's workbench boundary",
    ))
}

fn open_browser_context_surface_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, terminal_id) = app_with_terminal()?;
    let opened = cli_command(
        &mut app,
        "open-browser",
        json!({"url": "http://localhost:4176", "_caller_pane": terminal_id}),
    )?;
    let browser_id = opened["pane_id"].as_u64();
    let passed = browser_id
        .and_then(|id| {
            app.assoc
                .associated_terminal
                .get(&id)
                .copied()
                .map(|owner| (id, owner))
        })
        .is_some_and(|(_id, owner)| owner == terminal_id);

    Ok(case(
        "open_browser_context_surface",
        passed,
        "open-browser creates a Browser Pane owned by the caller Terminal Context Surface",
    ))
}

fn context_artifact_round_trip_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let (mut app, terminal_id) = app_with_terminal()?;
    let editor_id = add_stage_editor(&mut app, terminal_id, &["ship it"])?;
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 4),
        });
    }

    let created = cli_command(
        &mut app,
        "create-context-artifact",
        json!({
            "pane_id": editor_id,
            "comment": "review this",
            "pin": true,
            "_caller_pane": terminal_id
        }),
    )?;
    let artifact_id = created["artifact_id"].as_u64();
    let listed = cli_command(
        &mut app,
        "list-context-artifacts",
        json!({"_caller_pane": terminal_id}),
    )?;
    let sent = artifact_id
        .map(|id| {
            cli_command(
                &mut app,
                "send-context-artifact",
                json!({"artifact_id": id, "_caller_pane": terminal_id}),
            )
        })
        .transpose()?;
    let read = artifact_id
        .map(|id| {
            cli_command(
                &mut app,
                "read-context-artifact",
                json!({"artifact_id": id, "_caller_pane": terminal_id}),
            )
        })
        .transpose()?;

    let listed_contains = listed
        .as_array()
        .into_iter()
        .flatten()
        .any(|artifact| artifact["artifact_id"].as_u64() == artifact_id);
    let passed = created["content"] == "ship"
        && created["comment"] == "review this"
        && created["pinned"] == true
        && listed_contains
        && sent
            .as_ref()
            .is_some_and(|result| result["artifact"]["delivery_count"].as_u64() == Some(1))
        && read.is_some_and(|artifact| {
            artifact["content"] == "ship" && artifact["delivery_count"].as_u64() == Some(1)
        });

    Ok(case(
        "context_artifact_round_trip",
        passed,
        "Context Artifacts can be created from a selection, delivered with history, listed, and read by the paired agent",
    ))
}

fn project_local_config_case() -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
    let root = compatibility_temp_dir("tide-project-config");
    let result = (|| -> Result<CompatibilityCase, Box<dyn std::error::Error>> {
        let (mut app, terminal_id) = app_with_terminal()?;
        let project_dir = root.join("packages/app");
        fs::create_dir_all(&project_dir)?;
        let config_dir = root.join(".tide");
        fs::create_dir_all(&config_dir)?;
        let config_path = config_dir.join("workspace.json");
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
        )?;

        if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&terminal_id) {
            terminal.context.cwd = Some(project_dir);
        }

        let observed = cli_command(
            &mut app,
            "observe-workspace",
            json!({"_caller_pane": terminal_id}),
        )?;
        let project_config = &observed["project_config"];
        let monitor_config = &observed["task_monitor"]["project_config"];
        let root_string = root.to_string_lossy().to_string();
        let path_string = config_path.to_string_lossy().to_string();
        let passed = project_config["state"] == "loaded"
            && project_config["root"].as_str() == Some(root_string.as_str())
            && project_config["path"].as_str() == Some(path_string.as_str())
            && project_config["workspace_count"].as_u64() == Some(1)
            && project_config["workspaces"][0]["name"] == "Dev"
            && project_config["actions"][0]["command"] == "cargo test -p tide-app tide_mcp_runtime"
            && project_config["execution"]["automatic"] == false
            && monitor_config["action_count"].as_u64() == Some(1);

        Ok(case(
            "project_local_config",
            passed,
            "observe-workspace exposes .tide/workspace.json Workspace presets and Action recipes without auto-execution",
        ))
    })();

    let _ = fs::remove_dir_all(&root);
    result
}

fn terminal_with_modes(
    sequences: &[&str],
) -> Result<crate::tide_terminal::Terminal, Box<dyn std::error::Error>> {
    let terminal = crate::tide_terminal::Terminal::new(80, 24)?;
    for sequence in sequences {
        terminal.bench_write_to_term(sequence.as_bytes());
    }
    Ok(terminal)
}

fn case(name: &'static str, passed: bool, details: &str) -> CompatibilityCase {
    CompatibilityCase {
        name,
        passed,
        details: details.to_string(),
    }
}

fn format_terminal_report(report: &CompatibilityReport) -> String {
    let mut output = format!(
        "Tide compatibility: {} ({})\nversion: {}\n",
        report.target,
        if report.passed { "passed" } else { "failed" },
        report.version
    );
    for case in &report.cases {
        output.push_str(&format!(
            "[{}] {} - {}\n",
            if case.passed { "ok" } else { "fail" },
            case.name,
            case.details
        ));
    }
    output
}

fn usage() -> String {
    "\
Usage:
  tide-terminal compatibility terminal [--json]
  tide-terminal compatibility workbench [--json]

Runs deterministic headless fixtures for Tide's documented terminal contract:
search, URLs, OSC 8, ANSI color, OSC title, BEL, OSC 52 writes, mouse, wheel,
Kitty keyboard, and TERM/COLORTERM environment strategy. The workbench target
checks MCP-visible surfaces, caller scoping, Browser Pane placement,
project-local configuration exposure, and Context Artifact round-trips."
        .to_string()
}

fn compatibility_temp_dir(prefix: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("{prefix}-{}-{nonce}", std::process::id()))
}

fn app_with_terminal() -> Result<(App, u64), Box<dyn std::error::Error>> {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true)?;
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);
    app.compute_layout();
    Ok((app, terminal_id))
}

fn app_with_context_browser(
    dock_width: f32,
) -> Result<(App, u64, u64), Box<dyn std::error::Error>> {
    let (mut app, terminal_id) = app_with_terminal()?;
    app.dock.dock_width = dock_width;
    let browser_id = add_context_browser(&mut app, terminal_id, "http://localhost:4174")?;
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);
    app.compute_layout();
    Ok((app, terminal_id, browser_id))
}

fn add_stage_terminal(app: &mut App, anchor_id: u64) -> Result<u64, Box<dyn std::error::Error>> {
    let terminal_id = app
        .layout
        .split(anchor_id, crate::tide_core::SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true)?;
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    Ok(terminal_id)
}

fn add_stage_editor(
    app: &mut App,
    anchor_id: u64,
    lines: &[&str],
) -> Result<u64, Box<dyn std::error::Error>> {
    let editor_id = app
        .layout
        .split(anchor_id, crate::tide_core::SplitDirection::Vertical);
    let mut editor = EditorPane::new_empty(editor_id);
    editor.editor.buffer.lines = lines.iter().map(|line| (*line).to_string()).collect();
    app.panes.insert(editor_id, PaneKind::Editor(editor));
    Ok(editor_id)
}

fn add_context_browser(
    app: &mut App,
    terminal_id: u64,
    url: &str,
) -> Result<u64, Box<dyn std::error::Error>> {
    let browser_id = app.layout.alloc_id();
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(browser_id, url.to_string())),
    );
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.add_pane_to_dock(browser_id, Some(terminal_id));
    app.assoc
        .associated_terminal
        .insert(browser_id, terminal_id);
    Ok(browser_id)
}

fn pane_entry(observed: &serde_json::Value, pane_id: u64) -> Option<&serde_json::Value> {
    observed["panes"]
        .as_array()?
        .iter()
        .find(|entry| entry["pane_id"].as_u64() == Some(pane_id))
}

fn cli_command(
    app: &mut App,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    app.handle_cli_command(method, params)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, format!("{err:?}")).into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn terminal_compatibility_report_passes_core_fixtures() {
        let report = run_terminal_compatibility().expect("compatibility should run");

        assert!(report.passed);
        assert!(report.cases.len() >= 10);
        assert!(report
            .cases
            .iter()
            .any(|case| case.name == "term_env" && case.passed));
        assert!(report
            .cases
            .iter()
            .any(|case| case.name == "osc8_hyperlink" && case.passed));
    }

    #[test]
    fn terminal_compatibility_json_output_is_machine_readable() {
        let (output, passed) =
            run_compatibility_inner(&args(&["terminal", "--json"])).expect("compat should run");
        let value: serde_json::Value = serde_json::from_str(&output).expect("valid json");

        assert!(passed);
        assert_eq!(value["diagnostic"], "terminal_compatibility");
        assert_eq!(value["target"], "terminal");
        assert_eq!(value["passed"], true);
        assert!(value["cases"]
            .as_array()
            .is_some_and(|cases| !cases.is_empty()));
    }

    #[test]
    fn terminal_compatibility_rejects_unknown_options() {
        let err = run_compatibility_inner(&args(&["terminal", "--bogus"]))
            .expect_err("unknown flag should fail");

        assert!(err.contains("--bogus"));
    }

    #[test]
    fn workbench_compatibility_report_passes_mcp_workbench_fixtures() {
        let report = run_workbench_compatibility().expect("workbench compatibility should run");

        assert!(report.passed);
        assert_eq!(report.target, "workbench");
        assert!(report
            .cases
            .iter()
            .any(|case| case.name == "observe_workspace_surfaces" && case.passed));
        assert!(report
            .cases
            .iter()
            .any(|case| case.name == "context_artifact_round_trip" && case.passed));
        assert!(report
            .cases
            .iter()
            .any(|case| case.name == "project_local_config" && case.passed));
    }

    #[test]
    fn workbench_compatibility_json_output_is_machine_readable() {
        let (output, passed) =
            run_compatibility_inner(&args(&["workbench", "--json"])).expect("compat should run");
        let value: serde_json::Value = serde_json::from_str(&output).expect("valid json");

        assert!(passed);
        assert_eq!(value["diagnostic"], "workbench_compatibility");
        assert_eq!(value["target"], "workbench");
        assert_eq!(value["passed"], true);
    }
}
