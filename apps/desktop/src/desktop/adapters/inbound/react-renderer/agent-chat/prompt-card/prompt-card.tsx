import type { AgentChatPromptChoice, AgentChatPromptDetail, AgentChatPromptStep, AgentChatPromptStepAnswer, AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { useEffect, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import {
  PromptActions,
  PromptAnswerNote,
  PromptBody,
  PromptCardFrame,
  PromptCustomReply,
  PromptDetail,
  PromptDetailBody,
  PromptDetailLine,
  PromptDetailLocation,
  PromptDetailLocations,
  PromptHead,
  PromptHeaderChip,
  PromptKind,
  PromptMessage,
  PromptOptionButton,
  PromptOptionLabel,
  PromptOptionMark,
  PromptOptionPreview,
  PromptOptionShortcut,
  PromptOptionText,
  PromptOptionValue,
  PromptOptions,
  PromptSecondaryButton,
  PromptStepCount,
  PromptStepDot,
  PromptStepTabs,
  PromptSubmitButton,
  PromptSubmitShortcut,
  PromptWizardHead,
} from "./prompt-card.parts.tsx";
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
  onAnswerText: (value: string, notes?: string) => void;
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

// The command / diff an approval prompt is asking the user to approve, with affected paths.
// `format:"diff"` colorizes +/- lines; `"text"` renders as a monospace block.
function PromptDetailView(props: { detail: AgentChatPromptDetail }): ReactElement {
  const { detail } = props;
  return (
    <PromptDetail data-prompt-detail="true" data-format={detail.format}>
      <PromptDetailBody data-prompt-detail-body="true">
        {detail.format === "diff"
          ? detail.body.split("\n").map((line, index) => (
              <PromptDetailLine
                key={index}
                data-line={line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx"}
              >
                {line}
                {"\n"}
              </PromptDetailLine>
            ))
          : detail.body}
      </PromptDetailBody>
      {detail.locations !== undefined && detail.locations.length > 0 ? (
        <PromptDetailLocations>
          {detail.locations.map((path) => (
            <PromptDetailLocation key={path} data-prompt-detail-location="true">
              {path}
            </PromptDetailLocation>
          ))}
        </PromptDetailLocations>
      ) : null}
    </PromptDetail>
  );
}

function SinglePromptCard(props: {
  prompt: NonNullable<AgentChatShellViewModel["prompt"]>;
  onSelectChoice: (choiceId: string) => void;
  onAnswerText: (value: string, notes?: string) => void;
}): ReactElement {
  const choices = props.prompt.choices ?? [];
  const hasChoices = choices.length > 0;
  const allowOther = props.prompt.kind === "choice" || props.prompt.kind === "question";
  // A multi-select question (e.g. claude AskUserQuestion multiSelect): the user toggles
  // several options and submits them together, instead of one pick finalizing.
  const multiSelect = props.prompt.multiSelect === true && hasChoices;
  const [selectedId, setSelectedId] = useState<string | null>(
    props.prompt.defaultChoiceId ?? null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [otherActive, setOtherActive] = useState(allowOther && !hasChoices && !multiSelect);
  const [otherText, setOtherText] = useState("");
  // AskUserQuestion (kind:"choice") is the only prompt with a per-answer note channel
  // (claude annotations). Approval/permission cards have no native notes sink → no field.
  const isAUQ = props.prompt.kind === "choice";
  const [notes, setNotes] = useState("");
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
    // Notes only ride on AskUserQuestion answers (claude annotations); undefined elsewhere.
    // Never on an "Other…" reply — that field is hidden then, so it'd be a stale, invisible note.
    const note = isAUQ && !otherActive && notes.trim().length > 0 ? notes.trim() : undefined;
    if (multiSelect) {
      if (selectedIds.size === 0) {
        return;
      }
      // claude records the joined option labels as this question's answer (free-text
      // path — no STRUCTURED_OPTION_PREFIX). Preserve the listed order.
      const labels = choices.filter((choice) => selectedIds.has(choice.choiceId)).map((choice) => choice.label);
      props.onAnswerText(labels.join(", "), note);
      return;
    }
    if (otherActive) {
      if (otherText.trim().length > 0) {
        props.onAnswerText(otherText.trim(), note);
      }
      return;
    }
    if (selectedId !== null) {
      // For an AskUserQuestion pick, route through the value path (the chosen option's
      // providerValue) so the note rides along; approval picks keep the choiceId path.
      if (isAUQ) {
        const value = choices.find((choice) => choice.choiceId === selectedId)?.providerValue ?? "";
        props.onAnswerText(value, note);
      } else {
        props.onSelectChoice(selectedId);
      }
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
      // ⌘/Ctrl+1..9 SELECTS the N-th visible option (highlight only — confirming
      // still goes through ⌘Enter, so the user can keep typing after picking).
      // Match the physical digit (event.code) and exclude Option, which is the
      // multitask jump's modifier. See docs_v2/specs/prompt-card-number-key-selection.md.
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const digit = /^Digit([1-9])$/.exec(event.code);
        if (digit !== null) {
          const choiceIds = choices.map((choice) => choice.choiceId);
          const ids = multiSelect ? choiceIds : [...choiceIds, ...(allowOther && hasChoices ? ["__other"] : [])];
          const target = ids[Number(digit[1]) - 1];
          if (target !== undefined) {
            event.preventDefault();
            if (target === "__other") {
              setOtherActive(true);
              setSelectedId(null);
            } else if (multiSelect) {
              toggleMulti(target);
            } else {
              setOtherActive(false);
              setSelectedId(target);
            }
          }
          return;
        }
      }
      // Arrows move options only when focus is NOT in a text field, so they don't
      // hijack the composer's or the Other field's cursor. (Multi-select toggles by
      // click instead, so single-option arrow navigation does not apply.)
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      if (!multiSelect && (event.key === "ArrowDown" || event.key === "ArrowUp") && !inEditable) {
        const ids = [...choices.map((choice) => choice.choiceId), ...(allowOther && hasChoices ? ["__other"] : [])];
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
    // `notes` is read by submit() (it rides on an AskUserQuestion answer), so it must be a
    // dependency — otherwise the ⌘Enter listener keeps a stale closure and a note typed
    // before ⌘Enter is dropped. (`otherText` is here for the same reason.)
  }, [choices, hasChoices, allowOther, multiSelect, otherActive, selectedId, selectedIds, otherText, notes, props]);
  const kindLabel =
    props.prompt.kind === "approval"
      ? "Approval needed"
      : props.prompt.kind === "permission"
      ? "Permission needed"
      : props.prompt.kind === "choice"
      ? "Choose an option"
      : "Question";
  return (
    <PromptCardFrame role="group" aria-label="Agent prompt" data-prompt-card="true">
      <PromptHead>
        <PromptKind data-prompt-kind-label="true">
          {multiSelect ? "Select all that apply" : kindLabel}
          {props.prompt.header ? (
            <PromptHeaderChip data-prompt-header-chip="true">{props.prompt.header}</PromptHeaderChip>
          ) : null}
        </PromptKind>
        <PromptBody data-prompt-body="true">
          <PromptMessage data-prompt-message="true">{props.prompt.message}</PromptMessage>
          {props.prompt.detail ? <PromptDetailView detail={props.prompt.detail} /> : null}
        </PromptBody>
      </PromptHead>
      <PromptOptions data-prompt-options="true">
        {renderOptions({
          choices,
          multiSelect,
          selectedId,
          selectedIds,
          otherActive,
          otherText,
          hasChoices,
          allowOther,
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
          showNotes: isAUQ,
          notes,
          onNotes: setNotes,
        })}
      </PromptOptions>
      <PromptActions data-prompt-actions="true">
        <PromptSecondaryButton type="button" data-prompt-skip="true" onClick={() => props.onAnswerText("")}>
          Skip
        </PromptSecondaryButton>
        <PromptSubmitButton type="button" data-prompt-submit="true" disabled={!canSubmit} onClick={submit}>
          Submit
          <PromptSubmitShortcut>⌘↵</PromptSubmitShortcut>
        </PromptSubmitButton>
      </PromptActions>
    </PromptCardFrame>
  );
}

// Per-step answer state for the wizard: a single pick, a multi-select set, or an
// "Other…" free-text reply.
interface StepAnswerState {
  selectedId: string | null;
  selectedIds: Set<string>;
  otherActive: boolean;
  otherText: string;
  notes: string;
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
    notes: "",
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
      steps.map((eachStep, index) => {
        // The note field is hidden while a step's "Other…" is active, so don't ship one then.
        const note = answers[index].otherActive ? "" : answers[index].notes.trim();
        return {
          stepId: eachStep.stepId,
          value: resolveStepValue(eachStep, answers[index]),
          ...(note.length > 0 ? { notes: note } : {}),
        };
      }),
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
      // ⌘/Ctrl+1..9 selects the N-th option of the CURRENT step (highlight only —
      // it never advances; ⌘Enter still does Next/Submit). See
      // docs_v2/specs/prompt-card-number-key-selection.md.
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const digit = /^Digit([1-9])$/.exec(event.code);
        if (digit !== null) {
          const choiceIds = choices.map((choice) => choice.choiceId);
          const ids = multiSelect ? choiceIds : [...choiceIds, ...(hasChoices ? ["__other"] : [])];
          const picked = ids[Number(digit[1]) - 1];
          if (picked !== undefined) {
            event.preventDefault();
            if (picked === "__other") {
              setCurrent((prev) => ({ ...prev, otherActive: true, selectedId: null }));
            } else if (multiSelect) {
              setCurrent((prev) => {
                const next = new Set(prev.selectedIds);
                if (next.has(picked)) {
                  next.delete(picked);
                } else {
                  next.add(picked);
                }
                return { ...prev, selectedIds: next };
              });
            } else {
              setCurrent((prev) => ({ ...prev, otherActive: false, selectedId: picked }));
            }
          }
          return;
        }
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
    // All reactive values the keydown closure reads (goNext/submit/setCurrent close over
    // stepIndex, answers, steps, props.onAnswerSteps; isLast/choices/hasChoices/multiSelect
    // are read directly) — so the listener never holds a stale callback.
  }, [stepIndex, answers, choices, hasChoices, multiSelect, isLast, steps, props]);

  return (
    <PromptCardFrame $wizard role="group" aria-label="Agent prompt" data-prompt-card="true" data-prompt-wizard="true">
      <PromptHead>
        <PromptWizardHead data-prompt-wizard-head="true">
          <PromptKind data-prompt-kind-label="true">
            {multiSelect ? "Select all that apply" : "Question"}
            <PromptStepCount> · {stepIndex + 1} of {steps.length}</PromptStepCount>
            {step.header ? <PromptHeaderChip data-prompt-header-chip="true">{step.header}</PromptHeaderChip> : null}
          </PromptKind>
          <PromptStepTabs role="tablist" aria-label="Steps">
            {steps.map((eachStep, index) => (
              <PromptStepDot
                key={eachStep.stepId}
                type="button"
                data-prompt-step-dot="true"
                data-active={index === stepIndex ? "true" : "false"}
                data-answered={stepIsAnswered(eachStep, answers[index]) ? "true" : "false"}
                aria-label={`Step ${index + 1}${index === stepIndex ? " (current)" : ""}`}
                aria-current={index === stepIndex ? "step" : undefined}
                onClick={() => setStepIndex(index)}
              />
            ))}
          </PromptStepTabs>
        </PromptWizardHead>
        <PromptBody data-prompt-body="true">
          <PromptMessage data-prompt-message="true">{step.message}</PromptMessage>
        </PromptBody>
      </PromptHead>
      <PromptOptions data-prompt-options="true">
        {renderOptions({
          choices,
          multiSelect,
          selectedId: answer.selectedId,
          selectedIds: answer.selectedIds,
          otherActive: answer.otherActive,
          otherText: answer.otherText,
          hasChoices,
          allowOther: true,
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
          showNotes: true,
          notes: answer.notes,
          onNotes: (value) => setCurrent((prev) => ({ ...prev, notes: value })),
        })}
      </PromptOptions>
      <PromptActions data-prompt-actions="true">
        <PromptSecondaryButton
          type="button"
          data-prompt-skip="true"
          disabled={stepIndex === 0}
          onClick={goBack}
        >
          Back
        </PromptSecondaryButton>
        <PromptSubmitButton type="button" data-prompt-submit="true" onClick={goNext}>
          {isLast ? "Submit" : "Next"}
          <PromptSubmitShortcut>⌘↵</PromptSubmitShortcut>
        </PromptSubmitButton>
      </PromptActions>
    </PromptCardFrame>
  );
}

// An option's secondary line is its human `description` (claude AskUserQuestion), or a
// genuinely meaningful providerValue (e.g. a command/model id) when there is none. Internal
// answer-routing tokens — every provider prefixes them "structured:" — are never shown.
function optionSecondary(choice: AgentChatPromptChoice): string | undefined {
  if (choice.description !== undefined && choice.description.length > 0) {
    return choice.description;
  }
  const value = choice.providerValue;
  return value && value !== choice.label && !value.startsWith("structured:") ? value : undefined;
}

// Shared option list (single pick / multi-select toggles / "Other…" free text) used by
// both the single card and each wizard step, so they look and behave identically.
function renderOptions(input: {
  choices: AgentChatPromptChoice[];
  multiSelect: boolean;
  selectedId: string | null;
  selectedIds: Set<string>;
  otherActive: boolean;
  otherText: string;
  hasChoices: boolean;
  allowOther: boolean;
  onPickChoice: (choiceId: string) => void;
  onToggleMulti: (choiceId: string) => void;
  onPickOther: () => void;
  onOtherText: (value: string) => void;
  onOtherEnter: () => void;
  // AskUserQuestion-only: a free-text note that rides alongside a *listed* selection
  // (claude annotations), shown below the options. Hidden while "Other…" is active — the
  // custom-reply field is already the free-text input, so a second box would be redundant.
  showNotes: boolean;
  notes: string;
  onNotes: (value: string) => void;
}): ReactElement {
  const option = (
    key: string,
    label: string,
    secondary: string | undefined,
    selected: boolean,
    onClick: () => void,
    kind?: AgentChatPromptChoice["kind"],
    // 1-based ⌘N shortcut number for this option, when it has one (the first 9
    // options). Shown as a keycap and selectable via ⌘/Ctrl+digit. See
    // docs_v2/specs/prompt-card-number-key-selection.md.
    numberHint?: number,
  ) => (
    <PromptOptionButton
      key={key}
      type="button"
      data-prompt-option="true"
      data-selected={selected ? "true" : "false"}
      data-multi={input.multiSelect ? "true" : undefined}
      data-kind={kind}
      aria-pressed={input.multiSelect ? selected : undefined}
      onClick={onClick}
    >
      <PromptOptionMark aria-hidden />
      <PromptOptionText>
        <PromptOptionLabel data-prompt-option-label="true">{label}</PromptOptionLabel>
        {secondary ? <PromptOptionValue data-prompt-option-value="true">{secondary}</PromptOptionValue> : null}
      </PromptOptionText>
      {numberHint !== undefined ? (
        <PromptOptionShortcut aria-hidden>⌘{numberHint}</PromptOptionShortcut>
      ) : null}
    </PromptOptionButton>
  );
  // The focused single-select option's preview (claude AskUserQuestion option.preview):
  // the mockup/code for the option the user is on, shown below the list.
  const focused = input.choices.find((choice) => choice.choiceId === input.selectedId);
  const preview = !input.multiSelect && !input.otherActive ? focused?.preview : undefined;
  return (
    <>
      {input.choices.map((choice, index) =>
        option(
          choice.choiceId,
          choice.label,
          optionSecondary(choice),
          input.multiSelect
            ? input.selectedIds.has(choice.choiceId)
            : !input.otherActive && input.selectedId === choice.choiceId,
          input.multiSelect
            ? () => input.onToggleMulti(choice.choiceId)
            : () => input.onPickChoice(choice.choiceId),
          choice.kind,
          index < 9 ? index + 1 : undefined,
        ),
      )}
      {input.allowOther && input.hasChoices && !input.multiSelect
        ? option(
            "__other",
            "Other…",
            undefined,
            input.otherActive,
            input.onPickOther,
            undefined,
            // "Other…" is the slot right after the listed choices, so it takes
            // the next number — but only while that stays within ⌘1..⌘9.
            input.choices.length < 9 ? input.choices.length + 1 : undefined,
          )
        : null}
      {preview !== undefined && preview.length > 0 ? (
        <PromptOptionPreview data-prompt-option-preview="true" aria-label="Option preview">{preview}</PromptOptionPreview>
      ) : null}
      {input.otherActive ? (
        <PromptCustomReply
          data-prompt-custom-reply="true"
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
      {input.showNotes && !input.otherActive ? (
        <PromptAnswerNote
          data-prompt-note="true"
          placeholder="Add a note (optional) — sent with your answer"
          value={input.notes}
          rows={2}
          spellCheck={false}
          aria-label="Note for this answer"
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => input.onNotes(event.currentTarget.value)}
        />
      ) : null}
    </>
  );
}
