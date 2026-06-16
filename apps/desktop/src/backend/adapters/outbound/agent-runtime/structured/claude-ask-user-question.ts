// claude AskUserQuestion handling, extracted from claude-stream-json-client.ts (it is
// claude-only — no other provider batches questions — and was pushing the client past
// the file-size cap). Owns: surfacing the tool's 1-4 questions as a prompt (a navigable
// WIZARD for a multi-question set, one card at a time for the degenerate fallback), and
// turning the user's answer(s) back into the single control_response that allows the tool.
// See docs_v2/specs/multi-step-prompt-navigation.md.
import type { PromptChoice, PromptState, PromptStep, PromptStepAnswer } from "../../../../application/domains/thread/thread.ts";
import type { StructuredProviderEvent } from "./structured-runtime-events.ts";
import { STRUCTURED_ALLOW_TOKEN, STRUCTURED_OPTION_PREFIX, isRecord, stringField } from "./claude-stream-json-shared.ts";

// A pending claude permission/tool request awaiting a control_response. AskUserQuestion
// requests carry the sequential multi-question state (claude requires EVERY question
// answered before the tool runs); a plain permission leaves `askUserQuestion` unset.
export interface PendingPermission {
  requestId: string;
  toolInput: unknown;
  askUserQuestion?: {
    questions: unknown[];
    answers: Record<string, string>;
    index: number;
  };
}

// The slice of the client the AskUserQuestion handlers operate through: the shared
// pending map, the thread/agent identity stamped on a prompt, the event sink, and the
// control-protocol writer. Passed in so this module never imports the client (no cycle).
export interface AskUserQuestionContext {
  threadId: string;
  agentId: "claude";
  pendingPermissions: Map<string, PendingPermission>;
  onEvent: (event: StructuredProviderEvent) => void;
  writeLine: (value: unknown) => void;
}

// Surface AskUserQuestion's question at `index` as a choice prompt; returns false if it
// has no answerable options (caller then falls back to a generic allow/deny permission
// for the whole tool). The one-at-a-time path: the next question is surfaced WHILE the
// previous is being answered, so emitting is deferred (see below).
export function surfaceAskUserQuestion(
  ctx: AskUserQuestionContext,
  requestId: string,
  toolInput: Record<string, unknown>,
  questions: unknown[],
  answers: Record<string, string>,
  index: number,
): boolean {
  const question = isRecord(questions[index]) ? questions[index] : undefined;
  const questionText = question !== undefined ? stringField(question, "question") : undefined;
  const options = question !== undefined && Array.isArray(question.options) ? question.options : [];
  const optionChoices = buildOptionChoices(options);
  if (questionText === undefined || optionChoices.length === 0) {
    return false;
  }
  const promptId = `claude-auq-${requestId}-${index}`;
  ctx.pendingPermissions.set(promptId, {
    requestId,
    toolInput,
    askUserQuestion: { questions, answers, index },
  });
  const total = questions.length;
  // A multiSelect question lets the user pick several options; the card submits them
  // joined as the free-text answer (claude records the joined labels). See the answer
  // path below (no STRUCTURED_OPTION_PREFIX ⇒ accepted verbatim).
  const multiSelect = question?.multiSelect === true;
  const promptState: PromptState = {
    promptId,
    threadId: ctx.threadId,
    agentId: ctx.agentId,
    kind: "choice",
    // Number multi-question prompts so the user knows more are coming.
    message: total > 1 ? `(${index + 1}/${total}) ${questionText}` : questionText,
    choices: optionChoices,
    defaultChoiceId: optionChoices[0]?.choiceId,
    ...(multiSelect ? { multiSelect: true } : {}),
    source: "provider_hook",
  };
  // Defer the emit: a follow-up question (Q2…) is surfaced WHILE the previous one is
  // being answered, so emitting synchronously would queue it behind the about-to-be-
  // cleared prior prompt — and the queue path re-emits the stale prior prompt,
  // clobbering this one in the UI. setImmediate lets the answer flow settle (prompt
  // cleared) so this surfaces cleanly as the visible card. Gated on the pending entry:
  // a control_cancel_request landing inside this window already withdrew the
  // interaction — emitting then would show a ghost card nothing can answer.
  setImmediate(() => {
    if (ctx.pendingPermissions.has(promptId)) {
      ctx.onEvent({ kind: "prompt", promptState });
    }
  });
  return true;
}

// Surface a MULTI-question AskUserQuestion as ONE navigable wizard prompt: every question
// rides as a `step`, the user moves back/forth and revises freely, and submits all answers
// together. Returns false if any question lacks text/options — the caller then falls back
// to the one-at-a-time path. Unlike that path this emits SYNCHRONOUSLY: it surfaces once
// from the tool request (not during an answer flow), so no deferred re-surface is needed.
export function surfaceAskUserQuestionWizard(
  ctx: AskUserQuestionContext,
  requestId: string,
  toolInput: Record<string, unknown>,
  questions: unknown[],
): boolean {
  const steps: PromptStep[] = [];
  for (let index = 0; index < questions.length; index += 1) {
    const step = buildAskUserQuestionStep(questions[index], index);
    if (step === undefined) {
      return false;
    }
    steps.push(step);
  }
  if (steps.length < 2) {
    return false;
  }
  const promptId = `claude-auq-${requestId}`;
  ctx.pendingPermissions.set(promptId, {
    requestId,
    toolInput,
    askUserQuestion: { questions, answers: {}, index: 0 },
  });
  const head = steps[0];
  const promptState: PromptState = {
    promptId,
    threadId: ctx.threadId,
    agentId: ctx.agentId,
    kind: "choice",
    // Single-view fallback mirrors step 0 (the wizard chrome shows the i/N position, so
    // no "(i/N)" prefix on the raw question).
    message: head.message,
    choices: head.choices,
    defaultChoiceId: head.defaultChoiceId,
    ...(head.multiSelect === true ? { multiSelect: true } : {}),
    steps,
    source: "provider_hook",
  };
  if (ctx.pendingPermissions.has(promptId)) {
    ctx.onEvent({ kind: "prompt", promptState });
  }
  return true;
}

// Answer a pending AskUserQuestion (the caller has already handled a Deny). A wizard
// submit carries every step's answer at once → build the full answers map and allow the
// tool ONCE. The per-question path (a 1-question prompt, or the degenerate no-options
// fallback) records this question's answer then surfaces the next, allowing once all are
// collected. `pending.askUserQuestion` is guaranteed set by the caller.
export function answerAskUserQuestion(
  ctx: AskUserQuestionContext,
  pending: PendingPermission,
  input: { value: string; stepAnswers?: PromptStepAnswer[] },
): void {
  const askUserQuestion = pending.askUserQuestion;
  if (askUserQuestion === undefined) {
    return;
  }
  if (input.stepAnswers !== undefined) {
    sendAskUserQuestionAllow(
      ctx,
      pending.requestId,
      pending.toolInput,
      answersFromStepAnswers(askUserQuestion.questions, input.stepAnswers),
    );
    return;
  }
  const { questions, answers, index } = askUserQuestion;
  const currentQuestion = isRecord(questions[index])
    ? stringField(questions[index] as Record<string, unknown>, "question")
    : undefined;
  // A listed option arrives as structured:option:<label>; any OTHER non-empty value is
  // the user's typed "Other…" free-text reply, which claude accepts verbatim. An empty
  // value is Skip (leave this question unanswered). Dropping the free-text path here lost
  // the user's typed answers entirely ("The user did not answer the questions").
  const answerText = answerTextFromValue(input.value);
  const nextAnswers =
    answerText !== undefined && currentQuestion !== undefined
      ? { ...answers, [currentQuestion]: answerText }
      : answers;
  const nextIndex = index + 1;
  if (
    nextIndex < questions.length &&
    surfaceAskUserQuestion(
      ctx,
      pending.requestId,
      isRecord(pending.toolInput) ? pending.toolInput : {},
      questions,
      nextAnswers,
      nextIndex,
    )
  ) {
    return; // more questions to ask before allowing the tool
  }
  sendAskUserQuestionAllow(ctx, pending.requestId, pending.toolInput, nextAnswers);
}

function sendAskUserQuestionAllow(
  ctx: AskUserQuestionContext,
  requestId: string,
  toolInput: unknown,
  answers: Record<string, string>,
): void {
  const updatedInput = isRecord(toolInput) ? { ...toolInput, answers } : toolInput;
  ctx.writeLine({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: { behavior: "allow", updatedInput },
    },
  });
}

function buildOptionChoices(options: unknown[]): PromptChoice[] {
  return options
    .map((option) =>
      isRecord(option) && typeof option.label === "string"
        ? {
            choiceId: `opt-${option.label}`,
            label: option.label,
            providerValue: `${STRUCTURED_OPTION_PREFIX}${option.label}`,
          }
        : undefined,
    )
    .filter((choice): choice is PromptChoice => choice !== undefined);
}

// Build one wizard step from an AskUserQuestion question. Returns undefined when the
// question has no text or no answerable options (the wizard then declines, falling back
// to the one-at-a-time path).
function buildAskUserQuestionStep(question: unknown, index: number): PromptStep | undefined {
  const record = isRecord(question) ? question : undefined;
  const questionText = record !== undefined ? stringField(record, "question") : undefined;
  const options = record !== undefined && Array.isArray(record.options) ? record.options : [];
  const choices = buildOptionChoices(options);
  if (questionText === undefined || choices.length === 0) {
    return undefined;
  }
  return {
    stepId: `q-${index}`,
    message: questionText,
    choices,
    defaultChoiceId: choices[0]?.choiceId,
    ...(record?.multiSelect === true ? { multiSelect: true } : {}),
  };
}

// Map a wizard's per-step answers back to claude's answers map (keyed by question text),
// interpreting each value exactly like a single-question answer.
function answersFromStepAnswers(
  questions: unknown[],
  stepAnswers: PromptStepAnswer[],
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const stepAnswer of stepAnswers) {
    const index = parseStepIndex(stepAnswer.stepId);
    if (index === undefined) {
      continue;
    }
    const question = isRecord(questions[index]) ? questions[index] : undefined;
    const questionText = question !== undefined ? stringField(question, "question") : undefined;
    if (questionText === undefined) {
      continue;
    }
    const answerText = answerTextFromValue(stepAnswer.value);
    if (answerText !== undefined) {
      answers[questionText] = answerText;
    }
  }
  return answers;
}

// Interpret one prompt-answer value: a listed option strips STRUCTURED_OPTION_PREFIX; any
// other non-empty text (not the Allow token) is a verbatim free-text reply; "" is a skip.
function answerTextFromValue(value: string): string | undefined {
  if (value.startsWith(STRUCTURED_OPTION_PREFIX)) {
    return value.slice(STRUCTURED_OPTION_PREFIX.length);
  }
  return value.length > 0 && value !== STRUCTURED_ALLOW_TOKEN ? value : undefined;
}

function parseStepIndex(stepId: string): number | undefined {
  const match = /^q-(\d+)$/.exec(stepId);
  return match === null ? undefined : Number.parseInt(match[1], 10);
}
