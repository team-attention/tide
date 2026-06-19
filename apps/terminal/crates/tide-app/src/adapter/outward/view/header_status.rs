// Agent-status → header chrome visual state: status dot colors and the
// running/idle/needs-input chrome states. Extracted from header.rs; re-exported
// there so `crate::header::…` call sites are unchanged.

use std::collections::HashMap;

use crate::pane::PaneKind;
use crate::tide_core::PaneId;

use super::header::AgentChromeState;

pub(crate) fn stage_terminal_dot_color(
    state: impl Into<AgentChromeState>,
    blink_time: Option<f64>,
) -> crate::tide_core::Color {
    match state.into() {
        AgentChromeState::Running => crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0),
        AgentChromeState::Attention => {
            let opacity = blink_time
                .map(|t| 0.72 + 0.28 * (t * crate::theme::AGENT_BLINK_FREQUENCY).sin() as f32)
                .unwrap_or(0.9);
            crate::tide_core::Color::new(0.95, 0.65, 0.2, opacity)
        }
        AgentChromeState::ConnectedIdle => crate::tide_core::Color::new(0.36, 0.56, 0.82, 1.0),
    }
}

pub(crate) fn agent_status_dot_color(
    status: crate::state::gateway_status::AgentStatus,
    attention_unresolved: bool,
    blink_time: Option<f64>,
) -> crate::tide_core::Color {
    let chrome_state = match status {
        crate::state::gateway_status::AgentStatus::Idle if !attention_unresolved => {
            AgentChromeState::ConnectedIdle
        }
        _ => AgentChromeState::from(status),
    };

    match chrome_state {
        AgentChromeState::Running => crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0),
        AgentChromeState::Attention => {
            let opacity = blink_time
                .map(|t| 0.85 + 0.15 * (t * crate::theme::AGENT_BLINK_FREQUENCY).cos() as f32)
                .unwrap_or(1.0);
            crate::tide_core::Color::new(0.95, 0.65, 0.2, opacity)
        }
        AgentChromeState::ConnectedIdle => crate::tide_core::Color::new(0.3, 0.55, 0.95, 1.0),
    }
}

pub(crate) fn terminal_chrome_agent_status(
    panes: &HashMap<PaneId, PaneKind>,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    pane_id: PaneId,
) -> Option<crate::state::gateway_status::AgentStatus> {
    match panes.get(&pane_id) {
        Some(PaneKind::Terminal(_)) => detected_agents
            .get(&pane_id)
            .filter(|agent| agent.wrapper_managed)
            .and_then(|agent| agent.status),
        _ => None,
    }
}

pub(crate) fn terminal_chrome_visual_state(
    panes: &HashMap<PaneId, PaneKind>,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    pane_id: PaneId,
) -> Option<AgentChromeState> {
    match panes.get(&pane_id) {
        Some(PaneKind::Terminal(_)) => detected_agents
            .get(&pane_id)
            .filter(|agent| agent.wrapper_managed)
            .and_then(|agent| match agent.status {
                Some(status) => Some(AgentChromeState::from(status)),
                None if agent.gateway_connected => Some(AgentChromeState::ConnectedIdle),
                None => None,
            }),
        _ => None,
    }
}

pub(crate) fn pane_agent_chrome_visual_state(
    panes: &HashMap<PaneId, PaneKind>,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    pane_id: PaneId,
) -> Option<AgentChromeState> {
    match panes.get(&pane_id) {
        Some(PaneKind::Browser(browser)) if browser.agent_browser_control_mode().is_some() => {
            Some(AgentChromeState::Running)
        }
        Some(PaneKind::Terminal(_)) => {
            terminal_chrome_visual_state(panes, detected_agents, pane_id)
        }
        _ => None,
    }
}

pub(crate) fn stage_terminal_dot_status(
    panes: &HashMap<PaneId, PaneKind>,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    pane_id: PaneId,
    is_stage_surface: bool,
) -> Option<crate::state::gateway_status::AgentStatus> {
    if !is_stage_surface {
        return None;
    }

    terminal_chrome_agent_status(panes, detected_agents, pane_id)
}

pub(crate) fn stage_terminal_dot_visual_state(
    panes: &HashMap<PaneId, PaneKind>,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    pane_id: PaneId,
    is_stage_surface: bool,
) -> Option<AgentChromeState> {
    if !is_stage_surface {
        return None;
    }

    terminal_chrome_visual_state(panes, detected_agents, pane_id)
}
