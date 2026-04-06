// ContextArtifact — live workspace-local selection/comment state for paired agents.

use std::collections::HashMap;

use crate::pane::Selection;
use crate::tide_core::PaneId;
use serde_json::{json, Value};

#[derive(Clone)]
pub(crate) struct ContextArtifact {
    pub artifact_id: u64,
    pub source_pane_id: PaneId,
    pub associated_terminal_id: PaneId,
    pub pane_kind: String,
    pub selection: Option<Selection>,
    pub content: String,
    pub comment: String,
    pub pinned: bool,
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

pub(crate) fn context_artifact_json(artifact: &ContextArtifact) -> Value {
    json!({
        "artifact_id": artifact.artifact_id,
        "pane_id": artifact.source_pane_id,
        "associated_terminal_id": artifact.associated_terminal_id,
        "pane_kind": artifact.pane_kind,
        "content": artifact.content,
        "comment": artifact.comment,
        "pinned": artifact.pinned,
        "selection": artifact.selection.as_ref().map(serialize_selection).unwrap_or(Value::Null),
    })
}

pub(crate) fn format_context_artifact_terminal_input(artifact: &ContextArtifact) -> String {
    let mut sections = vec![format!(
        "Tide Context Artifact #{} from {} pane {}",
        artifact.artifact_id, artifact.pane_kind, artifact.source_pane_id
    )];

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

pub(crate) fn wrap_terminal_input_for_paste_and_submit(text: &str, bracketed: bool) -> Vec<u8> {
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
    data.extend_from_slice(b"\r");
    data
}
