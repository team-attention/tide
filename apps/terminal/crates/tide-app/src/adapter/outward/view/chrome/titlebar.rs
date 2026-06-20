use crate::tide_core::{Rect, Renderer, TextStyle, Vec2};

use crate::state::drag_types::HoverTarget;
use crate::theme::*;
use crate::App;
use crate::DockPort;
use crate::PaneLifecyclePort;

use super::super::raster_icons::{
    FLATICON_CONNECT, FLATICON_DOCK_CONTEXT, FLATICON_FILE_TREE, FLATICON_SETTINGS,
    FLATICON_WORKSPACE_RAIL,
};

pub(crate) fn workspace_item_indicator_status(
    _is_active: bool,
    has_running: bool,
    has_alert: bool,
    has_connected_idle: bool,
) -> Option<crate::header::AgentChromeState> {
    use crate::header::AgentChromeState;

    if has_alert {
        return Some(AgentChromeState::Attention);
    }

    if has_running {
        return Some(AgentChromeState::Running);
    }

    if has_connected_idle {
        return Some(AgentChromeState::ConnectedIdle);
    }

    None
}

pub(crate) fn workspace_item_indicator_color(
    status: impl Into<crate::header::AgentChromeState>,
    blink_time: Option<f64>,
) -> crate::tide_core::Color {
    use crate::header::AgentChromeState;

    match status.into() {
        AgentChromeState::Running => crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0),
        AgentChromeState::Attention => {
            let opacity = blink_time
                .map(|t| 0.65 + 0.35 * (t * crate::theme::AGENT_BLINK_FREQUENCY).sin() as f32)
                .unwrap_or(1.0);
            crate::tide_core::Color::new(0.95, 0.65, 0.2, opacity)
        }
        AgentChromeState::ConnectedIdle => crate::tide_core::Color::new(0.36, 0.56, 0.82, 1.0),
    }
}

pub(crate) fn integration_toggle_notification_indicator_color(
    auto_integration: bool,
    status: crate::state::NotificationAuthorizationStatus,
) -> Option<crate::tide_core::Color> {
    if !auto_integration {
        return None;
    }

    Some(match status {
        crate::state::NotificationAuthorizationStatus::Authorized
        | crate::state::NotificationAuthorizationStatus::Provisional
        | crate::state::NotificationAuthorizationStatus::Ephemeral => {
            crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0)
        }
        crate::state::NotificationAuthorizationStatus::Unknown
        | crate::state::NotificationAuthorizationStatus::NotDetermined => {
            crate::tide_core::Color::new(0.95, 0.65, 0.2, 1.0)
        }
        crate::state::NotificationAuthorizationStatus::Denied => DARK.diff_removed_gutter,
    })
}

pub(crate) fn titlebar_workspace_title(app: &App) -> String {
    let fallback = format!("Workspace {}", app.ws.active + 1);
    app.ws
        .workspaces
        .get(app.ws.active)
        .map(|workspace| workspace.name.clone())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(fallback)
}

pub(crate) fn titlebar_identity_origin_x() -> f32 {
    96.0
}

pub(crate) fn titlebar_identity_origin_x_for_window(is_fullscreen: bool) -> f32 {
    if is_fullscreen {
        PANE_PADDING
    } else {
        titlebar_identity_origin_x()
    }
}

pub(crate) fn titlebar_toggle_button_width(cell_width: f32) -> f32 {
    cell_width * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_H * 2.0
}

pub(crate) fn titlebar_toggle_button_height(cell_height: f32) -> f32 {
    cell_height * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_V * 2.0
}

pub(crate) fn titlebar_toggle_button_draws_hotkey_hint() -> bool {
    false
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TitlebarSurfaceIcon {
    WorkspaceRail,
    DockContext,
    FileTree,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TitlebarActionIcon {
    Integration,
    Settings,
}

pub(crate) fn titlebar_surface_button_icon(target: &HoverTarget) -> Option<TitlebarSurfaceIcon> {
    match target {
        HoverTarget::TitlebarWorkspace => Some(TitlebarSurfaceIcon::WorkspaceRail),
        HoverTarget::TitlebarDock => Some(TitlebarSurfaceIcon::DockContext),
        HoverTarget::TitlebarFileTree => Some(TitlebarSurfaceIcon::FileTree),
        _ => None,
    }
}

pub(crate) fn titlebar_surface_icon_text_glyph(_icon: TitlebarSurfaceIcon) -> Option<&'static str> {
    None
}

pub(crate) fn titlebar_action_button_icon(
    target: &HoverTarget,
    _dark_mode: bool,
) -> Option<TitlebarActionIcon> {
    match target {
        HoverTarget::TitlebarIntegration => Some(TitlebarActionIcon::Integration),
        HoverTarget::TitlebarSettings => Some(TitlebarActionIcon::Settings),
        _ => None,
    }
}

pub(crate) fn titlebar_action_icon_text_glyph(_icon: TitlebarActionIcon) -> Option<&'static str> {
    None
}

pub(crate) fn titlebar_surface_raster_icon_asset(
    icon: TitlebarSurfaceIcon,
) -> &'static crate::tide_renderer::RasterIconAsset {
    match icon {
        TitlebarSurfaceIcon::WorkspaceRail => &FLATICON_WORKSPACE_RAIL,
        TitlebarSurfaceIcon::DockContext => &FLATICON_DOCK_CONTEXT,
        TitlebarSurfaceIcon::FileTree => &FLATICON_FILE_TREE,
    }
}

pub(crate) fn titlebar_action_raster_icon_asset(
    icon: TitlebarActionIcon,
) -> &'static crate::tide_renderer::RasterIconAsset {
    match icon {
        TitlebarActionIcon::Integration => &FLATICON_CONNECT,
        TitlebarActionIcon::Settings => &FLATICON_SETTINGS,
    }
}

pub(crate) fn titlebar_workspace_meta_text(app: &App, workspace_index: usize) -> String {
    let mut signals = Vec::new();

    if let Some(status) = titlebar_workspace_task_status_text(app, workspace_index) {
        signals.push(status.to_string());
    }
    if let Some(event) = workspace_task_event_signal_text(app, workspace_index) {
        signals.push(event);
    }
    if let Some(surface) = workspace_terminal_context_surface_signal_text(app, workspace_index) {
        signals.push(surface);
    }
    if let Some(git) = workspace_terminal_git_signal_text(app, workspace_index) {
        signals.push(git);
    }
    if let Some(context) = workspace_context_artifact_signal_text(app, workspace_index) {
        signals.push(context);
    }
    if let Some(cwd) = workspace_terminal_cwd(app, workspace_index)
        .map(|path| crate::state::abbreviate_path(&path))
        .filter(|path| !path.is_empty())
    {
        signals.push(cwd);
    }

    signals.join(" - ")
}

pub(crate) fn titlebar_workspace_task_status_text(
    app: &App,
    workspace_index: usize,
) -> Option<&'static str> {
    workspace_stage_agent_task_state(app, workspace_index).label()
}

pub(crate) fn titlebar_workspace_attention_panel_text(app: &App) -> Option<String> {
    let (attention, running, connected) = workspace_attention_panel_counts(app);
    if attention > 0 {
        return Some(if attention == 1 {
            "1 needs attention".to_string()
        } else {
            format!("{attention} need attention")
        });
    }
    if running > 0 {
        return Some(format!("{running} running"));
    }
    if connected > 0 {
        return Some(format!("{connected} connected"));
    }
    None
}

pub(crate) fn titlebar_workspace_attention_panel_detail_text(app: &App) -> Option<String> {
    workspace_attention_panel_primary_signal(app)
}

fn titlebar_workspace_attention_panel_status(app: &App) -> Option<crate::header::AgentChromeState> {
    use crate::header::AgentChromeState;

    let (attention, running, connected) = workspace_attention_panel_counts(app);
    if attention > 0 {
        return Some(AgentChromeState::Attention);
    }
    if running > 0 {
        return Some(AgentChromeState::Running);
    }
    if connected > 0 {
        return Some(AgentChromeState::ConnectedIdle);
    }
    None
}

fn workspace_attention_panel_counts(app: &App) -> (usize, usize, usize) {
    let mut attention = 0usize;
    let mut running = 0usize;
    let mut connected = 0usize;

    for i in 0..workspace_count(app) {
        let state = workspace_stage_agent_task_state(app, i);
        let extra_attention = app
            .ws
            .workspace_extras
            .get(i)
            .is_some_and(|extras| extras.has_agent_notification);
        if state.has_needs_input || state.has_finished || extra_attention {
            attention += 1;
        } else if state.has_running {
            running += 1;
        } else if state.has_connected {
            connected += 1;
        }
    }

    (attention, running, connected)
}

fn workspace_attention_panel_primary_signal(app: &App) -> Option<String> {
    let mut fallback_running = None;
    let mut fallback_connected = None;

    for i in 0..workspace_count(app) {
        let state = workspace_stage_agent_task_state(app, i);
        let extra_attention = app
            .ws
            .workspace_extras
            .get(i)
            .is_some_and(|extras| extras.has_agent_notification);
        if state.has_needs_input || state.has_finished || extra_attention {
            return Some(workspace_attention_panel_line(
                app,
                i,
                state.label().unwrap_or("attention"),
            ));
        }
        if state.has_running && fallback_running.is_none() {
            fallback_running = Some(workspace_attention_panel_line(app, i, "running"));
        } else if state.has_connected && fallback_connected.is_none() {
            fallback_connected = Some(workspace_attention_panel_line(app, i, "connected"));
        }
    }

    fallback_running.or(fallback_connected)
}

fn workspace_attention_panel_line(
    app: &App,
    workspace_index: usize,
    fallback_status: &str,
) -> String {
    let name = workspace_display_name(app, workspace_index);
    let detail = workspace_stage_agent_event(app, workspace_index)
        .map(|event| compact_workspace_meta_signal(&event.summary))
        .unwrap_or_else(|| fallback_status.to_string());
    compact_workspace_meta_signal(&format!("{name}: {detail}"))
}

fn workspace_display_name(app: &App, workspace_index: usize) -> String {
    app.ws
        .workspaces
        .get(workspace_index)
        .map(|workspace| workspace.name.clone())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| format!("Workspace {}", workspace_index + 1))
}

fn workspace_count(app: &App) -> usize {
    app.ws.workspaces.len().max(app.ws.active + 1)
}

fn workspace_task_event_signal_text(app: &App, workspace_index: usize) -> Option<String> {
    workspace_stage_agent_event(app, workspace_index)
        .map(|event| compact_workspace_meta_signal(&event.summary))
        .or_else(|| workspace_browser_event_signal_text(app, workspace_index))
        .or_else(|| workspace_terminal_exit_signal_text(app, workspace_index))
        .or_else(|| workspace_diff_event_signal_text(app, workspace_index))
}

fn workspace_browser_event_signal_text(app: &App, workspace_index: usize) -> Option<String> {
    workspace_pane_entries(app, workspace_index)
        .into_iter()
        .filter_map(|(pane_id, pane)| match pane {
            crate::pane::PaneKind::Browser(browser) => browser_task_event_signal(pane_id, browser),
            _ => None,
        })
        .min_by_key(|(priority, _)| *priority)
        .map(|(_, summary)| summary)
}

fn browser_task_event_signal(
    _pane_id: crate::tide_core::PaneId,
    browser: &crate::pane::browser::BrowserPane,
) -> Option<(u8, String)> {
    if let Some(permission) = browser.pending_permission.as_ref() {
        return Some((
            5,
            compact_workspace_meta_signal(&format!("browser permission: {}", permission.origin)),
        ));
    }
    if let Some(certificate) = browser.pending_certificate_error.as_ref() {
        return Some((
            6,
            compact_workspace_meta_signal(&format!("browser certificate: {}", certificate.host)),
        ));
    }
    if let Some(download) = browser.download_state.as_ref() {
        return Some((
            15,
            if download.completed {
                "browser download complete".to_string()
            } else {
                "browser downloading".to_string()
            },
        ));
    }
    if browser.streaming {
        return Some((22, "render streaming".to_string()));
    }
    if browser.loading {
        return Some((25, "browser loading".to_string()));
    }

    None
}

fn workspace_diff_event_signal_text(app: &App, workspace_index: usize) -> Option<String> {
    workspace_pane_entries(app, workspace_index)
        .into_iter()
        .filter_map(|(pane_id, pane)| match pane {
            crate::pane::PaneKind::Diff(diff) => diff_task_event_signal(pane_id, diff),
            _ => None,
        })
        .min_by_key(|(priority, _)| *priority)
        .map(|(_, summary)| summary)
}

fn diff_task_event_signal(
    _pane_id: crate::tide_core::PaneId,
    diff: &crate::pane::diff::DiffPane,
) -> Option<(u8, String)> {
    if !diff.loaded {
        return Some((45, "diff loading".to_string()));
    }
    if !diff.files.is_empty() {
        return Some((50, format!("diff {} files", diff.files.len())));
    }

    None
}

fn workspace_pane_entries(
    app: &App,
    workspace_index: usize,
) -> Vec<(crate::tide_core::PaneId, &crate::pane::PaneKind)> {
    if workspace_index == app.ws.active {
        return app
            .panes
            .iter()
            .map(|(&pane_id, pane)| (pane_id, pane))
            .collect();
    }

    app.ws
        .workspaces
        .get(workspace_index)
        .map(|workspace| {
            workspace
                .panes
                .iter()
                .map(|(&pane_id, pane)| (pane_id, pane))
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkspaceStageAgentEvent {
    pane_id: crate::tide_core::PaneId,
    summary: String,
}

fn workspace_stage_agent_event(
    app: &App,
    workspace_index: usize,
) -> Option<WorkspaceStageAgentEvent> {
    let candidates = workspace_stage_agent_event_candidates(app, workspace_index);

    [
        crate::state::gateway_status::AgentStatus::NeedsInput,
        crate::state::gateway_status::AgentStatus::Idle,
        crate::state::gateway_status::AgentStatus::Running,
    ]
    .into_iter()
    .find_map(|target_status| {
        candidates.iter().find_map(|(pane_id, agent)| {
            (agent.status == Some(target_status))
                .then(|| app.agent_notification_snippets.get(pane_id))
                .flatten()
                .map(|summary| WorkspaceStageAgentEvent {
                    pane_id: *pane_id,
                    summary: summary.clone(),
                })
        })
    })
    .or_else(|| {
        candidates.iter().find_map(|(pane_id, _)| {
            app.notified_panes
                .contains(pane_id)
                .then(|| app.agent_notification_snippets.get(pane_id))
                .flatten()
                .map(|summary| WorkspaceStageAgentEvent {
                    pane_id: *pane_id,
                    summary: summary.clone(),
                })
        })
    })
}

fn workspace_stage_agent_event_candidates<'a>(
    app: &'a App,
    workspace_index: usize,
) -> Vec<(
    crate::tide_core::PaneId,
    &'a crate::state::gateway_status::AgentInfo,
)> {
    workspace_stage_terminal_pane_ids(app, workspace_index)
        .into_iter()
        .filter_map(|pane_id| {
            app.gateway
                .detected_agents
                .get(&pane_id)
                .filter(|agent| agent.wrapper_managed)
                .map(|agent| (pane_id, agent))
        })
        .collect()
}

fn workspace_stage_terminal_pane_ids(
    app: &App,
    workspace_index: usize,
) -> Vec<crate::tide_core::PaneId> {
    if workspace_index == app.ws.active {
        return app
            .panes
            .iter()
            .filter_map(|(&pane_id, pane)| {
                if matches!(pane, crate::pane::PaneKind::Terminal(_))
                    && !app.is_pane_in_dock(pane_id)
                {
                    Some(pane_id)
                } else {
                    None
                }
            })
            .collect();
    }

    let Some(workspace) = app.ws.workspaces.get(workspace_index) else {
        return Vec::new();
    };

    let stage_pane_ids = workspace.layout.all_pane_ids();
    if stage_pane_ids.is_empty() {
        workspace
            .panes
            .iter()
            .filter_map(|(&pane_id, pane)| {
                matches!(pane, crate::pane::PaneKind::Terminal(_)).then_some(pane_id)
            })
            .collect()
    } else {
        stage_pane_ids
            .into_iter()
            .filter(|pane_id| {
                matches!(
                    workspace.panes.get(pane_id),
                    Some(crate::pane::PaneKind::Terminal(_))
                )
            })
            .collect()
    }
}

fn workspace_terminal_exit_signal_text(app: &App, workspace_index: usize) -> Option<String> {
    if workspace_index == app.ws.active {
        return workspace_stage_terminal_pane_ids(app, workspace_index)
            .into_iter()
            .find_map(|pane_id| {
                terminal_pane_from_map(&app.panes, pane_id)
                    .filter(|terminal| terminal.context.child_dead)
                    .map(|_| "terminal exited".to_string())
            });
    }

    let workspace = app.ws.workspaces.get(workspace_index)?;
    workspace_stage_terminal_pane_ids(app, workspace_index)
        .into_iter()
        .find_map(|pane_id| {
            terminal_pane_from_map(&workspace.panes, pane_id)
                .filter(|terminal| terminal.context.child_dead)
                .map(|_| "terminal exited".to_string())
        })
}

fn compact_workspace_meta_signal(text: &str) -> String {
    let trimmed = text.trim();
    const MAX_CHARS: usize = 36;
    if trimmed.chars().count() <= MAX_CHARS {
        return trimmed.to_string();
    }

    let mut compact = trimmed
        .chars()
        .take(MAX_CHARS.saturating_sub(3))
        .collect::<String>();
    compact.push_str("...");
    compact
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct WorkspaceStageAgentTaskState {
    has_needs_input: bool,
    has_finished: bool,
    has_running: bool,
    has_connected: bool,
}

impl WorkspaceStageAgentTaskState {
    fn label(self) -> Option<&'static str> {
        if self.has_needs_input {
            return Some("needs input");
        }
        if self.has_finished {
            return Some("finished");
        }
        if self.has_running {
            return Some("running");
        }
        if self.has_connected {
            return Some("connected");
        }
        None
    }
}

fn workspace_stage_agent_task_state(
    app: &App,
    workspace_index: usize,
) -> WorkspaceStageAgentTaskState {
    if workspace_index == app.ws.active {
        let pane_ids = app.panes.iter().filter_map(|(&pane_id, pane)| {
            if matches!(pane, crate::pane::PaneKind::Terminal(_)) && !app.is_pane_in_dock(pane_id) {
                Some(pane_id)
            } else {
                None
            }
        });
        return workspace_stage_agent_task_state_for(app, &app.panes, pane_ids);
    }

    let Some(workspace) = app.ws.workspaces.get(workspace_index) else {
        return WorkspaceStageAgentTaskState::default();
    };

    let stage_pane_ids = workspace.layout.all_pane_ids();
    if stage_pane_ids.is_empty() {
        let pane_ids = workspace.panes.iter().filter_map(|(&pane_id, pane)| {
            if matches!(pane, crate::pane::PaneKind::Terminal(_)) {
                Some(pane_id)
            } else {
                None
            }
        });
        workspace_stage_agent_task_state_for(app, &workspace.panes, pane_ids)
    } else {
        workspace_stage_agent_task_state_for(app, &workspace.panes, stage_pane_ids.into_iter())
    }
}

fn workspace_stage_agent_task_state_for(
    app: &App,
    panes: &std::collections::HashMap<crate::tide_core::PaneId, crate::pane::PaneKind>,
    pane_ids: impl Iterator<Item = crate::tide_core::PaneId>,
) -> WorkspaceStageAgentTaskState {
    use crate::state::gateway_status::AgentStatus;

    let mut state = WorkspaceStageAgentTaskState::default();

    for pane_id in pane_ids {
        if !matches!(
            panes.get(&pane_id),
            Some(crate::pane::PaneKind::Terminal(_))
        ) {
            continue;
        }
        let Some(agent) = app
            .gateway
            .detected_agents
            .get(&pane_id)
            .filter(|agent| agent.wrapper_managed)
        else {
            continue;
        };

        match agent.status {
            Some(AgentStatus::NeedsInput) => state.has_needs_input = true,
            Some(AgentStatus::Idle) => state.has_finished = true,
            Some(AgentStatus::Running) => state.has_running = true,
            None if agent.gateway_connected => state.has_connected = true,
            None => {}
        }
    }

    state
}

fn workspace_terminal_git_signal_text(app: &App, workspace_index: usize) -> Option<String> {
    let git = workspace_terminal_git_info(app, workspace_index)?;
    if git.branch.trim().is_empty() {
        return None;
    }

    if git.status.changed_files > 0 {
        Some(format!(
            "{} {} changed",
            git.branch, git.status.changed_files
        ))
    } else {
        Some(git.branch.clone())
    }
}

fn workspace_terminal_context_surface_signal_text(
    app: &App,
    workspace_index: usize,
) -> Option<String> {
    let mut context_pane_count = 0usize;
    let mut has_split = false;

    for pane_id in workspace_stage_terminal_pane_ids(app, workspace_index) {
        let Some(terminal) = workspace_terminal_pane_by_id(app, workspace_index, pane_id) else {
            continue;
        };
        context_pane_count += terminal.dock_layout.all_pane_ids().len();
        if terminal.dock_view_mode == crate::state::ViewMode::Split {
            has_split = true;
        }
    }

    (context_pane_count > 0).then(|| {
        let mode = if has_split { "split" } else { "stacked" };
        format!("surface {} {}", mode, context_pane_count)
    })
}

fn workspace_terminal_pane_by_id(
    app: &App,
    workspace_index: usize,
    pane_id: crate::tide_core::PaneId,
) -> Option<&crate::pane::TerminalPane> {
    if workspace_index == app.ws.active {
        return terminal_pane_from_map(&app.panes, pane_id);
    }

    app.ws
        .workspaces
        .get(workspace_index)
        .and_then(|workspace| terminal_pane_from_map(&workspace.panes, pane_id))
}

fn workspace_terminal_git_info(
    app: &App,
    workspace_index: usize,
) -> Option<&crate::tide_terminal::git::GitInfo> {
    workspace_terminal_pane(app, workspace_index)
        .and_then(|terminal| terminal.context.git_info.as_ref())
}

fn workspace_terminal_pane(
    app: &App,
    workspace_index: usize,
) -> Option<&crate::pane::TerminalPane> {
    if workspace_index == app.ws.active {
        return app
            .focused_terminal_id()
            .and_then(|pane_id| terminal_pane_from_map(&app.panes, pane_id))
            .or_else(|| {
                app.focus
                    .focused
                    .and_then(|pane_id| terminal_pane_from_map(&app.panes, pane_id))
            })
            .or_else(|| {
                app.layout
                    .all_pane_ids()
                    .into_iter()
                    .find_map(|pane_id| terminal_pane_from_map(&app.panes, pane_id))
            })
            .or_else(|| app.panes.values().find_map(terminal_pane_from_kind));
    }

    let workspace = app.ws.workspaces.get(workspace_index)?;
    let preferred_terminal = app
        .ws
        .workspace_extras
        .get(workspace_index)
        .and_then(|extras| extras.stage_focused)
        .or(workspace.focused);

    preferred_terminal
        .and_then(|pane_id| terminal_pane_from_map(&workspace.panes, pane_id))
        .or_else(|| {
            workspace
                .layout
                .pane_ids()
                .into_iter()
                .find_map(|pane_id| terminal_pane_from_map(&workspace.panes, pane_id))
        })
        .or_else(|| workspace.panes.values().find_map(terminal_pane_from_kind))
}

fn terminal_pane_from_map(
    panes: &std::collections::HashMap<crate::tide_core::PaneId, crate::pane::PaneKind>,
    pane_id: crate::tide_core::PaneId,
) -> Option<&crate::pane::TerminalPane> {
    panes.get(&pane_id).and_then(terminal_pane_from_kind)
}

fn terminal_pane_from_kind(pane: &crate::pane::PaneKind) -> Option<&crate::pane::TerminalPane> {
    match pane {
        crate::pane::PaneKind::Terminal(terminal) => Some(terminal),
        _ => None,
    }
}

fn workspace_context_artifact_signal_text(app: &App, workspace_index: usize) -> Option<String> {
    let artifacts = if workspace_index == app.ws.active {
        Some(&app.context_artifacts)
    } else {
        app.ws.workspace_context_artifacts.get(workspace_index)
    }?;

    let count = artifacts.artifacts.len();
    if count == 0 {
        return None;
    }

    let delivered = artifacts
        .artifacts
        .values()
        .filter(|artifact| !artifact.deliveries.is_empty())
        .count();
    let pending = count.saturating_sub(delivered);

    if pending > 0 {
        Some(format!("ctx {} pending", pending))
    } else {
        Some(format!("ctx {} sent", delivered))
    }
}

fn workspace_terminal_cwd(app: &App, workspace_index: usize) -> Option<std::path::PathBuf> {
    if workspace_index == app.ws.active {
        return app.focused_terminal_cwd();
    }

    let workspace = app.ws.workspaces.get(workspace_index)?;
    let preferred_terminal = app
        .ws
        .workspace_extras
        .get(workspace_index)
        .and_then(|extras| extras.stage_focused)
        .or(workspace.focused);

    preferred_terminal
        .and_then(|pane_id| terminal_cwd_from_workspace(workspace, pane_id))
        .or_else(|| {
            workspace
                .layout
                .pane_ids()
                .into_iter()
                .find_map(|pane_id| terminal_cwd_from_workspace(workspace, pane_id))
        })
        .or_else(|| {
            workspace
                .panes
                .values()
                .find_map(|pane| terminal_cwd_from_pane(pane))
        })
}

fn terminal_cwd_from_workspace(
    workspace: &crate::Workspace,
    pane_id: crate::tide_core::PaneId,
) -> Option<std::path::PathBuf> {
    workspace
        .panes
        .get(&pane_id)
        .and_then(terminal_cwd_from_pane)
}

fn terminal_cwd_from_pane(pane: &crate::pane::PaneKind) -> Option<std::path::PathBuf> {
    match pane {
        crate::pane::PaneKind::Terminal(terminal) => terminal
            .context
            .cwd
            .clone()
            .or_else(|| terminal.backend.detect_cwd_fallback()),
        _ => None,
    }
}

pub(crate) fn titlebar_button_backdrop_level(is_active: bool, is_hovered: bool) -> u8 {
    match (is_active, is_hovered) {
        (false, false) => 0,
        (false, true) => 1,
        (true, false) => 2,
        (true, true) => 3,
    }
}

fn with_alpha(color: crate::tide_core::Color, alpha: f32) -> crate::tide_core::Color {
    crate::tide_core::Color::new(color.r, color.g, color.b, alpha)
}

fn draw_titlebar_button_backdrop(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    rect: Rect,
    p: &ThemePalette,
    is_active: bool,
    is_hovered: bool,
) {
    let level = titlebar_button_backdrop_level(is_active, is_hovered);
    if level == 0 {
        return;
    }

    let (fill, stroke) = match level {
        1 => (p.badge_bg, with_alpha(p.tab_text, 0.08)),
        2 => (
            with_alpha(p.dock_tab_underline, 0.16),
            with_alpha(p.dock_tab_underline, 0.36),
        ),
        _ => (
            with_alpha(p.dock_tab_underline, 0.24),
            with_alpha(p.dock_tab_underline, 0.52),
        ),
    };
    let radius = 7.0;
    renderer.draw_chrome_rounded_rect(rect, stroke, radius);
    renderer.draw_chrome_rounded_rect(
        Rect::new(
            rect.x + 1.0,
            rect.y + 1.0,
            (rect.width - 2.0).max(0.0),
            (rect.height - 2.0).max(0.0),
        ),
        fill,
        (radius - 1.0).max(0.0),
    );
}

fn draw_titlebar_surface_icon(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    icon: TitlebarSurfaceIcon,
    button_rect: Rect,
    color: crate::tide_core::Color,
) {
    if let Some(glyph) = titlebar_surface_icon_text_glyph(icon) {
        let cell = renderer.cell_size();
        let icon_w = cell.width * TITLEBAR_ICON_SCALE;
        let icon_h = cell.height * TITLEBAR_ICON_SCALE;
        renderer.draw_chrome_text_scaled(
            glyph,
            Vec2::new(
                button_rect.x + (button_rect.width - icon_w) / 2.0,
                button_rect.y + (button_rect.height - icon_h) / 2.0,
            ),
            TextStyle {
                foreground: color,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            button_rect,
            TITLEBAR_ICON_SCALE,
        );
        return;
    }

    let icon_w = 16.0_f32;
    let icon_h = 16.0_f32;
    let x = (button_rect.x + (button_rect.width - icon_w) / 2.0).round();
    let y = (button_rect.y + (button_rect.height - icon_h) / 2.0).round();
    renderer.draw_chrome_raster_icon(
        titlebar_surface_raster_icon_asset(icon),
        Rect::new(x, y, icon_w, icon_h),
        color,
    );
}

fn draw_titlebar_action_icon(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    icon: TitlebarActionIcon,
    button_rect: Rect,
    color: crate::tide_core::Color,
) {
    if titlebar_action_icon_text_glyph(icon).is_some() {
        return;
    }

    let icon_w = 16.0_f32;
    let icon_h = 16.0_f32;
    let x = (button_rect.x + (button_rect.width - icon_w) / 2.0).round();
    let y = (button_rect.y + (button_rect.height - icon_h) / 2.0).round();
    renderer.draw_chrome_raster_icon(
        titlebar_action_raster_icon_asset(icon),
        Rect::new(x, y, icon_w, icon_h),
        color,
    );
}

fn titlebar_controls_left_edge(logical_width: f32, cell_width: f32) -> f32 {
    let btn_w = titlebar_toggle_button_width(cell_width);
    logical_width - PANE_PADDING - btn_w * 5.0 - TITLEBAR_BUTTON_GAP * 4.0
}

/// Render the titlebar background, title text, icons, and toggle buttons.
/// Also renders the workspace sidebar if visible.
pub(super) fn render_titlebar_and_sidebar(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    logical: crate::tide_core::Size,
) {
    let blink_time = crate::adapter::outward::view::wrapped_agent_blink_time(
        app.ports.clock.now(),
        app.timing.wrapped_agent_blink_at,
        app.has_any_stage_wrapped_agent_alert(),
    );

    // Draw titlebar background, border, and title (macOS transparent titlebar)
    if app.window.top_inset > 0.0 {
        let tb = Rect::new(0.0, 0.0, logical.width, app.window.top_inset);
        renderer.draw_chrome_rect(tb, p.file_tree_bg);
        // Bottom border
        renderer.draw_chrome_rect(
            Rect::new(
                0.0,
                app.window.top_inset - BORDER_WIDTH,
                logical.width,
                BORDER_WIDTH,
            ),
            p.border_subtle,
        );
        // Leading identity uses the otherwise empty traffic-light lane without turning
        // the titlebar into a centered label.
        let cs = renderer.cell_size();
        {
            let title_text = titlebar_workspace_title(app);
            let meta_text = titlebar_workspace_meta_text(app, app.ws.active);
            let identity_x = titlebar_identity_origin_x_for_window(app.window.is_fullscreen);
            let controls_left = titlebar_controls_left_edge(logical.width, cs.width);
            let identity_w = (controls_left - identity_x - PANE_PADDING).max(0.0);
            let title_y = (app.window.top_inset - cs.height) / 2.0;
            if identity_w >= cs.width * 4.0 {
                let meta_reserved_w = if meta_text.is_empty() {
                    0.0
                } else {
                    let meta_cap = identity_w * 0.42;
                    if meta_cap >= cs.width * 6.0 {
                        (meta_text.chars().count() as f32 * cs.width).min(meta_cap)
                    } else {
                        0.0
                    }
                };
                let title_gap = if meta_reserved_w > 0.0 {
                    cs.width * 2.0
                } else {
                    0.0
                };
                let title_w = (identity_w - meta_reserved_w - title_gap).max(cs.width * 4.0);
                renderer.draw_chrome_text(
                    &title_text,
                    Vec2::new(identity_x, title_y),
                    TextStyle {
                        foreground: p.tab_text_focused,
                        background: None,
                        bold: false,
                        dim: false,
                        italic: false,
                        underline: false,
                    },
                    Rect::new(identity_x, title_y, title_w, cs.height),
                );
                if meta_reserved_w > 0.0 {
                    let meta_x = identity_x + title_w + title_gap;
                    renderer.draw_chrome_text(
                        &meta_text,
                        Vec2::new(meta_x, title_y),
                        TextStyle {
                            foreground: p.tab_text,
                            background: None,
                            bold: false,
                            dim: false,
                            italic: false,
                            underline: false,
                        },
                        Rect::new(meta_x, title_y, meta_reserved_w, cs.height),
                    );
                }
            }
        }
        // Right: titlebar icons
        {
            let btn_w = titlebar_toggle_button_width(cs.width);
            let btn_h = titlebar_toggle_button_height(cs.height);

            // Settings gear icon
            {
                let gear_w = btn_w;
                let gear_h = btn_h;
                let gear_x = logical.width - PANE_PADDING - gear_w;
                let gear_y = (app.window.top_inset - gear_h) / 2.0;
                let gear_rect = Rect::new(gear_x, gear_y, gear_w, gear_h);
                let gear_hovered = matches!(
                    app.interaction.hover_target,
                    Some(HoverTarget::TitlebarSettings)
                );
                let gear_color = if app.modal.config_page.is_some() {
                    p.dock_tab_underline
                } else {
                    p.tab_text
                };
                draw_titlebar_button_backdrop(
                    renderer,
                    gear_rect,
                    p,
                    app.modal.config_page.is_some(),
                    gear_hovered,
                );
                if let Some(icon) = titlebar_action_button_icon(
                    &HoverTarget::TitlebarSettings,
                    app.window.dark_mode,
                ) {
                    draw_titlebar_action_icon(renderer, icon, gear_rect, gear_color);
                }
            }

            // Titlebar toggle buttons: [Workspace] [Dock] [FileTree] [Integration] [Settings]
            // Positioned right-to-left from the settings icon
            let settings_w = btn_w;
            let settings_x = logical.width - PANE_PADDING - settings_w;

            // Integration toggle button (left of settings)
            let integ_w = btn_w;
            let integ_h = btn_h;
            let integ_x = settings_x - integ_w - TITLEBAR_BUTTON_GAP;
            let integ_y = (app.window.top_inset - integ_h) / 2.0;
            let integ_rect = Rect::new(integ_x, integ_y, integ_w, integ_h);
            {
                let is_active = app.settings.auto_integration;
                let is_hovered = matches!(
                    app.interaction.hover_target,
                    Some(HoverTarget::TitlebarIntegration)
                );
                let icon_color = if is_active {
                    p.dock_tab_underline
                } else {
                    p.tab_text
                };
                draw_titlebar_button_backdrop(renderer, integ_rect, p, is_active, is_hovered);
                if let Some(icon) = titlebar_action_button_icon(
                    &HoverTarget::TitlebarIntegration,
                    app.window.dark_mode,
                ) {
                    draw_titlebar_action_icon(renderer, icon, integ_rect, icon_color);
                }
                if let Some(indicator_color) = integration_toggle_notification_indicator_color(
                    is_active,
                    app.window.notification_authorization_status,
                ) {
                    let indicator_size = 5.0_f32;
                    let indicator_x = integ_x + integ_w - indicator_size - 3.0;
                    let indicator_y = integ_y + 3.0;
                    renderer.draw_chrome_rounded_rect(
                        Rect::new(indicator_x, indicator_y, indicator_size, indicator_size),
                        indicator_color,
                        indicator_size / 2.0,
                    );
                }
            }

            let btn_right = integ_x - TITLEBAR_BUTTON_GAP;
            // Helper: render a larger icon-only titlebar surface toggle button.
            // Returns the total width consumed.
            let render_titlebar_surface_btn =
                |renderer: &mut crate::tide_renderer::WgpuRenderer,
                 icon: TitlebarSurfaceIcon,
                 right_edge: f32,
                 is_active: bool,
                 is_hovered: bool|
                 -> f32 {
                    let btn_w = titlebar_toggle_button_width(cs.width);
                    let btn_h = titlebar_toggle_button_height(cs.height);
                    let btn_x = right_edge - btn_w;
                    let btn_y = (app.window.top_inset - btn_h) / 2.0;
                    let btn_rect = Rect::new(btn_x, btn_y, btn_w, btn_h);

                    draw_titlebar_button_backdrop(renderer, btn_rect, p, is_active, is_hovered);

                    // Icon
                    let icon_color = if is_active {
                        p.dock_tab_underline
                    } else {
                        p.tab_text
                    };
                    draw_titlebar_surface_icon(renderer, icon, btn_rect, icon_color);

                    btn_w
                };
            // Render buttons right-to-left: [FileTree] [Dock] [Workspace]
            let mut cur_right = btn_right;

            // FileTree button
            let w = render_titlebar_surface_btn(
                renderer,
                titlebar_surface_button_icon(&HoverTarget::TitlebarFileTree).unwrap(),
                cur_right,
                app.ft.visible,
                app.interaction.hover_target.as_ref() == Some(&HoverTarget::TitlebarFileTree),
            );
            cur_right -= w + TITLEBAR_BUTTON_GAP;

            // Dock button
            let w = render_titlebar_surface_btn(
                renderer,
                titlebar_surface_button_icon(&HoverTarget::TitlebarDock).unwrap(),
                cur_right,
                app.dock.dock_open,
                app.interaction.hover_target.as_ref() == Some(&HoverTarget::TitlebarDock),
            );
            cur_right -= w + TITLEBAR_BUTTON_GAP;

            // Workspace sidebar button
            let _w = render_titlebar_surface_btn(
                renderer,
                titlebar_surface_button_icon(&HoverTarget::TitlebarWorkspace).unwrap(),
                cur_right,
                app.ws.show_sidebar,
                app.interaction.hover_target.as_ref() == Some(&HoverTarget::TitlebarWorkspace),
            );
        }
    }

    // Draw workspace sidebar if visible
    if let Some(ws_rect) = app.ws.sidebar_rect {
        let cs = renderer.cell_size();
        let edge_inset = PANE_CORNER_RADIUS;

        // Focus-dependent styling (matches file_tree.rs pattern)
        let sidebar_focused = app.focus.focus_area == crate::state::FocusArea::FileTree && false; // sidebar has no FocusArea yet
        let border_color = crate::tide_core::Color::new(0.0, 0.0, 0.0, 0.0);
        let border_w = 0.0_f32;

        // Sidebar visual rect: inset from top/bottom for corner radius visibility
        let sb_border = Rect::new(
            ws_rect.x,
            ws_rect.y + edge_inset,
            ws_rect.width,
            ws_rect.height - edge_inset * 2.0,
        );

        // Shadow when focused (matches file_tree.rs pattern)
        if sidebar_focused {
            let shadow_color = crate::tide_core::Color::new(0.769, 0.722, 0.651, 0.25);
            renderer.draw_chrome_shadow(sb_border, shadow_color, PANE_CORNER_RADIUS, 16.0, -4.0);
        }

        // Outer rounded rect (border)
        renderer.draw_chrome_rounded_rect(sb_border, border_color, PANE_CORNER_RADIUS);
        // Inner fill (dynamic border width)
        let inset = Rect::new(
            sb_border.x + border_w,
            sb_border.y + border_w,
            sb_border.width - 2.0 * border_w,
            sb_border.height - 2.0 * border_w,
        );
        renderer.draw_chrome_rounded_rect(
            inset,
            p.file_tree_bg,
            (PANE_CORNER_RADIUS - border_w).max(0.0),
        );

        // Workspace items
        let geo = crate::adapter::inward::drag_drop_adapter::ws_sidebar_geometry(app).unwrap();
        let content_x = geo.content_x;
        let content_w = geo.content_w;
        let item_gap = geo.item_gap;

        // Determine available text width for compact mode detection
        let text_avail_w = content_w - WS_SIDEBAR_ITEM_PAD_H * 2.0;
        let compact = text_avail_w < cs.width * 12.0; // < 12 chars -> compact

        // Collect workspace info: for the active workspace, use live App data;
        // for others, read from the stored workspace vec.
        for i in 0..app.ws.workspaces.len() {
            let is_active = i == app.ws.active;
            let ws_name = app.ws.workspaces[i].name.clone();
            let (has_running, has_alert, has_connected_idle) = app.workspace_stage_agent_flags(i);
            let indicator_status = workspace_item_indicator_status(
                is_active,
                has_running,
                has_alert,
                has_connected_idle,
            );
            let indicator_color =
                indicator_status.map(|status| workspace_item_indicator_color(status, blink_time));

            let item_rect = geo.item_rect(i);

            // Active item: pane-bg background with accent bar (matches file_tree.rs cursor row pattern)
            if is_active {
                // Warm accent row highlight background
                let accent = p.dock_tab_underline;
                let row_bg = crate::tide_core::Color::new(accent.r, accent.g, accent.b, 0.12);
                renderer.draw_chrome_rounded_rect(item_rect, row_bg, FILE_TREE_ROW_RADIUS);
                // Left accent bar (matches file_tree.rs cursor row accent bar)
                renderer.draw_chrome_rect(
                    Rect::new(
                        item_rect.x + 2.0,
                        item_rect.y + 2.0,
                        2.0,
                        item_rect.height - 4.0,
                    ),
                    accent,
                );
            } else {
                if matches!(
                    app.interaction.hover_target,
                    Some(HoverTarget::WorkspaceSidebarItem(idx)) if idx == i
                ) {
                    // Hover highlight (matches file_tree.rs row radius)
                    renderer.draw_chrome_rounded_rect(item_rect, p.badge_bg, FILE_TREE_ROW_RADIUS);
                }
            }

            // Inline rename: when workspace_rename targets this rail item,
            // draw the InputLine text + caret in place of the static name.
            let is_renaming = matches!(
                app.modal.workspace_rename.as_ref(),
                Some(state) if state.ws_index == i
            );
            if is_renaming {
                let state = app.modal.workspace_rename.as_ref().unwrap();
                // Use the full content width for the input — no truncation
                let (text_x, text_y) = (
                    content_x + WS_SIDEBAR_ITEM_PAD_H,
                    item_rect.y + (item_rect.height - cs.height) / 2.0,
                );
                renderer.draw_chrome_text(
                    &state.input.text,
                    Vec2::new(text_x, text_y),
                    TextStyle {
                        foreground: p.tab_text_focused,
                        background: None,
                        bold: true,
                        dim: false,
                        italic: false,
                        underline: false,
                    },
                    inset,
                );
                // Caret
                let caret_chars = state.input.text[..state.input.cursor].chars().count() as f32;
                let caret_x = text_x + caret_chars * cs.width;
                renderer.draw_chrome_rect(
                    Rect::new(caret_x, text_y, 1.5, cs.height),
                    p.tab_text_focused,
                );
                continue;
            }

            // Name text -- one-line rows keep the rail useful as a dense task monitor.
            let indicator_reserved_w = if indicator_color.is_some() {
                WS_SIDEBAR_ITEM_PAD_H + 10.0
            } else {
                0.0
            };
            let meta_text = if !compact {
                titlebar_workspace_meta_text(app, i)
            } else {
                String::new()
            };
            let meta_w = if meta_text.is_empty() {
                0.0
            } else {
                (meta_text.chars().count() as f32 * cs.width).min(text_avail_w * 0.45)
            };
            let meta_gap = if meta_w > 0.0 { cs.width } else { 0.0 };
            let name_avail_w =
                (text_avail_w - indicator_reserved_w - meta_w - meta_gap).max(cs.width * 2.0);
            let display_name = if compact {
                format!("W{}", i + 1)
            } else {
                let max_chars = (name_avail_w / cs.width).floor() as usize;
                if ws_name.chars().count() > max_chars && max_chars > 1 {
                    let truncated: String =
                        ws_name.chars().take(max_chars.saturating_sub(1)).collect();
                    format!("{}…", truncated)
                } else {
                    ws_name
                }
            };
            let name_color = if is_active {
                p.tab_text_focused
            } else {
                p.ws_sidebar_text_inactive
            };
            // Center text vertically; compact mode also centers horizontally.
            let (name_text_x, name_text_y) = if compact {
                let name_w = display_name.len() as f32 * cs.width;
                (
                    content_x + (content_w - name_w) / 2.0,
                    item_rect.y + (item_rect.height - cs.height) / 2.0,
                )
            } else {
                (
                    content_x + WS_SIDEBAR_ITEM_PAD_H,
                    item_rect.y + (item_rect.height - cs.height) / 2.0,
                )
            };
            renderer.draw_chrome_text(
                &display_name,
                Vec2::new(name_text_x, name_text_y),
                TextStyle {
                    foreground: name_color,
                    background: None,
                    bold: is_active,
                    dim: false,
                    italic: false,
                    underline: false,
                },
                inset,
            );

            if !meta_text.is_empty() && meta_w > 0.0 {
                let max_chars = (meta_w / cs.width).floor() as usize;
                let display_meta = if meta_text.chars().count() > max_chars && max_chars > 1 {
                    let truncated: String = meta_text
                        .chars()
                        .take(max_chars.saturating_sub(1))
                        .collect();
                    format!("{}…", truncated)
                } else {
                    meta_text
                };
                let display_meta_w = display_meta.chars().count() as f32 * cs.width;
                let meta_x = item_rect.x + item_rect.width
                    - WS_SIDEBAR_ITEM_PAD_H
                    - indicator_reserved_w
                    - display_meta_w;
                renderer.draw_chrome_text(
                    &display_meta,
                    Vec2::new(meta_x, item_rect.y + (item_rect.height - cs.height) / 2.0),
                    TextStyle {
                        foreground: p.tab_text,
                        background: None,
                        bold: false,
                        dim: false,
                        italic: false,
                        underline: false,
                    },
                    inset,
                );
            }

            if let Some(color) = indicator_color {
                let dot_size = 8.0_f32;
                let dot_x = item_rect.x + item_rect.width - WS_SIDEBAR_ITEM_PAD_H - dot_size;
                let dot_y = item_rect.y + (item_rect.height - dot_size) / 2.0;
                renderer.draw_chrome_rounded_rect(
                    Rect::new(dot_x, dot_y, dot_size, dot_size),
                    color,
                    dot_size / 2.0,
                );
                if matches!(
                    indicator_status,
                    Some(crate::header::AgentChromeState::Attention)
                ) {
                    renderer.draw_chrome_rounded_rect(
                        Rect::new(dot_x - 2.0, dot_y - 2.0, dot_size + 4.0, dot_size + 4.0),
                        crate::tide_core::Color::new(color.r, color.g, color.b, color.a * 0.3),
                        (dot_size + 4.0) / 2.0,
                    );
                }
            }

            // Draw drag drop indicator line before this item (gap == i)
            if let Some((src, press_y, gap)) = app.ws.drag {
                let dragging =
                    (app.window.last_cursor_pos.y - press_y).abs() > crate::theme::DRAG_THRESHOLD;
                if dragging && gap == i && gap != src && gap != src + 1 {
                    let line_y = item_rect.y - item_gap / 2.0;
                    let line_rect = Rect::new(content_x + 4.0, line_y - 1.0, content_w - 8.0, 2.0);
                    renderer.draw_chrome_rounded_rect(line_rect, p.border_focused, 1.0);
                }
            }
        }

        // Draw drop indicator after the last item (gap == len)
        if let Some((src, press_y, gap)) = app.ws.drag {
            let dragging =
                (app.window.last_cursor_pos.y - press_y).abs() > crate::theme::DRAG_THRESHOLD;
            let len = app.ws.workspaces.len();
            if dragging && gap == len && gap != src + 1 {
                let last_bottom = geo.item_rect(len - 1);
                let line_y = last_bottom.y + last_bottom.height + item_gap / 2.0;
                let line_rect = Rect::new(content_x + 4.0, line_y - 1.0, content_w - 8.0, 2.0);
                renderer.draw_chrome_rounded_rect(line_rect, p.border_focused, 1.0);
            }
        }

        let btn_h = cs.height + 12.0;
        let btn_y = ws_rect.y + ws_rect.height - edge_inset - btn_h - WS_SIDEBAR_PADDING;

        if !compact {
            if let Some(summary) = titlebar_workspace_attention_panel_text(app) {
                let panel_h = cs.height * 2.0 + 14.0;
                let panel_y = btn_y - item_gap - panel_h;
                let items_end_y = if app.ws.workspaces.is_empty() {
                    geo.start_y
                } else {
                    let last = geo.item_rect(app.ws.workspaces.len() - 1);
                    last.y + last.height
                };
                if panel_y > items_end_y + item_gap {
                    let panel_rect = Rect::new(content_x, panel_y, content_w, panel_h);
                    let panel_status = titlebar_workspace_attention_panel_status(app);
                    let is_attention =
                        panel_status == Some(crate::header::AgentChromeState::Attention);
                    let panel_bg = if is_attention {
                        crate::tide_core::Color::new(0.95, 0.65, 0.2, 0.115)
                    } else {
                        p.badge_bg
                    };
                    renderer.draw_chrome_rounded_rect(panel_rect, panel_bg, FILE_TREE_ROW_RADIUS);

                    let dot_size = 7.0_f32;
                    let dot_color = workspace_item_indicator_color(
                        panel_status.unwrap_or(crate::header::AgentChromeState::ConnectedIdle),
                        blink_time,
                    );
                    let text_x = panel_rect.x + WS_SIDEBAR_ITEM_PAD_H + dot_size + 7.0;
                    let summary_y = panel_rect.y + 6.0;
                    renderer.draw_chrome_rounded_rect(
                        Rect::new(
                            panel_rect.x + WS_SIDEBAR_ITEM_PAD_H,
                            summary_y + (cs.height - dot_size) / 2.0,
                            dot_size,
                            dot_size,
                        ),
                        dot_color,
                        dot_size / 2.0,
                    );
                    renderer.draw_chrome_text(
                        &summary,
                        Vec2::new(text_x, summary_y),
                        TextStyle {
                            foreground: p.tab_text_focused,
                            background: None,
                            bold: true,
                            dim: false,
                            italic: false,
                            underline: false,
                        },
                        panel_rect,
                    );

                    if let Some(detail) = titlebar_workspace_attention_panel_detail_text(app) {
                        renderer.draw_chrome_text(
                            &detail,
                            Vec2::new(
                                panel_rect.x + WS_SIDEBAR_ITEM_PAD_H,
                                summary_y + cs.height + 2.0,
                            ),
                            TextStyle {
                                foreground: p.tab_text,
                                background: None,
                                bold: false,
                                dim: false,
                                italic: false,
                                underline: false,
                            },
                            panel_rect,
                        );
                    }
                }
            }
        }

        // "+ New Workspace" button at bottom -- use "+" when narrow
        let btn_rect = Rect::new(content_x, btn_y, content_w, btn_h);

        if matches!(
            app.interaction.hover_target,
            Some(HoverTarget::WorkspaceSidebarNewBtn)
        ) {
            renderer.draw_chrome_rounded_rect(btn_rect, p.badge_bg, FILE_TREE_ROW_RADIUS);
        }

        let btn_text = if compact { "+" } else { "+ New Workspace" };
        let btn_text_w = btn_text.len() as f32 * cs.width;
        let btn_text_x = content_x + (content_w - btn_text_w) / 2.0;
        let btn_text_y = btn_y + (btn_h - cs.height) / 2.0;
        renderer.draw_chrome_text(
            btn_text,
            Vec2::new(btn_text_x, btn_text_y),
            TextStyle {
                foreground: p.tab_text,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            inset,
        );
    }
}
