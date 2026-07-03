import { memo } from "react";
import type { ReactElement } from "react";
import type { AgentChatBlockView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { createToolLogTurn } from "./tool-log.tsx";
import { renderAgentMarkdown } from "./markdown.tsx";
import { renderUserBody } from "./user-turn.tsx";
import { Check, Copy, CornerDownRight, RotateCcw } from "lucide-react";
import {
  TranscriptTurn,
  TurnActionButton,
  TurnActions,
  TurnBody,
  TurnLabel,
  TurnRawFallback,
} from "./transcript.parts.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// A message/event turn wrapped in React.memo: during a streaming turn the whole
// transcript re-renders, but a turn whose content is unchanged is skipped by the
// comparator instead of rebuilding its (markdown) subtree (perf E2). Keyed by
// blockId at the call site; compared on the stable content fields.
interface AgentSessionTurnProps {
  block: AgentChatBlockView;
  activeStreamingCaret?: boolean;
}

export const AgentSessionTurn = memo(
  function AgentSessionTurn({
    block,
    activeStreamingCaret = false,
  }: AgentSessionTurnProps): ReactElement | null {
    return createAgentSessionTurn(block, activeStreamingCaret);
  },
  (prev, next) =>
    prev.block.blockId === next.block.blockId &&
    prev.block.parentBlockId === next.block.parentBlockId &&
    prev.block.body === next.block.body &&
    prev.block.status === next.block.status &&
    prev.block.kind === next.block.kind &&
    prev.block.role === next.block.role &&
    prev.block.phase === next.block.phase &&
    prev.block.title === next.block.title &&
    prev.block.rawFallback === next.block.rawFallback &&
    prev.block.nativeEvidenceLabel === next.block.nativeEvidenceLabel &&
    prev.activeStreamingCaret === next.activeStreamingCaret,
);

function createAgentSessionTurn(
  block: AgentChatBlockView,
  activeStreamingCaret: boolean,
): ReactElement | null {
  if (block.role === "tool") {
    return createToolLogTurn(block);
  }
  const role = block.role === "user" ? "user" : block.role === "agent" ? "agent" : "event";
  const isCommentary = role === "agent" && block.phase === "commentary";

  return (
    <TranscriptTurn
      key={block.blockId}
      $commentary={isCommentary}
      $role={role}
      data-transcript-turn="true"
      data-block-id={block.blockId}
      data-parent-block-id={block.parentBlockId}
      data-block-kind={block.kind}
      data-block-status={block.status}
      data-block-role={role}
      data-block-phase={block.phase}
      data-native-evidence={block.nativeEvidenceLabel}
      data-native-evidence-count={block.nativeEvidence?.length}
      data-streaming-caret={activeStreamingCaret ? "active" : undefined}
    >
      {/* Codex-style: the user turn is a right-aligned bubble (no label needed),
          the agent answer is flat prose (the text is the hero), and structured
          events keep a small muted label. */}
      {role === "event" ? (
        <TurnLabel>{block.title}</TurnLabel>
      ) : null}
      {isCommentary ? <TurnLabel>Update</TurnLabel> : null}
      {role === "agent" ? (
        renderAgentMarkdown(block.body)
      ) : role === "user" ? (
        renderUserBody(block.body)
      ) : (
        <TurnBody data-turn-body="true">{block.body}</TurnBody>
      )}
      {/* Prompt blocks are historical markers for an interactive card; their raw
          fallback is the hook's JSON payload — runtime transport, not content. */}
      {block.rawFallback && block.rawFallback !== block.body && !block.kind.endsWith("_prompt") ? (
        <TurnRawFallback>{block.rawFallback}</TurnRawFallback>
      ) : null}
      {/* Hover actions on a completed agent answer: copy the answer, or retry the
          prompt. Click handling is event-delegated on the session container. */}
      {role === "agent" && !isCommentary && block.status !== "streaming" && block.status !== "pending" && block.body.trim().length > 0
        ? createAgentTurnActions()
        : null}
    </TranscriptTurn>
  );
}

function createAgentTurnActions(): ReactElement {
  return (
    <TurnActions data-agent-turn-actions="true" aria-hidden={false}>
      <TurnActionButton
        type="button"
        data-agent-turn-action="copy"
        title="Copy answer"
        aria-label="Copy answer"
      >
        <Copy
          size={13}
          strokeWidth={1.8}
          data-turn-action-icon="copy"
          aria-hidden
        />
        <Check
          size={13}
          strokeWidth={2}
          data-turn-action-icon="check"
          aria-hidden
        />
      </TurnActionButton>
      <TurnActionButton
        type="button"
        data-agent-turn-action="quote"
        title="Quote in chat"
        aria-label="Quote this message in the composer"
      >
        <CornerDownRight size={13} strokeWidth={1.8} aria-hidden />
      </TurnActionButton>
      <TurnActionButton
        type="button"
        data-agent-turn-action="retry"
        title="Retry"
        aria-label="Retry this prompt"
      >
        <RotateCcw size={13} strokeWidth={1.8} aria-hidden />
      </TurnActionButton>
    </TurnActions>
  );
}
