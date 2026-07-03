import { useEffect, useRef, useState, type ReactElement } from "react";
import { styled } from "styled-components";
import { CheckCircle2, Circle, CircleDot, Target } from "lucide-react";
import type {
  AgentChatChecklistStatus,
  AgentChatChecklistView,
  AgentChatGoalState,
} from "../../../../../application/domains/agent-chat/agent-chat.ts";

// The pinned panel at the top of the chat column: the thread goal (user-set,
// editable) above the agent's live checklist (read-only, the latest "plan" block).
// Mounted only when an active thread has a goal/checklist or an edit in progress.
// See thread-goal-and-checklist-panel.md.
export function GoalChecklistPanel(props: {
  goal?: string;
  goalState?: AgentChatGoalState;
  checklist: AgentChatChecklistView | null;
  onSetGoal?: (goal: string) => void;
}): ReactElement | null {
  const { goal, goalState, checklist, onSetGoal } = props;
  const [editing, setEditing] = useState(false);
  const currentGoal = (goalState?.objective ?? goal ?? "").trim();
  const [draft, setDraft] = useState(currentGoal);
  const [collapsed, setCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isCancellingRef = useRef(false);

  // Keep the draft in sync with backend-confirmed goal changes while not editing.
  useEffect(() => {
    if (!editing) {
      setDraft(currentGoal);
    }
  }, [currentGoal, editing]);

  useEffect(() => {
    if (editing) {
      isCancellingRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const hasGoal = currentGoal.length > 0;
  const hasChecklist = checklist !== null && checklist.entries.length > 0;

  if (!editing && !hasGoal && !hasChecklist) {
    return null;
  }

  const commit = (): void => {
    if (isCancellingRef.current) {
      return;
    }
    const next = draft.trim();
    setEditing(false);
    if (next !== currentGoal) {
      onSetGoal?.(next);
    }
  };

  const cancel = (): void => {
    isCancellingRef.current = true;
    setEditing(false);
    setDraft(currentGoal);
  };

  return (
    <GoalChecklistPanelFrame
      $hasChecklist={hasChecklist}
      aria-label="Thread goal and checklist"
      data-goal-checklist-panel="true"
      data-checklist-mode={hasChecklist ? "with-checklist" : "goal-only"}
    >
      <GoalRow>
        <GoalLabel>
          <Target size={13} strokeWidth={2} aria-hidden />
          <span>Goal</span>
        </GoalLabel>
        {editing ? (
          <GoalInput
            ref={inputRef}
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
          <GoalTextButton
            type="button"
            $empty={!hasGoal}
            title={hasGoal ? "Edit goal" : "Set a goal"}
            onClick={() => {
              setDraft(currentGoal);
              setEditing(true);
            }}
          >
            {hasGoal ? currentGoal : "Set a goal for this thread"}
          </GoalTextButton>
        )}
        {goalState !== undefined && hasGoal ? (
          <GoalStatusPill $status={goalState.status}>
            {goalStatusLabel(goalState)}
          </GoalStatusPill>
        ) : null}
        {hasChecklist ? (
          <ChecklistProgressButton
            type="button"
            aria-expanded={!collapsed}
            title={collapsed ? "Show checklist" : "Hide checklist"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {checklist.doneCount}/{checklist.totalCount}
          </ChecklistProgressButton>
        ) : null}
      </GoalRow>
      {hasChecklist && !collapsed ? (
        <ChecklistList>
          {checklist.entries.map((entry, index) => (
            <ChecklistItem
              key={`${index}-${entry.text}`}
              $status={entry.status}
              data-checklist-item-status={entry.status}
            >
              <ChecklistStatusIcon status={entry.status} />
              <ChecklistItemText>{entry.text}</ChecklistItemText>
            </ChecklistItem>
          ))}
        </ChecklistList>
      ) : null}
    </GoalChecklistPanelFrame>
  );
}

function goalStatusLabel(goalState: AgentChatGoalState): string {
  const provider = goalState.provider;
  switch (goalState.status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "blocked":
      return "Blocked";
    case "usage_limited":
      return "Usage limit";
    case "budget_limited":
      return "Budget limit";
    case "complete":
      return "Complete";
  }
  return provider;
}

function ChecklistStatusIcon({ status }: { status: AgentChatChecklistStatus }): ReactElement {
  if (status === "done") {
    return (
      <CheckCircle2 size={14} strokeWidth={2} aria-label="Done" />
    );
  }
  if (status === "in_progress") {
    return (
      <CircleDot size={14} strokeWidth={2} aria-label="In progress" />
    );
  }
  return (
    <Circle size={14} strokeWidth={2} aria-label="Pending" />
  );
}

const GoalChecklistPanelFrame = styled.section<{ $hasChecklist: boolean }>`
  width: min(760px, calc(100% - 32px));
  min-width: 0;
  display: grid;
  gap: 7px;
  margin: 0 auto;
  padding: ${({ $hasChecklist }) => ($hasChecklist ? "8px 10px" : "0 2px")};
  border: ${({ $hasChecklist }) => ($hasChecklist ? "1px solid var(--tide-border)" : "0")};
  border-radius: ${({ $hasChecklist }) => ($hasChecklist ? "8px" : "0")};
  background: ${({ $hasChecklist }) =>
    $hasChecklist
      ? "color-mix(in srgb, var(--tide-surface) 97%, var(--tide-text) 3%)"
      : "transparent"};
  box-shadow: ${({ $hasChecklist }) =>
    $hasChecklist ? "0 1px 2px rgba(15, 23, 42, 0.035)" : "none"};
`;

const GoalRow = styled.div`
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
`;

const GoalLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  color: var(--tide-muted);
  font-size: 12px;
  font-weight: 560;
  line-height: 1;

  svg {
    color: var(--tide-muted);
  }
`;

const goalControlCss = `
  min-width: 0;
  min-height: 26px;
  border: 0;
  border-radius: 6px;
  font: inherit;
`;

const GoalTextButton = styled.button<{ $empty: boolean }>`
  ${goalControlCss}
  padding: 3px 6px;
  color: ${({ $empty }) => ($empty ? "var(--tide-muted)" : "var(--tide-text)")};
  background: transparent;
  text-align: left;
  line-height: 1.35;
  overflow-wrap: anywhere;
  cursor: text;

  &:hover {
    background: color-mix(in srgb, var(--tide-selection) 60%, transparent);
  }
`;

const GoalInput = styled.input`
  ${goalControlCss}
  width: 100%;
  padding: 0 7px;
  color: var(--tide-text);
  background: var(--tide-bg);
  outline: 1px solid var(--tide-accent);
`;

const GoalStatusPill = styled.span<{ $status: AgentChatGoalState["status"] }>`
  ${goalControlCss}
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  color: ${({ $status }) => {
    if ($status === "active") {
      return "var(--tide-accent)";
    }
    if ($status === "complete") {
      return "var(--tide-success)";
    }
    if ($status === "blocked" || $status === "usage_limited" || $status === "budget_limited") {
      return "var(--tide-danger)";
    }
    return "var(--tide-muted)";
  }};
  background: color-mix(in srgb, var(--tide-bg) 82%, var(--tide-text) 6%);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
`;

const ChecklistProgressButton = styled.button`
  ${goalControlCss}
  padding: 0 8px;
  color: var(--tide-muted);
  background: var(--tide-bg);
  font-size: 12px;
  font-weight: 600;

  &:hover {
    color: var(--tide-text);
  }
`;

const ChecklistList = styled.ul`
  min-width: 0;
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0 0 0 23px;
  list-style: none;
`;

const ChecklistItem = styled.li<{ $status: AgentChatChecklistStatus }>`
  min-width: 0;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: start;
  gap: 7px;
  color: ${({ $status }) => {
    if ($status === "in_progress") {
      return "var(--tide-text)";
    }
    if ($status === "done") {
      return "color-mix(in srgb, var(--tide-muted) 82%, var(--tide-text) 18%)";
    }
    return "var(--tide-muted)";
  }};
  font-size: 12.5px;
  line-height: 1.35;

  > svg {
    margin-top: 1px;
    color: currentColor;
  }
`;

const ChecklistItemText = styled.span`
  min-width: 0;
  overflow-wrap: anywhere;
`;
