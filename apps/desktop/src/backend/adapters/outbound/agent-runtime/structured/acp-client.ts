// Shared ACP (Agent Client Protocol) runtime client. Used by every provider
// that speaks ACP over stdio — gemini (`gemini --acp`) and opencode
// (`opencode acp`). Identical protocol shape verified live for both.
//
// EVIDENCE-BASED (live transcripts /tmp/tide-proto-evidence/gemini/ + the
// bundled @agentclientprotocol/sdk schemas inside gemini-cli 0.46):
// - JSON-RPC 2.0, newline-delimited, over plain stdio. Bidirectional: the agent
//   also sends REQUESTS (session/request_permission) the client must answer.
// - initialize {protocolVersion:1, clientCapabilities, clientInfo} →
//   {authMethods, agentCapabilities:{loadSession:true,...}}.
// - session/new {cwd, mcpServers:[]} → {sessionId, modes, models}. The agent
//   GENERATES the session id (randomUUID) — it cannot be minted by the client.
//   Unauthenticated: error -32000 "Gemini API key is missing or not configured."
// - session/prompt {sessionId, prompt:[{type:"text",text}]} stays UNRESOLVED for
//   the whole turn; its result {stopReason, _meta:{quota}} IS the turn end.
// - streaming: notifications session/update {update:{sessionUpdate:kind,...}}:
//   agent_message_chunk / agent_thought_chunk / tool_call / tool_call_update /
//   available_commands_update / plan.
// - permission: agent request session/request_permission {options:[{optionId,
//   name,kind}], toolCall:{title,...}} → respond
//   {id, result:{outcome:{outcome:"selected", optionId}}}.
// - cancel: notification session/cancel {sessionId} → prompt resolves with
//   stopReason "cancelled" (pending permission must be answered "cancelled").
// - trust: ACP surfaces NO trust prompt; an untrusted cwd silently skips MCP
//   servers and locks privileged modes. Tide forces trust via the
//   GEMINI_CLI_TRUST_WORKSPACE=true env override (source-verified) — workspace
//   trust is a Tide product decision, same as the other providers.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";

import type { ComposerAttachmentRef, PromptChoice, PromptState, ProviderCliAgentId } from "../../../../application/domains/thread/thread.ts";
import type { DiscoveredProviderSessionRef, ProviderLaunchPlan } from "../../../../application/ports/outbound/agent-integration-port.ts";
import type {
  StructuredClientCallbacks,
  StructuredRuntimeClient,
  StructuredRuntimeWrite,
} from "./structured-runtime-events.ts";
import { createUpdateNoticeScanner } from "./agent-update-notice.ts";

export const GEMINI_OPTION_PREFIX = "structured:gemini-option:";

export interface CreateAcpClientInput extends StructuredClientCallbacks {
  plan: ProviderLaunchPlan;
  threadId: string;
  runtimeId: string;
  agentId: ProviderCliAgentId;
  sessionRefKind: DiscoveredProviderSessionRef["kind"];
  initialPrompt?: string;
  initialAttachments?: ComposerAttachmentRef[];
  resumeSessionId?: string;
}

interface AcpQueuedPrompt {
  text: string;
  attachments?: ComposerAttachmentRef[];
}

// Build the ACP session/prompt content blocks: the text plus a NATIVE image
// ContentBlock per attachment ({type:"image", mimeType, data:<base64>} — the
// ACP/MCP image content shape, confirmed in the opencode + gemini ACP bundles).
// ACP agents have no file-read tool, so the "[Attached image: <path>]" text alone
// is invisible to them — this is what actually lets them see the image. The file
// is read synchronously (a just-materialized small image on the send path).
export function acpPromptBlocks(
  text: string,
  attachments?: ComposerAttachmentRef[],
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [{ type: "text", text }];
  for (const attachment of attachments ?? []) {
    try {
      const data = readFileSync(attachment.path).toString("base64");
      blocks.push({ type: "image", mimeType: attachment.mediaType, data });
    } catch {
      // Unreadable attachment — skip it rather than fail the whole turn.
    }
  }
  return blocks;
}

export function createAcpClient(input: CreateAcpClientInput): StructuredRuntimeClient {
  return new AcpClient(input);
}

class AcpClient implements StructuredRuntimeClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly onEvent: StructuredClientCallbacks["onEvent"];
  private readonly tideThreadId: string;
  private readonly runtimeId: string;
  private readonly agentId: ProviderCliAgentId;
  private readonly sessionRefKind: DiscoveredProviderSessionRef["kind"];
  private readonly protocolParams: Record<string, unknown>;
  private buffer = "";
  private requestId = 0;
  private exited = false;
  private readonly scanUpdate = createUpdateNoticeScanner((message) =>
    this.onEvent({ kind: "runtime_notice", level: "info", message }),
  );
  private sessionId?: string;
  // A mid-thread mode change that arrived before session/new (or session/load)
  // resolved; applied right after the session is adopted.
  private pendingModeId?: string;
  private turnOpen = false;
  private recordIndex = 0;
  // streaming accumulation: one growing block per message/thought run
  private messageBuffer = "";
  private messageBlockId?: string;
  private thoughtBuffer = "";
  private thoughtBlockId?: string;
  private readonly pendingResponses = new Map<number, (message: Record<string, unknown>) => void>();
  private readonly pendingPermissions = new Map<string, number | string>();
  private readonly queuedPrompts: AcpQueuedPrompt[] = [];

  constructor(input: CreateAcpClientInput) {
    this.onEvent = input.onEvent;
    this.tideThreadId = input.threadId;
    this.runtimeId = input.runtimeId;
    this.agentId = input.agentId;
    this.sessionRefKind = input.sessionRefKind;
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
        process.stderr.write(`[tide-gemini-acp ${this.runtimeId}] ${chunk}`);
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
    this.bootstrap(input);
  }

  get pid(): number | undefined {
    return this.child.pid ?? undefined;
  }

  private bootstrap(input: CreateAcpClientInput): void {
    this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "tide", title: "Tide", version: "2.0" },
    }, () => {
      const sessionParams = {
        cwd: this.protocolParams.cwd ?? process.cwd(),
        mcpServers: Array.isArray(this.protocolParams.mcpServers)
          ? this.protocolParams.mcpServers
          : [],
      };
      if (input.resumeSessionId !== undefined) {
        this.request("session/load", { sessionId: input.resumeSessionId, ...sessionParams }, (response) => {
          this.adoptSession(response, input.resumeSessionId);
        });
        return;
      }
      this.request("session/new", sessionParams, (response) => {
        this.adoptSession(response, undefined, input.initialPrompt, input.initialAttachments);
      });
    });
  }

  private adoptSession(
    response: Record<string, unknown>,
    knownSessionId?: string,
    initialPrompt?: string,
    initialAttachments?: ComposerAttachmentRef[],
  ): void {
    if (response.error !== undefined) {
      const error = isRecord(response.error) ? response.error : {};
      this.onEvent({
        kind: "turn_completed",
        notice: stringField(error, "message") ?? "Gemini session could not be started.",
      });
      return;
    }
    const result = isRecord(response.result) ? response.result : {};
    const sessionId = stringField(result, "sessionId") ?? knownSessionId;
    if (sessionId === undefined) {
      return;
    }
    this.sessionId = sessionId;
    this.onEvent({
      kind: "session_ref",
      ref: { agentId: this.agentId, kind: this.sessionRefKind, value: sessionId },
    });
    // Approval mode is an ACP session mode (default/autoEdit/yolo/plan) — set
    // it when the launch options ask for a non-default mode. A mid-thread
    // change that arrived before the session was adopted applies now instead.
    const modeId = this.pendingModeId ?? stringField(this.protocolParams, "modeId");
    this.pendingModeId = undefined;
    if (modeId !== undefined && modeId !== "default") {
      this.request("session/set_mode", { sessionId, modeId }, () => undefined);
    }
    if (initialPrompt !== undefined && initialPrompt.length > 0) {
      this.queuedPrompts.push({ text: initialPrompt, attachments: initialAttachments });
    }
    this.flushQueuedPrompt();
  }

  // Mid-thread Launch Options change: the only live-updatable ACP setting is
  // the session mode (permission). session/set_mode is valid at any time —
  // including back to "default". See mid-thread-launch-option-changes.md.
  applyConfig(protocolParams: Record<string, unknown>): void {
    const modeId = stringField(protocolParams, "modeId");
    if (modeId === undefined) {
      return;
    }
    if (this.sessionId === undefined) {
      this.pendingModeId = modeId;
      return;
    }
    this.request("session/set_mode", { sessionId: this.sessionId, modeId }, () => undefined);
  }

  private flushQueuedPrompt(): void {
    if (this.turnOpen || this.sessionId === undefined) {
      return;
    }
    const next = this.queuedPrompts.shift();
    if (next === undefined) {
      return;
    }
    this.startTurn(next.text, next.attachments);
  }

  private startTurn(text: string, attachments?: ComposerAttachmentRef[]): void {
    if (this.sessionId === undefined) {
      this.queuedPrompts.push({ text, attachments });
      return;
    }
    this.turnOpen = true;
    this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: acpPromptBlocks(text, attachments),
    }, (response) => {
      this.turnOpen = false;
      this.flushStreams();
      const result = isRecord(response.result) ? response.result : {};
      const stopReason = stringField(result, "stopReason");
      const meta = isRecord(result._meta) ? result._meta : {};
      const quota = isRecord(meta.quota) ? meta.quota : undefined;
      const tokenCount = quota !== undefined && isRecord(quota.token_count) ? quota.token_count : undefined;
      const inputTokens = tokenCount !== undefined ? numberField(tokenCount, "input_tokens") : undefined;
      const outputTokens = tokenCount !== undefined ? numberField(tokenCount, "output_tokens") : undefined;
      let notice: string | undefined;
      if (response.error !== undefined) {
        const error = isRecord(response.error) ? response.error : {};
        notice = stringField(error, "message") ?? "Gemini turn failed.";
      } else if (stopReason === "max_tokens") {
        notice = "Gemini stopped: maximum tokens reached.";
      } else if (stopReason === "refusal") {
        notice = "Gemini declined to continue this turn.";
      }
      this.onEvent({
        kind: "turn_completed",
        ...(notice !== undefined ? { notice } : {}),
        ...(inputTokens !== undefined && outputTokens !== undefined
          ? {
              usage: {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
              },
            }
          : {}),
      });
      this.flushQueuedPrompt();
    });
  }

  async write(input: StructuredRuntimeWrite): Promise<void> {
    if (input.kind === "composer_input") {
      // ACP turns are sequential: a prompt while one is open queues and runs
      // when the open session/prompt resolves.
      if (this.turnOpen || this.sessionId === undefined) {
        this.queuedPrompts.push({ text: input.value, attachments: input.attachments });
        return;
      }
      this.startTurn(input.value, input.attachments);
      return;
    }
    const promptId = input.promptId ?? "";
    const serverRequestId = this.pendingPermissions.get(promptId);
    if (serverRequestId === undefined) {
      return;
    }
    this.pendingPermissions.delete(promptId);
    const optionId = input.value.startsWith(GEMINI_OPTION_PREFIX)
      ? input.value.slice(GEMINI_OPTION_PREFIX.length)
      : undefined;
    this.writeLine({
      jsonrpc: "2.0",
      id: serverRequestId,
      result:
        optionId !== undefined
          ? { outcome: { outcome: "selected", optionId } }
          : { outcome: { outcome: "cancelled" } },
    });
  }

  async interrupt(): Promise<void> {
    // session/cancel resolves the open session/prompt with stopReason:cancelled;
    // the ACP process stays alive for the next prompt.
    if (this.sessionId !== undefined && this.turnOpen) {
      this.writeLine({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: this.sessionId },
      });
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
    onResponse: (message: Record<string, unknown>) => void,
  ): void {
    this.requestId += 1;
    this.pendingResponses.set(this.requestId, onResponse);
    this.writeLine({ jsonrpc: "2.0", id: this.requestId, method, params });
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
          `[tide-gemini-acp ${this.runtimeId}] <- ${String(message.method ?? `response#${String(message.id)}`)}\n`,
        );
      }
      try {
        this.handleMessage(message);
      } catch (error) {
        if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
          process.stderr.write(`[tide-gemini-acp ${this.runtimeId}] handler error: ${String(error)}\n`);
        }
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    // Response to one of OUR requests (result or error).
    if (message.id !== undefined && message.method === undefined) {
      const id = typeof message.id === "number" ? message.id : Number(message.id);
      const handler = this.pendingResponses.get(id);
      if (handler !== undefined) {
        this.pendingResponses.delete(id);
        handler(message);
      }
      return;
    }
    const method = typeof message.method === "string" ? message.method : undefined;
    if (method === undefined) {
      return;
    }
    const params = isRecord(message.params) ? message.params : {};

    // Agent-initiated REQUEST: permission (fs/* and terminal/* are disabled by
    // our declared clientCapabilities).
    if (message.id !== undefined) {
      if (method === "session/request_permission") {
        this.surfacePermission(message.id as number | string, params);
      }
      return;
    }

    if (method === "session/update") {
      this.handleSessionUpdate(isRecord(params.update) ? params.update : {});
    }
  }

  private handleSessionUpdate(update: Record<string, unknown>): void {
    const kind = stringField(update, "sessionUpdate");
    if (kind === "agent_message_chunk") {
      const content = isRecord(update.content) ? update.content : {};
      const text = stringField(content, "text") ?? "";
      if (text.length === 0) {
        return;
      }
      if (this.messageBlockId === undefined) {
        this.messageBlockId = `structured:${this.runtimeId}:${this.recordIndex}`;
        this.recordIndex += 1;
        this.messageBuffer = "";
      }
      this.messageBuffer += text;
      // Same blockId every emit → the reader UPSERTS, so the answer streams.
      this.onEvent({
        kind: "content_record",
        sourceRef: `${this.messageBlockId}:${this.messageBuffer.length}`,
        payload: {
          type: "message",
          role: "agent",
          status: "complete",
          blockId: this.messageBlockId,
          body: this.messageBuffer,
          sourceRuntimeId: this.runtimeId,
        },
        body: this.messageBuffer,
      });
      return;
    }
    if (kind === "agent_thought_chunk") {
      const content = isRecord(update.content) ? update.content : {};
      const text = stringField(content, "text") ?? "";
      if (text.length === 0) {
        return;
      }
      if (this.thoughtBlockId === undefined) {
        this.thoughtBlockId = `structured:${this.runtimeId}:${this.recordIndex}`;
        this.recordIndex += 1;
        this.thoughtBuffer = "";
      }
      this.thoughtBuffer += text;
      this.onEvent({
        kind: "content_record",
        sourceRef: `${this.thoughtBlockId}:${this.thoughtBuffer.length}`,
        payload: {
          type: "reasoning",
          role: "reasoning",
          status: "complete",
          blockId: this.thoughtBlockId,
          body: this.thoughtBuffer,
          sourceRuntimeId: this.runtimeId,
        },
        body: this.thoughtBuffer,
      });
      return;
    }
    if (kind === "tool_call" || kind === "tool_call_update") {
      // A tool call ends the current message/thought run (new chunks after it
      // belong to a NEW block).
      this.flushStreams();
      const toolCallId = stringField(update, "toolCallId") ?? String(this.recordIndex);
      const title = stringField(update, "title") ?? "tool";
      const status = stringField(update, "status");
      const blockId = `structured:${this.runtimeId}:tool:${toolCallId}`;
      if (kind === "tool_call") {
        this.onEvent({
          kind: "content_record",
          sourceRef: blockId,
          payload: {
            type: "tool_call",
            toolName: title,
            callId: toolCallId,
            arguments: title,
            body: title,
            status: "complete",
            blockId,
            sourceRuntimeId: this.runtimeId,
          },
          body: title,
        });
        return;
      }
      if (status === "completed" || status === "failed") {
        const output = acpToolOutput(update.content);
        this.onEvent({
          kind: "content_record",
          sourceRef: `${blockId}:result`,
          payload: {
            type: "tool_result",
            toolName: title,
            callId: toolCallId,
            ok: status === "completed",
            output,
            body: bounded(output),
            status: "complete",
            blockId: `${blockId}:result`,
            sourceRuntimeId: this.runtimeId,
          },
          body: bounded(output),
        });
      }
    }
    if (kind === "available_commands_update") {
      const list = Array.isArray(update.availableCommands) ? update.availableCommands : [];
      const commands = list
        .filter((c): c is Record<string, unknown> => isRecord(c))
        .map((c) => ({
          name: stringField(c, "name") ?? "",
          description: stringField(c, "description") ?? "Gemini command",
          trigger: "/" as const,
        }))
        .filter((c) => c.name.length > 0);
      if (commands.length > 0) {
        this.onEvent({ kind: "commands", commands });
      }
      return;
    }
    // plan / current_mode_update: later slices.
  }

  private flushStreams(): void {
    this.messageBlockId = undefined;
    this.messageBuffer = "";
    this.thoughtBlockId = undefined;
    this.thoughtBuffer = "";
  }

  private surfacePermission(serverRequestId: number | string, params: Record<string, unknown>): void {
    const toolCall = isRecord(params.toolCall) ? params.toolCall : {};
    const title = stringField(toolCall, "title") ?? "Allow this tool?";
    const options = Array.isArray(params.options) ? params.options : [];
    const choices: PromptChoice[] = options
      .map((option) => {
        if (!isRecord(option)) {
          return undefined;
        }
        const optionId = stringField(option, "optionId");
        const name = stringField(option, "name") ?? optionId;
        if (optionId === undefined || name === undefined) {
          return undefined;
        }
        return {
          choiceId: optionId,
          label: name,
          providerValue: `${GEMINI_OPTION_PREFIX}${optionId}`,
        };
      })
      .filter((choice): choice is PromptChoice => choice !== undefined);
    if (choices.length === 0) {
      return;
    }
    const promptId = `gemini-perm-${String(serverRequestId)}`;
    this.pendingPermissions.set(promptId, serverRequestId);
    // gemini's own option order is [Allow always, Allow once, Reject]. Tide
    // cards preselect the FIRST option, and plain "Allow once" is the right
    // default — order it first (the structured answer routes by optionId, so
    // display order is free).
    choices.sort((a, b) => {
      const rank = (choice: PromptChoice): number =>
        choice.choiceId === "proceed_once" ? 0 : choice.choiceId.startsWith("proceed") ? 1 : 2;
      return rank(a) - rank(b);
    });
    const allowOnce = choices.find((choice) => choice.choiceId === "proceed_once");
    const promptState: PromptState = {
      promptId,
      threadId: this.tideThreadId,
      agentId: this.agentId,
      kind: "approval",
      message: title,
      choices,
      defaultChoiceId: (allowOnce ?? choices[0]).choiceId,
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

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

function acpToolOutput(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => {
      if (!isRecord(item)) {
        return "";
      }
      const inner = isRecord(item.content) ? item.content : undefined;
      if (inner !== undefined && typeof inner.text === "string") {
        return inner.text;
      }
      return "";
    })
    .join("\n")
    .trim();
}
