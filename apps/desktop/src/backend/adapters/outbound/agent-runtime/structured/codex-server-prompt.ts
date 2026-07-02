import type { PromptChoice, PromptDetail, PromptState, PromptStep, PromptStepAnswer } from "../../../../application/domains/thread/thread.ts";
import { bounded, isRecord, stringField } from "./codex-app-server-shared.ts";

export const CODEX_ACCEPT_TOKEN = "structured:accept";
export const CODEX_DECLINE_TOKEN = "structured:decline";
const CODEX_OPTION_PREFIX = "structured:codex-option:";
// "Allow for this session": codex's native session-scoped approval - the same command/files
// are not re-prompted for the rest of the session (decision: "acceptForSession").
// See docs_v2/specs/codex-permission-allow-for-session.md.
export const CODEX_ACCEPT_FOR_SESSION_TOKEN = "structured:accept_for_session";

export type PendingServerPrompt =
  | { kind: "approval" | "legacy_review"; serverRequestId: number | string }
  | {
      kind: "mcp_elicitation";
      serverRequestId: number | string;
      acceptContent: Record<string, unknown> | null;
    }
  | {
      kind: "request_user_input";
      serverRequestId: number | string;
      questions: CodexUserInputQuestion[];
    };

export function codexServerPromptResult(
  pending: PendingServerPrompt,
  input: string | { value: string; stepAnswers?: PromptStepAnswer[] },
): Record<string, unknown> {
  const value = typeof input === "string" ? input : input.value;
  if (pending.kind === "mcp_elicitation") {
    const action = value === CODEX_ACCEPT_TOKEN || value === CODEX_ACCEPT_FOR_SESSION_TOKEN
      ? "accept"
      : "decline";
    return {
      action,
      content: action === "accept" ? pending.acceptContent : null,
      _meta: null,
    };
  }
  if (pending.kind === "request_user_input") {
    return codexUserInputResult(pending.questions, typeof input === "string" ? undefined : input.stepAnswers, value);
  }
  if (pending.kind === "legacy_review") {
    return {
      decision: value === CODEX_ACCEPT_TOKEN
        ? "approved"
        : value === CODEX_ACCEPT_FOR_SESSION_TOKEN
          ? "approved_for_session"
          : "denied",
    };
  }
  // codex v2 decision enum: accept / acceptForSession (don't re-prompt this session) /
  // decline. Secure-by-default: only an EXPLICIT allow token approves; the Skip button
  // (value ""), a dismissed card, or any unrecognized answer DECLINES.
  return {
    decision: value === CODEX_ACCEPT_TOKEN
      ? "accept"
      : value === CODEX_ACCEPT_FOR_SESSION_TOKEN
        ? "acceptForSession"
        : "decline",
  };
}

export function codexApprovalPrompt(input: {
  serverRequestId: number | string;
  threadId: string;
  message: string;
  detail?: PromptDetail;
  nativeIds?: Record<string, string>;
}): { promptState: PromptState; pending: PendingServerPrompt } {
  const promptId = `codex-perm-${String(input.serverRequestId)}`;
  return {
    pending: { kind: "approval", serverRequestId: input.serverRequestId },
    promptState: {
      promptId,
      threadId: input.threadId,
      agentId: "codex",
      kind: "approval",
      message: input.message,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      ...(input.nativeIds !== undefined ? { nativeIds: input.nativeIds } : {}),
      choices: [
        { choiceId: "allow", label: "Allow", providerValue: CODEX_ACCEPT_TOKEN },
        {
          choiceId: "allow_session",
          label: "Allow for this session",
          providerValue: CODEX_ACCEPT_FOR_SESSION_TOKEN,
          kind: "allow_always",
        },
        { choiceId: "deny", label: "Deny", providerValue: CODEX_DECLINE_TOKEN },
      ],
      defaultChoiceId: "allow",
      source: "provider_hook",
    },
  };
}

export function codexLegacyReviewPrompt(input: {
  serverRequestId: number | string;
  threadId: string;
  message: string;
  detail?: PromptDetail;
  nativeIds?: Record<string, string>;
}): { promptState: PromptState; pending: PendingServerPrompt } {
  const promptId = `codex-legacy-review-${String(input.serverRequestId)}`;
  return {
    pending: { kind: "legacy_review", serverRequestId: input.serverRequestId },
    promptState: {
      promptId,
      threadId: input.threadId,
      agentId: "codex",
      kind: "approval",
      message: input.message,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      ...(input.nativeIds !== undefined ? { nativeIds: input.nativeIds } : {}),
      choices: [
        { choiceId: "allow", label: "Allow", providerValue: CODEX_ACCEPT_TOKEN },
        {
          choiceId: "allow_session",
          label: "Allow for this session",
          providerValue: CODEX_ACCEPT_FOR_SESSION_TOKEN,
          kind: "allow_always",
        },
        { choiceId: "deny", label: "Deny", providerValue: CODEX_DECLINE_TOKEN },
      ],
      defaultChoiceId: "allow",
      source: "provider_hook",
    },
  };
}

export function codexMcpElicitationPrompt(input: {
  serverRequestId: number | string;
  threadId: string;
  params: Record<string, unknown>;
  nativeIds?: Record<string, string>;
}): { promptState: PromptState; pending: PendingServerPrompt } {
  const promptId = `codex-mcp-elicit-${String(input.serverRequestId)}`;
  const mode = stringField(input.params, "mode");
  const detail = mcpElicitationDetail(input.params);
  return {
    pending: {
      kind: "mcp_elicitation",
      serverRequestId: input.serverRequestId,
      acceptContent: mode === "form" ? {} : null,
    },
    promptState: {
      promptId,
      threadId: input.threadId,
      agentId: "codex",
      kind: "approval",
      message: stringField(input.params, "message") ?? "Allow MCP request",
      ...(detail !== undefined ? { detail } : {}),
      ...(input.nativeIds !== undefined ? { nativeIds: input.nativeIds } : {}),
      choices: [
        { choiceId: "allow", label: "Allow", providerValue: CODEX_ACCEPT_TOKEN },
        { choiceId: "deny", label: "Deny", providerValue: CODEX_DECLINE_TOKEN },
      ],
      defaultChoiceId: "allow",
      source: "provider_hook",
    },
  };
}

export interface CodexUserInputQuestion {
  id: string;
  question: string;
  header?: string;
  choices?: PromptChoice[];
}

export function codexRequestUserInputPrompt(input: {
  serverRequestId: number | string;
  threadId: string;
  params: Record<string, unknown>;
  nativeIds?: Record<string, string>;
}): { promptState: PromptState; pending: PendingServerPrompt } | undefined {
  const questions = Array.isArray(input.params.questions)
    ? input.params.questions.map(codexQuestionFromRecord).filter((q): q is CodexUserInputQuestion => q !== undefined)
    : [];
  if (questions.length === 0) {
    return undefined;
  }
  const promptId = `codex-user-input-${String(input.serverRequestId)}`;
  const first = questions[0];
  const steps = questions.length > 1
    ? questions.map((question): PromptStep => ({
        stepId: question.id,
        message: question.question,
        ...(question.header !== undefined ? { header: question.header } : {}),
        ...(question.choices !== undefined ? { choices: question.choices } : {}),
        ...(question.choices?.[0] !== undefined ? { defaultChoiceId: question.choices[0].choiceId } : {}),
      }))
    : undefined;
  return {
    pending: { kind: "request_user_input", serverRequestId: input.serverRequestId, questions },
    promptState: {
      promptId,
      threadId: input.threadId,
      agentId: "codex",
      kind: first.choices !== undefined && first.choices.length > 0 ? "choice" : "question",
      message: first.question,
      ...(first.header !== undefined ? { header: first.header } : {}),
      ...(first.choices !== undefined ? { choices: first.choices } : {}),
      ...(first.choices?.[0] !== undefined ? { defaultChoiceId: first.choices[0].choiceId } : {}),
      ...(steps !== undefined ? { steps } : {}),
      ...(input.nativeIds !== undefined ? { nativeIds: input.nativeIds } : {}),
      source: "provider_hook",
    },
  };
}

function mcpElicitationDetail(params: Record<string, unknown>): PromptDetail | undefined {
  const meta = isRecord(params._meta) ? params._meta : undefined;
  const lines: string[] = [];
  const serverName = stringField(params, "serverName");
  if (serverName !== undefined) {
    lines.push(`server: ${serverName}`);
  }
  const toolTitle = meta !== undefined
    ? stringField(meta, "tool_title") ?? stringField(meta, "tool_name") ?? stringField(meta, "tool")
    : undefined;
  if (toolTitle !== undefined) {
    lines.push(`tool: ${toolTitle}`);
  }
  const toolArguments = meta !== undefined ? meta.tool_arguments : undefined;
  if (toolArguments !== undefined) {
    lines.push(`arguments: ${bounded(jsonDetail(toolArguments))}`);
  }
  if (lines.length === 0) {
    return undefined;
  }
  return { format: "text", body: lines.join("\n") };
}

function jsonDetail(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function codexQuestionFromRecord(value: unknown): CodexUserInputQuestion | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = stringField(value, "id");
  const question = stringField(value, "question");
  if (id === undefined || question === undefined) {
    return undefined;
  }
  const options = Array.isArray(value.options) ? value.options : [];
  const choices = options
    .map((option): PromptChoice | undefined => {
      if (!isRecord(option)) {
        return undefined;
      }
      const label = stringField(option, "label");
      if (label === undefined) {
        return undefined;
      }
      const description = stringField(option, "description");
      return {
        choiceId: `opt-${label}`,
        label,
        providerValue: `${CODEX_OPTION_PREFIX}${label}`,
        ...(description !== undefined ? { description } : {}),
      };
    })
    .filter((choice): choice is PromptChoice => choice !== undefined);
  return {
    id,
    question,
    ...(stringField(value, "header") !== undefined ? { header: stringField(value, "header") } : {}),
    ...(choices.length > 0 ? { choices } : {}),
  };
}

function codexUserInputResult(
  questions: CodexUserInputQuestion[],
  stepAnswers: PromptStepAnswer[] | undefined,
  fallbackValue: string,
): Record<string, unknown> {
  const answers: Record<string, { answers: string[] }> = {};
  if (stepAnswers !== undefined) {
    for (const answer of stepAnswers) {
      if (questions.some((question) => question.id === answer.stepId)) {
        answers[answer.stepId] = { answers: answerTexts(answer.value) };
      }
    }
    return { answers };
  }
  const first = questions[0];
  if (first !== undefined) {
    answers[first.id] = { answers: answerTexts(fallbackValue) };
  }
  return { answers };
}

function answerTexts(value: string): string[] {
  if (value.startsWith(CODEX_OPTION_PREFIX)) {
    return [value.slice(CODEX_OPTION_PREFIX.length)];
  }
  return value.length > 0 ? [value] : [];
}
