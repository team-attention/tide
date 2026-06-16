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
  source: "pty" | "provider_signal" | "provider_hook";
}

export interface PromptChoiceDto {
  choiceId: string;
  label: string;
  providerValue: string;
}
