import type { AgentChatChoiceSurfaceView } from "../../../../../application/domains/agent-chat/agent-chat-shell-state.ts";
import { createElement } from "react";
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
  return createElement(
    "section",
    {
      key: input.key,
      className: "choice-surface",
      "aria-label": "Choice Surface",
      "data-choice-surface": input.surface.surfaceKind,
      "data-choice-source": input.surface.sourceLabel,
    },
    createElement(
      "header",
      { className: "choice-surface__header" },
      createElement("h2", null, input.surface.title),
      createElement("span", null, input.surface.sourceLabel),
    ),
    input.message
      ? createElement("p", { className: "choice-surface__message" }, input.message)
      : null,
    createChoiceRows(input.surface, input.onRowSelect),
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

  return createElement(
    "div",
    { className: "choice-surface__rows" },
    rows.map((row) => {
      const rowButton = createElement(
        "button",
        {
          key: row.rowId,
          type: "button",
          className: `choice-surface__row${row.danger ? " choice-surface__row--danger" : ""}${
            row.disabled ? " choice-surface__row--disabled" : ""
          }`,
          "data-selected": row.selected ? "true" : "false",
          disabled: row.disabled === true,
          "aria-disabled": row.disabled === true,
          onClick: row.disabled ? undefined : () => onRowSelect?.(surface.surfaceKind, row.rowId),
        },
        createElement("span", { className: "choice-surface__row-icon", "aria-hidden": true }, choiceRowIcon(row.icon)),
        createElement("span", { className: "choice-surface__row-label" }, row.label),
        row.detail ? createElement("span", { className: "choice-surface__row-detail" }, row.detail) : null,
        row.meta ? createElement("span", { className: "choice-surface__row-meta" }, row.meta) : null,
      );
      // A trailing affordance (e.g. delete a worktree) routes through the same
      // row-select callback with its own rowId; can't nest in the row button, so
      // wrap both in a row container. Rows without an action stay a bare button.
      if (row.action === undefined) {
        return rowButton;
      }
      const action = row.action;
      return createElement(
        "div",
        { key: row.rowId, className: "choice-surface__row-wrap" },
        rowButton,
        createElement(
          "button",
          {
            type: "button",
            className: "choice-surface__row-action",
            "aria-label": action.label,
            title: action.label,
            onClick: () => onRowSelect?.(surface.surfaceKind, action.rowId),
          },
          choiceRowIcon(action.icon),
        ),
      );
    }),
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
    return createElement(
      "span",
      { className: `agent-identity-icon agent-identity-icon--${agentId}`, "aria-hidden": true },
      agentMonogramFor(agentId),
    );
  }
  const lucide: Record<string, ReactNode> = {
    check: createElement(Check, { size: 15, strokeWidth: 2 }),
    folder: createElement(Folder, { size: 15, strokeWidth: 1.85 }),
    "folder-plus": createElement(FolderPlus, { size: 15, strokeWidth: 1.85 }),
    scratch: createElement(FileText, { size: 15, strokeWidth: 1.85 }),
    branch: createElement(GitBranch, { size: 15, strokeWidth: 1.85 }),
    plus: createElement(Plus, { size: 15, strokeWidth: 2 }),
    source: createElement(Layers, { size: 15, strokeWidth: 1.85 }),
    agent: createElement(Bot, { size: 15, strokeWidth: 1.85 }),
    attach: createElement(Paperclip, { size: 15, strokeWidth: 1.85 }),
    file: createElement(FileText, { size: 15, strokeWidth: 1.85 }),
    panel: createElement(PanelsTopLeft, { size: 15, strokeWidth: 1.85 }),
    tool: createElement(Wrench, { size: 15, strokeWidth: 1.85 }),
    trash: createElement(Trash2, { size: 14, strokeWidth: 1.85 }),
  };
  // Unknown values render nothing rather than leaking a stray glyph string.
  return lucide[icon] ?? null;
}

function choiceSurfaceTitle(kind: string): string {
  switch (kind) {
    case "question":
      return "Question from Agent";
    case "approval":
    case "permission":
      return "Permission required";
    case "command_picker":
      return "Command suggestions";
    default:
      return "Choose an option";
  }
}
