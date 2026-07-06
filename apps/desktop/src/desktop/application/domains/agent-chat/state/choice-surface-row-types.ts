export interface AgentChatChoiceSurfaceRowView {
  rowId: string;
  label: string;
  detail?: string;
  meta?: string;
  icon?: string;
  selected?: boolean;
  danger?: boolean;
  // A row for a real feature that is not wired up yet: shown greyed and
  // non-interactive instead of silently doing nothing when clicked.
  disabled?: boolean;
  // An optional trailing affordance (e.g. a trash button) rendered beside the
  // row. Clicking it routes through the same row-select callback with this
  // `rowId`, so no extra handler plumbing is needed. See
  // docs_v2/specs/worktree-branch-deletion.md.
  action?: { rowId: string; label: string; icon?: string };
}
