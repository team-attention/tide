import type { AgentChatChoiceSurfaceView, AgentChatComposerSurfaceKind, AgentChatContextItem } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { AnchorRect, ComposerHandlers } from "../support/types.ts";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { agentMonogramFor, createChoiceSurface } from "./choice-surface.tsx";
import { OpencodeConnectPanel } from "./opencode-connect-panel.tsx";
import { OpencodeModelProviderPanel } from "./opencode-model-provider-panel.tsx";
import { CornerDownRight, FileText, Folder, FolderGit2, GitBranch, Globe, Terminal } from "lucide-react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// Renders the active chip dropdown as a fixed popover anchored to the chip,
// behind a transparent full-viewport backdrop that closes it on outside click.
export function createChipPopover(input: {
  surface: AgentChatChoiceSurfaceView;
  anchor: AnchorRect;
  onRowSelect?: (surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"], rowId: string) => void;
  onInputSubmit?: (
    surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
    rowId: string,
    value: string,
  ) => void;
  onOpencodeConnectApiKey?: (vendorId: string, key: string) => void;
  onClose: () => void;
}): ReactElement {
  const gap = 6;
  const viewportH = typeof window === "undefined" ? 900 : window.innerHeight;
  const viewportW = typeof window === "undefined" ? 1200 : window.innerWidth;
  const openUp = input.anchor.top > viewportH / 2;
  const margin = 12;
  // Cap the popover to the space actually available on the side it opens toward,
  // so the scroll region spans the whole list instead of running past a viewport
  // edge where the far rows become unreachable.
  const available = openUp
    ? input.anchor.top - gap - margin
    : viewportH - input.anchor.bottom - gap - margin;
  const style: Record<string, string> = {
    position: "fixed",
    left: `${Math.max(8, Math.min(input.anchor.left, viewportW - 396))}px`,
    zIndex: "60",
    maxHeight: `${Math.max(160, available)}px`,
  };
  if (openUp) {
    style.bottom = `${viewportH - input.anchor.top + gap}px`;
  } else {
    style.top = `${input.anchor.bottom + gap}px`;
  }
  return (
    <div className="chip-popover-backdrop" onMouseDown={input.onClose}>
      <div
        className="chip-popover"
        style={style as unknown as CSSProperties}
        onMouseDown={(event: { stopPropagation: () => void }) => event.stopPropagation()}
      >
        {input.surface.surfaceKind === "opencode_model_provider" ? (
          <OpencodeModelProviderPanel
            surface={input.surface}
            onRowSelect={input.onRowSelect}
            onConnectApiKey={input.onOpencodeConnectApiKey}
          />
        ) : input.surface.surfaceKind === "opencode_connect" ? (
          <OpencodeConnectPanel
            surface={input.surface}
            onRowSelect={input.onRowSelect}
            onConnectApiKey={input.onOpencodeConnectApiKey}
          />
        ) : (
          createChoiceSurface({
            key: `popover:${input.surface.surfaceKind}`,
            surface: input.surface,
            onRowSelect: input.onRowSelect,
            onInputSubmit: input.onInputSubmit,
          })
        )}
      </div>
    </div>
  );
}

export function contextChipIcon(kind: string): typeof FileText {
  switch (kind) {
    case "terminal":
      return Terminal;
    case "browser":
      return Globe;
    case "message":
      return CornerDownRight;
    default:
      return FileText;
  }
}

// Extracts a chip's anchor rect from a click event for popover positioning.
export function chipAnchorFromEvent(event: { currentTarget: HTMLElement }): AnchorRect {
  const rect = event.currentTarget.getBoundingClientRect();
  return { left: rect.left, top: rect.top, bottom: rect.bottom };
}

export function createContextChip(
  item: AgentChatContextItem,
  handlers: ComposerHandlers,
): ReactElement {
  return (
    <button
      key={`${item.label}:${item.value}`}
      className="composer-shell__context-chip"
      data-context-kind={item.label.toLowerCase()}
      data-agent-runtime-source={item.runtimeSourceKind}
      type="button"
      onClick={(event: { currentTarget: HTMLElement }) =>
        handlers.onOpenSurface?.(surfaceForContextItem(item), chipAnchorFromEvent(event))
      }
    >
      <span className="composer-shell__chip-icon" aria-hidden>
        {contextItemIcon(item)}
      </span>
      <span className="visually-hidden">{item.label}</span>
      <span className="composer-shell__chip-label">{item.value}</span>
    </button>
  );
}

function surfaceForContextItem(item: AgentChatContextItem): AgentChatComposerSurfaceKind {
  switch (item.label) {
    case "Agent":
      return "agent_menu";
    case "Project":
    case "Scratch":
      return "project_menu";
    case "Environment":
      return "worktree_menu";
    case "Branch":
      return "branch_menu";
  }
}

function contextItemIcon(item: AgentChatContextItem): ReactNode {
  const props = { size: 13, strokeWidth: 1.85, "aria-hidden": true } as const;
  switch (item.label) {
    case "Agent":
      // Use the same per-agent identity monogram badge shown in Thread rows.
      return (
        <span
          className={`agent-identity-icon agent-identity-icon--${item.agentId ?? "codex"}`}
          aria-hidden
        >
          {agentMonogramFor(item.agentId ?? "codex")}
        </span>
      );
    case "Project":
      return <Folder {...props} />;
    case "Scratch":
      return <FileText {...props} />;
    case "Environment":
      return <FolderGit2 {...props} />;
    case "Branch":
      return <GitBranch {...props} />;
  }
}
