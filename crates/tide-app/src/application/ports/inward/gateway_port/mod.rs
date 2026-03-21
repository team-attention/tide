// GatewayPort — Agent Gateway state and notifications.

use serde_json::Value;

pub(crate) trait GatewayPort {
    fn gateway_notify(&mut self, event: &str, data: Value);
    fn gateway_inc_streams(&mut self);
    fn gateway_dec_streams(&mut self);
    fn gateway_subscribe(&mut self, tx: std::sync::mpsc::Sender<String>, event_filter: Vec<String>) -> bool;
    fn take_subscribe_tx(&mut self) -> Option<std::sync::mpsc::Sender<String>>;
    fn gateway_toggle_modal(&mut self);
    fn gateway_enable_unconnected_agents(&mut self);
}
