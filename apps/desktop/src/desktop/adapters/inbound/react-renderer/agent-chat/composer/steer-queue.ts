import { createElement } from "react";
import type { ReactElement } from "react";
import { renderUserAttachmentBody } from "../transcript/user-turn.ts";
import { CornerDownRight, Square, Trash2 } from "lucide-react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// Optimistic just-sent user row, shown until the backend's real user block arrives.
// The "대기 중" (waiting) badge only appears when the agent is genuinely busy and the
// message is actually queued behind the live turn — never on an idle send, which goes
// straight through.
export function createQueuedInputRow(queuedInput: string, queued: boolean, index = 0): ReactElement {
  const hasAttachments = queuedInput.includes("**↳ ");
  return createElement(
    "article",
    {
      key: `queued-${index}`,
      className: queued
        ? "agent-session-turn agent-session-turn--user agent-session-turn--queued"
        : "agent-session-turn agent-session-turn--user",
      "data-block-role": "user",
      ...(queued ? { "data-queued": true } : {}),
    },
    createElement(
      "span",
      { className: "agent-session-turn__label" },
      "You",
      queued
        ? createElement("span", { className: "agent-session-turn__queued-badge" }, "대기 중")
        : null,
      // Edit the queued message before it runs (only while genuinely queued).
      // Handled by the Agent Session's delegated onClick via [data-edit-queued].
      queued
        ? createElement(
            "button",
            {
              type: "button",
              className: "agent-session-turn__edit",
              "data-edit-queued": true,
              "aria-label": "Edit queued message",
              title: "Edit queued message",
            },
            "수정",
          )
        : null,
    ),
    hasAttachments
      ? renderUserAttachmentBody(queuedInput)
      : createElement("p", { className: "agent-session-turn__body" }, queuedInput),
  );
}

// The pending "steer" messages docked to the top of the Composer while a turn is
// live: a FIFO stack of queued follow-ups. Each row carries three controls —
// 인터럽트 (cut the live turn so the queue runs now), 수정 (pull it back into the
// Composer to edit), and 삭제 (discard it). The stack is height-capped and scrolls
// (CSS), so a long queue never pushes the Composer off-screen.
export function createQueuedSteerStack(
  queuedInputs: string[],
  onEditQueued?: (index: number) => void,
  onInterrupt?: () => void,
  onRemoveQueued?: (index: number) => void,
): ReactElement {
  return createElement(
    "div",
    { className: "composer-steer-stack" },
    ...queuedInputs.map((queuedInput, index) =>
      createElement(
        "div",
        { key: `steer-${index}`, className: "composer-steer", "data-queued": true },
        createElement(CornerDownRight, {
          size: 13,
          strokeWidth: 1.9,
          className: "composer-steer__icon",
          "aria-hidden": true,
        }),
        createElement("span", { className: "composer-steer__badge" }, "대기 중"),
        createElement("span", { className: "composer-steer__text" }, queuedInput),
        createElement(
          "span",
          { className: "composer-steer__actions" },
          // 인터럽트: cut the live turn so the queue runs now.
          createElement(
            "button",
            {
              type: "button",
              className: "composer-steer__interrupt",
              "aria-label": "Interrupt the current turn and run the queue",
              title: "끊고 실행 (인터럽트)",
              onClick: () => onInterrupt?.(),
            },
            createElement(Square, { size: 11, strokeWidth: 0, fill: "currentColor", "aria-hidden": true }),
          ),
          // 수정: pull this message back into the Composer to edit.
          createElement(
            "button",
            {
              type: "button",
              className: "composer-steer__edit",
              "aria-label": "Edit queued message",
              title: "수정",
              onClick: () => onEditQueued?.(index),
            },
            "수정",
          ),
          // 삭제: discard this queued message.
          createElement(
            "button",
            {
              type: "button",
              className: "composer-steer__delete",
              "aria-label": "Delete queued message",
              title: "삭제",
              onClick: () => onRemoveQueued?.(index),
            },
            createElement(Trash2, { size: 13, strokeWidth: 1.9, "aria-hidden": true }),
          ),
        ),
      ),
    ),
  );
}
