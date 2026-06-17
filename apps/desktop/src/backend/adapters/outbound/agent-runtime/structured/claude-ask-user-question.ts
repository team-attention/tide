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
// Per-question annotations claude reads back from the AskUserQuestion tool: the user's
// free-text `notes` and an echo of the chosen option's authored `preview`. Keyed by question
// text, exactly like `answers`. Sent in `updatedInput.annotations` when non-empty.
export type AskUserQuestionAnnotations = Record<string, { notes?: string; preview?: string }>;

export interface PendingPermission {
  requestId: string;
  toolInput: unknown;
  askUserQuestion?: {
    questions: unknown[];
    answers: Record<string, string>;
    // Accumulated alongside `answers` for the sequential (one-at-a-time) answer path.
    annotations: AskUserQuestionAnnotations;
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
  annotations: AskUserQuestionAnnotations,
): boolean {
  const question = isRecord(questions[index]) ? questions[index] : undefined;
  const questionText = question !== undefined ? stringField(question, "question") : undefined;
  const header = question !== undefined ? stringField(question, "header") : undefined;
  const options = question !== undefined && Array.isArray(question.options) ? question.options : [];
  const optionChoices = buildOptionChoices(options);
  if (questionText === undefined || optionChoices.length === 0) {
    return false;
  }
  const promptId = `claude-auq-${requestId}-${index}`;
  ctx.pendingPermissions.set(promptId, {
    requestId,
    toolInput,
    askUserQuestion: { questions, answers, annotations, index },
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
    ...(header !== undefined ? { header } : {}),
    choices: optionChoices,
    defaultChoiceId: optionChoices[0]?.choiceId,
    ...(multiSelect ? { multiSelect: true } : {}),
    source: "provider_hook",
  };
  // Emit SYNCHRONOUSLY — no setImmediate. Deferring the emit on a timer made the FIRST/
  // single question (the common case) race with surrounding stream events: a turn-end or
  // re-poll landing in the deferral window left the thread Working with the card never
  // surfaced (the "stuck waiting, no card" report). Ordering of a follow-up question (Q2…)
  // surfaced during the previous answer is the BACKEND prompt queue's job
  // (recordProviderPromptState queues behind a live prompt; answerPrompt promotes the next
  // on settle) — a deterministic queue, not a timer. The pendingPermissions gate still
  // guards a control_cancel_request that withdrew the interaction before this ran.
  if (ctx.pendingPermissions.has(promptId)) {
    ctx.onEvent({ kind: "prompt", promptState });
  }
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
    askUserQuestion: { questions, answers: {}, annotations: {}, index: 0 },
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
    ...(head.header !== undefined ? { header: head.header } : {}),
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
  input: { value: string; stepAnswers?: PromptStepAnswer[]; notes?: string },
): void {
  const askUserQuestion = pending.askUserQuestion;
  if (askUserQuestion === undefined) {
    return;
  }
  if (input.stepAnswers !== undefined) {
    const { answers, annotations } = answersFromStepAnswers(askUserQuestion.questions, input.stepAnswers);
    sendAskUserQuestionAllow(ctx, pending.requestId, pending.toolInput, answers, annotations);
    return;
  }
  const { questions, answers, annotations, index } = askUserQuestion;
  const currentQuestionRecord = questions[index];
  const currentQuestion = isRecord(currentQuestionRecord)
    ? stringField(currentQuestionRecord, "question")
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
  // Attach the user's note + the chosen option's preview echo to this question.
  const annotation =
    currentQuestion !== undefined ? buildAnnotation(currentQuestionRecord, input.value, input.notes) : undefined;
  const nextAnnotations =
    annotation !== undefined && currentQuestion !== undefined
      ? { ...annotations, [currentQuestion]: annotation }
      : annotations;
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
      nextAnnotations,
    )
  ) {
    return; // more questions to ask before allowing the tool
  }
  sendAskUserQuestionAllow(ctx, pending.requestId, pending.toolInput, nextAnswers, nextAnnotations);
}

function sendAskUserQuestionAllow(
  ctx: AskUserQuestionContext,
  requestId: string,
  toolInput: unknown,
  answers: Record<string, string>,
  annotations: AskUserQuestionAnnotations,
): void {
  const hasAnnotations = Object.keys(annotations).length > 0;
  const updatedInput = isRecord(toolInput)
    ? { ...toolInput, answers, ...(hasAnnotations ? { annotations } : {}) }
    : toolInput;
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
    .map((option) => {
      if (!isRecord(option) || typeof option.label !== "string") {
        return undefined;
      }
      // AskUserQuestion options carry `description` (per-option explanation) and an
      // optional `preview` (mockup/code) — surface both so the card can show them.
      const description = stringField(option, "description");
      const preview = stringField(option, "preview");
      return {
        choiceId: `opt-${option.label}`,
        label: option.label,
        providerValue: `${STRUCTURED_OPTION_PREFIX}${option.label}`,
        ...(description !== undefined ? { description } : {}),
        ...(preview !== undefined ? { preview } : {}),
      };
    })
    .filter((choice): choice is PromptChoice => choice !== undefined);
}

// Build one wizard step from an AskUserQuestion question. Returns undefined when the
// question has no text or no answerable options (the wizard then declines, falling back
// to the one-at-a-time path).
function buildAskUserQuestionStep(question: unknown, index: number): PromptStep | undefined {
  const record = isRecord(question) ? question : undefined;
  const questionText = record !== undefined ? stringField(record, "question") : undefined;
  const header = record !== undefined ? stringField(record, "header") : undefined;
  const options = record !== undefined && Array.isArray(record.options) ? record.options : [];
  const choices = buildOptionChoices(options);
  if (questionText === undefined || choices.length === 0) {
    return undefined;
  }
  return {
    stepId: `q-${index}`,
    message: questionText,
    ...(header !== undefined ? { header } : {}),
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
): { answers: Record<string, string>; annotations: AskUserQuestionAnnotations } {
  const answers: Record<string, string> = {};
  const annotations: AskUserQuestionAnnotations = {};
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
    const annotation = buildAnnotation(question, stepAnswer.value, stepAnswer.notes);
    if (annotation !== undefined) {
      annotations[questionText] = annotation;
    }
  }
  return { answers, annotations };
}

// Build the claude annotation for one answered question: the user's free-text note plus an
// echo of the chosen option's authored preview. Returns undefined when there's nothing to
// attach (no note, and the chosen option had no preview / the answer was free text).
function buildAnnotation(
  question: unknown,
  value: string,
  notes: string | undefined,
): { notes?: string; preview?: string } | undefined {
  const trimmed = notes?.trim();
  const note = trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
  const preview = chosenOptionPreview(question, value);
  if (note === undefined && preview === undefined) {
    return undefined;
  }
  return {
    ...(note !== undefined ? { notes: note } : {}),
    ...(preview !== undefined ? { preview } : {}),
  };
}

// The authored preview of the option the user chose (value = structured:option:<label>),
// echoed back into annotations. A free-text ("Other…") answer matches no option ⇒ no preview.
function chosenOptionPreview(question: unknown, value: string): string | undefined {
  if (!value.startsWith(STRUCTURED_OPTION_PREFIX)) {
    return undefined;
  }
  const label = value.slice(STRUCTURED_OPTION_PREFIX.length);
  const options = isRecord(question) && Array.isArray(question.options) ? question.options : [];
  for (const option of options) {
    if (isRecord(option) && option.label === label) {
      return stringField(option, "preview");
    }
  }
  return undefined;
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
