import type { AgentChatChoiceSurfaceView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement, ReactNode } from "react";
import { Bot, Check, FileText, Folder, FolderPlus, GitBranch, Layers, PanelsTopLeft, Paperclip, Plus, Trash2, Wrench } from "lucide-react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createChoiceSurface(input: {
  key: string;
  surface: AgentChatChoiceSurfaceView;
  message?: string;
  onRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
}): ReactElement {
  return (
    <section
      key={input.key}
      className="choice-surface"
      aria-label="Choice Surface"
      data-choice-surface={input.surface.surfaceKind}
      data-choice-source={input.surface.sourceLabel}
    >
      <header className="choice-surface__header">
        <h2>{input.surface.title}</h2>
        <span>{input.surface.sourceLabel}</span>
      </header>
      {input.message ? <p className="choice-surface__message">{input.message}</p> : null}
      {createChoiceRows(input.surface, input.onRowSelect)}
    </section>
  );
}

function createChoiceRows(
  surface: AgentChatChoiceSurfaceView,
  onRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void,
): ReactElement | null {
  const rows = surface.rows;
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="choice-surface__rows">
      {rows.map((row) => {
        const rowButton = (
          <button
            key={row.rowId}
            type="button"
            className={`choice-surface__row${row.danger ? " choice-surface__row--danger" : ""}${
              row.disabled ? " choice-surface__row--disabled" : ""
            }`}
            data-selected={row.selected ? "true" : "false"}
            disabled={row.disabled === true}
            aria-disabled={row.disabled === true}
            onClick={row.disabled ? undefined : () => onRowSelect?.(surface.surfaceKind, row.rowId)}
          >
            <span className="choice-surface__row-icon" aria-hidden>
              {choiceRowIcon(row.icon)}
            </span>
            <span className="choice-surface__row-label">{row.label}</span>
            {row.detail ? <span className="choice-surface__row-detail">{row.detail}</span> : null}
            {row.meta ? <span className="choice-surface__row-meta">{row.meta}</span> : null}
          </button>
        );
        // A trailing affordance (e.g. delete a worktree) routes through the same
        // row-select callback with its own rowId; can't nest in the row button, so
        // wrap both in a row container. Rows without an action stay a bare button.
        if (row.action === undefined) {
          return rowButton;
        }
        const action = row.action;
        return (
          <div key={row.rowId} className="choice-surface__row-wrap">
            {rowButton}
            <button
              type="button"
              className="choice-surface__row-action"
              aria-label={action.label}
              title={action.label}
              onClick={() => onRowSelect?.(surface.surfaceKind, action.rowId)}
            >
              {choiceRowIcon(action.icon)}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Choice-surface rows carry a semantic icon key (e.g. "folder", "check") which
// the renderer maps to a lucide icon. Unknown values render as the literal glyph
// (legacy menus still pass glyph strings until they migrate to keys).
// Two-letter provider monogram (Codex/Claude both start with C, hence distinct
// 2-char codes). Mirrors agentMonogram() in tide-product-shell.
export function agentMonogramFor(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "Cl";
    case "gemini":
      return "Ge";
    case "opencode":
      return "Oc";
    case "openai_api":
      return "AI";
    default:
      return "Co";
  }
}

function choiceRowIcon(icon: string | undefined): ReactNode {
  if (icon === undefined || icon === "") {
    return null;
  }
  // Per-agent identity monogram badge (same mark used in Thread rows and the
  // composer agent chip), keyed as "identity:<agentId>".
  if (icon.startsWith("identity:")) {
    const agentId = icon.slice("identity:".length) || "codex";
    return (
      <span className={`agent-identity-icon agent-identity-icon--${agentId}`} aria-hidden>
        {agentMonogramFor(agentId)}
      </span>
    );
  }
  const lucide: Record<string, ReactNode> = {
    check: <Check size={15} strokeWidth={2} />,
    folder: <Folder size={15} strokeWidth={1.85} />,
    "folder-plus": <FolderPlus size={15} strokeWidth={1.85} />,
    scratch: <FileText size={15} strokeWidth={1.85} />,
    branch: <GitBranch size={15} strokeWidth={1.85} />,
    plus: <Plus size={15} strokeWidth={2} />,
    source: <Layers size={15} strokeWidth={1.85} />,
    agent: <Bot size={15} strokeWidth={1.85} />,
    attach: <Paperclip size={15} strokeWidth={1.85} />,
    file: <FileText size={15} strokeWidth={1.85} />,
    panel: <PanelsTopLeft size={15} strokeWidth={1.85} />,
    tool: <Wrench size={15} strokeWidth={1.85} />,
    trash: <Trash2 size={14} strokeWidth={1.85} />,
  };
  // Unknown values render nothing rather than leaking a stray glyph string.
  return lucide[icon] ?? null;
}

