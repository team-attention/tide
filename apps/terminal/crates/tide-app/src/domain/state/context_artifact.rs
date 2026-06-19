// ContextArtifact — live workspace-local selection/comment state for paired agents.

use std::collections::HashMap;

use crate::pane::Selection;
use crate::tide_core::PaneId;
use serde_json::{json, Value};

#[derive(Clone)]
pub(crate) struct ContextArtifactDelivery {
    pub sequence: u64,
    pub terminal_input_injected: bool,
}

#[derive(Clone)]
pub(crate) struct ContextArtifact {
    pub artifact_id: u64,
    pub source_pane_id: PaneId,
    pub associated_terminal_id: PaneId,
    pub pane_kind: String,
    pub source_label: String,
    pub selection: Option<Selection>,
    pub content: String,
    pub comment: String,
    pub pinned: bool,
    pub deliveries: Vec<ContextArtifactDelivery>,
}

impl ContextArtifact {
    pub(crate) fn record_delivery(&mut self, terminal_input_injected: bool) {
        let sequence = self
            .deliveries
            .last()
            .map(|delivery| delivery.sequence.saturating_add(1))
            .unwrap_or(1);
        self.deliveries.push(ContextArtifactDelivery {
            sequence,
            terminal_input_injected,
        });
    }
}

pub(crate) struct ContextArtifactStore {
    pub next_artifact_id: u64,
    pub artifacts: HashMap<u64, ContextArtifact>,
}

impl ContextArtifactStore {
    pub fn new() -> Self {
        Self {
            next_artifact_id: 1,
            artifacts: HashMap::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.artifacts.is_empty()
    }

    pub fn allocate_id(&mut self) -> u64 {
        let mut id = self.next_artifact_id;
        while self.artifacts.contains_key(&id) {
            id = id.saturating_add(1);
        }
        self.next_artifact_id = id.saturating_add(1);
        id
    }
}

pub(crate) fn serialize_selection(selection: &Selection) -> Value {
    json!({
        "anchor_row": selection.anchor.0,
        "anchor_col": selection.anchor.1,
        "end_row": selection.end.0,
        "end_col": selection.end.1,
    })
}

pub(crate) fn serialize_delivery(delivery: &ContextArtifactDelivery) -> Value {
    json!({
        "sequence": delivery.sequence,
        "terminal_input_injected": delivery.terminal_input_injected,
    })
}

pub(crate) fn context_artifact_json(artifact: &ContextArtifact) -> Value {
    let deliveries: Vec<Value> = artifact.deliveries.iter().map(serialize_delivery).collect();
    let last_delivery = artifact
        .deliveries
        .last()
        .map(serialize_delivery)
        .unwrap_or(Value::Null);

    json!({
        "artifact_id": artifact.artifact_id,
        "pane_id": artifact.source_pane_id,
        "associated_terminal_id": artifact.associated_terminal_id,
        "pane_kind": artifact.pane_kind,
        "source_label": artifact.source_label,
        "content": artifact.content,
        "comment": artifact.comment,
        "pinned": artifact.pinned,
        "delivered": !artifact.deliveries.is_empty(),
        "delivery_count": artifact.deliveries.len(),
        "deliveries": deliveries,
        "last_delivery": last_delivery,
        "selection": artifact.selection.as_ref().map(serialize_selection).unwrap_or(Value::Null),
    })
}

pub(crate) fn format_context_artifact_terminal_input(artifact: &ContextArtifact) -> String {
    let mut sections = vec![format!("Tide Context Artifact #{}", artifact.artifact_id)];
    sections.push(format!("Source: {}", artifact.source_label));

    if artifact.pinned {
        sections.push("Pinned: on".to_string());
    }

    if !artifact.comment.trim().is_empty() {
        sections.push(String::new());
        sections.push("Comment:".to_string());
        sections.push(artifact.comment.trim_end().to_string());
    }

    if !artifact.content.trim().is_empty() {
        sections.push(String::new());
        sections.push("Selection:".to_string());
        sections.push(artifact.content.trim_end().to_string());
    }

    sections.join("\n")
}

pub(crate) fn wrap_terminal_input_for_paste(text: &str, bracketed: bool) -> Vec<u8> {
    let mut data = Vec::new();
    if bracketed {
        data.extend_from_slice(b"\x1b[200~");
        let safe = text.replace("\x1b[201~", "");
        data.extend_from_slice(safe.as_bytes());
        data.extend_from_slice(b"\x1b[201~");
        data.extend_from_slice(b"\x1b[D\x1b[C");
    } else {
        data.extend_from_slice(text.as_bytes());
    }
    data
}
