// Claude Code structured runtime client — the stream-json control protocol.
//
// EVIDENCE-BASED (live transcripts /tmp/tide-proto-evidence/claude/, claude
// 2.1.170; corroborated by @anthropic-ai/claude-agent-sdk 0.3.170 sdk.mjs):
// - spawn: claude --print --input-format stream-json --output-format stream-json
//   --verbose --permission-prompt-tool stdio [--permission-mode X] ...
//   JSONL both directions over plain stdio (NO PTY). Process persists across
//   turns while stdin stays open.
// - first stdout line: {"type":"system","subtype":"init", session_id, tools,
//   mcp_servers:[{name,status}], model, slash_commands, ...}
// - user turn (stdin): {"type":"user","message":{"role":"user","content":[...]}}
// - complete messages stream back as {"type":"assistant"|"user", message:{...}}
//   (tool_result content arrives on "user"-typed lines, Anthropic shape).
// - permission: {"type":"control_request","request_id","request":{"subtype":
//   "can_use_tool","tool_name","input","permission_suggestions",...}} answered on
//   stdin with {"type":"control_response","response":{"subtype":"success",
//   "request_id","response":{"behavior":"allow","updatedInput":<input>}}} or
//   {"behavior":"deny","message","interrupt":false}. The tool DOES NOT START
//   until the response arrives — the whole PTY box-timing failure class is gone.
// - turn end: {"type":"result", subtype, is_error, usage, modelUsage, ...}.
//   Unauthenticated: result.is_error=true + synthetic "Not logged in" message.
// - interrupt: control_request {"subtype":"interrupt"} from client; not wired
//   yet (Tide's Stop kills the runtime, same semantics as the PTY transport).
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";

import type { ComposerAttachmentRef, PromptChoice, PromptState } from "../../../../application/domains/thread/thread.ts";
import type { ProviderLaunchPlan } from "../../../../application/ports/outbound/agent-integration-port.ts";
import type {
  StructuredClientCallbacks,
  StructuredRuntimeClient,
  StructuredRuntimeWrite,
} from "./structured-runtime-events.ts";
import { createUpdateNoticeScanner } from "./agent-update-notice.ts";

export const STRUCTURED_ALLOW_TOKEN = "structured:allow";
export const STRUCTURED_DENY_TOKEN = "structured:deny";
export const STRUCTURED_OPTION_PREFIX = "structured:option:";

export interface CreateClaudeStreamJsonClientInput extends StructuredClientCallbacks {
  plan: ProviderLaunchPlan;
  threadId: string;
  runtimeId: string;
  initialPrompt?: string;
  initialAttachments?: ComposerAttachmentRef[];
}

// Build a claude user-message content array: the text plus a NATIVE inline image
// block per attachment ({type:"image", source:{type:"base64", media_type, data}},
// the Anthropic Messages shape — VERIFIED accepted by `claude --print
// --input-format stream-json`). The bytes go inline on the wire, so claude never
// reads a file — no on-disk attachment, no repo pollution. The "[Attached image:
// <path>]" marker that fed the old file-read path is stripped (it's now dead text
// claude would otherwise try to open). With no attachments the content is exactly
// the text block — byte-identical to before.
const ATTACHED_IMAGE_LINE_RE = /\n*\[Attached image:[^\]]*\]/g;
export function claudeUserContent(
  text: string,
  attachments?: ComposerAttachmentRef[],
): Array<Record<string, unknown>> {
  if (attachments === undefined || attachments.length === 0) {
    return [{ type: "text", text }];
  }
  const cleaned = text.replace(ATTACHED_IMAGE_LINE_RE, "").trim();
  const content: Array<Record<string, unknown>> = [];
  if (cleaned.length > 0) {
    content.push({ type: "text", text: cleaned });
  }
  for (const attachment of attachments) {
    try {
      const data = readFileSync(attachment.path).toString("base64");
      content.push({
        type: "image",
        source: { type: "base64", media_type: attachment.mediaType, data },
      });
    } catch {
      // Unreadable attachment — skip it rather than fail the whole turn.
    }
  }
  return content.length > 0 ? content : [{ type: "text", text }];
}

export function createClaudeStreamJsonClient(
  input: CreateClaudeStreamJsonClientInput,
): StructuredRuntimeClient {
  return new ClaudeStreamJsonClient(input);
}

interface PendingPermission {
  requestId: string;
  toolInput: unknown;
  // For AskUserQuestion: sequential multi-question state. claude can ask several
  // questions in ONE call and requires EVERY one answered, so we surface them one
  // at a time, accumulate answers keyed by question text, and only allow the tool
  // once all are collected. (Answering just the first left the rest unanswered →
  // "The user did not answer the questions".)
  askUserQuestion?: {
    questions: unknown[];
    answers: Record<string, string>;
    index: number;
  };
}

class ClaudeStreamJsonClient implements StructuredRuntimeClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly onEvent: StructuredClientCallbacks["onEvent"];
  private readonly threadId: string;
  private readonly runtimeId: string;
  private readonly agentId = "claude" as const;
  private buffer = "";
  private initialPrompt?: string;
  private initSeen = false;
  private exited = false;
  private readonly scanUpdate = createUpdateNoticeScanner((message) =>
    this.onEvent({ kind: "runtime_notice", level: "info", message }),
  );
  // Live streaming state: the id of the assistant message currently streaming
  // (from message_start) and the accumulated text per content-block index. The
  // matching complete `assistant` message finalizes these by the SAME blockId.
  private streamMessageId?: string;
  private readonly streamBlocks = new Map<
    number,
    { kind: "agent" | "reasoning"; body: string }
  >();
  private flushScheduled = false;
  // promptId -> the protocol request awaiting a control_response.
  private readonly pendingPermissions = new Map<string, PendingPermission>();

  constructor(input: CreateClaudeStreamJsonClientInput) {
    this.onEvent = input.onEvent;
    this.threadId = input.threadId;
    this.runtimeId = input.runtimeId;
    this.initialPrompt = input.initialPrompt;
    this.child = spawn(input.plan.command, input.plan.args, {
      cwd: input.plan.cwd,
      // Inherit the backend's env (login-shell PATH, HOME for auth state) and
      // overlay the plan's additions — plan.env alone would strand the CLI
      // without credentials or PATH.
      env: { ...process.env, ...input.plan.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.ingest(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
        process.stderr.write(`[tide-claude-sj ${this.runtimeId}] ${chunk}`);
      }
      this.scanUpdate(chunk);
    });
    this.child.on("error", (error) => {
      // spawn failures (missing binary, bad cwd) emit 'error' and may never
      // 'exit' — without this handler the runtime dies silently and the thread
      // hangs "Working".
      if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
        process.stderr.write(`[tide-claude-sj ${this.runtimeId}] spawn error: ${String(error)}\n`);
      }
      if (this.exited) {
        return;
      }
      this.exited = true;
      this.onEvent({ kind: "runtime_exited", exitCode: null });
    });
    this.child.on("exit", (code) => {
      if (this.exited) {
        return;
      }
      this.exited = true;
      this.onEvent({ kind: "runtime_exited", exitCode: code });
    });
    // Deliver the first turn IMMEDIATELY: claude emits NOTHING (not even the
    // init line) until its first stdin message arrives — verified live with a
    // delayed-write probe (init at 6.0s == the moment input was written).
    // Waiting for init before writing would deadlock both sides. stdin is
    // buffered, so writing before the process reads is safe; and claude
    // registers its MCP tools before running the turn (the PTY-era plan
    // delivered the first prompt via launch argv for the same reason).
    if (input.initialPrompt !== undefined && input.initialPrompt.length > 0) {
      this.writeLine({
        type: "user",
        message: {
          role: "user",
          content: claudeUserContent(input.initialPrompt, input.initialAttachments),
        },
      });
      this.initialPrompt = undefined;
    }
  }

  get pid(): number | undefined {
    return this.child.pid ?? undefined;
  }

  async write(input: StructuredRuntimeWrite): Promise<void> {
    if (input.kind === "composer_input") {
      this.writeLine({
        type: "user",
        message: {
          role: "user",
          content: claudeUserContent(input.value, input.attachments),
        },
      });
      return;
    }
    const promptId = input.promptId ?? "";
    const pending = this.pendingPermissions.get(promptId);
    if (pending === undefined) {
      // The interaction is gone provider-side (turn ended/interrupted). With a
      // structured protocol there is nothing to type into — drop silently.
      return;
    }
    this.pendingPermissions.delete(promptId);
    if (input.value === STRUCTURED_DENY_TOKEN) {
      this.writeLine({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: pending.requestId,
          response: { behavior: "deny", message: "The user denied this tool use.", interrupt: false },
        },
      });
      return;
    }
    const optionLabel = input.value.startsWith(STRUCTURED_OPTION_PREFIX)
      ? input.value.slice(STRUCTURED_OPTION_PREFIX.length)
      : undefined;
    // AskUserQuestion: record this question's answer (keyed by its text), then
    // surface the NEXT question, or — once every question is answered — allow the
    // tool with the full answers map. claude requires ALL questions answered.
    if (pending.askUserQuestion !== undefined) {
      const { questions, answers, index } = pending.askUserQuestion;
      const currentQuestion = isRecord(questions[index])
        ? stringField(questions[index] as Record<string, unknown>, "question")
        : undefined;
      const nextAnswers =
        optionLabel !== undefined && currentQuestion !== undefined
          ? { ...answers, [currentQuestion]: optionLabel }
          : answers;
      const nextIndex = index + 1;
      if (
        nextIndex < questions.length &&
        this.surfaceAskUserQuestion(
          pending.requestId,
          isRecord(pending.toolInput) ? pending.toolInput : {},
          questions,
          nextAnswers,
          nextIndex,
        )
      ) {
        return; // more questions to ask before allowing the tool
      }
      this.sendAskUserQuestionAllow(pending.requestId, pending.toolInput, nextAnswers);
      return;
    }
    // Generic permission allow: no answer payload.
    this.writeLine({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: pending.requestId,
        response: { behavior: "allow", updatedInput: pending.toolInput },
      },
    });
  }

  // Surface AskUserQuestion's question at `index` as a choice prompt; returns
  // false if it has no answerable options (caller then falls back to a generic
  // allow/deny permission for the whole tool).
  private surfaceAskUserQuestion(
    requestId: string,
    toolInput: Record<string, unknown>,
    questions: unknown[],
    answers: Record<string, string>,
    index: number,
  ): boolean {
    const question = isRecord(questions[index]) ? questions[index] : undefined;
    const questionText = question !== undefined ? stringField(question, "question") : undefined;
    const options = question !== undefined && Array.isArray(question.options) ? question.options : [];
    const optionChoices: PromptChoice[] = options
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
    if (questionText === undefined || optionChoices.length === 0) {
      return false;
    }
    const promptId = `claude-auq-${requestId}-${index}`;
    this.pendingPermissions.set(promptId, {
      requestId,
      toolInput,
      askUserQuestion: { questions, answers, index },
    });
    const total = questions.length;
    const promptState = {
      promptId,
      threadId: this.threadId,
      agentId: this.agentId,
      kind: "choice" as const,
      // Number multi-question prompts so the user knows more are coming.
      message: total > 1 ? `(${index + 1}/${total}) ${questionText}` : questionText,
      choices: optionChoices,
      defaultChoiceId: optionChoices[0]?.choiceId,
      source: "provider_hook" as const,
    };
    // Defer the emit: a follow-up question (Q2…) is surfaced WHILE the previous
    // one is being answered, so emitting synchronously would queue it behind the
    // about-to-be-cleared prior prompt — and the queue path re-emits the stale
    // prior prompt, clobbering this one in the UI. setImmediate lets the answer
    // flow settle (prompt cleared) so this surfaces cleanly as the visible card.
    setImmediate(() => {
      this.onEvent({ kind: "prompt", promptState });
    });
    return true;
  }

  private sendAskUserQuestionAllow(
    requestId: string,
    toolInput: unknown,
    answers: Record<string, string>,
  ): void {
    const updatedInput = isRecord(toolInput) ? { ...toolInput, answers } : toolInput;
    this.writeLine({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response: { behavior: "allow", updatedInput },
      },
    });
  }

  async interrupt(): Promise<void> {
    // The CLI replies with a result(error_during_execution) that flows to
    // turn_completed; the process stays usable for the next turn.
    this.writeLine({
      type: "control_request",
      request_id: `int-${randomUUID()}`,
      request: { subtype: "interrupt" },
    });
  }

  async stop(): Promise<void> {
    this.exited = true;
    try {
      this.child.stdin.end();
    } catch {
      // best-effort
    }
    this.child.kill("SIGTERM");
    setTimeout(() => {
      try {
        this.child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, 1500).unref();
  }

  private writeLine(value: unknown): void {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf("\n");
      if (line.length === 0) {
        continue;
      }
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
        process.stderr.write(
          `[tide-claude-sj ${this.runtimeId}] <- ${String(message.type)} ${String((message as { subtype?: unknown }).subtype ?? "")}\n`,
        );
      }
      try {
        this.handleMessage(message);
      } catch (error) {
        if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
          process.stderr.write(
            `[tide-claude-sj ${this.runtimeId}] handler error: ${String(error)}\n`,
          );
        }
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    const type = message.type;
    if (type === "system" && message.subtype === "init") {
      const sessionId = typeof message.session_id === "string" ? message.session_id : undefined;
      if (sessionId !== undefined) {
        this.onEvent({
          kind: "session_ref",
          ref: { agentId: this.agentId, kind: "claude_transcript", value: sessionId },
        });
      }
      const slashCommands = Array.isArray(message.slash_commands) ? message.slash_commands : [];
      const skills = Array.isArray(message.skills) ? message.skills : [];
      const commands = [
        ...slashCommands
          .filter((n): n is string => typeof n === "string")
          .map((name) => ({ name, description: "Claude command", trigger: "/" as const })),
        ...skills
          .filter((n): n is string => typeof n === "string")
          .map((name) => ({ name, description: "Claude skill", trigger: "$" as const })),
      ];
      if (commands.length > 0) {
        this.onEvent({ kind: "commands", commands });
      }
      this.initSeen = true;
      return;
    }
    if (type === "stream_event") {
      this.handleStreamEvent(isRecord(message.event) ? message.event : {});
      return;
    }
    if (type === "assistant" || type === "user") {
      // The complete message finalizes whatever streamed (same blockId scheme),
      // so flush any pending delta first, then persist.
      this.flushStream();
      this.emitContentRecords(message);
      return;
    }
    if (type === "control_request") {
      this.handleControlRequest(message);
      return;
    }
    if (type === "control_cancel_request") {
      const requestId = stringField(message, "request_id");
      for (const [promptId, pending] of this.pendingPermissions) {
        if (pending.requestId === requestId) {
          this.pendingPermissions.delete(promptId);
          this.onEvent({ kind: "prompt_withdrawn", promptId });
          return;
        }
      }
      return;
    }
    if (type === "result") {
      const isError = message.is_error === true;
      const resultText = typeof message.result === "string" ? message.result : undefined;
      // A user interrupt yields result(error_during_execution) with
      // terminal_reason "aborted_streaming" — not a real failure, so no notice.
      const aborted =
        message.subtype === "error_during_execution" &&
        (message.terminal_reason === "aborted_streaming" || message.terminal_reason === "aborted");
      this.onEvent({
        kind: "turn_completed",
        ...(isError && !aborted && resultText !== undefined ? { notice: resultText } : {}),
        usage: claudeUsage(message),
      });
      return;
    }
    // rate_limit_event, keep_alive: ignored.
  }

  // --- Live streaming (requires --include-partial-messages) ---
  // message_start gives the message id; content_block_delta carries text_delta /
  // thinking_delta per content-block index. We accumulate and flush coalesced
  // content_delta events (UI-only). The complete `assistant` message then
  // finalizes the same blockIds. Verified shapes live (claude 2.1.170).
  private handleStreamEvent(event: Record<string, unknown>): void {
    const eventType = event.type;
    if (eventType === "message_start") {
      const inner = isRecord(event.message) ? event.message : {};
      this.streamMessageId = stringField(inner, "id");
      this.streamBlocks.clear();
      return;
    }
    if (eventType === "content_block_delta") {
      const index = typeof event.index === "number" ? event.index : 0;
      const delta = isRecord(event.delta) ? event.delta : {};
      let kind: "agent" | "reasoning" | undefined;
      let text: string | undefined;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        kind = "agent";
        text = delta.text;
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        kind = "reasoning";
        text = delta.thinking;
      }
      if (kind === undefined || text === undefined) {
        return;
      }
      const slot = this.streamBlocks.get(index) ?? { kind, body: "" };
      slot.body += text;
      this.streamBlocks.set(index, slot);
      this.scheduleFlush();
      return;
    }
    if (eventType === "message_stop") {
      this.flushStream();
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    // Coalesce token deltas into ~50ms UI updates so streaming feels live
    // without flooding IPC/React with one event per token.
    setTimeout(() => this.flushStream(), 50).unref();
  }

  private flushStream(): void {
    this.flushScheduled = false;
    if (this.streamMessageId === undefined) {
      return;
    }
    for (const [index, slot] of this.streamBlocks) {
      if (slot.body.length === 0) {
        continue;
      }
      this.onEvent({
        kind: "content_delta",
        blockId: `structured:${this.runtimeId}:${this.streamMessageId}:${index}`,
        role: slot.kind,
        blockKind: slot.kind === "reasoning" ? "reasoning" : "agent_message",
        body: slot.body,
      });
    }
  }

  private emitContentRecords(message: Record<string, unknown>): void {
    const inner = message.message;
    if (!isRecord(inner) || !Array.isArray(inner.content)) {
      return;
    }
    const role = inner.role;
    // Key every block by the message id + its content-block index, so a
    // streamed block (content_delta used the same key) is FINALIZED here rather
    // than duplicated. Falls back to the runtime id for messages with no id.
    const messageId = stringField(inner, "id") ?? this.streamMessageId ?? "msg";
    inner.content.forEach((item, index) => {
      if (!isRecord(item)) {
        return;
      }
      const blockId = `structured:${this.runtimeId}:${messageId}:${index}`;
      if (item.type === "text" && role === "assistant" && typeof item.text === "string" && item.text.length > 0) {
        this.emitRecord(blockId, {
          type: "message",
          role: "agent",
          status: "complete",
          blockId,
          body: item.text,
          sourceRuntimeId: this.runtimeId,
        }, item.text);
        return;
      }
      if (item.type === "thinking" && typeof item.thinking === "string" && item.thinking.length > 0) {
        this.emitRecord(blockId, {
          type: "reasoning",
          role: "reasoning",
          status: "complete",
          blockId,
          body: item.thinking,
          sourceRuntimeId: this.runtimeId,
        }, item.thinking);
        return;
      }
      if (item.type === "tool_use" && typeof item.id === "string") {
        const argumentsText = JSON.stringify(item.input ?? {});
        this.emitRecord(`${blockId}:${item.id}`, {
          type: "tool_call",
          toolName: typeof item.name === "string" ? item.name : "tool",
          callId: item.id,
          arguments: argumentsText,
          body: bounded(argumentsText),
          status: "complete",
          blockId: `${blockId}:${item.id}`,
          sourceRuntimeId: this.runtimeId,
        }, bounded(argumentsText));
        return;
      }
      if (item.type === "tool_result" && typeof item.tool_use_id === "string") {
        const output = toolResultText(item.content);
        this.emitRecord(`${blockId}:${item.tool_use_id}`, {
          type: "tool_result",
          callId: item.tool_use_id,
          ok: item.is_error !== true,
          output,
          body: bounded(output),
          status: "complete",
          blockId: `${blockId}:${item.tool_use_id}`,
          sourceRuntimeId: this.runtimeId,
        }, bounded(output));
      }
    });
    // The message is finalized; clear streaming state for the next message.
    this.streamMessageId = undefined;
    this.streamBlocks.clear();
  }

  private emitRecord(sourceRef: string, payload: Record<string, unknown>, body: string): void {
    this.onEvent({ kind: "content_record", sourceRef, payload, body });
  }

  private handleControlRequest(message: Record<string, unknown>): void {
    const requestId = stringField(message, "request_id");
    const request = isRecord(message.request) ? message.request : undefined;
    if (requestId === undefined || request === undefined) {
      return;
    }
    if (request.subtype !== "can_use_tool") {
      return;
    }
    const toolName = stringField(request, "tool_name") ?? "tool";
    const toolInput = isRecord(request.input) ? request.input : {};
    const promptId = `claude-perm-${requestId}`;

    // AskUserQuestion's can_use_tool carries the FULL set of questions, each with
    // options. claude requires EVERY question answered, so surface them one at a
    // time (Q1 → on answer → Q2 → …) and inject all answers via updatedInput.
    if (toolName === "AskUserQuestion") {
      const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
      if (questions.length > 0 && this.surfaceAskUserQuestion(requestId, toolInput, questions, {}, 0)) {
        return;
      }
    }

    this.pendingPermissions.set(promptId, { requestId, toolInput });

    const target =
      stringField(toolInput, "command") ??
      stringField(toolInput, "url") ??
      stringField(toolInput, "query") ??
      stringField(toolInput, "path") ??
      stringField(toolInput, "file_path") ??
      stringField(toolInput, "pattern");
    const message_ =
      stringField(toolInput, "description") ??
      (target !== undefined ? `${toolName}: ${target}` : `Claude Code permission required for ${toolName}.`);

    const choices: PromptChoice[] = [
      { choiceId: "allow", label: "Allow", providerValue: STRUCTURED_ALLOW_TOKEN },
      { choiceId: "deny", label: "Deny", providerValue: STRUCTURED_DENY_TOKEN },
    ];
    const promptState: PromptState = {
      promptId,
      threadId: this.threadId,
      agentId: this.agentId,
      kind: "approval",
      message: message_,
      choices,
      defaultChoiceId: "allow",
      source: "provider_hook",
    };
    this.onEvent({ kind: "prompt", promptState });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        isRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text : "",
      )
      .join("\n")
      .trim();
  }
  return "";
}

function claudeUsage(message: Record<string, unknown>):
  | { inputTokens?: number; outputTokens?: number; contextWindow?: number; totalTokens?: number }
  | undefined {
  // modelUsage carries per-model contextWindow (evidence: 01-trivial-turn.jsonl
  // line 13) — the context meter's ground truth in this transport.
  const modelUsage = isRecord(message.modelUsage) ? message.modelUsage : undefined;
  if (modelUsage !== undefined) {
    for (const value of Object.values(modelUsage)) {
      if (!isRecord(value)) {
        continue;
      }
      const inputTokens = numberField(value, "inputTokens");
      const cacheRead = numberField(value, "cacheReadInputTokens") ?? 0;
      const outputTokens = numberField(value, "outputTokens");
      return {
        inputTokens: inputTokens !== undefined ? inputTokens + cacheRead : undefined,
        outputTokens,
        contextWindow: numberField(value, "contextWindow"),
        totalTokens:
          inputTokens !== undefined && outputTokens !== undefined
            ? inputTokens + cacheRead + outputTokens
            : undefined,
      };
    }
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
