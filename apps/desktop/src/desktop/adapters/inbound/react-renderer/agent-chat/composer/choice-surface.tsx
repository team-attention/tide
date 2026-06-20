import type { AgentChatChoiceSurfaceView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
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
  onInputSubmit?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
    value: string,
  ) => void;
}): ReactElement {
  return (
    <ChoiceSurface
      key={input.key}
      surface={input.surface}
      message={input.message}
      onRowSelect={input.onRowSelect}
      onInputSubmit={input.onInputSubmit}
    />
  );
}

function ChoiceSurface(input: {
  surface: AgentChatChoiceSurfaceView;
  message?: string;
  onRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
  onInputSubmit?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
    value: string,
  ) => void;
}): ReactElement {
  const [inlineRowId, setInlineRowId] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setInlineRowId(null);
    setInlineDraft("");
  }, [input.surface.surfaceKind]);
  useEffect(() => {
    if (inlineRowId !== null) {
      inputRef.current?.focus();
    }
  }, [inlineRowId]);
  return (
    <section
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
      {createChoiceRows({
        surface: input.surface,
        inlineRowId,
        inlineDraft,
        inputRef,
        onInlineDraftChange: setInlineDraft,
        onInlineRowOpen: (rowId) => {
          setInlineRowId(rowId);
          setInlineDraft("");
        },
        onInlineRowClose: () => {
          setInlineRowId(null);
          setInlineDraft("");
        },
        onInputSubmit: input.onInputSubmit,
        onRowSelect: input.onRowSelect,
      })}
    </section>
  );
}

function createChoiceRows(input: {
  surface: AgentChatChoiceSurfaceView;
  inlineRowId: string | null;
  inlineDraft: string;
  inputRef: { current: HTMLInputElement | null };
  onInlineDraftChange: (value: string) => void;
  onInlineRowOpen: (rowId: string) => void;
  onInlineRowClose: () => void;
  onInputSubmit?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
    value: string,
  ) => void;
  onRowSelect?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
  ) => void;
}): ReactElement | null {
  const rows = input.surface.rows;
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="choice-surface__rows">
      {rows.map((row) => {
        const inline = inlineCreateConfig(input.surface.surfaceKind, row.rowId);
        if (inline !== null && input.inlineRowId === row.rowId) {
          const submit = (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            input.onInputSubmit?.(input.surface.surfaceKind, row.rowId, input.inlineDraft);
          };
          return (
            <form key={row.rowId} className="choice-surface__inline-create" onSubmit={submit}>
              <div className="choice-surface__inline-title">
                <span className="choice-surface__row-icon" aria-hidden>
                  {choiceRowIcon(row.icon)}
                </span>
                <span className="choice-surface__row-label">{row.label}</span>
                {row.detail ? <span className="choice-surface__row-detail">{row.detail}</span> : null}
              </div>
              <div className="choice-surface__inline-controls">
                <input
                  ref={input.inputRef}
                  className="choice-surface__inline-input"
                  value={input.inlineDraft}
                  placeholder={inline.placeholder}
                  aria-label={inline.ariaLabel}
                  spellCheck={false}
                  onChange={(event) => input.onInlineDraftChange(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      input.onInlineRowClose();
                    }
                  }}
                />
                <button type="submit" className="choice-surface__inline-submit">
                  Use
                </button>
              </div>
            </form>
          );
        }
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
            onClick={
              row.disabled
                ? undefined
                : inline !== null
                  ? () => input.onInlineRowOpen(row.rowId)
                  : () => input.onRowSelect?.(input.surface.surfaceKind, row.rowId)
            }
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
              onClick={() => input.onRowSelect?.(input.surface.surfaceKind, action.rowId)}
            >
              {choiceRowIcon(action.icon)}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function inlineCreateConfig(
  surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
  rowId: string,
): { placeholder: string; ariaLabel: string } | null {
  if (surfaceKind === "branch_menu" && rowId === "create-branch") {
    return {
      placeholder: "worktree branch name (optional)",
      ariaLabel: "New worktree branch name",
    };
  }
  return null;
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
