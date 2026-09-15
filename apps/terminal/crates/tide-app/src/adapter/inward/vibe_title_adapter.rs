use crate::pane::PaneKind;
use crate::GatewayPort;

pub(crate) fn handle_vibe_title_change(
    app: &mut crate::App,
    id: u64,
    previous: Option<&str>,
    title: Option<&str>,
) {
    let terminal = matches!(app.panes.get(&id), Some(PaneKind::Terminal(_)))
        || app
            .ws
            .workspaces
            .iter()
            .enumerate()
            .any(|(index, workspace)| {
                index != app.ws.active
                    && matches!(workspace.panes.get(&id), Some(PaneKind::Terminal(_)))
            });
    let Some(agent) = app.gateway.detected_agents.get(&id) else {
        return;
    };
    if !terminal
        || !agent.wrapper_managed
        || !agent.gateway_connected
        || agent.name != "Mistral Vibe"
    {
        return;
    }
    if let Some(event) = crate::domain::agent::vibe_title::lifecycle_event(previous, title) {
        // Running -> plain -> completion suffix may arrive in the same batch.
        if event == "agent-idle"
            && agent.status == Some(crate::state::gateway_status::AgentStatus::Idle)
        {
            return;
        }
        app.handle_terminal_notification(id, &format!("tide:wrapped-agent:vibe:{event}"));
    }
}
