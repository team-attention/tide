// Claude Code stream-json client. Uses native `/goal`, not Tide-side preambles.
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";

import { createNodeSubagentActivityWatcher, type SubagentActivityWatcher } from "./subagent-activity-watcher.ts";

import type { ComposerAttachmentRef } from "../../../../application/domains/thread/thread.ts";
import type { ProviderLaunchPlan } from "../../../../application/ports/outbound/agent-integration-port.ts";
import type {
  StructuredClientCallbacks,
  StructuredProviderEvent,
  StructuredRuntimeClient,
  StructuredRuntimeWrite,
} from "./structured-runtime-events.ts";
import type { AgentRuntimeRateLimitDto } from "../../../../../shared/contracts/agent-runtime.ts";
import { claudeUsage } from "./claude-usage.ts";
import { usageWithRememberedRateLimits, type StructuredUsagePayload } from "./structured-usage.ts";
import { createUpdateNoticeScanner } from "./agent-update-notice.ts";
import { claudeTodoWritePlanContentRecord } from "./structured-plan-goal.ts";
import {
  STRUCTURED_ALLOW_ALWAYS_TOKEN,
  STRUCTURED_ALLOW_TOKEN,
  STRUCTURED_DENY_TOKEN,
  addRulesOnlySuggestions,
  bounded,
  isRecord,
  stringField,
  toolResultText,
} from "./claude-stream-json-shared.ts";
import { buildPermissionPrompt } from "./claude-permission-prompt.ts";
import type { AskUserQuestionContext, PendingPermission } from "./claude-ask-user-question.ts";
import { answerAskUserQuestion, surfaceAskUserQuestion, surfaceAskUserQuestionWizard } from "./claude-ask-user-question.ts";
import { writeUnsupportedClaudeControlRequest } from "./claude-control-request.ts";
import { claudeGoalEventsFromMessage, claudeGoalEventsFromText, claudeGoalSetEvent, claudeGoalUserMessage } from "./claude-goal.ts";

// How long applyConfig waits for claude's control_response ack before treating
// a mid-thread change as failed; fires only if the process is wedged/dead.
// See docs_v2/specs/claude-bypass-live-capability.md.
const CONFIG_ACK_TIMEOUT_MS = 2500;

export interface CreateClaudeStreamJsonClientInput extends StructuredClientCallbacks {
  plan: ProviderLaunchPlan;
  threadId: string;
  runtimeId: string;
  initialPrompt?: string;
  initialGoal?: string;
  initialAttachments?: ComposerAttachmentRef[];
  // Resolves a session id to its `subagents/` dir, enabling the live Task fan-out
  // watcher. Absent ⇒ no watcher. Spec: live-turn-activity-visibility.md (Slice B).
  locateSubagentsDir?: (sessionId: string) => string | undefined;
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

export function createClaudeStreamJsonClient(input: CreateClaudeStreamJsonClientInput): StructuredRuntimeClient {
  return new ClaudeStreamJsonClient(input);
}

class ClaudeStreamJsonClient implements StructuredRuntimeClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly onEvent: StructuredClientCallbacks["onEvent"];
  private readonly threadId: string;
  private readonly runtimeId: string;
  private readonly agentId = "claude" as const;
  private buffer = "";
  private exited = false;
  private sessionId?: string;
  private readonly subagentWatcher?: SubagentActivityWatcher;
  private readonly scanUpdate = createUpdateNoticeScanner((message) =>
    this.onEvent({ kind: "runtime_notice", level: "info", message }),
  );
  private streamMessageId?: string;
  private readonly streamBlocks = new Map<
    number,
    { kind: "agent" | "reasoning"; body: string }
  >();
  private flushScheduled = false;
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly pendingConfigAcks = new Map<string, (ok: boolean) => void>();
  private lastRateLimits?: AgentRuntimeRateLimitDto[];
  private goalObjective = "";

  constructor(input: CreateClaudeStreamJsonClientInput) {
    this.onEvent = input.onEvent;
    this.threadId = input.threadId;
    this.runtimeId = input.runtimeId;
    this.goalObjective = input.initialGoal?.trim() ?? "";
    if (input.locateSubagentsDir !== undefined) {
      const locate = input.locateSubagentsDir;
      this.subagentWatcher = createNodeSubagentActivityWatcher({
        resolveDir: () => (this.sessionId !== undefined ? locate(this.sessionId) : undefined),
        emit: ({ nestedAgents, nestedToolCalls }) =>
          this.onEvent({ kind: "live_activity", nestedAgents, nestedToolCalls }),
      });
    }
    this.child = spawn(input.plan.command, input.plan.args, {
      cwd: input.plan.cwd,
      // The runtime port resolves the cwd shell env before this point, so this
      // spawn must not re-merge the backend process env and leak Tide ownership.
      env: input.plan.env,
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
    if (this.goalObjective.length > 0) {
      this.sendGoalCommand(this.goalObjective);
    } else if (input.initialPrompt !== undefined && input.initialPrompt.length > 0) {
      this.sendUserText(input.initialPrompt, input.initialAttachments);
    }
  }

  get pid(): number | undefined { return this.child.pid ?? undefined; }

  private sendUserText(text: string, attachments?: ComposerAttachmentRef[]): void {
    this.writeLine({
      type: "user",
      message: {
        role: "user",
        content: claudeUserContent(text, attachments),
      },
    });
    this.onEvent({ kind: "turn_started" });
    this.subagentWatcher?.start(Date.now());
  }

  private sendGoalCommand(objective: string): void {
    const goal = objective.trim();
    this.goalObjective = goal;
    this.writeLine(claudeGoalUserMessage(goal));
    if (goal.length === 0) {
      this.onEvent({ kind: "goal_cleared" });
      return;
    }
    const event = claudeGoalSetEvent(goal);
    if (event !== undefined) this.onEvent(event);
    this.onEvent({ kind: "turn_started" });
    this.subagentWatcher?.start(Date.now());
  }

  async write(input: StructuredRuntimeWrite): Promise<void> {
    if (input.kind === "goal_set") {
      this.sendGoalCommand(input.objective);
      return;
    }
    if (input.kind === "composer_input") {
      this.sendUserText(input.value, input.attachments);
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
    // AskUserQuestion: record this question's answer (keyed by its text), then surface
    // the NEXT question, or — once every question is answered (a wizard submit delivers
    // them all at once) — allow the tool with the full answers map. Owned by the
    // claude-ask-user-question module.
    if (pending.askUserQuestion !== undefined) {
      answerAskUserQuestion(this.askUserQuestionContext(), pending, input);
      return;
    }
    // "Allow always": allow this call AND echo the CLI's own addRules suggestions back as
    // updatedPermissions so the CLI persists the rule (its settings store) and stops asking the
    // same thing. See docs_v2/specs/claude-permission-allow-always.md.
    if (input.value === STRUCTURED_ALLOW_ALWAYS_TOKEN) {
      this.writeLine({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: pending.requestId,
          response: {
            behavior: "allow",
            updatedInput: pending.toolInput,
            ...(pending.permissionRuleUpdates !== undefined
              ? { updatedPermissions: pending.permissionRuleUpdates }
              : {}),
          },
        },
      });
      return;
    }
    // Allow ONLY on the explicit allow token. Anything else — the Skip button (value ""),
    // a dismissed card, or an unrecognized answer — defaults to DENY: never silently run a
    // tool the user did not explicitly approve. (Skip used to fall through here and ALLOW.)
    // See claude-parallel-permission-wedge.md.
    if (input.value !== STRUCTURED_ALLOW_TOKEN) {
      this.writeLine({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: pending.requestId,
          response: { behavior: "deny", message: "The user did not approve this tool use.", interrupt: false },
        },
      });
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

  // The slice of this client the AskUserQuestion handlers (claude-ask-user-question.ts)
  // operate through — passed in so that module never imports the client (no cycle).
  private askUserQuestionContext(): AskUserQuestionContext {
    return {
      threadId: this.threadId,
      agentId: this.agentId,
      pendingPermissions: this.pendingPermissions,
      onEvent: this.onEvent,
      writeLine: (value) => this.writeLine(value),
    };
  }

  // Mid-thread Launch Options change, applied to the LIVE session via the
  // stream-json control protocol (the same set_model / set_permission_mode
  // requests the official Agent SDK sends). Unlike interrupt(), this AWAITS each
  // control_response: claude can REFUSE a live change — e.g. switching to
  // bypassPermissions when the session was not launched bypass-capable (the
  // `--allow-dangerously-skip-permissions` flag) — and the caller must learn that
  // so it falls back to a transparent restart instead of reporting a phantom
  // "applied". Resolves true only if EVERY change is acked success; a refusal or a
  // missing ack (timeout) resolves false. See claude-bypass-live-capability.md.
  async applyConfig(protocolParams: Record<string, unknown>): Promise<boolean> {
    const acks: Promise<boolean>[] = [];
    const model = protocolParams.model;
    if (typeof model === "string" && model.length > 0) {
      acks.push(this.sendConfigRequest({ subtype: "set_model", model }));
    }
    const permissionMode = protocolParams.permissionMode;
    if (typeof permissionMode === "string" && permissionMode.length > 0) {
      acks.push(this.sendConfigRequest({ subtype: "set_permission_mode", mode: permissionMode }));
    }
    if (acks.length === 0) {
      return true;
    }
    const results = await Promise.all(acks);
    return results.every((ok) => ok);
  }

  // Write one config control_request and resolve when claude's matching
  // control_response arrives (success => true, error => false). A wedged/dead
  // process never replies, so a timeout resolves false (→ restart fallback) rather
  // than hanging the setLaunchOptions command. The error's reason is surfaced under
  // TIDE_DEBUG_STRUCTURED by ingest().
  private sendConfigRequest(request: Record<string, unknown>): Promise<boolean> {
    const requestId = `cfg-${randomUUID()}`;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingConfigAcks.delete(requestId)) {
          resolve(false);
        }
      }, CONFIG_ACK_TIMEOUT_MS);
      timer.unref?.();
      this.pendingConfigAcks.set(requestId, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
      try {
        this.writeLine({ type: "control_request", request_id: requestId, request });
      } catch {
        // Dead/closed stdin (EPIPE / destroyed stream): clean up the timer + pending
        // ack and degrade to a restart rather than leaving them dangling.
        clearTimeout(timer);
        this.pendingConfigAcks.delete(requestId);
        resolve(false);
      }
    });
  }

  // A control_response for one of our cfg-* config requests resolves its ack.
  // Unmatched ids (e.g. the interrupt control request's own response) are ignored.
  private resolveConfigAck(message: Record<string, unknown>): void {
    const response = isRecord(message.response) ? message.response : message;
    const requestId = stringField(response, "request_id");
    if (requestId === undefined) {
      return;
    }
    const ack = this.pendingConfigAcks.get(requestId);
    if (ack === undefined) {
      return;
    }
    this.pendingConfigAcks.delete(requestId);
    ack(stringField(response, "subtype") === "success");
  }

  // Resolve every in-flight tool-permission request with a clean deny. Without this, an
  // abort/teardown closes the control stream while a request is pending and claude records
  // `Tool permission request failed: ... stream closed before response received` — a
  // confusing error that survives into the resumed conversation (claude then awkwardly
  // works around the "broken" tool, e.g. printing an AskUserQuestion as plain text). A user
  // Stop while an AskUserQuestion / permission card is up — now reachable in waiting states
  // — takes exactly this path, so deny first and let claude record a clean cancellation.
  private denyPendingPermissions(message: string): void {
    for (const pending of this.pendingPermissions.values()) {
      // Best-effort: this runs on teardown, where stdin may already be ended/closed —
      // a raw write would throw ERR_STREAM_WRITE_AFTER_END and abort the rest of cleanup
      // (e.g. killing the child). Swallow it.
      try {
        this.writeLine({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: pending.requestId,
            response: { behavior: "deny", message, interrupt: false },
          },
        });
      } catch {
        // stream already closed — nothing to deny onto.
      }
    }
    this.pendingPermissions.clear();
  }

  async interrupt(): Promise<void> {
    this.subagentWatcher?.stop();
    // Clean-deny any pending permission BEFORE aborting, so an open AskUserQuestion /
    // permission resolves as "user interrupted" instead of a stream-closed error.
    this.denyPendingPermissions("The user interrupted this tool use.");
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
    this.subagentWatcher?.stop();
    // Settle any in-flight applyConfig acks (the process is going away) so a
    // pending setLaunchOptions resolves to a restart rather than waiting the timeout.
    for (const resolve of this.pendingConfigAcks.values()) {
      resolve(false);
    }
    this.pendingConfigAcks.clear();
    // Best-effort clean-deny before the stream closes (flushed with the buffered stdin
    // writes ahead of end()), so a stop mid-permission isn't recorded as a stream error.
    this.denyPendingPermissions("The runtime was stopped before this tool use completed.");
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
        this.sessionId = sessionId; // lets the subagent watcher locate the dir.
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
      return;
    }
    if (type === "system" && message.subtype === "local_command") {
      this.handleGoalEvents(
        claudeGoalEventsFromText(
          typeof message.content === "string" ? message.content : "",
          this.goalObjective,
        ),
      );
      return;
    }
    if (type === "stream_event") {
      this.handleStreamEvent(isRecord(message.event) ? message.event : {});
      return;
    }
    if (type === "assistant" || type === "user") {
      this.handleGoalEvents(claudeGoalEventsFromMessage(message, this.goalObjective));
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
    if (type === "control_response") {
      // claude's ack to one of OUR control requests (set_model / set_permission_mode).
      this.resolveConfigAck(message);
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
      this.subagentWatcher?.stop(); // turn ended — the projector emits the clear.
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
        usage: this.withLastRateLimits(claudeUsage(message)),
      });
      return;
    }
    if (type === "rate_limit_event") {
      const usage = this.withLastRateLimits(claudeUsage(message));
      if (usage !== undefined) {
        this.onEvent({ kind: "usage", usage });
      }
      return;
    }
    // keep_alive: ignored.
  }

  // Carry the most recent rate-limit windows forward onto later usage events that omit
  // them (claude reports them once per turn, not on every event).
  private withLastRateLimits(usage: StructuredUsagePayload | undefined): StructuredUsagePayload | undefined {
    if (usage?.rateLimits !== undefined && usage.rateLimits.length > 0) {
      this.lastRateLimits = usage.rateLimits;
    }
    return usageWithRememberedRateLimits(usage, this.lastRateLimits);
  }

  private handleGoalEvents(result: { events: StructuredProviderEvent[]; objective: string }): void {
    this.goalObjective = result.objective;
    for (const event of result.events) {
      this.onEvent(event);
    }
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
        if (item.name === "TodoWrite") {
          const record = claudeTodoWritePlanContentRecord(this.runtimeId, item.input);
          this.emitRecord(record.sourceRef, record.payload, record.body);
          return;
        }
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
    if (requestId === undefined) {
      return;
    }
    const request = isRecord(message.request) ? message.request : undefined;
    if (request?.subtype !== "can_use_tool") {
      writeUnsupportedClaudeControlRequest({
        requestId,
        subtype: request === undefined ? "malformed" : String(request.subtype ?? "unknown"),
        writeLine: (value) => this.writeLine(value),
        onEvent: this.onEvent,
      });
      return;
    }
    const toolName = stringField(request, "tool_name") ?? "tool";
    const toolInput = isRecord(request.input) ? request.input : {};
    const promptId = `claude-perm-${requestId}`;

    // AskUserQuestion's can_use_tool carries the FULL set of questions, each with
    // options. claude requires EVERY question answered. A multi-question set surfaces
    // as ONE navigable wizard (all steps at once, answered together); a single question
    // (or a degenerate set the wizard can't build) falls back to one card at a time.
    if (toolName === "AskUserQuestion") {
      const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
      const ctx = this.askUserQuestionContext();
      if (questions.length > 1 && surfaceAskUserQuestionWizard(ctx, requestId, toolInput, questions)) {
        return;
      }
      if (questions.length > 0 && surfaceAskUserQuestion(ctx, requestId, toolInput, questions, {}, 0, {})) {
        return;
      }
    }

    // The CLI ships a "don't ask again" rule with each request (permission_suggestions). Surface
    // it as an Allow-always choice ONLY for the pure-addRules case (persistent allow-rule); echo
    // it back as updatedPermissions on allow so the CLI persists it. See
    // docs_v2/specs/claude-permission-allow-always.md.
    const ruleUpdates = addRulesOnlySuggestions(request.permission_suggestions);
    this.pendingPermissions.set(promptId, {
      requestId,
      toolInput,
      ...(ruleUpdates !== undefined ? { permissionRuleUpdates: ruleUpdates } : {}),
    });

    this.onEvent({
      kind: "prompt",
      promptState: buildPermissionPrompt({
        promptId,
        threadId: this.threadId,
        agentId: this.agentId,
        toolName,
        toolInput,
        ruleUpdates,
      }),
    });
  }
}

// Usage/rate-limit parsing moved to claude-usage.ts to keep this client under the
// file-size ratchet; re-exported here so callers/tests keep their import path.
export { claudeUsage };
