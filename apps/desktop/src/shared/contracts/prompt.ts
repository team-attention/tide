import type { AgentId } from "./agent.ts";
import type { ThreadId } from "./ids.ts";

export type PromptKindDto =
  | "question"
  | "approval"
  | "permission"
  | "choice"
  | "command_picker";

// The semantic of an approval option, carried natively by ACP (gemini/opencode)
// `options[].kind`. Drives default-option selection and allow/reject styling without
// string-matching the optionId. claude/codex don't report it (left undefined).
export type PromptChoiceKindDto =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

// What an approval/permission prompt is asking the user to approve, normalized across
// providers: a command (+cwd) or tool-input summary (`text`), or a unified diff (`diff`),
// plus the affected file paths. Renderer is provider-agnostic.
export interface PromptDetailDto {
  format: "text" | "diff";
  body: string;
  locations?: string[];
}

export interface PromptStateDto {
  promptId: string;
  threadId: ThreadId;
  agentId: AgentId;
  kind: PromptKindDto;
  message: string;
  // Short chip label for a question (claude AskUserQuestion `question.header`).
  header?: string;
  // For approval/permission prompts: the command/diff being approved (claude permission
  // tool input, codex command/fileChange, ACP toolCall content + locations).
  detail?: PromptDetailDto;
  choices?: PromptChoiceDto[];
  defaultChoiceId?: string;
  // When true the user may pick SEVERAL options (a multi-select question, e.g. claude
  // AskUserQuestion multiSelect) — the card toggles them and submits the set together.
  multiSelect?: boolean;
  // A batched, multi-step prompt (currently only claude AskUserQuestion's 1-4 questions).
  // When present with length > 1 the card is a navigable wizard: the user moves Back/Next
  // across steps, revises any answer, and submits them all together — nothing commits until
  // the final submit. Single prompts (every permission/approval, a 1-question AskUserQuestion)
  // omit this and render as a plain single card. `message`/`choices`/`multiSelect` mirror
  // `steps[0]` so non-wizard consumers still have a usable single view.
  steps?: PromptStepDto[];
  source: "pty" | "provider_signal" | "provider_hook";
}

export interface PromptStepDto {
  // Stable per-step id (claude: "q-<index>"); echoed back in each PromptStepAnswerDto.
  stepId: string;
  // The raw question text. The wizard chrome shows the "i of N" position itself, so this
  // carries NO "(i/N)" prefix (unlike the single-prompt `message`).
  message: string;
  // Short chip label for this question (claude AskUserQuestion `question.header`).
  header?: string;
  choices?: PromptChoiceDto[];
  defaultChoiceId?: string;
  multiSelect?: boolean;
}

// One resolved answer in a multi-step submit. `value` is the provider-native answer the
// renderer already resolves: a chosen option's `providerValue`, free text ("Other…"), or
// "" to skip — i.e. exactly what the single-prompt answer `value` carries.
export interface PromptStepAnswerDto {
  stepId: string;
  value: string;
  // Free-text note the user attached to this question (claude AskUserQuestion
  // annotations.notes); undefined when no note was written.
  notes?: string;
}

export interface PromptChoiceDto {
  choiceId: string;
  label: string;
  providerValue: string;
  // Per-option explanation (claude AskUserQuestion `option.description`).
  description?: string;
  // Per-option preview content — mockup/code/diff shown when the option is focused
  // (claude AskUserQuestion `option.preview`).
  preview?: string;
  // Approval semantic (ACP `options[].kind`); undefined for claude/codex.
  kind?: PromptChoiceKindDto;
}
