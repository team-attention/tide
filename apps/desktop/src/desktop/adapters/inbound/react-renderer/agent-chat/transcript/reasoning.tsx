import type { AgentChatBlockView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { renderMarkdownToHtml } from "./markdown.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// Reasoning/thinking renders as a quiet, collapsible disclosure — secondary to the
// answer, like the Codex/Claude apps. It expands live while streaming so the user
// can watch the model think, then collapses once the turn is complete.
export function ReasoningTurn({ block }: { block: AgentChatBlockView }): ReactElement {
  const streaming = block.status === "streaming" || block.status === "pending";
  const [expanded, setExpanded] = useState(streaming);
  // Follow the live stream open, but stop forcing it once the user has toggled.
  const userToggled = useRef(false);
  useEffect(() => {
    if (!userToggled.current) {
      setExpanded(streaming);
    }
  }, [streaming]);
  const label = block.title && block.title.trim().length > 0 ? block.title : "Thinking";
  return (
    <div
      className={`agent-reasoning${expanded ? " agent-reasoning--expanded" : ""}${
        streaming ? " agent-reasoning--streaming" : ""
      }`}
      data-block-id={block.blockId}
      data-block-role="reasoning"
    >
      <button
        type="button"
        className="agent-reasoning__summary"
        aria-expanded={expanded}
        onClick={() => {
          userToggled.current = true;
          setExpanded((value) => !value);
        }}
      >
        <Sparkles size={13} strokeWidth={1.9} className="agent-reasoning__icon" aria-hidden />
        <span className="agent-reasoning__label">{label}</span>
        <ChevronDown size={13} strokeWidth={1.9} className="agent-reasoning__chevron" aria-hidden />
      </button>
      {expanded ? (
        <div
          className="agent-reasoning__body"
          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(block.body) }}
        />
      ) : null}
    </div>
  );
}
