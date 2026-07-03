import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { LaunchOptionFeedback } from "../../../../../application/domains/agent-chat/state/types.ts";
import type { ComposerHandlers } from "../support/types.ts";
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { useEffect, useState } from "react";
import { keyframes, styled } from "styled-components";
import { handleComposerPaste } from "./attachments.ts";
import { ArrowUp, Check, ChevronDown, Plus, ShieldCheck, Square, X } from "lucide-react";
import { chipAnchorFromEvent, contextChipIcon, createContextChip } from "./context-chips.tsx";
import { createProviderReadiness } from "../readiness/readiness.ts";
import { PromptCard } from "../prompt-card/prompt-card.tsx";
import { createQueuedSteerStack } from "./steer-queue.tsx";
import { SessionContextMeter } from "./usage-meter.tsx";
import {
  ComposerChipChevron,
  ComposerChipIcon,
  ComposerChipLabel,
  ComposerChoiceChip,
} from "./composer.parts.tsx";
import { VisuallyHidden } from "../../support/visually-hidden.tsx";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// The composer has something sendable when there is text, a pasted image, OR a
// context chip/block — any of these alone is a valid send (submitComposer accepts
// them), so the run-state button must offer Send, not Stop (spec).
function composerHasContent(viewModel: AgentChatShellViewModel): boolean {
  return (
    viewModel.composer.draft.trim().length > 0 ||
    viewModel.composer.attachments.length > 0 ||
    viewModel.composer.contextChips.length > 0
  );
}

export function createComposer(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  const isStartComposer = viewModel.composer.mode === "start";

  return (
    <ComposerShell
      aria-label="Composer"
      data-composer-shell="true"
      data-composer-mode={viewModel.composer.mode}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        handlers.onSubmit?.();
      }}
    >
      <ComposerBody data-composer-body="true">
        <ComposerInput
          aria-label="Composer draft"
          data-composer-input="true"
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
              // While a prompt card is up it owns the keyboard (its ⌘↵ / arrows / Other
              // field). Plain Enter in the composer must be a clean no-op — firing a
              // no-op submit just flickers the screen (spec: composer-prompt-browser-fixes).
              if (viewModel.prompt != null) {
                return;
              }
              handlers.onSubmit?.();
            }
          }}
          onPaste={(event) => handleComposerPaste(event.nativeEvent, handlers.onAddAttachment)}
          placeholder={isStartComposer ? "Do anything" : "Ask for follow-up changes"}
        />
        {viewModel.composer.attachments.length > 0 ? (
          <ComposerAttachments>
            {viewModel.composer.attachments.map((attachment) => (
              <ComposerAttachment key={attachment.id}>
                <ComposerAttachmentOpen
                  type="button"
                  title="Preview image"
                  aria-label={`Preview ${attachment.name}`}
                  onClick={() => handlers.onPreviewAttachment?.(attachment.previewUrl)}
                >
                  <ComposerAttachmentThumb
                    src={attachment.previewUrl}
                    alt={attachment.name}
                  />
                </ComposerAttachmentOpen>
                <ComposerAttachmentRemove
                  type="button"
                  title="Remove attachment"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => handlers.onRemoveAttachment?.(attachment.id)}
                >
                  <X size={12} strokeWidth={2.2} aria-hidden />
                </ComposerAttachmentRemove>
              </ComposerAttachment>
            ))}
          </ComposerAttachments>
        ) : null}
        {viewModel.composer.contextChips.length > 0 ? (
          <ComposerContextCards>
            {viewModel.composer.contextChips.map((chip) => {
              const ChipIcon = contextChipIcon(chip.kind);
              return (
                <ComposerContextCard key={chip.id} data-context-chip-kind={chip.kind}>
                  <ComposerContextCardHead>
                    <ChipIcon
                      size={13}
                      strokeWidth={1.9}
                      aria-hidden
                    />
                    <ComposerContextCardLabel>{chip.label}</ComposerContextCardLabel>
                    <ComposerContextCardKind>{chip.kind}</ComposerContextCardKind>
                    <ComposerContextCardRemove
                      type="button"
                      title="Remove"
                      aria-label={`Remove ${chip.label}`}
                      onClick={() => handlers.onRemoveContextChip?.(chip.id)}
                    >
                      <X size={15} strokeWidth={2.2} aria-hidden />
                    </ComposerContextCardRemove>
                  </ComposerContextCardHead>
                  <ComposerContextCardComment
                    // Lets AgentChatShell focus THIS chip's comment field the moment the
                    // chip is added ("Add to chat" → type your note here). See agent-chat.tsx.
                    data-chip-comment-id={chip.id}
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
                </ComposerContextCard>
              );
            })}
          </ComposerContextCards>
        ) : null}
        {isStartComposer ? (
          <ComposerStartContext data-composer-start-context="true">
            {viewModel.composer.contextItems.map((item) => createContextChip(item, handlers))}
          </ComposerStartContext>
        ) : null}
        <ComposerToolbar data-composer-toolbar="true">
          <ComposerIconButton
            type="button"
            title="Composer options"
            aria-label="Composer options"
            data-composer-options-button="true"
            onClick={(event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("composer_options", chipAnchorFromEvent(event))
            }
          >
            <Plus size={16} strokeWidth={2.1} aria-hidden />
          </ComposerIconButton>
          <ComposerChoiceChip
            type="button"
            title="Permission"
            aria-label="Permission"
            data-composer-choice-chip="true"
            data-choice-kind="permission"
            onClick={(event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.("permission_menu", chipAnchorFromEvent(event))
            }
          >
            {/* Figma: shield-check icon + label + chevron-down. */}
            <ComposerChipIcon data-composer-chip-icon="true" aria-hidden>
              <ShieldCheck size={14} strokeWidth={1.9} aria-hidden />
            </ComposerChipIcon>
            <ComposerChipLabel data-composer-chip-label="true">{viewModel.composer.permissionLabel}</ComposerChipLabel>
            <ChipFeedbackBadge feedback={viewModel.composer.permissionFeedback} />
            <ComposerChipChevron aria-hidden>
              <ChevronDown size={13} strokeWidth={1.9} aria-hidden />
            </ComposerChipChevron>
          </ComposerChoiceChip>
          <ComposerToolbarSpacer />
          {/* Non-blocking agent-CLI update advisory (spec: version-management.md, Lane 2 / D2):
              a quiet pill, not a card. Present even when the agent is ready and on the start
              composer. One click runs the same readiness terminal update as install
              (update_available:terminal); the vX → vY detail lives in the tooltip. */}
          {viewModel.providerUpdateAdvisory ? (
            <ComposerChoiceChip
              $variant="update"
              type="button"
              title={`v${viewModel.providerUpdateAdvisory.currentVersion} → v${viewModel.providerUpdateAdvisory.latestVersion} — updates the CLI in a terminal, your draft is kept`}
              aria-label={`Update ${viewModel.providerUpdateAdvisory.agentLabel}`}
              data-composer-choice-chip="true"
              data-choice-kind="update"
              onClick={() =>
                handlers.onChoiceSurfaceRowSelect?.("provider_readiness", "update_available:terminal")
              }
            >
              <ComposerChipIcon data-composer-chip-icon="true" aria-hidden>
                <ArrowUp size={14} strokeWidth={2} aria-hidden />
              </ComposerChipIcon>
              <ComposerChipLabel data-composer-chip-label="true">{`Update ${viewModel.providerUpdateAdvisory.agentLabel}`}</ComposerChipLabel>
            </ComposerChoiceChip>
          ) : null}
          <ComposerChoiceChip
            $variant="model"
            type="button"
            title="Model"
            aria-label="Model"
            data-composer-choice-chip="true"
            data-choice-kind="model"
            onClick={(event: { currentTarget: HTMLElement }) =>
              handlers.onOpenSurface?.(viewModel.composer.modelChipSurface, chipAnchorFromEvent(event))
            }
          >
            {/* Figma: label + chevron-down (no leading icon). */}
            <ComposerChipLabel data-composer-chip-label="true">{viewModel.composer.modelLabel}</ComposerChipLabel>
            <ChipFeedbackBadge feedback={viewModel.composer.modelFeedback} />
            <ComposerChipChevron aria-hidden>
              <ChevronDown size={13} strokeWidth={1.9} aria-hidden />
            </ComposerChipChevron>
          </ComposerChoiceChip>
          {/* While the runtime is LIVE with NOTHING to send, the button is Stop (interrupt) —
              "live" includes waiting on a prompt, so a Thread parked on an approval/question
              the UI didn't surface is always escapable (Stop clears it backend-side). Add any
              content — typed text, a pasted image, or a context chip/block — and it becomes
              Send so you can queue it. Interrupt while a draft/queue exists lives on the queued
              rows instead (createQueuedSteerStack). */}
          {(viewModel.chatState === "running" ||
            viewModel.chatState === "waiting_for_approval" ||
            viewModel.chatState === "waiting_for_input") &&
          !composerHasContent(viewModel)
            ? createComposerStopButton(handlers.onInterrupt)
            : createComposerSendButton(viewModel.composer.submitLabel, viewModel.prompt != null)}
        </ComposerToolbar>
      </ComposerBody>
    </ComposerShell>
  );
}

// Inline chip badge confirming a mid-thread launch-option change. "applied" = took
// effect live: a brief green "Applied" flash that self-dismisses after ~2.4s (so it
// never lingers or holds chip width), re-armed whenever `at` changes. "pending" = a
// transparent restart applies it on the next send: a persistent muted badge that the
// reducer clears at the next turn start. See
// docs_v2/specs/mid-thread-launch-option-feedback.md.
// Unmount reclaims the chip width once the flash has faded out; MUST match the
// ComposerChipFeedback animation duration below.
const APPLIED_FLASH_MS = 2400;

function ChipFeedbackBadge({ feedback }: { feedback: LaunchOptionFeedback | undefined }): ReactElement | null {
  const [flashDone, setFlashDone] = useState(false);
  const state = feedback?.state;
  const at = feedback?.at;
  useEffect(() => {
    setFlashDone(false);
    if (state !== "applied") {
      return;
    }
    const timer = setTimeout(() => setFlashDone(true), APPLIED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [state, at]);

  if (feedback === undefined) {
    return null;
  }
  if (feedback.state === "applied") {
    if (flashDone) {
      return null;
    }
    return (
      <ComposerChipFeedback $state="applied" role="status">
        <Check size={11} strokeWidth={2.8} aria-hidden />
        Applied
      </ComposerChipFeedback>
    );
  }
  return (
    <ComposerChipFeedback $state="pending" role="status">
      Next message
    </ComposerChipFeedback>
  );
}

// Submit button: queues the draft (mid-run) or starts the turn (idle). While a
// prompt card is up it is disabled — the card owns the response, and the composer
// draft is held as a follow-up (you can type, but you answer the prompt first).
function createComposerSendButton(label: string, disabled = false): ReactElement {
  const title = disabled ? "Answer the prompt above first" : label;
  return (
    <ComposerRunButton
      $mode="send"
      key="send"
      type="submit"
      title={title}
      aria-label={title}
      disabled={disabled}
      data-composer-send="true"
    >
      <ArrowUp size={17} strokeWidth={2.4} aria-hidden />
      <VisuallyHidden>{title}</VisuallyHidden>
    </ComposerRunButton>
  );
}

// Stop button: interrupts the live turn (a queued follow-up then runs next).
function createComposerStopButton(onInterrupt?: () => void): ReactElement {
  return (
    <ComposerRunButton
      $mode="stop"
      key="stop"
      type="button"
      title="Interrupt"
      aria-label="Interrupt"
      onClick={() => onInterrupt?.()}
      data-composer-stop="true"
    >
      <Square size={13} strokeWidth={0} fill="currentColor" aria-hidden />
      <VisuallyHidden>Interrupt</VisuallyHidden>
    </ComposerRunButton>
  );
}

export function createComposerStack(
  viewModel: AgentChatShellViewModel,
  handlers: ComposerHandlers,
): ReactElement {
  return (
    <ComposerStackFrame data-composer-stack="true">
      {/* composer.activeSurface (chip dropdown) is rendered as an anchored popover
          by AgentChatShell. Provider readiness and prompt cards remain in flow. */}
      {createProviderReadiness(viewModel, handlers.onChoiceSurfaceRowSelect)}
      {viewModel.prompt ? (
        <PromptCard
          key={viewModel.prompt.promptId}
          prompt={viewModel.prompt}
          onSelectChoice={(choiceId: string) => handlers.onChoiceSurfaceRowSelect?.("prompt_state", choiceId)}
          onAnswerText={(value: string, notes?: string) => handlers.onAnswerPromptText?.(value, notes)}
          onAnswerSteps={(stepAnswers) => handlers.onAnswerPromptSteps?.(stepAnswers)}
        />
      ) : null}
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
	            handlers.onRunQueuedInputNow,
	            handlers.onRemoveQueued,
	          )
        : null}
      {viewModel.usage ? <SessionContextMeter usage={viewModel.usage} /> : null}
      {createComposer(viewModel, handlers)}
    </ComposerStackFrame>
  );
}

const composerChipFeedbackFlash = keyframes`
  0% {
    opacity: 0;
    transform: translateY(1px);
  }
  7% {
    opacity: 1;
    transform: translateY(0);
  }
  90% {
    opacity: 1;
    transform: translateY(0);
  }
  100% {
    opacity: 0;
    transform: translateY(0);
  }
`;

const ComposerStackFrame = styled.div`
  width: min(760px, calc(100% - 32px));
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  margin: 0 auto;
`;

const ComposerShell = styled.form`
  width: 100%;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--tide-line);
  border-radius: 14px;
  background: var(--tide-bg);
  box-shadow: var(--tide-shadow-composer);
`;

const ComposerBody = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
`;

const ComposerInput = styled.textarea`
  width: 100%;
  min-height: 44px;
  max-height: 240px;
  field-sizing: content;
  resize: none;
  border: 0;
  outline: none;
  padding: 0;
  background: transparent;
  color: var(--tide-text);
  font-size: 16px;
  line-height: 1.4;

  ${ComposerShell}[data-composer-mode="follow_up"] & {
    min-height: 22px;
    max-height: 200px;
    font-size: 14px;
  }

  &::placeholder {
    color: color-mix(in srgb, var(--tide-muted) 58%, transparent);
  }
`;

const ComposerAttachments = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const ComposerAttachment = styled.div`
  position: relative;
  width: 56px;
  height: 56px;
  overflow: hidden;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: var(--tide-surface-2, rgba(127, 127, 127, 0.08));
`;

const ComposerAttachmentOpen = styled.button`
  width: 100%;
  height: 100%;
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
`;

const ComposerAttachmentThumb = styled.img`
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
`;

const ComposerAttachmentRemove = styled.button`
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--tide-bg);
  background: rgba(0, 0, 0, 0.6);
  cursor: pointer;

  &:hover {
    background: rgba(0, 0, 0, 0.82);
  }
`;

const ComposerContextCards = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ComposerContextCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 8px 8px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: var(--tide-surface);
`;

const ComposerContextCardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;

  & > svg {
    flex: 0 0 auto;
    color: var(--tide-muted);
  }
`;

const ComposerContextCardLabel = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--tide-text);
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ComposerContextCardKind = styled.span`
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--tide-bg);
  color: var(--tide-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const ComposerContextCardRemove = styled.button`
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

const ComposerContextCardComment = styled.textarea`
  width: 100%;
  min-height: 20px;
  border: 0;
  background: transparent;
  color: var(--tide-text);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  outline: none;
  resize: none;
  field-sizing: content;

  &::placeholder {
    color: var(--tide-muted);
  }
`;

const ComposerToolbar = styled.div`
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ComposerStartContext = styled.dl`
  min-height: 30px;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  overflow: hidden;
  margin: 0;
`;

const ComposerIconButton = styled.button`
  width: 30px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--tide-line);
  border-radius: 999px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;

  &:hover {
    border-color: var(--tide-line);
    background: var(--tide-selection);
  }
`;

const ComposerToolbarSpacer = styled.span`
  flex: 1 1 auto;
`;

const ComposerChipFeedback = styled.span<{ $state: "applied" | "pending" }>`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10.5px;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;

  ${({ $state }) =>
    $state === "applied"
      ? `
        color: var(--tide-diff-add);
        font-weight: 600;
        animation: ${composerChipFeedbackFlash} 2400ms ease both;
      `
      : `
        padding: 2px 6px;
        border-radius: 999px;
        background: var(--tide-selection);
        color: var(--tide-muted);
        font-weight: 500;
      `}

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const ComposerRunButton = styled.button<{ $mode: "send" | "stop" }>`
  width: 32px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: var(--tide-action);
  color: var(--tide-bg);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
`;
