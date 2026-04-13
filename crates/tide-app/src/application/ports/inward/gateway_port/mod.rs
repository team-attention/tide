// GatewayPort — Agent Gateway state and notifications.

use serde_json::Value;

use crate::state::gateway_status::AgentInfo;

pub(crate) trait GatewayPort {
    fn gateway_notify(&mut self, event: &str, data: Value);
    fn gateway_inc_streams(&mut self);
    fn gateway_dec_streams(&mut self);
    fn gateway_subscribe(
        &mut self,
        owner_pane_id: Option<crate::tide_core::PaneId>,
        tx: std::sync::mpsc::Sender<String>,
        event_filter: Vec<String>,
    ) -> bool;
    fn take_subscribe_tx(&mut self) -> Option<std::sync::mpsc::Sender<String>>;
    fn toggle_auto_integration(&mut self);
    /// Mutable access to detected agents map for status updates.
    fn detected_agents_mut(&mut self) -> &mut std::collections::HashMap<u64, AgentInfo>;
    /// Set or clear the stored notification snippet for a wrapped-agent Pane.
    fn set_agent_notification_snippet(
        &mut self,
        pane_id: u64,
        notification_snippet: Option<String>,
    );
    /// Handle a terminal notification (OSC 9) message for a pane.
    fn handle_terminal_notification(&mut self, pane_id: u64, message: &str);
    /// Route agent notification to appropriate channels based on user context.
    fn route_agent_notification(
        &mut self,
        pane_id: u64,
        status: crate::state::gateway_status::AgentStatus,
        notification_snippet: Option<String>,
    );
}
