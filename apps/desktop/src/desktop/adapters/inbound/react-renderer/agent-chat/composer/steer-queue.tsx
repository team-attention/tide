import type { ReactElement } from "react";
import { renderUserAttachmentBody } from "../transcript/user-turn.tsx";
import { ArrowUp, CornerDownRight, Pencil, Trash2 } from "lucide-react";
import { styled } from "styled-components";
import {
  QueuedBadge,
  QueuedEditButton,
  TranscriptTurn,
  TurnBody,
  TurnLabel,
} from "../transcript/transcript.parts.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// Optimistic just-sent user row, shown until the backend's real user block arrives.
// The "Queued" badge only appears when the agent is genuinely busy and the
// message is actually queued behind the live turn — never on an idle send, which goes
// straight through.
export function createQueuedInputRow(queuedInput: string, queued: boolean, index = 0): ReactElement {
  const hasAttachments = queuedInput.includes("**↳ ");
  return (
    <TranscriptTurn
      key={`queued-${index}`}
      $queued={queued}
      $role="user"
      data-transcript-turn="true"
      data-block-role="user"
      {...(queued ? { "data-queued": true } : {})}
    >
      <TurnLabel>
        You
        {queued ? <QueuedBadge>Queued</QueuedBadge> : null}
        {/* Edit the queued message before it runs (only while genuinely queued).
            Handled by the Agent Session's delegated onClick via [data-edit-queued]. */}
        {queued ? (
          <QueuedEditButton
            type="button"
            data-edit-queued
            aria-label="Edit queued message"
            title="Edit queued message"
          >
            <Pencil size={12} strokeWidth={1.9} aria-hidden />
          </QueuedEditButton>
        ) : null}
      </TurnLabel>
      {hasAttachments ? (
        renderUserAttachmentBody(queuedInput)
      ) : (
        <TurnBody $userBubble data-turn-body="true">{queuedInput}</TurnBody>
      )}
    </TranscriptTurn>
  );
}

// The pending "steer" messages docked to the top of the Composer while a turn is
// live: a FIFO stack of queued follow-ups. Each row carries three controls —
// Send now (cut the live turn so the queue runs now), Edit (pull it back into the
// Composer to edit), and Delete (discard it). The stack is height-capped and scrolls
// (CSS), so a long queue never pushes the Composer off-screen.
export function createQueuedSteerStack(
  queuedInputs: string[],
  onEditQueued?: (index: number) => void,
  onRunQueuedInputNow?: (index: number) => void,
  onRemoveQueued?: (index: number) => void,
): ReactElement {
  return (
    <ComposerSteerStack data-composer-steer-stack="true">
      {queuedInputs.map((queuedInput, index) => (
        <ComposerSteer key={`steer-${index}`} data-composer-steer="true" data-queued>
          <SteerIconWrap aria-hidden>
            <CornerDownRight size={13} strokeWidth={1.9} aria-hidden />
          </SteerIconWrap>
          <SteerBadge>Queued</SteerBadge>
          <SteerText>{queuedInput}</SteerText>
          <SteerActions>
            {/* Send now: cut the live turn so this queued message runs now — framed as
                a "send" (arrow-up), matching the composer's send button, not a red stop. */}
            <SteerInterruptButton
              type="button"
	              aria-label="Send now — interrupt the current turn and run this message"
	              title="Send now (interrupt current turn)"
	              onClick={() => onRunQueuedInputNow?.(index)}
	            >
              <ArrowUp size={15} strokeWidth={2.3} aria-hidden />
            </SteerInterruptButton>
            {/* Edit: pull this message back into the Composer to edit. */}
            <SteerActionButton
              type="button"
              aria-label="Edit queued message"
              title="Edit"
              onClick={() => onEditQueued?.(index)}
            >
              <Pencil size={13} strokeWidth={1.9} aria-hidden />
            </SteerActionButton>
            {/* Delete: discard this queued message. */}
            <SteerDeleteButton
              type="button"
              aria-label="Delete queued message"
              title="Delete"
              onClick={() => onRemoveQueued?.(index)}
            >
              <Trash2 size={13} strokeWidth={1.9} aria-hidden />
            </SteerDeleteButton>
          </SteerActions>
        </ComposerSteer>
      ))}
    </ComposerSteerStack>
  );
}

const ComposerSteerStack = styled.div`
  max-height: 168px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  margin-bottom: -8px;
`;

const ComposerSteer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 12px;
  border: 1px solid var(--tide-line);
  border-radius: 12px;
  background: var(--tide-surface);
  color: var(--tide-text);
  font-size: 13px;
  line-height: 18px;
  box-shadow: 0 1px 2px rgba(52, 48, 56, 0.04);
`;

const SteerIconWrap = styled.span`
  flex-shrink: 0;
  color: var(--tide-muted);
`;

const SteerBadge = styled.span`
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--tide-selection);
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
`;

const SteerText = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--tide-text);
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SteerActions = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
`;

const SteerActionButton = styled.button`
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

const SteerInterruptButton = styled(SteerActionButton)`
  color: var(--tide-action);

  &:hover {
    background: var(--tide-action);
    color: var(--tide-on-action);
  }
`;

const SteerDeleteButton = styled(SteerActionButton)`
  &:hover {
    background: var(--tide-danger);
    color: var(--tide-bg);
  }
`;
