import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ComposerHandlers } from "../support/types.ts";
import { createElement } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { handleComposerPaste } from "./attachments.ts";
import { ArrowUp, ChevronDown, Mic, Plus, ShieldCheck, Square, X } from "lucide-react";
import { chipAnchorFromEvent, contextChipIcon, createContextChip } from "./context-chips.ts";
import { createProviderReadiness } from "../readiness/readiness.ts";
import { PromptCard } from "../prompt-card/prompt-card.ts";
import { createUsageMeter } from "./usage-meter.ts";
import { createQueuedSteerStack } from "./steer-queue.ts";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createComposer(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  const isStartComposer = viewModel.composer.mode === "start";

  return createElement(
    "form",
    {
      className: "composer-shell",
      "aria-label": "Composer",
      "data-composer-mode": viewModel.composer.mode,
      onSubmit: (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        handlers.onSubmit?.();
      },
    },
    createElement(
      "div",
      { className: "composer-shell__body" },
      createElement("textarea", {
        "aria-label": "Composer draft",
        className: "composer-shell__input",
        ref: handlers.inputRef,
        // One row at rest (CSS min-height sets the floor per mode); the input
        // grows with content via CSS field-sizing in Chromium.
        rows: 1,
        value: viewModel.composer.draft,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
          handlers.onDraftChange?.(event.currentTarget.value),
        // Enter sends; Shift+Enter inserts a newline. Never submit mid-IME
        // composition (Korean/Japanese candidate selection) — that Enter commits
        // the candidate, not the message. `isComposing`/keyCode 229 guard it.
        onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            // ⌘/Ctrl+Enter belongs to the prompt card (answer Allow/Deny) — never
            // submit the composer draft on it, or answering a prompt would flush
            // the in-progress follow-up as the prompt's answer.
            !event.metaKey &&
            !event.ctrlKey &&
            !event.nativeEvent.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            handlers.onSubmit?.();
          }
        },
        onPaste: (event: ClipboardEvent) =>
          handleComposerPaste(event, handlers.onAddAttachment),
        placeholder: isStartComposer ? "Do anything" : "Ask for follow-up changes",
      }),
      viewModel.composer.attachments.length > 0
        ? createElement(
            "div",
            { className: "composer-shell__attachments" },
            viewModel.composer.attachments.map((attachment) =>
              createElement(
                "div",
                { key: attachment.id, className: "composer-shell__attachment" },
                createElement(
                  "button",
                  {
                    type: "button",
                    className: "composer-shell__attachment-open",
                    title: "Preview image",
                    "aria-label": `Preview ${attachment.name}`,
                    onClick: () => handlers.onPreviewAttachment?.(attachment.previewUrl),
                  },
                  createElement("img", {
                    className: "composer-shell__attachment-thumb",
                    src: attachment.previewUrl,
                    alt: attachment.name,
                  }),
                ),
                createElement(
                  "button",
                  {
                    type: "button",
                    className: "composer-shell__attachment-remove",
                    title: "Remove attachment",
                    "aria-label": `Remove ${attachment.name}`,
                    onClick: () => handlers.onRemoveAttachment?.(attachment.id),
                  },
                  createElement(X, { size: 12, strokeWidth: 2.2, "aria-hidden": true }),
                ),
              ),
            ),
          )
        : null,
      viewModel.composer.contextChips.length > 0
        ? createElement(
            "div",
            { className: "composer-shell__chips" },
            viewModel.composer.contextChips.map((chip) =>
              createElement(
                "div",
                { key: chip.id, className: `composer-chip-card composer-chip-card--${chip.kind}` },
                createElement(
                  "div",
                  { className: "composer-chip-card__head" },
                  createElement(contextChipIcon(chip.kind), {
                    size: 13,
                    strokeWidth: 1.9,
                    className: "composer-chip-card__icon",
                    "aria-hidden": true,
                  }),
                  createElement("span", { className: "composer-chip-card__label" }, chip.label),
                  createElement("span", { className: "composer-chip-card__kind" }, chip.kind),
                  createElement(
                    "button",
                    {
                      type: "button",
                      className: "composer-chip-card__remove",
                      title: "Remove",
                      "aria-label": `Remove ${chip.label}`,
                      onClick: () => handlers.onRemoveContextChip?.(chip.id),
                    },
                    createElement(X, { size: 15, strokeWidth: 2.2, "aria-hidden": true }),
                  ),
                ),
                createElement("textarea", {
                  className: "composer-chip-card__comment",
                  placeholder: "Comment on this selection… (Enter to send, Shift+Enter for newline)",
                  value: chip.comment,
                  rows: 1,
                  spellCheck: false,
                  "aria-label": `Comment for ${chip.label}`,
                  onChange: (event: ChangeEvent<HTMLTextAreaElement>) =>
                    handlers.onSetContextChipComment?.(chip.id, event.currentTarget.value),
                  // Match the composer: Enter sends, Shift+Enter inserts a newline.
                  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      handlers.onSubmit?.();
                    }
                  },
                }),
              ),
            ),
          )
        : null,
      isStartComposer
        ? createElement(
            "dl",
            { className: "composer-shell__start-context" },
            viewModel.composer.contextItems.map((item) => createContextChip(item, handlers)),
          )
        : null,
      createElement(
        "div",
        { className: "composer-shell__toolbar" },
        createElement(
          "button",
          {
            type: "button",
            className: "composer-shell__icon-button",
            title: "Composer options",
            "aria-label": "Composer options",
            onClick: (event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("composer_options", chipAnchorFromEvent(event)),
          },
          createElement(Plus, { size: 16, strokeWidth: 2.1, "aria-hidden": true }),
        ),
        createElement(
          "button",
          {
            type: "button",
            className: "composer-shell__choice-chip",
            title: "Permission",
            "aria-label": "Permission",
            onClick: (event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("permission_menu", chipAnchorFromEvent(event)),
          },
          // Figma: shield-check icon + label + chevron-down.
          createElement(ShieldCheck, { size: 14, strokeWidth: 1.9, className: "composer-shell__chip-icon", "aria-hidden": true }),
          createElement("span", { className: "composer-shell__chip-label" }, viewModel.composer.permissionLabel),
          createElement(ChevronDown, { size: 13, strokeWidth: 1.9, className: "composer-shell__chip-chevron", "aria-hidden": true }),
        ),
        createElement("span", { className: "composer-shell__toolbar-spacer" }),
        createElement(
          "button",
          {
            type: "button",
            className: "composer-shell__choice-chip composer-shell__choice-chip--model",
            title: "Model",
            "aria-label": "Model",
            onClick: (event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("model_menu", chipAnchorFromEvent(event)),
          },
          // Figma: label + chevron-down (no leading icon).
          createElement("span", { className: "composer-shell__chip-label" }, viewModel.composer.modelLabel),
          createElement(ChevronDown, { size: 13, strokeWidth: 1.9, className: "composer-shell__chip-chevron", "aria-hidden": true }),
        ),
        createElement(
          "button",
          {
            type: "button",
            className: "composer-shell__icon-button composer-shell__icon-button--mic",
            title: "Voice input",
            "aria-label": "Voice input",
          },
          createElement(Mic, { size: 15, strokeWidth: 2, "aria-hidden": true }),
        ),
        // While the agent runs with an EMPTY composer, the button is Stop (interrupt).
        // Start typing a follow-up and it becomes Send so you can queue it. Interrupt
        // while a draft/queue exists lives on the queued rows instead (createQueuedSteerStack).
        viewModel.chatState === "running" && viewModel.composer.draft.trim().length === 0
          ? createComposerStopButton(handlers.onInterrupt)
          : createComposerSendButton(viewModel.composer.submitLabel),
      ),
    ),
  );
}

// Submit button: queues the draft (mid-run) or starts the turn (idle).
function createComposerSendButton(label: string): ReactElement {
  return createElement(
    "button",
    { key: "send", type: "submit", className: "composer-shell__send", title: label, "aria-label": label },
    createElement(ArrowUp, { size: 17, strokeWidth: 2.4, "aria-hidden": true }),
    createElement("span", { className: "visually-hidden" }, label),
  );
}

// Stop button: interrupts the live turn (a queued follow-up then runs next).
function createComposerStopButton(onInterrupt?: () => void): ReactElement {
  return createElement(
    "button",
    {
      key: "stop",
      type: "button",
      className: "composer-shell__send composer-shell__send--stop",
      title: "Interrupt",
      "aria-label": "Interrupt",
      onClick: () => onInterrupt?.(),
    },
    createElement(Square, { size: 13, strokeWidth: 0, fill: "currentColor", "aria-hidden": true }),
    createElement("span", { className: "visually-hidden" }, "Interrupt"),
  );
}

export function createComposerStack(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  return createElement(
    "div",
    { className: "agent-chat-shell__composer-stack" },
    // composer.activeSurface (chip dropdown) is rendered as an anchored popover
    // by AgentChatShell. Provider readiness and prompt cards remain in flow.
    ...createProviderReadiness(viewModel, handlers.onChoiceSurfaceRowSelect),
    viewModel.prompt
      ? createElement(PromptCard, {
          key: viewModel.prompt.promptId,
          prompt: viewModel.prompt,
          onSelectChoice: (choiceId: string) =>
            handlers.onChoiceSurfaceRowSelect?.("prompt_state", choiceId),
          onAnswerText: (value: string) => handlers.onAnswerPromptText?.(value),
        })
      : null,
    viewModel.usage ? createUsageMeter(viewModel.usage) : null,
    // Messages queued behind a live turn dock here, atop the Composer (Codex-style
    // "steer"): a FIFO stack, each visible as pending and editable before it runs.
    // "Live" includes waiting on a prompt — the queue must not jump to the transcript
    // and back when an Allow/Deny card opens and closes.
    viewModel.queuedInputs.length > 0 &&
    (viewModel.chatState === "running" ||
      viewModel.chatState === "waiting_for_approval" ||
      viewModel.chatState === "waiting_for_input")
      ? createQueuedSteerStack(
          viewModel.queuedInputs,
          handlers.onEditQueued,
          handlers.onInterrupt,
          handlers.onRemoveQueued,
        )
      : null,
    createComposer(viewModel, handlers),
  );
}
