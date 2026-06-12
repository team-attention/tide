import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { createElement, useEffect, useState } from "react";
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
  const [selectedId, setSelectedId] = useState<string | null>(
    props.prompt.defaultChoiceId ?? null,
  );
  const [otherActive, setOtherActive] = useState(!hasChoices);
  const [otherText, setOtherText] = useState("");
  const canSubmit = otherActive ? otherText.trim().length > 0 : selectedId !== null;
  const submit = () => {
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
      // hijack the composer's or the Other field's cursor.
      const target = event.target as HTMLElement | null;
      const inEditable =
        target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !inEditable) {
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
  }, [choices, hasChoices, otherActive, selectedId, otherText, props]);
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
  ) =>
    createElement(
      "button",
      {
        key,
        type: "button",
        className: "prompt-card__option",
        "data-selected": selected ? "true" : "false",
        onClick,
      },
      createElement("span", { className: "prompt-card__radio", "aria-hidden": true }),
      createElement("span", { className: "prompt-card__option-label" }, label),
      detail ? createElement("span", { className: "prompt-card__option-value" }, detail) : null,
    );
  return createElement(
    "div",
    { className: "prompt-card", role: "group", "aria-label": "Agent prompt" },
    createElement(
      "div",
      { className: "prompt-card__head" },
      createElement("span", { className: "prompt-card__kind" }, kindLabel),
      createElement("p", { className: "prompt-card__message" }, props.prompt.message),
    ),
    createElement(
      "div",
      { className: "prompt-card__options" },
      ...choices.map((choice) =>
        option(
          choice.choiceId,
          choice.label,
          choice.providerValue && choice.providerValue !== choice.label ? choice.providerValue : undefined,
          !otherActive && selectedId === choice.choiceId,
          () => {
            setOtherActive(false);
            setSelectedId(choice.choiceId);
          },
        ),
      ),
      hasChoices
        ? option("__other", "Other…", undefined, otherActive, () => {
            setOtherActive(true);
            setSelectedId(null);
          })
        : null,
      otherActive
        ? createElement("textarea", {
            className: "prompt-card__other",
            placeholder: hasChoices ? "Type a custom reply…" : "Type your reply…",
            value: otherText,
            rows: hasChoices ? 2 : 3,
            autoFocus: true,
            spellCheck: false,
            "aria-label": "Custom reply",
            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setOtherText(event.currentTarget.value),
            onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            },
          })
        : null,
    ),
    createElement(
      "div",
      { className: "prompt-card__actions" },
      createElement(
        "button",
        { type: "button", className: "prompt-card__skip", onClick: () => props.onAnswerText("") },
        "Skip",
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "prompt-card__submit",
          disabled: !canSubmit,
          onClick: submit,
        },
        "Submit",
        createElement("span", { className: "prompt-card__submit-kbd" }, "⌘↵"),
      ),
    ),
  );
}
