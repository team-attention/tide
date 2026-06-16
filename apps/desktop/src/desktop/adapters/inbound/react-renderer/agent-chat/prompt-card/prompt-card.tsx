import type { AgentChatPromptStep, AgentChatPromptStepAnswer, AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { useEffect, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// A unified, pretty prompt card for any agent's question / approval / choice /
// permission request: the message, selectable options (with their provider
// values), an "Other" free-text reply, and Skip / Submit. Replaces the generic
// menu-style rendering so every provider's prompt looks the same.
//
// A batched multi-question prompt (claude AskUserQuestion, `prompt.steps.length > 1`)
// renders instead as a navigable WIZARD: the user moves Back/Next across the steps,
// reviews and revises any prior answer, and submits them all together — nothing commits
// until the final submit. Single prompts (every permission/approval, a 1-question
// AskUserQuestion) keep the original single-card path unchanged. See
// docs_v2/specs/multi-step-prompt-navigation.md.
export function PromptCard(props: {
  prompt: NonNullable<AgentChatShellViewModel["prompt"]>;
  onSelectChoice: (choiceId: string) => void;
  onAnswerText: (value: string) => void;
  onAnswerSteps: (stepAnswers: AgentChatPromptStepAnswer[]) => void;
}): ReactElement {
  const steps = props.prompt.steps;
  if (steps !== undefined && steps.length > 1) {
    return <WizardPromptCard steps={steps} onAnswerSteps={props.onAnswerSteps} />;
  }
  return (
    <SinglePromptCard
      prompt={props.prompt}
      onSelectChoice={props.onSelectChoice}
      onAnswerText={props.onAnswerText}
    />
  );
}

function SinglePromptCard(props: {
  prompt: NonNullable<AgentChatShellViewModel["prompt"]>;
  onSelectChoice: (choiceId: string) => void;
  onAnswerText: (value: string) => void;
}): ReactElement {
  const choices = props.prompt.choices ?? [];
  const hasChoices = choices.length > 0;
  // A multi-select question (e.g. claude AskUserQuestion multiSelect): the user toggles
  // several options and submits them together, instead of one pick finalizing.
  const multiSelect = props.prompt.multiSelect === true && hasChoices;
  const [selectedId, setSelectedId] = useState<string | null>(
    props.prompt.defaultChoiceId ?? null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [otherActive, setOtherActive] = useState(!hasChoices && !multiSelect);
  const [otherText, setOtherText] = useState("");
  const toggleMulti = (choiceId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(choiceId)) {
        next.delete(choiceId);
      } else {
        next.add(choiceId);
      }
      return next;
    });
  };
  const canSubmit = multiSelect
    ? selectedIds.size > 0
    : otherActive
    ? otherText.trim().length > 0
    : selectedId !== null;
  const submit = () => {
    if (multiSelect) {
      if (selectedIds.size === 0) {
        return;
      }
      // claude records the joined option labels as this question's answer (free-text
      // path — no STRUCTURED_OPTION_PREFIX). Preserve the listed order.
      const labels = choices.filter((choice) => selectedIds.has(choice.choiceId)).map((choice) => choice.label);
      props.onAnswerText(labels.join(", "));
      return;
    }
    if (otherActive) {
      if (otherText.trim().length > 0) {
        props.onAnswerText(otherText.trim());
      }
      return;
    }
    if (selectedId !== null) {
      props.onSelectChoice(selectedId);
    }
  };
  // Keyboard: ↑/↓ move between options (incl. "Other…"); ⌘/Ctrl+Enter submits the
  // prompt from anywhere (composer included) — mirrors the "⌘↵" hint. Plain Enter
  // and arrows in a text field are left alone so the composer keeps working.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ⌘/Ctrl+Enter submits the prompt from ANYWHERE (composer included), so you can
      // answer Allow/Deny without the composer draft being flushed as the answer.
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
        return;
      }
      // Arrows move options only when focus is NOT in a text field, so they don't
      // hijack the composer's or the Other field's cursor. (Multi-select toggles by
      // click instead, so single-option arrow navigation does not apply.)
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      if (!multiSelect && (event.key === "ArrowDown" || event.key === "ArrowUp") && !inEditable) {
        const ids = [...choices.map((choice) => choice.choiceId), ...(hasChoices ? ["__other"] : [])];
        if (ids.length === 0) {
          return;
        }
        event.preventDefault();
        const current = otherActive
          ? ids.indexOf("__other")
          : selectedId !== null
          ? ids.indexOf(selectedId)
          : -1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          current < 0 ? (delta > 0 ? 0 : ids.length - 1) : (current + delta + ids.length) % ids.length;
        const nextId = ids[nextIndex];
        if (nextId === "__other") {
          setOtherActive(true);
          setSelectedId(null);
        } else {
          setOtherActive(false);
          setSelectedId(nextId);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [choices, hasChoices, multiSelect, otherActive, selectedId, selectedIds, otherText, props]);
  const kindLabel =
    props.prompt.kind === "approval"
      ? "Approval needed"
      : props.prompt.kind === "permission"
      ? "Permission needed"
      : props.prompt.kind === "choice"
      ? "Choose an option"
      : "Question";
  return (
    <div className="prompt-card" role="group" aria-label="Agent prompt">
      <div className="prompt-card__head">
        <span className="prompt-card__kind">{multiSelect ? "Select all that apply" : kindLabel}</span>
        <p className="prompt-card__message">{props.prompt.message}</p>
      </div>
      <div className="prompt-card__options">
        {renderOptions({
          choices,
          multiSelect,
          selectedId,
          selectedIds,
          otherActive,
          otherText,
          hasChoices,
          onPickChoice: (choiceId) => {
            setOtherActive(false);
            setSelectedId(choiceId);
          },
          onToggleMulti: toggleMulti,
          onPickOther: () => {
            setOtherActive(true);
            setSelectedId(null);
          },
          onOtherText: setOtherText,
          onOtherEnter: submit,
        })}
      </div>
      <div className="prompt-card__actions">
        <button type="button" className="prompt-card__skip" onClick={() => props.onAnswerText("")}>
          Skip
        </button>
        <button type="button" className="prompt-card__submit" disabled={!canSubmit} onClick={submit}>
          Submit
          <span className="prompt-card__submit-kbd">⌘↵</span>
        </button>
      </div>
    </div>
  );
}

// Per-step answer state for the wizard: a single pick, a multi-select set, or an
// "Other…" free-text reply.
interface StepAnswerState {
  selectedId: string | null;
  selectedIds: Set<string>;
  otherActive: boolean;
  otherText: string;
}

function initStepAnswer(step: AgentChatPromptStep): StepAnswerState {
  const hasChoices = (step.choices?.length ?? 0) > 0;
  const multiSelect = step.multiSelect === true && hasChoices;
  return {
    // Pre-select the default option so a single-select step always has a valid answer
    // (mirrors the single card's default-first); free navigation only reviews/changes it.
    selectedId: multiSelect ? null : step.defaultChoiceId ?? null,
    selectedIds: new Set(),
    otherActive: !hasChoices && !multiSelect,
    otherText: "",
  };
}

// Resolve one step's provider-native answer value — identical encoding to the single
// card: a chosen option's providerValue, joined labels for multiSelect (free text), the
// trimmed "Other…" text, or "" when nothing is chosen (a skipped step).
function resolveStepValue(step: AgentChatPromptStep, answer: StepAnswerState): string {
  const choices = step.choices ?? [];
  const multiSelect = step.multiSelect === true && choices.length > 0;
  if (multiSelect) {
    return choices
      .filter((choice) => answer.selectedIds.has(choice.choiceId))
      .map((choice) => choice.label)
      .join(", ");
  }
  if (answer.otherActive) {
    return answer.otherText.trim();
  }
  if (answer.selectedId !== null) {
    return choices.find((choice) => choice.choiceId === answer.selectedId)?.providerValue ?? "";
  }
  return "";
}

function stepIsAnswered(step: AgentChatPromptStep, answer: StepAnswerState): boolean {
  return resolveStepValue(step, answer).length > 0;
}

function WizardPromptCard(props: {
  steps: AgentChatPromptStep[];
  onAnswerSteps: (stepAnswers: AgentChatPromptStepAnswer[]) => void;
}): ReactElement {
  const steps = props.steps;
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<StepAnswerState[]>(() => steps.map(initStepAnswer));
  const step = steps[stepIndex];
  const answer = answers[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const choices = step.choices ?? [];
  const hasChoices = choices.length > 0;
  const multiSelect = step.multiSelect === true && hasChoices;

  const setCurrent = (updater: (prev: StepAnswerState) => StepAnswerState) => {
    setAnswers((prev) => prev.map((entry, index) => (index === stepIndex ? updater(entry) : entry)));
  };
  const submit = () => {
    props.onAnswerSteps(
      steps.map((eachStep, index) => ({
        stepId: eachStep.stepId,
        value: resolveStepValue(eachStep, answers[index]),
      })),
    );
  };
  const goNext = () => {
    if (isLast) {
      submit();
    } else {
      setStepIndex((index) => Math.min(index + 1, steps.length - 1));
    }
  };
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0));

  // Keyboard: ⌘/Ctrl+Enter advances (Next, or Submit on the last step) from anywhere;
  // ↑/↓ move options within the current step (single-select). Back is via button/dot.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        goNext();
        return;
      }
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      if (!multiSelect && (event.key === "ArrowDown" || event.key === "ArrowUp") && !inEditable) {
        const ids = [...choices.map((choice) => choice.choiceId), ...(hasChoices ? ["__other"] : [])];
        if (ids.length === 0) {
          return;
        }
        event.preventDefault();
        const current = answer.otherActive
          ? ids.indexOf("__other")
          : answer.selectedId !== null
          ? ids.indexOf(answer.selectedId)
          : -1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          current < 0 ? (delta > 0 ? 0 : ids.length - 1) : (current + delta + ids.length) % ids.length;
        const nextId = ids[nextIndex];
        if (nextId === "__other") {
          setCurrent((prev) => ({ ...prev, otherActive: true, selectedId: null }));
        } else {
          setCurrent((prev) => ({ ...prev, otherActive: false, selectedId: nextId }));
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, answers, choices, hasChoices, multiSelect, isLast]);

  return (
    <div className="prompt-card prompt-card--wizard" role="group" aria-label="Agent prompt">
      <div className="prompt-card__head">
        <div className="prompt-card__wizard-head">
          <span className="prompt-card__kind">
            {multiSelect ? "Select all that apply" : "Question"}
            <span className="prompt-card__step-count"> · {stepIndex + 1} of {steps.length}</span>
          </span>
          <div className="prompt-card__steps" role="tablist" aria-label="Steps">
            {steps.map((eachStep, index) => (
              <button
                key={eachStep.stepId}
                type="button"
                className="prompt-card__step-dot"
                data-active={index === stepIndex ? "true" : "false"}
                data-answered={stepIsAnswered(eachStep, answers[index]) ? "true" : "false"}
                aria-label={`Step ${index + 1}${index === stepIndex ? " (current)" : ""}`}
                aria-current={index === stepIndex ? "step" : undefined}
                onClick={() => setStepIndex(index)}
              />
            ))}
          </div>
        </div>
        <p className="prompt-card__message">{step.message}</p>
      </div>
      <div className="prompt-card__options">
        {renderOptions({
          choices,
          multiSelect,
          selectedId: answer.selectedId,
          selectedIds: answer.selectedIds,
          otherActive: answer.otherActive,
          otherText: answer.otherText,
          hasChoices,
          onPickChoice: (choiceId) =>
            setCurrent((prev) => ({ ...prev, otherActive: false, selectedId: choiceId })),
          onToggleMulti: (choiceId) =>
            setCurrent((prev) => {
              const next = new Set(prev.selectedIds);
              if (next.has(choiceId)) {
                next.delete(choiceId);
              } else {
                next.add(choiceId);
              }
              return { ...prev, selectedIds: next };
            }),
          onPickOther: () =>
            setCurrent((prev) => ({ ...prev, otherActive: true, selectedId: null })),
          onOtherText: (value) => setCurrent((prev) => ({ ...prev, otherText: value })),
          onOtherEnter: goNext,
        })}
      </div>
      <div className="prompt-card__actions">
        <button
          type="button"
          className="prompt-card__skip"
          disabled={stepIndex === 0}
          onClick={goBack}
        >
          Back
        </button>
        <button type="button" className="prompt-card__submit" onClick={goNext}>
          {isLast ? "Submit" : "Next"}
          <span className="prompt-card__submit-kbd">⌘↵</span>
        </button>
      </div>
    </div>
  );
}

// Shared option list (single pick / multi-select toggles / "Other…" free text) used by
// both the single card and each wizard step, so they look and behave identically.
function renderOptions(input: {
  choices: { choiceId: string; label: string; providerValue: string }[];
  multiSelect: boolean;
  selectedId: string | null;
  selectedIds: Set<string>;
  otherActive: boolean;
  otherText: string;
  hasChoices: boolean;
  onPickChoice: (choiceId: string) => void;
  onToggleMulti: (choiceId: string) => void;
  onPickOther: () => void;
  onOtherText: (value: string) => void;
  onOtherEnter: () => void;
}): ReactElement {
  const option = (
    key: string,
    label: string,
    detail: string | undefined,
    selected: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      className="prompt-card__option"
      data-selected={selected ? "true" : "false"}
      data-multi={input.multiSelect ? "true" : undefined}
      aria-pressed={input.multiSelect ? selected : undefined}
      onClick={onClick}
    >
      <span className="prompt-card__radio" aria-hidden />
      <span className="prompt-card__option-label">{label}</span>
      {detail ? <span className="prompt-card__option-value">{detail}</span> : null}
    </button>
  );
  return (
    <>
      {input.choices.map((choice) =>
        option(
          choice.choiceId,
          choice.label,
          choice.providerValue && choice.providerValue !== choice.label ? choice.providerValue : undefined,
          input.multiSelect
            ? input.selectedIds.has(choice.choiceId)
            : !input.otherActive && input.selectedId === choice.choiceId,
          input.multiSelect
            ? () => input.onToggleMulti(choice.choiceId)
            : () => input.onPickChoice(choice.choiceId),
        ),
      )}
      {input.hasChoices && !input.multiSelect
        ? option("__other", "Other…", undefined, input.otherActive, input.onPickOther)
        : null}
      {input.otherActive ? (
        <textarea
          className="prompt-card__other"
          placeholder={input.hasChoices ? "Type a custom reply…" : "Type your reply…"}
          value={input.otherText}
          rows={input.hasChoices ? 2 : 3}
          autoFocus
          spellCheck={false}
          aria-label="Custom reply"
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => input.onOtherText(event.currentTarget.value)}
          onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              input.onOtherEnter();
            }
          }}
        />
      ) : null}
    </>
  );
}
