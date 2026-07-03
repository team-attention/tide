import type { AgentChatChoiceSurfaceView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { styled } from "styled-components";
import { Bot, Check, FileText, Folder, FolderPlus, GitBranch, Layers, PanelsTopLeft, Paperclip, Plus, Trash2, Wrench } from "lucide-react";
import { AgentIdentityIcon } from "../../product-shell/support/agent-identity.tsx";
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
  const surfaceRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    setInlineRowId(null);
    setInlineDraft("");
  }, [input.surface.surfaceKind]);
  useEffect(() => {
    if (inlineRowId !== null) {
      inputRef.current?.focus();
    }
  }, [inlineRowId]);
  useEffect(() => {
    if (inlineRowId !== null || typeof window === "undefined") {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const surface = surfaceRef.current;
      if (
        surface === null ||
        event.defaultPrevented ||
        event.key !== "Tab" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !choiceSurfaceShouldHandleTab(surface, event)
      ) {
        return;
      }
      if (focusNextChoiceSurfaceTabTarget(surface, event.shiftKey ? -1 : 1)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [inlineRowId, input.surface.surfaceKind]);
  return (
    <ChoiceSurfaceFrame
      ref={surfaceRef}
      aria-label="Choice Surface"
      data-choice-surface={input.surface.surfaceKind}
      data-choice-source={input.surface.sourceLabel}
    >
      <ChoiceSurfaceHeader>
        <h2>{input.surface.title}</h2>
        <span>{input.surface.sourceLabel}</span>
      </ChoiceSurfaceHeader>
      {input.message ? <ChoiceSurfaceMessage>{input.message}</ChoiceSurfaceMessage> : null}
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
    </ChoiceSurfaceFrame>
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
    <ChoiceSurfaceRows data-choice-rows="true">
      {rows.map((row) => {
        const inline = inlineCreateConfig(input.surface.surfaceKind, row.rowId);
        if (inline !== null && input.inlineRowId === row.rowId) {
          const submit = (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            input.onInputSubmit?.(input.surface.surfaceKind, row.rowId, input.inlineDraft);
          };
          return (
            <ChoiceInlineCreate key={row.rowId} onSubmit={submit}>
              <ChoiceInlineTitle>
                <ChoiceRowIcon aria-hidden>
                  {choiceRowIcon(row.icon)}
                </ChoiceRowIcon>
                <ChoiceRowLabel data-choice-row-label="true">{row.label}</ChoiceRowLabel>
                {row.detail ? <ChoiceRowDetail data-choice-row-detail="true">{row.detail}</ChoiceRowDetail> : null}
              </ChoiceInlineTitle>
              <ChoiceInlineControls>
                <ChoiceInlineInput
                  ref={input.inputRef}
                  data-choice-inline-input="true"
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
                <ChoiceInlineSubmit type="submit">
                  Use
                </ChoiceInlineSubmit>
              </ChoiceInlineControls>
            </ChoiceInlineCreate>
          );
        }
        const rowButton = (
          <ChoiceRow
            key={row.rowId}
            type="button"
            $danger={row.danger === true}
            $disabled={row.disabled === true}
            data-choice-row="true"
            data-choice-tab-target={row.disabled ? undefined : "true"}
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
            <ChoiceRowIcon aria-hidden>
              {choiceRowIcon(row.icon)}
            </ChoiceRowIcon>
            <ChoiceRowLabel data-choice-row-label="true">{row.label}</ChoiceRowLabel>
            {row.detail ? <ChoiceRowDetail data-choice-row-detail="true">{row.detail}</ChoiceRowDetail> : null}
            {row.meta ? <ChoiceRowMeta data-choice-row-meta="true">{row.meta}</ChoiceRowMeta> : null}
          </ChoiceRow>
        );
        // A trailing affordance (e.g. delete a worktree) routes through the same
        // row-select callback with its own rowId; can't nest in the row button, so
        // wrap both in a row container. Rows without an action stay a bare button.
        if (row.action === undefined) {
          return rowButton;
        }
        const action = row.action;
        return (
          <ChoiceRowWrap key={row.rowId}>
            {rowButton}
            <ChoiceRowAction
              type="button"
              data-choice-row-action="true"
              data-choice-tab-target="true"
              aria-label={action.label}
              title={action.label}
              onClick={() => input.onRowSelect?.(input.surface.surfaceKind, action.rowId)}
            >
              {choiceRowIcon(action.icon)}
            </ChoiceRowAction>
          </ChoiceRowWrap>
        );
      })}
    </ChoiceSurfaceRows>
  );
}

export function nextChoiceSurfaceTabIndex(
  currentIndex: number,
  total: number,
  direction: 1 | -1,
): number {
  if (total <= 0) {
    return -1;
  }
  if (currentIndex < 0 || currentIndex >= total) {
    return direction > 0 ? 0 : total - 1;
  }
  return (currentIndex + direction + total) % total;
}

function focusNextChoiceSurfaceTabTarget(root: HTMLElement, direction: 1 | -1): boolean {
  const targets = choiceSurfaceTabTargets(root);
  const nextIndex = nextChoiceSurfaceTabIndex(
    targets.findIndex((target) => target === root.ownerDocument.activeElement),
    targets.length,
    direction,
  );
  const target = targets[nextIndex];
  if (target === undefined) {
    return false;
  }
  target.focus();
  return true;
}

function choiceSurfaceTabTargets(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-choice-tab-target='true']")).filter(
    (target) => {
      const button = target as HTMLButtonElement;
      return button.disabled !== true && target.getAttribute("aria-disabled") !== "true";
    },
  );
}

function choiceSurfaceShouldHandleTab(root: HTMLElement, event: KeyboardEvent): boolean {
  const view = root.ownerDocument.defaultView;
  if (view === null) {
    return false;
  }
  const active = root.ownerDocument.activeElement;
  const activeNode = active instanceof view.Node ? active : null;
  const eventNode = event.target instanceof view.Node ? event.target : null;
  if ((activeNode !== null && root.contains(activeNode)) || (eventNode !== null && root.contains(eventNode))) {
    return true;
  }

  const shell = root.closest("[data-agent-chat-shell]");
  const composer = shell?.querySelector("[data-composer-shell]");
  return activeNode !== null && composer?.contains(activeNode) === true;
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
function choiceRowIcon(icon: string | undefined): ReactNode {
  if (icon === undefined || icon === "") {
    return null;
  }
  // Per-agent identity monogram badge (same mark used in Thread rows and the
  // composer agent chip), keyed as "identity:<agentId>".
  if (icon.startsWith("identity:")) {
    const agentId = icon.slice("identity:".length) || "codex";
    return <AgentIdentityIcon agentId={agentId} />;
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

const ChoiceSurfaceFrame = styled.section`
  width: max-content;
  max-width: min(380px, 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  padding: 6px;
  border: 1px solid var(--tide-line);
  border-radius: 12px;
  background: var(--tide-bg);
  box-shadow: var(--tide-shadow-popover);
  transform-origin: top;
  animation: tide-pop-in 0.13s ease;
`;

const ChoiceSurfaceHeader = styled.header`
  min-height: 24px;
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 2px 8px 4px;

  & h2 {
    margin: 0;
    overflow: hidden;
    color: var(--tide-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  & span {
    color: var(--tide-muted);
    font-size: 12px;
  }
`;

const ChoiceSurfaceMessage = styled.p`
  margin: 2px 0 8px 28px;
  color: var(--tide-muted);
  font-size: 12px;
  white-space: pre-wrap;
`;

const ChoiceSurfaceRows = styled.div`
  min-height: 0;
  max-height: 56vh;
  flex: 1 1 auto;
  display: grid;
  gap: 0;
  overflow-y: auto;
  margin: 0;
  padding: 0;
`;

const ChoiceRow = styled.button<{ $danger: boolean; $disabled: boolean }>`
  min-height: 34px;
  display: grid;
  grid-template-columns: 16px auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: ${({ $danger }) => ($danger ? "var(--tide-danger)" : "var(--tide-text)")};
  font-size: 14px;
  text-align: left;
  cursor: ${({ $disabled }) => ($disabled ? "default" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? "0.45" : "1")};
  transition: background-color 0.12s ease, color 0.12s ease;

  &[data-selected="true"],
  &:not(:disabled):hover {
    background: var(--tide-selection);
  }

  &:not(:disabled):focus-visible {
    outline: 2px solid var(--tide-line-strong, var(--tide-muted));
    outline-offset: -2px;
    background: var(--tide-selection);
  }
`;

const ChoiceRowWrap = styled.div`
  display: flex;
  align-items: center;

  ${ChoiceRow} {
    min-width: 0;
    flex: 1 1 auto;
  }

  &:hover [data-choice-row-action],
  [data-choice-row-action]:focus-visible {
    opacity: 1;
  }
`;

const ChoiceRowAction = styled.button`
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 4px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  opacity: 0;
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;

  &:hover {
    background: color-mix(in srgb, var(--tide-danger) 14%, transparent);
    color: var(--tide-danger);
  }

  &:focus-visible {
    outline: 2px solid var(--tide-line-strong, var(--tide-muted));
    outline-offset: -2px;
    background: var(--tide-selection);
  }
`;

const ChoiceInlineCreate = styled.form`
  display: grid;
  gap: 7px;
  padding: 7px 8px 8px;
  border-radius: 8px;
  background: var(--tide-selection);
`;

const ChoiceInlineTitle = styled.div`
  min-height: 20px;
  display: grid;
  grid-template-columns: 16px auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
`;

const ChoiceInlineControls = styled.div`
  display: grid;
  grid-template-columns: minmax(160px, 1fr) auto;
  gap: 6px;
`;

const ChoiceInlineInput = styled.input`
  min-width: 0;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-bg);
  color: var(--tide-text);
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: var(--tide-line-strong, var(--tide-muted));
  }
`;

const ChoiceInlineSubmit = styled.button`
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-bg);
  color: var(--tide-text);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--tide-surface);
  }
`;

const ChoiceRowIcon = styled.span`
  color: var(--tide-muted);
`;

const ChoiceRowLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  color: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ChoiceRowDetail = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${ChoiceRow}[aria-disabled="true"] & {
    font-style: italic;
  }
`;

const ChoiceRowMeta = styled.span`
  min-width: 0;
  justify-self: end;
  overflow: hidden;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--tide-selection);
  color: var(--tide-muted);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
