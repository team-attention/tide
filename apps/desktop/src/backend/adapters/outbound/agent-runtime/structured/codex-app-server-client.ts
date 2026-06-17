// Codex structured runtime client — the app-server protocol (the same one the
// Codex IDE extension speaks).
//
// EVIDENCE-BASED (live transcripts /tmp/tide-proto-evidence/codex/ + the
// machine-generated TypeScript bindings from `codex app-server generate-ts`,
// codex-cli 0.136):
// - spawn: `codex app-server` serves JSONL over stdio directly (JSON-RPC-shaped,
//   no `jsonrpc` field). Client requests: {id, method, params}; responses echo
//   the id. Notifications have no id. The SERVER also sends requests (its own id
//   namespace) for approvals — answered with {id, result:{decision}}.
// - handshake: initialize {clientInfo, capabilities:null} → result, then
//   notification "initialized". Core thread/turn methods need no experimental
//   capability flag.
// - thread/start {cwd, approvalPolicy, sandbox, model?} → {thread:{id, path}};
//   thread/resume {threadId} restores a prior session (verified cross-process).
// - turn/start {threadId, input:[{type:"text",text}]} → streaming notifications:
//   item/started / item/completed (agentMessage, reasoning, commandExecution,
//   mcpToolCall, webSearch, …), thread/tokenUsage/updated, turn/completed
//   {turn:{status: completed|interrupted|failed, error}}.
// - approvals: server request item/commandExecution/requestApproval
//   {command, cwd, reason?} / item/fileChange/requestApproval — respond
//   {id, result:{decision:"accept"|"decline"|…}}. decline does NOT kill the
//   turn: the model is told and continues (verified live, 02-deny-flow.jsonl).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { ComposerAttachmentRef, PromptDetail, PromptState } from "../../../../application/domains/thread/thread.ts";
import type { ProviderLaunchPlan } from "../../../../application/ports/outbound/agent-integration-port.ts";
import type {
  StructuredClientCallbacks,
  StructuredRuntimeClient,
  StructuredRuntimeWrite,
} from "./structured-runtime-events.ts";
import { createUpdateNoticeScanner } from "./agent-update-notice.ts";

export const CODEX_ACCEPT_TOKEN = "structured:accept";
export const CODEX_DECLINE_TOKEN = "structured:decline";

export interface CreateCodexAppServerClientInput extends StructuredClientCallbacks {
  plan: ProviderLaunchPlan;
  threadId: string;
  runtimeId: string;
  initialPrompt?: string;
  initialAttachments?: ComposerAttachmentRef[];
  // thread/resume target (the rollout/thread id) when resuming.
  resumeThreadId?: string;
}

// Build the codex turn input array: the text plus a NATIVE localImage item per
// attachment. Codex has no file-read tool, so the "[Attached image: <path>]" text
// alone is invisible to it — the localImage item is what actually lets it see the
// image. EVIDENCE: codex app-server UserInput union (v0.136 generate-ts bindings)
// has { type: "localImage", path, detail? }.
export function codexTurnInput(
  text: string,
  attachments?: ComposerAttachmentRef[],
): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [{ type: "text", text }];
  for (const attachment of attachments ?? []) {
    items.push({ type: "localImage", path: attachment.path });
  }
  return items;
}

export function createCodexAppServerClient(
  input: CreateCodexAppServerClientInput,
): StructuredRuntimeClient {
  return new CodexAppServerClient(input);
}

class CodexAppServerClient implements StructuredRuntimeClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly onEvent: StructuredClientCallbacks["onEvent"];
  private readonly tideThreadId: string;
  private readonly runtimeId: string;
  private readonly protocolParams: Record<string, unknown>;
  private buffer = "";
  private requestId = 0;
  private recordIndex = 0;
  private exited = false;
  private codexThreadId?: string;
  private activeTurnId?: string;
  // True between issuing turn/start and learning the turn id from its result.
  // In that window a steer can't carry expectedTurnId yet, so it parks in
  // pendingSteerText and flushes the instant the id lands.
  private turnStartInFlight = false;
  private readonly pendingSteerText: string[] = [];
  // Mid-thread Launch Options changes (model/effort), delivered as turn/start
  // overrides — the protocol applies them "for this turn and subsequent turns"
  // (codex-cli 0.136 bindings: TurnStartParams). Re-sent on every turn/start;
  // idempotent. See mid-thread-launch-option-changes.md.
  private turnOverrides: Record<string, unknown> = {};
  private lastUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    contextWindow?: number;
    totalTokens?: number;
  };
  // our request id -> what to do with the result
  private readonly pendingResponses = new Map<number, (result: Record<string, unknown>) => void>();
  // promptId -> the SERVER's request id awaiting a decision result
  private readonly pendingApprovals = new Map<string, number | string>();
  private readonly queuedWrites: string[] = [];
  private ready = false;
  // Live streaming: itemId -> accumulated agentMessage text. The complete
  // item/completed finalizes the same blockId (msg:<itemId>).
  private readonly streamBodies = new Map<string, string>();
  // itemId -> accumulated reasoning summary text (model_reasoning_summary=detailed).
  private readonly reasoningBodies = new Map<string, string>();
  private flushScheduled = false;
  private readonly scanUpdate = createUpdateNoticeScanner((message) =>
    this.onEvent({ kind: "runtime_notice", level: "info", message }),
  );

  constructor(input: CreateCodexAppServerClientInput) {
    this.onEvent = input.onEvent;
    this.tideThreadId = input.threadId;
    this.runtimeId = input.runtimeId;
    this.protocolParams = isRecord(input.plan.protocolParams) ? input.plan.protocolParams : {};
    this.child = spawn(input.plan.command, input.plan.args, {
      cwd: input.plan.cwd,
      env: { ...process.env, ...input.plan.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.ingest(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
        process.stderr.write(`[tide-codex-as ${this.runtimeId}] ${chunk}`);
      }
      this.scanUpdate(chunk);
    });
    this.child.on("error", () => {
      if (!this.exited) {
        this.exited = true;
        this.onEvent({ kind: "runtime_exited", exitCode: null });
      }
    });
    this.child.on("exit", (code) => {
      if (!this.exited) {
        this.exited = true;
        this.onEvent({ kind: "runtime_exited", exitCode: code });
      }
    });

    void this.bootstrap(input);
  }

  get pid(): number | undefined {
    return this.child.pid ?? undefined;
  }

  private async bootstrap(input: CreateCodexAppServerClientInput): Promise<void> {
    this.request("initialize", {
      clientInfo: { name: "tide", title: "Tide", version: "2.0" },
      capabilities: null,
    }, () => {
      this.notify("initialized", {});
      if (input.resumeThreadId !== undefined) {
        // Re-send the launch protocolParams (model/sandbox/approvalPolicy):
        // ThreadResumeParams accepts them as overrides, so a resume respawn
        // after a mid-thread options change launches with the new values.
        this.request("thread/resume", {
          threadId: input.resumeThreadId,
          ...this.protocolParams,
        }, (result) => {
          this.adoptThread(result);
        });
        return;
      }
      this.request("thread/start", {
        cwd: input.plan.cwd,
        ...this.protocolParams,
      }, (result) => {
        this.adoptThread(result);
        if (input.initialPrompt !== undefined && input.initialPrompt.length > 0) {
          this.startTurn(input.initialPrompt, input.initialAttachments);
        }
      });
    });
  }

  private adoptThread(result: Record<string, unknown>): void {
    const thread = isRecord(result.thread) ? result.thread : undefined;
    const id = thread !== undefined ? stringField(thread, "id") : undefined;
    if (id === undefined) {
      return;
    }
    this.codexThreadId = id;
    // Surface codex skills in the composer "$" menu (the replacement for the
    // removed listCustomPrompts; verified shape via generate-ts bindings).
    this.request("skills/list", { cwds: [] }, (result) => {
      const data = Array.isArray(result.data) ? result.data : [];
      const commands = data
        .filter((d): d is Record<string, unknown> => isRecord(d))
        .flatMap((d) => (Array.isArray(d.skills) ? d.skills : []))
        .filter((sk): sk is Record<string, unknown> => isRecord(sk))
        .map((sk) => ({
          name: stringField(sk, "name") ?? "",
          description: stringField(sk, "description") ?? stringField(sk, "shortDescription") ?? "Codex skill",
          trigger: "$" as const,
        }))
        .filter((c) => c.name.length > 0);
      if (commands.length > 0) {
        this.onEvent({ kind: "commands", commands });
      }
    });
    const path = thread !== undefined ? stringField(thread, "path") : undefined;
    this.onEvent({
      kind: "session_ref",
      ref: {
        agentId: "codex",
        kind: "codex_rollout",
        value: id,
        ...(path !== undefined ? { transcriptPath: path } : {}),
      },
    });
    this.ready = true;
    for (const queued of this.queuedWrites.splice(0)) {
      this.startTurn(queued);
    }
  }

  private startTurn(text: string, attachments?: ComposerAttachmentRef[]): void {
    if (this.codexThreadId === undefined) {
      this.queuedWrites.push(text);
      return;
    }
    // A turn is already running → STEER: inject this input into the active turn
    // instead of starting a second one (codex serves one turn at a time).
    if (this.activeTurnId !== undefined) {
      this.steerTurn(text, attachments);
      return;
    }
    // A turn/start is mid-flight but its id isn't known yet — steer once it is.
    if (this.turnStartInFlight) {
      this.pendingSteerText.push(text);
      return;
    }
    this.turnStartInFlight = true;
    this.request("turn/start", {
      threadId: this.codexThreadId,
      input: codexTurnInput(text, attachments),
      ...this.turnOverrides,
    }, (result) => {
      const turn = isRecord(result.turn) ? result.turn : undefined;
      this.activeTurnId = turn !== undefined ? stringField(turn, "id") : undefined;
      this.turnStartInFlight = false;
      if (this.activeTurnId !== undefined) {
        for (const pending of this.pendingSteerText.splice(0)) {
          this.steerTurn(pending);
        }
      }
    });
  }

  // turn/steer injects new user input into the ACTIVE turn (expectedTurnId is a
  // required precondition; the request fails if it doesn't match the live turn).
  // The same turn continues — exactly one turn/completed still ends it.
  // EVIDENCE: codex app-server bindings (codex-cli 0.136) TurnSteerParams =
  // {threadId, input, expectedTurnId} → TurnSteerResponse {turnId}.
  private steerTurn(text: string, attachments?: ComposerAttachmentRef[]): void {
    if (this.codexThreadId === undefined || this.activeTurnId === undefined) {
      this.pendingSteerText.push(text);
      return;
    }
    this.request("turn/steer", {
      threadId: this.codexThreadId,
      input: codexTurnInput(text, attachments),
      expectedTurnId: this.activeTurnId,
    }, (result) => {
      const turnId = stringField(result, "turnId");
      if (turnId !== undefined) {
        this.activeTurnId = turnId;
      }
    });
  }

  async write(input: StructuredRuntimeWrite): Promise<void> {
    if (input.kind === "composer_input") {
      if (!this.ready) {
        this.queuedWrites.push(input.value);
        return;
      }
      this.startTurn(input.value, input.attachments);
      return;
    }
    const promptId = input.promptId ?? "";
    const serverRequestId = this.pendingApprovals.get(promptId);
    if (serverRequestId === undefined) {
      return;
    }
    this.pendingApprovals.delete(promptId);
    const decision = input.value === CODEX_DECLINE_TOKEN ? "decline" : "accept";
    this.writeLine({ id: serverRequestId, result: { decision } });
  }

  // Mid-thread Launch Options change. The integration maps to TurnStartParams
  // override keys (model/effort); they ride every subsequent turn/start.
  applyConfig(protocolParams: Record<string, unknown>): void {
    this.turnOverrides = { ...this.turnOverrides, ...protocolParams };
  }

  async interrupt(): Promise<void> {
    // turn/interrupt aborts the turn → turn/completed status:interrupted; the
    // app-server process stays alive for the next turn.
    if (this.codexThreadId !== undefined && this.activeTurnId !== undefined) {
      this.request("turn/interrupt", {
        threadId: this.codexThreadId,
        turnId: this.activeTurnId,
      }, () => undefined);
    }
  }

  async stop(): Promise<void> {
    this.exited = true;
    this.child.kill("SIGTERM");
    setTimeout(() => {
      try {
        this.child.kill("SIGKILL");
      } catch {
        // gone
      }
    }, 1500).unref();
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    onResult: (result: Record<string, unknown>) => void,
  ): void {
    this.requestId += 1;
    this.pendingResponses.set(this.requestId, onResult);
    if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
      process.stderr.write(`[tide-codex-as ${this.runtimeId}] -> ${method}\n`);
    }
    this.writeLine({ id: this.requestId, method, params });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.writeLine({ method, params });
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
          `[tide-codex-as ${this.runtimeId}] <- ${String(message.method ?? `response#${String(message.id)}`)}\n`,
        );
      }
      try {
        this.handleMessage(message);
      } catch (error) {
        if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
          process.stderr.write(`[tide-codex-as ${this.runtimeId}] handler error: ${String(error)}\n`);
        }
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    // Response to one of OUR requests.
    if (message.id !== undefined && message.method === undefined) {
      const id = typeof message.id === "number" ? message.id : Number(message.id);
      const handler = this.pendingResponses.get(id);
      if (handler !== undefined) {
        this.pendingResponses.delete(id);
        if (isRecord(message.result)) {
          handler(message.result);
        } else if (message.error !== undefined) {
          // A failed thread/turn request must not hang the thread.
          const errorMessage = isRecord(message.error)
            ? stringField(message.error, "message") ?? "Codex request failed."
            : "Codex request failed.";
          this.onEvent({ kind: "turn_completed", notice: errorMessage });
        }
      }
      return;
    }
    const method = typeof message.method === "string" ? message.method : undefined;
    if (method === undefined) {
      return;
    }
    const params = isRecord(message.params) ? message.params : {};

    // SERVER-INITIATED REQUEST (has an id): an approval to answer.
    if (message.id !== undefined) {
      this.handleServerRequest(method, message.id as number | string, params);
      return;
    }

    if (method === "item/reasoning/summaryTextDelta") {
      const itemId = stringField(params, "itemId");
      const delta = stringField(params, "delta");
      if (itemId !== undefined && delta !== undefined) {
        this.reasoningBodies.set(itemId, (this.reasoningBodies.get(itemId) ?? "") + delta);
        this.scheduleFlush();
      }
      return;
    }
    if (method === "item/reasoning/summaryPartAdded") {
      // A new summary part: separate it from the previous with a blank line.
      const itemId = stringField(params, "itemId");
      const existing = itemId !== undefined ? this.reasoningBodies.get(itemId) : undefined;
      if (itemId !== undefined && existing !== undefined && existing.length > 0) {
        this.reasoningBodies.set(itemId, existing + "\n\n");
      }
      return;
    }
    if (method === "item/agentMessage/delta") {
      // Live token streaming. {itemId, delta} — accumulate and flush coalesced
      // content_delta (UI-only); item/completed finalizes the same blockId.
      const itemId = stringField(params, "itemId");
      const delta = stringField(params, "delta");
      if (itemId !== undefined && delta !== undefined) {
        this.streamBodies.set(itemId, (this.streamBodies.get(itemId) ?? "") + delta);
        this.scheduleFlush();
      }
      return;
    }
    if (method === "item/completed") {
      this.flushStream();
      this.emitItem(isRecord(params.item) ? params.item : undefined);
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      const usage = isRecord(params.tokenUsage) ? params.tokenUsage : undefined;
      const total = usage !== undefined && isRecord(usage.total) ? usage.total : undefined;
      if (total !== undefined) {
        this.lastUsage = {
          inputTokens: numberField(total, "inputTokens"),
          outputTokens: numberField(total, "outputTokens"),
          totalTokens: numberField(total, "totalTokens"),
          contextWindow: usage !== undefined ? numberField(usage, "modelContextWindow") : undefined,
        };
      }
      return;
    }
    if (method === "turn/completed") {
      const turn = isRecord(params.turn) ? params.turn : undefined;
      const status = turn !== undefined ? stringField(turn, "status") : undefined;
      let notice: string | undefined;
      if (status === "failed") {
        const error = turn !== undefined && isRecord(turn.error) ? turn.error : undefined;
        notice = (error !== undefined ? stringField(error, "message") : undefined) ?? "Codex turn failed.";
      }
      // status "interrupted" is a user Stop — no notice (benign).
      this.activeTurnId = undefined;
      this.turnStartInFlight = false;
      // Any input parked for a steer that never found a live turn (e.g. the turn
      // errored before its id landed) carries over as the next turn — the client
      // owns delivering input the service already handed it.
      const carryOver = this.pendingSteerText.splice(0);
      this.onEvent({
        kind: "turn_completed",
        ...(notice !== undefined ? { notice } : {}),
        ...(this.lastUsage !== undefined ? { usage: this.lastUsage } : {}),
      });
      for (const text of carryOver) {
        this.startTurn(text);
      }
      return;
    }
    // thread/started, turn/started, item/started, deltas, status changes:
    // rendering consumes completed items only in this slice.
  }

  private handleServerRequest(
    method: string,
    serverRequestId: number | string,
    params: Record<string, unknown>,
  ): void {
    if (method === "item/commandExecution/requestApproval") {
      const command = stringField(params, "command") ?? "Run command";
      const cwd = stringField(params, "cwd");
      const reason = stringField(params, "reason");
      this.surfaceApproval(
        serverRequestId,
        reason !== undefined ? `Run command — ${reason}` : "Run command",
        { format: "text", body: cwd !== undefined ? `${command}\n\n# cwd: ${cwd}` : command },
      );
      return;
    }
    if (method === "item/fileChange/requestApproval") {
      const reason = stringField(params, "reason");
      this.surfaceApproval(
        serverRequestId,
        reason !== undefined ? `Apply file changes — ${reason}` : "Apply file changes",
        buildCodexFileChangeDetail(params),
      );
      return;
    }
    // Unknown server request: answering wrong is worse than declining late; log
    // and leave it pending (gap: item/tool/requestUserInput, elicitation).
    if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
      process.stderr.write(`[tide-codex-as ${this.runtimeId}] unhandled server request ${method}\n`);
    }
  }

  private surfaceApproval(
    serverRequestId: number | string,
    message: string,
    detail?: PromptDetail,
  ): void {
    const promptId = `codex-perm-${String(serverRequestId)}`;
    this.pendingApprovals.set(promptId, serverRequestId);
    const promptState: PromptState = {
      promptId,
      threadId: this.tideThreadId,
      agentId: "codex",
      kind: "approval",
      message,
      ...(detail !== undefined ? { detail } : {}),
      choices: [
        { choiceId: "allow", label: "Allow", providerValue: CODEX_ACCEPT_TOKEN },
        { choiceId: "deny", label: "Deny", providerValue: CODEX_DECLINE_TOKEN },
      ],
      defaultChoiceId: "allow",
      source: "provider_hook",
    };
    this.onEvent({ kind: "prompt", promptState });
  }

  private emitItem(item: Record<string, unknown> | undefined): void {
    if (item === undefined) {
      return;
    }
    const itemType = stringField(item, "type") ?? stringField(item, "itemType");
    const itemId = stringField(item, "id") ?? String(this.recordIndex);
    const blockBase = `structured:${this.runtimeId}:${this.recordIndex}`;
    if (itemType === "agentMessage") {
      // Finalize the streamed text under the SAME blockId the deltas used
      // (msg:<itemId>), so streaming → final is one block, never duplicated.
      const text = stringField(item, "text") ?? this.streamBodies.get(itemId);
      this.streamBodies.delete(itemId);
      if (text === undefined) {
        return;
      }
      const blockId = `structured:${this.runtimeId}:msg:${itemId}`;
      this.emitRecord(blockId, {
        type: "message",
        role: "agent",
        status: "complete",
        blockId,
        body: text,
        sourceRuntimeId: this.runtimeId,
      }, text);
      return;
    }
    if (itemType === "reasoning") {
      const fromItem = Array.isArray(item.summary)
        ? item.summary.filter((entry): entry is string => typeof entry === "string").join("\n\n")
        : "";
      const summary = fromItem.trim().length > 0 ? fromItem : (this.reasoningBodies.get(itemId) ?? "");
      this.reasoningBodies.delete(itemId);
      if (summary.trim().length === 0) {
        return;
      }
      const reasonBlock = `structured:${this.runtimeId}:reason:${itemId}`;
      this.emitRecord(reasonBlock, {
        type: "reasoning",
        role: "reasoning",
        status: "complete",
        blockId: reasonBlock,
        body: summary,
        sourceRuntimeId: this.runtimeId,
      }, summary);
      return;
    }
    if (itemType === "commandExecution") {
      const command = stringField(item, "command") ?? "";
      const output = stringField(item, "aggregatedOutput") ?? "";
      const exitCode = numberField(item, "exitCode");
      const status = stringField(item, "status");
      this.recordIndex += 1;
      this.emitRecord(`${blockBase}:${itemId}`, {
        type: "tool_call",
        toolName: "shell",
        callId: itemId,
        arguments: command,
        body: bounded(command),
        status: "complete",
        blockId: `${blockBase}:${itemId}`,
        sourceRuntimeId: this.runtimeId,
      }, bounded(command));
      this.recordIndex += 1;
      const resultBlock = `structured:${this.runtimeId}:${this.recordIndex}`;
      this.emitRecord(`${resultBlock}:${itemId}`, {
        type: "tool_result",
        toolName: "shell",
        callId: itemId,
        ok: exitCode === 0,
        output: status === "declined" ? "Command declined by the user." : output,
        body: bounded(status === "declined" ? "Command declined by the user." : output),
        status: "complete",
        blockId: `${resultBlock}:${itemId}`,
        sourceRuntimeId: this.runtimeId,
      }, bounded(output));
      return;
    }
    if (itemType === "mcpToolCall") {
      const server = stringField(item, "server") ?? "mcp";
      const tool = stringField(item, "tool") ?? "tool";
      const argumentsText = JSON.stringify(item.arguments ?? {});
      this.recordIndex += 1;
      this.emitRecord(`${blockBase}:${itemId}`, {
        type: "tool_call",
        toolName: `${server}.${tool}`,
        callId: itemId,
        arguments: argumentsText,
        body: bounded(argumentsText),
        status: "complete",
        blockId: `${blockBase}:${itemId}`,
        sourceRuntimeId: this.runtimeId,
      }, bounded(argumentsText));
      return;
    }
    if (itemType === "webSearch") {
      const query = stringField(item, "query") ?? "";
      this.recordIndex += 1;
      this.emitRecord(`${blockBase}:${itemId}`, {
        type: "tool_call",
        toolName: "web_search",
        callId: itemId,
        arguments: query,
        body: query,
        status: "complete",
        blockId: `${blockBase}:${itemId}`,
        sourceRuntimeId: this.runtimeId,
      }, query);
    }
    // userMessage / plan / fileChange render via their own flows later.
  }

  private emitRecord(sourceRef: string, payload: Record<string, unknown>, body: string): void {
    this.onEvent({ kind: "content_record", sourceRef, payload, body });
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) {
      return;
    }
    this.flushScheduled = true;
    // Coalesce token deltas into ~50ms UI updates (avoid one event per token).
    setTimeout(() => this.flushStream(), 50).unref();
  }

  private flushStream(): void {
    this.flushScheduled = false;
    for (const [itemId, body] of this.streamBodies) {
      if (body.length === 0) {
        continue;
      }
      this.onEvent({
        kind: "content_delta",
        blockId: `structured:${this.runtimeId}:msg:${itemId}`,
        role: "agent",
        blockKind: "agent_message",
        body,
      });
    }
    for (const [itemId, body] of this.reasoningBodies) {
      if (body.length === 0) {
        continue;
      }
      this.onEvent({
        kind: "content_delta",
        blockId: `structured:${this.runtimeId}:reason:${itemId}`,
        role: "reasoning",
        blockKind: "reasoning",
        body,
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

// Build an approval-card detail from a codex `item/fileChange/requestApproval`. The exact
// payload shape isn't pinned by a captured fixture yet (see spec residual risk), so probe
// the common carriers defensively: a top-level unified-diff string, or a `changes[]` array
// of `{ path, diff|unifiedDiff }`. Returns undefined (headline only) when nothing parses —
// no worse than today, strictly better when the shape matches.
export function buildCodexFileChangeDetail(params: Record<string, unknown>): PromptDetail | undefined {
  const directDiff =
    stringField(params, "unifiedDiff") ?? stringField(params, "diff") ?? stringField(params, "patch");
  if (directDiff !== undefined) {
    return { format: "diff", body: bounded(directDiff) };
  }
  const changes = Array.isArray(params.changes) ? params.changes : undefined;
  if (changes === undefined) {
    return undefined;
  }
  const parts: string[] = [];
  const locations: string[] = [];
  for (const change of changes) {
    if (!isRecord(change)) {
      continue;
    }
    const path = stringField(change, "path");
    if (path !== undefined) {
      locations.push(path);
    }
    const diff = stringField(change, "unifiedDiff") ?? stringField(change, "diff");
    if (diff !== undefined) {
      parts.push(path !== undefined ? `# ${path}\n${diff}` : diff);
    }
  }
  if (parts.length === 0) {
    return undefined;
  }
  return {
    format: "diff",
    body: bounded(parts.join("\n\n")),
    ...(locations.length > 0 ? { locations } : {}),
  };
}
