// Agent Gateway: Unix socket server + CLI command dispatch.
//
// The socket server runs on a background thread, accepting connections and
// parsing JSON-RPC 2.0 requests. Each request is enqueued as a CliCommand
// into the app event loop's mpsc channel for single-threaded dispatch.

pub(crate) mod client;
pub(crate) mod commands;
pub(crate) mod mcp;
pub(crate) mod notify;
pub(crate) mod protocol;
pub(crate) mod server;

use std::sync::mpsc;

/// A command received from an external process via the Agent Gateway socket.
/// Enqueued into the app event loop for single-threaded dispatch.
pub(crate) struct CliCommand {
    pub method: String,
    pub params: serde_json::Value,
    pub response_tx: mpsc::Sender<Result<serde_json::Value, protocol::CliError>>,
    /// For subscribe commands: channel to push event notifications to the client.
    pub notification_tx: Option<mpsc::Sender<String>>,
}

/// A gateway event notification pushed to subscribers.
#[derive(Debug, Clone)]
pub(crate) struct GatewayEvent {
    pub event_type: String,
    pub data: serde_json::Value,
}
