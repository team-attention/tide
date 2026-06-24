// Wrapped-Agent notification interpretation: turning provider hook payloads
// (codex / claude) into human-readable notification snippets and turn
// resolutions. This is Wrapped-Agent domain knowledge, not transport — the
// gateway adapter just hands the payloads over.

use serde::Deserialize;
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

pub(crate) fn wrapped_agent_notification_snippet_from_payload(
    event: &str,
    agent_hint: &str,
    payload: Option<&Value>,
) -> Option<String> {
    match agent_hint {
        "codex" if event == "codex-turn-complete" => payload
            .and_then(codex_completed_turn_notification_snippet)
            .and_then(|text| crate::state::gateway_status::normalize_notification_snippet(&text)),
        "codex" if event == "agent-needs-input" => payload
            .and_then(codex_permission_request_notification_snippet)
            .and_then(|text| crate::state::gateway_status::normalize_notification_snippet(&text)),
        "claude" => payload
            .and_then(claude_notification_snippet)
            .and_then(|text| crate::state::gateway_status::normalize_notification_snippet(&text)),
        _ => None,
    }
}

fn codex_completed_turn_notification_snippet(payload: &Value) -> Option<String> {
    serde_json::from_value::<CodexCompletedTurnPayload>(payload.clone())
        .ok()
        .and_then(|payload| {
            if payload.payload_type == "agent-turn-complete" {
                payload.last_assistant_message
            } else {
                None
            }
        })
}

pub(crate) fn codex_stop_notification_snippet(resolution: &CodexStopResolution) -> Option<String> {
    match resolution {
        CodexStopResolution::IgnoreSubagent => None,
        CodexStopResolution::Resolved { assistant_message } => assistant_message
            .as_deref()
            .and_then(crate::state::gateway_status::normalize_notification_snippet),
    }
}

fn codex_permission_request_notification_snippet(payload: &Value) -> Option<String> {
    serde_json::from_value::<CodexPermissionRequestHookPayload>(payload.clone())
        .ok()
        .and_then(|payload| {
            if payload
                .hook_event_name
                .as_deref()
                .is_some_and(|event_name| {
                    event_name != "PermissionRequest" && event_name != "permissionRequest"
                })
            {
                return None;
            }
            payload.tool_input.and_then(|tool_input| {
                tool_input.description.or_else(|| {
                    tool_input
                        .command
                        .map(|command| format!("Approve command: {command}"))
                })
            })
        })
}

fn claude_notification_snippet(payload: &Value) -> Option<String> {
    serde_json::from_value::<ClaudeHookPayload>(payload.clone())
        .ok()
        .and_then(|payload| payload.message)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct CodexCompletedTurnPayload {
    #[serde(rename = "type")]
    payload_type: String,
    #[serde(default)]
    #[allow(dead_code)]
    input_messages: Vec<String>,
    last_assistant_message: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct CodexStopHookPayload {
    #[serde(alias = "hook-event-name")]
    hook_event_name: Option<String>,
    #[serde(alias = "transcript-path")]
    transcript_path: Option<PathBuf>,
    #[serde(alias = "last-assistant-message")]
    last_assistant_message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexPermissionRequestHookPayload {
    #[serde(alias = "hook-event-name")]
    hook_event_name: Option<String>,
    tool_input: Option<CodexPermissionRequestToolInput>,
}

#[derive(Debug, Deserialize)]
struct CodexPermissionRequestToolInput {
    command: Option<String>,
    description: Option<String>,
}

#[derive(Debug)]
pub(crate) enum CodexStopResolution {
    IgnoreSubagent,
    Resolved { assistant_message: Option<String> },
}

#[derive(Debug)]
enum CodexTranscriptResolution {
    IgnoreSubagent,
    MainThreadMessage(Option<String>),
}

#[derive(Debug, Deserialize)]
struct ClaudeHookPayload {
    message: Option<String>,
}

pub(crate) fn resolve_codex_stop_payload(payload: Option<&Value>) -> CodexStopResolution {
    let Some(payload) = payload else {
        return CodexStopResolution::Resolved {
            assistant_message: None,
        };
    };
    let Ok(payload) = serde_json::from_value::<CodexStopHookPayload>(payload.clone()) else {
        return CodexStopResolution::Resolved {
            assistant_message: None,
        };
    };
    if payload
        .hook_event_name
        .as_deref()
        .is_some_and(|event_name| event_name != "Stop")
    {
        return CodexStopResolution::Resolved {
            assistant_message: None,
        };
    }

    if let Some(transcript_path) = payload.transcript_path.as_deref() {
        match read_codex_transcript_resolution(transcript_path) {
            Some(CodexTranscriptResolution::IgnoreSubagent) => {
                return CodexStopResolution::IgnoreSubagent;
            }
            Some(CodexTranscriptResolution::MainThreadMessage(assistant_message)) => {
                return CodexStopResolution::Resolved {
                    assistant_message: assistant_message.or(payload.last_assistant_message),
                };
            }
            None => {}
        }
    }

    CodexStopResolution::Resolved {
        assistant_message: payload.last_assistant_message,
    }
}

fn read_codex_transcript_resolution(
    transcript_path: &std::path::Path,
) -> Option<CodexTranscriptResolution> {
    let file = File::open(transcript_path).ok()?;
    let reader = BufReader::new(file);
    let mut last_assistant_message = None;
    let mut response_item_final_assistant_message = None;
    let mut event_msg_final_assistant_message = None;
    let mut task_complete_assistant_message = None;

    for line in reader.lines() {
        let line = line.ok()?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(trimmed).ok()?;

        if value.get("type").and_then(Value::as_str) == Some("session_meta")
            && value.pointer("/payload/source/subagent").is_some()
        {
            return Some(CodexTranscriptResolution::IgnoreSubagent);
        }

        let Some(payload) = value.get("payload") else {
            continue;
        };

        match value.get("type").and_then(Value::as_str) {
            Some("response_item") => {
                if payload.get("type").and_then(Value::as_str) != Some("message")
                    || payload.get("role").and_then(Value::as_str) != Some("assistant")
                {
                    continue;
                }

                let message = codex_transcript_message_text(payload);
                if message.is_some() {
                    last_assistant_message = message.clone();
                }
                if payload.get("phase").and_then(Value::as_str) == Some("final_answer") {
                    response_item_final_assistant_message = message;
                }
            }
            Some("event_msg") => match payload.get("type").and_then(Value::as_str) {
                Some("agent_message") => {
                    let message = payload
                        .get("message")
                        .and_then(Value::as_str)
                        .filter(|text| !text.trim().is_empty())
                        .map(str::to_string);
                    if message.is_some() {
                        last_assistant_message = message.clone();
                    }
                    if payload.get("phase").and_then(Value::as_str) == Some("final_answer") {
                        event_msg_final_assistant_message = message;
                    }
                }
                Some("task_complete") => {
                    let message = payload
                        .get("last_agent_message")
                        .and_then(Value::as_str)
                        .filter(|text| !text.trim().is_empty())
                        .map(str::to_string);
                    if message.is_some() {
                        last_assistant_message = message.clone();
                        task_complete_assistant_message = message;
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }

    Some(CodexTranscriptResolution::MainThreadMessage(
        response_item_final_assistant_message
            .or(event_msg_final_assistant_message)
            .or(task_complete_assistant_message)
            .or(last_assistant_message),
    ))
}

fn codex_transcript_message_text(payload: &Value) -> Option<String> {
    let content = payload.get("content")?.as_array()?;
    let text = content
        .iter()
        .filter_map(|item| {
            if item.get("type").and_then(Value::as_str) == Some("output_text") {
                item.get("text").and_then(Value::as_str)
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

pub(crate) fn classify_codex_completed_turn_payload(
    payload: Option<&Value>,
) -> crate::state::gateway_status::AgentStatus {
    let Some(payload) = payload else {
        return crate::state::gateway_status::AgentStatus::Idle;
    };
    let Ok(payload) = serde_json::from_value::<CodexCompletedTurnPayload>(payload.clone()) else {
        return crate::state::gateway_status::AgentStatus::Idle;
    };
    if payload.payload_type != "agent-turn-complete" {
        return crate::state::gateway_status::AgentStatus::Idle;
    }

    crate::state::gateway_status::AgentStatus::Idle
}
