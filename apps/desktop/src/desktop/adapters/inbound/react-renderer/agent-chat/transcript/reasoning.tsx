import type { AgentChatBlockView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { keyframes, styled } from "styled-components";
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
    <ReasoningFrame
      $streaming={streaming}
      data-block-id={block.blockId}
      data-block-role="reasoning"
    >
      <ReasoningSummaryButton
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          userToggled.current = true;
          setExpanded((value) => !value);
        }}
      >
        <Sparkles size={13} strokeWidth={1.9} aria-hidden />
        <ReasoningLabel>{label}</ReasoningLabel>
        <ReasoningChevron $expanded={expanded} size={13} strokeWidth={1.9} aria-hidden />
      </ReasoningSummaryButton>
      {expanded ? (
        <ReasoningBody
          dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(block.body) }}
        />
      ) : null}
    </ReasoningFrame>
  );
}

const reasoningShimmer = keyframes`
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
`;

const ReasoningFrame = styled.div<{ $streaming: boolean }>`
  width: min(760px, calc(100% - 32px));
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 8px;

  ${({ $streaming }) =>
    $streaming
      ? `
        ${ReasoningLabel} {
          background: linear-gradient(
            100deg,
            var(--tide-muted) 30%,
            var(--tide-text) 50%,
            var(--tide-muted) 70%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: ${reasoningShimmer} 1.8s ease-in-out infinite;
        }
      `
      : ""}
`;

const ReasoningSummaryButton = styled.button`
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 2px;
  border: none;
  background: none;
  color: var(--tide-muted);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: color 0.12s ease;

  &:hover {
    color: var(--tide-text);
  }

  > svg:first-child {
    flex-shrink: 0;
    opacity: 0.85;
  }
`;

const ReasoningLabel = styled.span``;

const ReasoningChevron = styled(ChevronDown)<{ $expanded: boolean }>`
  flex-shrink: 0;
  opacity: 0.7;
  transform: ${({ $expanded }) => ($expanded ? "rotate(180deg)" : "none")};
  transition: transform 0.16s ease;
`;

const ReasoningBody = styled.div`
  margin: 0 0 2px;
  padding-left: 11px;
  border-left: 2px solid var(--tide-line);
  color: var(--tide-muted);
  font-size: 13.5px;
  line-height: 1.62;
  overflow-wrap: anywhere;

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  p {
    margin: 0 0 8px;
  }

  code {
    font-family: var(--tide-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 0.92em;
  }
`;
