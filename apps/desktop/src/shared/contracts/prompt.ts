import type { AgentId } from "./agent.ts";
import type { ThreadId } from "./ids.ts";

export type PromptKindDto =
  | "question"
  | "approval"
  | "permission"
  | "choice"
  | "command_picker";

export interface PromptStateDto {
  promptId: string;
  threadId: ThreadId;
  agentId: AgentId;
  kind: PromptKindDto;
  message: string;
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
}

export interface PromptChoiceDto {
  choiceId: string;
  label: string;
  providerValue: string;
}
