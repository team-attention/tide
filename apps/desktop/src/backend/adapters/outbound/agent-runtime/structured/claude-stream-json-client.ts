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
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { PromptChoice, PromptState } from "../../../../application/domains/thread/thread.ts";
import type { ProviderLaunchPlan } from "../../../../application/ports/outbound/agent-integration-port.ts";
import type {
  StructuredClientCallbacks,
  StructuredRuntimeClient,
  StructuredRuntimeWrite,
} from "./structured-runtime-events.ts";

export const STRUCTURED_ALLOW_TOKEN = "structured:allow";
export const STRUCTURED_DENY_TOKEN = "structured:deny";
export const STRUCTURED_OPTION_PREFIX = "structured:option:";

export interface CreateClaudeStreamJsonClientInput extends StructuredClientCallbacks {
  plan: ProviderLaunchPlan;
  threadId: string;
  runtimeId: string;
  initialPrompt?: string;
}

export function createClaudeStreamJsonClient(
  input: CreateClaudeStreamJsonClientInput,
): StructuredRuntimeClient {
  return new ClaudeStreamJsonClient(input);
}

interface PendingPermission {
  requestId: string;
  toolInput: unknown;
  // For AskUserQuestion: the question text an answer must be keyed by.
  question?: string;
}

class ClaudeStreamJsonClient implements StructuredRuntimeClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly onEvent: StructuredClientCallbacks["onEvent"];
  private readonly threadId: string;
  private readonly runtimeId: string;
  private readonly agentId = "claude" as const;
  private buffer = "";
  private recordIndex = 0;
  private initialPrompt?: string;
  private initSeen = false;
  private exited = false;
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
        message: { role: "user", content: [{ type: "text", text: input.initialPrompt }] },
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
        message: { role: "user", content: [{ type: "text", text: input.value }] },
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
    // AskUserQuestion answers ride the allow response: updatedInput gains
    // answers keyed by the question text mapping to the chosen option label
    // (verified live: 11-askuserquestion-answered.jsonl — the turn proceeded
    // with the chosen value).
    let updatedInput = pending.toolInput;
    const optionLabel = input.value.startsWith(STRUCTURED_OPTION_PREFIX)
      ? input.value.slice(STRUCTURED_OPTION_PREFIX.length)
      : undefined;
    if (optionLabel !== undefined && pending.question !== undefined && isRecord(pending.toolInput)) {
      updatedInput = {
        ...pending.toolInput,
        answers: { [pending.question]: optionLabel },
      };
    }
    this.writeLine({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: pending.requestId,
        response: { behavior: "allow", updatedInput },
      },
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
      this.initSeen = true;
      return;
    }
    if (type === "assistant" || type === "user") {
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
      this.onEvent({
        kind: "turn_completed",
        ...(isError && resultText !== undefined ? { notice: resultText } : {}),
        usage: claudeUsage(message),
      });
      return;
    }
    // stream_event (partial deltas), rate_limit_event, keep_alive: not consumed
    // yet — complete messages carry the content this slice renders.
  }

  private emitContentRecords(message: Record<string, unknown>): void {
    const inner = message.message;
    if (!isRecord(inner) || !Array.isArray(inner.content)) {
      return;
    }
    const role = inner.role;
    for (const item of inner.content) {
      if (!isRecord(item)) {
        continue;
      }
      const index = this.recordIndex;
      const blockId = `structured:${this.runtimeId}:${index}`;
      if (item.type === "text" && role === "assistant" && typeof item.text === "string" && item.text.length > 0) {
        this.recordIndex += 1;
        this.emitRecord(blockId, {
          type: "message",
          role: "agent",
          status: "complete",
          blockId,
          body: item.text,
          sourceRuntimeId: this.runtimeId,
        }, item.text);
        continue;
      }
      if (item.type === "thinking" && typeof item.thinking === "string" && item.thinking.length > 0) {
        this.recordIndex += 1;
        this.emitRecord(blockId, {
          type: "reasoning",
          role: "reasoning",
          status: "complete",
          blockId,
          body: item.thinking,
          sourceRuntimeId: this.runtimeId,
        }, item.thinking);
        continue;
      }
      if (item.type === "tool_use" && typeof item.id === "string") {
        this.recordIndex += 1;
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
        continue;
      }
      if (item.type === "tool_result" && typeof item.tool_use_id === "string") {
        this.recordIndex += 1;
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
    }
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

    // AskUserQuestion's can_use_tool carries the FULL question with options —
    // surface it as a choice card whose answer is injected via updatedInput.
    if (toolName === "AskUserQuestion") {
      const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
      const first = isRecord(questions[0]) ? questions[0] : undefined;
      const questionText = first !== undefined ? stringField(first, "question") : undefined;
      const options = first !== undefined && Array.isArray(first.options) ? first.options : [];
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
      if (questionText !== undefined && optionChoices.length > 0) {
        this.pendingPermissions.set(promptId, { requestId, toolInput, question: questionText });
        this.onEvent({
          kind: "prompt",
          promptState: {
            promptId,
            threadId: this.threadId,
            agentId: this.agentId,
            kind: "choice",
            message: questionText,
            choices: optionChoices,
            defaultChoiceId: optionChoices[0]?.choiceId,
            source: "provider_hook",
          },
        });
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
