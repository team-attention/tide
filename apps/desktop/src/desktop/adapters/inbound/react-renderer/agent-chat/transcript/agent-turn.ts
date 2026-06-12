import { createElement, memo } from "react";
import type { ReactElement } from "react";
import type { AgentChatBlockView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { createToolLogTurn } from "./tool-log.ts";
import { renderAgentMarkdown } from "./markdown.ts";
import { renderUserBody } from "./user-turn.ts";
import { Check, Copy, CornerDownRight, RotateCcw } from "lucide-react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// A message/event turn wrapped in React.memo: during a streaming turn the whole
// transcript re-renders, but a turn whose content is unchanged is skipped by the
// comparator instead of rebuilding its (markdown) subtree (perf E2). Keyed by
// blockId at the call site; compared on the stable content fields.
export const AgentSessionTurn = memo(
  function AgentSessionTurn({ block }: { block: AgentChatBlockView }): ReactElement | null {
    return createAgentSessionTurn(block);
  },
  (prev, next) =>
    prev.block.blockId === next.block.blockId &&
    prev.block.body === next.block.body &&
    prev.block.status === next.block.status &&
    prev.block.kind === next.block.kind &&
    prev.block.role === next.block.role &&
    prev.block.title === next.block.title &&
    prev.block.rawFallback === next.block.rawFallback,
);

function createAgentSessionTurn(block: AgentChatBlockView): ReactElement | null {
  if (block.role === "tool") {
    return createToolLogTurn(block);
  }
  const role = block.role === "user" ? "user" : block.role === "agent" ? "agent" : "event";

  return createElement(
    "article",
    {
      key: block.blockId,
      className: `agent-session-turn agent-session-turn--${role}`,
      "data-block-id": block.blockId,
      "data-block-kind": block.kind,
      "data-block-status": block.status,
      "data-block-role": role,
    },
    // Codex-style: the user turn is a right-aligned bubble (no label needed),
    // the agent answer is flat prose (the text is the hero), and structured
    // events keep a small muted label.
    role === "event"
      ? createElement("span", { className: "agent-session-turn__label" }, block.title)
      : null,
    role === "agent"
      ? renderAgentMarkdown(block.body)
      : role === "user"
        ? renderUserBody(block.body)
        : createElement("p", { className: "agent-session-turn__body" }, block.body),
    // Prompt blocks are historical markers for an interactive card; their raw
    // fallback is the hook's JSON payload — runtime transport, not content.
    block.rawFallback && block.rawFallback !== block.body && !block.kind.endsWith("_prompt")
      ? createElement("pre", { className: "agent-session-turn__raw" }, block.rawFallback)
      : null,
    // Hover actions on a completed agent answer: copy the answer, or retry the
    // prompt. Click handling is event-delegated on the session container.
    role === "agent" && block.status !== "streaming" && block.status !== "pending" && block.body.trim().length > 0
      ? createAgentTurnActions()
      : null,
  );
}

function createAgentTurnActions(): ReactElement {
  return createElement(
    "div",
    { className: "agent-turn-actions", "aria-hidden": false },
    createElement(
      "button",
      {
        type: "button",
        className: "agent-turn-actions__btn agent-turn-actions__btn--copy",
        title: "Copy answer",
        "aria-label": "Copy answer",
      },
      createElement(Copy, { size: 13, strokeWidth: 1.8, className: "agent-turn-actions__icon agent-turn-actions__icon--copy", "aria-hidden": true }),
      createElement(Check, { size: 13, strokeWidth: 2, className: "agent-turn-actions__icon agent-turn-actions__icon--check", "aria-hidden": true }),
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "agent-turn-actions__btn agent-turn-actions__btn--quote",
        title: "Quote in chat",
        "aria-label": "Quote this message in the composer",
      },
      createElement(CornerDownRight, { size: 13, strokeWidth: 1.8, className: "agent-turn-actions__icon", "aria-hidden": true }),
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "agent-turn-actions__btn agent-turn-actions__btn--retry",
        title: "Retry",
        "aria-label": "Retry this prompt",
      },
      createElement(RotateCcw, { size: 13, strokeWidth: 1.8, className: "agent-turn-actions__icon", "aria-hidden": true }),
    ),
  );
}
