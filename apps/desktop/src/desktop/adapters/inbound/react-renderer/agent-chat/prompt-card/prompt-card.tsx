import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { useEffect, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// A unified, pretty prompt card for any agent's question / approval / choice /
// permission request: the message, selectable options (with their provider
// values), an "Other" free-text reply, and Skip / Submit. Replaces the generic
// menu-style rendering so every provider's prompt looks the same.
export function PromptCard(props: {
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
      data-multi={multiSelect ? "true" : undefined}
      aria-pressed={multiSelect ? selected : undefined}
      onClick={onClick}
    >
      <span className="prompt-card__radio" aria-hidden />
      <span className="prompt-card__option-label">{label}</span>
      {detail ? <span className="prompt-card__option-value">{detail}</span> : null}
    </button>
  );
  return (
    <div className="prompt-card" role="group" aria-label="Agent prompt">
      <div className="prompt-card__head">
        <span className="prompt-card__kind">{multiSelect ? "Select all that apply" : kindLabel}</span>
        <p className="prompt-card__message">{props.prompt.message}</p>
      </div>
      <div className="prompt-card__options">
        {choices.map((choice) =>
          option(
            choice.choiceId,
            choice.label,
            choice.providerValue && choice.providerValue !== choice.label ? choice.providerValue : undefined,
            multiSelect ? selectedIds.has(choice.choiceId) : !otherActive && selectedId === choice.choiceId,
            multiSelect
              ? () => toggleMulti(choice.choiceId)
              : () => {
                  setOtherActive(false);
                  setSelectedId(choice.choiceId);
                },
          ),
        )}
        {hasChoices && !multiSelect
          ? option("__other", "Other…", undefined, otherActive, () => {
              setOtherActive(true);
              setSelectedId(null);
            })
          : null}
        {otherActive ? (
          <textarea
            className="prompt-card__other"
            placeholder={hasChoices ? "Type a custom reply…" : "Type your reply…"}
            value={otherText}
            rows={hasChoices ? 2 : 3}
            autoFocus
            spellCheck={false}
            aria-label="Custom reply"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setOtherText(event.currentTarget.value)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
        ) : null}
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
