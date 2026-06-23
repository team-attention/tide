import { useEffect, useRef, useState, type ReactElement } from "react";
import { CheckCircle2, Circle, CircleDot, Target } from "lucide-react";
import type {
  AgentChatChecklistStatus,
  AgentChatChecklistView,
} from "../../../../../application/domains/agent-chat/agent-chat.ts";

// The pinned panel at the top of the chat column: the thread goal (user-set,
// editable) above the agent's live checklist (read-only, the latest "plan" block).
// Mounted only for an active thread. See thread-goal-and-checklist-panel.md.
export function GoalChecklistPanel(props: {
  goal?: string;
  checklist: AgentChatChecklistView | null;
  onSetGoal?: (goal: string) => void;
}): ReactElement {
  const { goal, checklist, onSetGoal } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal ?? "");
  const [collapsed, setCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the draft in sync with backend-confirmed goal changes while not editing.
  useEffect(() => {
    if (!editing) {
      setDraft(goal ?? "");
    }
  }, [goal, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const currentGoal = (goal ?? "").trim();
  const hasGoal = currentGoal.length > 0;
  const hasChecklist = checklist !== null && checklist.entries.length > 0;

  const commit = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (next !== currentGoal) {
      onSetGoal?.(next);
    }
  };

  const cancel = (): void => {
    setEditing(false);
    setDraft(goal ?? "");
  };

  return (
    <section className="goal-checklist-panel" aria-label="Thread goal and checklist">
      <div className="goal-checklist-panel__goal-row">
        <Target size={14} strokeWidth={2} className="goal-checklist-panel__goal-icon" aria-hidden />
        {editing ? (
          <input
            ref={inputRef}
            className="goal-checklist-panel__goal-input"
            value={draft}
            placeholder="Describe the goal for this thread…"
            aria-label="Thread goal"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={`goal-checklist-panel__goal-text${hasGoal ? "" : " goal-checklist-panel__goal-text--empty"}`}
            title={hasGoal ? "Edit goal" : "Set a goal"}
            onClick={() => {
              setDraft(goal ?? "");
              setEditing(true);
            }}
          >
            {hasGoal ? currentGoal : "Set a goal for this thread"}
          </button>
        )}
        {hasChecklist ? (
          <button
            type="button"
            className="goal-checklist-panel__progress"
            aria-expanded={!collapsed}
            title={collapsed ? "Show checklist" : "Hide checklist"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {checklist.doneCount}/{checklist.totalCount}
          </button>
        ) : null}
      </div>
      {hasChecklist && !collapsed ? (
        <ul className="goal-checklist-panel__list">
          {checklist.entries.map((entry, index) => (
            <li
              key={`${index}-${entry.text}`}
              className={`goal-checklist-panel__item goal-checklist-panel__item--${entry.status}`}
            >
              <ChecklistStatusIcon status={entry.status} />
              <span className="goal-checklist-panel__item-text">{entry.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ChecklistStatusIcon({ status }: { status: AgentChatChecklistStatus }): ReactElement {
  if (status === "done") {
    return (
      <CheckCircle2 size={14} strokeWidth={2} className="goal-checklist-panel__item-icon" aria-label="Done" />
    );
  }
  if (status === "in_progress") {
    return (
      <CircleDot size={14} strokeWidth={2} className="goal-checklist-panel__item-icon" aria-label="In progress" />
    );
  }
  return (
    <Circle size={14} strokeWidth={2} className="goal-checklist-panel__item-icon" aria-label="Pending" />
  );
}
