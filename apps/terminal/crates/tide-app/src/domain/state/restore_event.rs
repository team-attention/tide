#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RestoreEventKind {
    SessionRestored,
    SessionRestoreFailed,
    SessionRestoreMissing,
    PreferencesRestored,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceRestoreEvent {
    pub kind: RestoreEventKind,
    pub crash_recovery: bool,
    pub restored_panes: usize,
    pub restored_context_panes: usize,
}
