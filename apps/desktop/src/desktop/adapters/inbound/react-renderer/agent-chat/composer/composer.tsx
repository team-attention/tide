import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ComposerHandlers } from "../support/types.ts";
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { handleComposerPaste } from "./attachments.ts";
import { ArrowUp, ChevronDown, Mic, Plus, ShieldCheck, Square, X } from "lucide-react";
import { chipAnchorFromEvent, contextChipIcon, createContextChip } from "./context-chips.tsx";
import { createProviderReadiness } from "../readiness/readiness.ts";
import { PromptCard } from "../prompt-card/prompt-card.tsx";
import { createUsageMeter } from "./usage-meter.tsx";
import { createQueuedSteerStack } from "./steer-queue.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

export function createComposer(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  const isStartComposer = viewModel.composer.mode === "start";

  return (
    <form
      className="composer-shell"
      aria-label="Composer"
      data-composer-mode={viewModel.composer.mode}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        handlers.onSubmit?.();
      }}
    >
      <div className="composer-shell__body">
        <textarea
          aria-label="Composer draft"
          className="composer-shell__input"
          ref={handlers.inputRef}
          // One row at rest (CSS min-height sets the floor per mode); the input
          // grows with content via CSS field-sizing in Chromium.
          rows={1}
          value={viewModel.composer.draft}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            handlers.onDraftChange?.(event.currentTarget.value)
          }
          // Enter sends; Shift+Enter inserts a newline. Never submit mid-IME
          // composition (Korean/Japanese candidate selection) — that Enter commits
          // the candidate, not the message. `isComposing`/keyCode 229 guard it.
          onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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
          }}
          onPaste={(event) => handleComposerPaste(event.nativeEvent, handlers.onAddAttachment)}
          placeholder={isStartComposer ? "Do anything" : "Ask for follow-up changes"}
        />
        {viewModel.composer.attachments.length > 0 ? (
          <div className="composer-shell__attachments">
            {viewModel.composer.attachments.map((attachment) => (
              <div key={attachment.id} className="composer-shell__attachment">
                <button
                  type="button"
                  className="composer-shell__attachment-open"
                  title="Preview image"
                  aria-label={`Preview ${attachment.name}`}
                  onClick={() => handlers.onPreviewAttachment?.(attachment.previewUrl)}
                >
                  <img
                    className="composer-shell__attachment-thumb"
                    src={attachment.previewUrl}
                    alt={attachment.name}
                  />
                </button>
                <button
                  type="button"
                  className="composer-shell__attachment-remove"
                  title="Remove attachment"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => handlers.onRemoveAttachment?.(attachment.id)}
                >
                  <X size={12} strokeWidth={2.2} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {viewModel.composer.contextChips.length > 0 ? (
          <div className="composer-shell__chips">
            {viewModel.composer.contextChips.map((chip) => {
              const ChipIcon = contextChipIcon(chip.kind);
              return (
                <div key={chip.id} className={`composer-chip-card composer-chip-card--${chip.kind}`}>
                  <div className="composer-chip-card__head">
                    <ChipIcon
                      size={13}
                      strokeWidth={1.9}
                      className="composer-chip-card__icon"
                      aria-hidden
                    />
                    <span className="composer-chip-card__label">{chip.label}</span>
                    <span className="composer-chip-card__kind">{chip.kind}</span>
                    <button
                      type="button"
                      className="composer-chip-card__remove"
                      title="Remove"
                      aria-label={`Remove ${chip.label}`}
                      onClick={() => handlers.onRemoveContextChip?.(chip.id)}
                    >
                      <X size={15} strokeWidth={2.2} aria-hidden />
                    </button>
                  </div>
                  <textarea
                    className="composer-chip-card__comment"
                    placeholder="Comment on this selection… (Enter to send, Shift+Enter for newline)"
                    value={chip.comment}
                    rows={1}
                    spellCheck={false}
                    aria-label={`Comment for ${chip.label}`}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      handlers.onSetContextChipComment?.(chip.id, event.currentTarget.value)
                    }
                    // Match the composer: Enter sends, Shift+Enter inserts a newline.
                    onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        handlers.onSubmit?.();
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
        {isStartComposer ? (
          <dl className="composer-shell__start-context">
            {viewModel.composer.contextItems.map((item) => createContextChip(item, handlers))}
          </dl>
        ) : null}
        <div className="composer-shell__toolbar">
          <button
            type="button"
            className="composer-shell__icon-button"
            title="Composer options"
            aria-label="Composer options"
            onClick={(event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("composer_options", chipAnchorFromEvent(event))
            }
          >
            <Plus size={16} strokeWidth={2.1} aria-hidden />
          </button>
          <button
            type="button"
            className="composer-shell__choice-chip"
            title="Permission"
            aria-label="Permission"
            onClick={(event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("permission_menu", chipAnchorFromEvent(event))
            }
          >
            {/* Figma: shield-check icon + label + chevron-down. */}
            <ShieldCheck size={14} strokeWidth={1.9} className="composer-shell__chip-icon" aria-hidden />
            <span className="composer-shell__chip-label">{viewModel.composer.permissionLabel}</span>
            <ChevronDown size={13} strokeWidth={1.9} className="composer-shell__chip-chevron" aria-hidden />
          </button>
          <span className="composer-shell__toolbar-spacer" />
          <button
            type="button"
            className="composer-shell__choice-chip composer-shell__choice-chip--model"
            title="Model"
            aria-label="Model"
            onClick={(event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.(viewModel.composer.modelChipSurface, chipAnchorFromEvent(event))
            }
          >
            {/* Figma: label + chevron-down (no leading icon). */}
            <span className="composer-shell__chip-label">{viewModel.composer.modelLabel}</span>
            <ChevronDown size={13} strokeWidth={1.9} className="composer-shell__chip-chevron" aria-hidden />
          </button>
          <button
            type="button"
            className="composer-shell__icon-button composer-shell__icon-button--mic"
            title="Voice input"
            aria-label="Voice input"
          >
            <Mic size={15} strokeWidth={2} aria-hidden />
          </button>
          {/* While the agent runs with an EMPTY composer, the button is Stop (interrupt).
              Start typing a follow-up and it becomes Send so you can queue it. Interrupt
              while a draft/queue exists lives on the queued rows instead (createQueuedSteerStack). */}
          {viewModel.chatState === "running" && viewModel.composer.draft.trim().length === 0
            ? createComposerStopButton(handlers.onInterrupt)
            : createComposerSendButton(viewModel.composer.submitLabel)}
        </div>
      </div>
    </form>
  );
}

// Submit button: queues the draft (mid-run) or starts the turn (idle).
function createComposerSendButton(label: string): ReactElement {
  return (
    <button key="send" type="submit" className="composer-shell__send" title={label} aria-label={label}>
      <ArrowUp size={17} strokeWidth={2.4} aria-hidden />
      <span className="visually-hidden">{label}</span>
    </button>
  );
}

// Stop button: interrupts the live turn (a queued follow-up then runs next).
function createComposerStopButton(onInterrupt?: () => void): ReactElement {
  return (
    <button
      key="stop"
      type="button"
      className="composer-shell__send composer-shell__send--stop"
      title="Interrupt"
      aria-label="Interrupt"
      onClick={() => onInterrupt?.()}
    >
      <Square size={13} strokeWidth={0} fill="currentColor" aria-hidden />
      <span className="visually-hidden">Interrupt</span>
    </button>
  );
}

export function createComposerStack(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  return (
    <div className="agent-chat-shell__composer-stack">
      {/* composer.activeSurface (chip dropdown) is rendered as an anchored popover
          by AgentChatShell. Provider readiness and prompt cards remain in flow. */}
      {createProviderReadiness(viewModel, handlers.onChoiceSurfaceRowSelect)}
      {viewModel.prompt ? (
        <PromptCard
          key={viewModel.prompt.promptId}
          prompt={viewModel.prompt}
          onSelectChoice={(choiceId: string) => handlers.onChoiceSurfaceRowSelect?.("prompt_state", choiceId)}
          onAnswerText={(value: string) => handlers.onAnswerPromptText?.(value)}
        />
      ) : null}
      {viewModel.usage ? createUsageMeter(viewModel.usage) : null}
      {/* Messages queued behind a live turn dock here, atop the Composer (Codex-style
          "steer"): a FIFO stack, each visible as pending and editable before it runs.
          "Live" includes waiting on a prompt — the queue must not jump to the transcript
          and back when an Allow/Deny card opens and closes. */}
      {viewModel.queuedInputs.length > 0 &&
      (viewModel.chatState === "running" ||
        viewModel.chatState === "waiting_for_approval" ||
        viewModel.chatState === "waiting_for_input")
        ? createQueuedSteerStack(
            viewModel.queuedInputs,
            handlers.onEditQueued,
            handlers.onInterrupt,
            handlers.onRemoveQueued,
          )
        : null}
      {createComposer(viewModel, handlers)}
    </div>
  );
}
