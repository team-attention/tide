import type { ReactElement } from "react";
import { renderUserAttachmentBody } from "../transcript/user-turn.tsx";
import { ArrowUp, CornerDownRight, Pencil, Trash2 } from "lucide-react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// Optimistic just-sent user row, shown until the backend's real user block arrives.
// The "Queued" badge only appears when the agent is genuinely busy and the
// message is actually queued behind the live turn — never on an idle send, which goes
// straight through.
export function createQueuedInputRow(queuedInput: string, queued: boolean, index = 0): ReactElement {
  const hasAttachments = queuedInput.includes("**↳ ");
  return (
    <article
      key={`queued-${index}`}
      className={
        queued
          ? "agent-session-turn agent-session-turn--user agent-session-turn--queued"
          : "agent-session-turn agent-session-turn--user"
      }
      data-block-role="user"
      {...(queued ? { "data-queued": true } : {})}
    >
      <span className="agent-session-turn__label">
        You
        {queued ? <span className="agent-session-turn__queued-badge">Queued</span> : null}
        {/* Edit the queued message before it runs (only while genuinely queued).
            Handled by the Agent Session's delegated onClick via [data-edit-queued]. */}
        {queued ? (
          <button
            type="button"
            className="agent-session-turn__edit"
            data-edit-queued
            aria-label="Edit queued message"
            title="Edit queued message"
          >
            <Pencil size={12} strokeWidth={1.9} aria-hidden />
          </button>
        ) : null}
      </span>
      {hasAttachments ? (
        renderUserAttachmentBody(queuedInput)
      ) : (
        <p className="agent-session-turn__body">{queuedInput}</p>
      )}
    </article>
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
    <div className="composer-steer-stack">
      {queuedInputs.map((queuedInput, index) => (
        <div key={`steer-${index}`} className="composer-steer" data-queued>
          <CornerDownRight size={13} strokeWidth={1.9} className="composer-steer__icon" aria-hidden />
          <span className="composer-steer__badge">Queued</span>
          <span className="composer-steer__text">{queuedInput}</span>
          <span className="composer-steer__actions">
            {/* Send now: cut the live turn so this queued message runs now — framed as
                a "send" (arrow-up), matching the composer's send button, not a red stop. */}
            <button
              type="button"
              className="composer-steer__interrupt"
	              aria-label="Send now — interrupt the current turn and run this message"
	              title="Send now (interrupt current turn)"
	              onClick={() => onRunQueuedInputNow?.(index)}
	            >
              <ArrowUp size={15} strokeWidth={2.3} aria-hidden />
            </button>
            {/* Edit: pull this message back into the Composer to edit. */}
            <button
              type="button"
              className="composer-steer__edit"
              aria-label="Edit queued message"
              title="Edit"
              onClick={() => onEditQueued?.(index)}
            >
              <Pencil size={13} strokeWidth={1.9} aria-hidden />
            </button>
            {/* Delete: discard this queued message. */}
            <button
              type="button"
              className="composer-steer__delete"
              aria-label="Delete queued message"
              title="Delete"
              onClick={() => onRemoveQueued?.(index)}
            >
              <Trash2 size={13} strokeWidth={1.9} aria-hidden />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
