// JSON-RPC 2.0 protocol types for the Agent Gateway.

use serde::{Deserialize, Serialize};

/// An incoming JSON-RPC 2.0 request.
#[derive(Debug, Deserialize)]
pub(crate) struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// A JSON-RPC 2.0 success response.
#[derive(Debug, Serialize)]
pub(crate) struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub result: serde_json::Value,
}

/// A JSON-RPC 2.0 error response.
#[derive(Debug, Serialize)]
pub(crate) struct JsonRpcErrorResponse {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub error: JsonRpcError,
}

#[derive(Debug, Serialize)]
pub(crate) struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

impl JsonRpcResponse {
    pub fn new(id: serde_json::Value, result: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            result,
        }
    }
}

impl JsonRpcErrorResponse {
    pub fn new(id: serde_json::Value, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id,
            error: JsonRpcError { code, message },
        }
    }
}

/// Gateway command error.
#[derive(Debug)]
pub(crate) enum CliError {
    MethodNotFound(String),
    InvalidParams(String),
    PaneNotFound(u64),
    InvalidPaneKind {
        pane_id: u64,
        expected: &'static str,
        actual: &'static str,
    },
}

impl CliError {
    pub fn code(&self) -> i32 {
        match self {
            CliError::MethodNotFound(_) => -32601,
            CliError::InvalidParams(_) => -32602,
            CliError::PaneNotFound(_) => -1,
            CliError::InvalidPaneKind { .. } => -2,
        }
    }

    pub fn message(&self) -> String {
        match self {
            CliError::MethodNotFound(m) => format!("method not found: {m}"),
            CliError::InvalidParams(m) => format!("invalid params: {m}"),
            CliError::PaneNotFound(id) => format!("pane not found: {id}"),
            CliError::InvalidPaneKind {
                pane_id,
                expected,
                actual,
            } => {
                format!("pane {pane_id} is {actual}, expected {expected}")
            }
        }
    }
}
