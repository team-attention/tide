import type { AgentChatChoiceSurfaceRowView } from "./types.ts";

export function row(
  rowId: string,
  label: string,
  detail?: string,
  meta?: string,
  icon = "",
  selected = false,
  danger = false,
  disabled = false,
): AgentChatChoiceSurfaceRowView {
  return { rowId, label, detail, meta, icon, selected, danger, disabled };
}
