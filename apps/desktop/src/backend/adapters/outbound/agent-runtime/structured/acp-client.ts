// Shared ACP runtime client for providers that speak ACP over stdio, currently
// opencode (`opencode acp`). Evidence: JSON-RPC 2.0 JSONL, bidirectional server
// requests, session/prompt stays unresolved for the turn, and session/update
// notifications stream messages, thoughts, tools, commands, usage, and plans.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import type { ComposerAttachmentRef, PromptChoice, PromptState, ProviderCliAgentId } from "../../../../application/domains/thread/thread.ts";
import type { DiscoveredProviderSessionRef, ProviderLaunchPlan } from "../../../../application/ports/outbound/agent-integration-port.ts";
import type {
  StructuredClientCallbacks,
  StructuredRuntimeClient,
  StructuredRuntimeWrite,
} from "./structured-runtime-events.ts";
import { normalizeProviderTerminalStatus } from "./structured-runtime-events.ts";
import type { AgentRuntimeRateLimitDto } from "../../../../../shared/contracts/agent-runtime.ts";
import { acpUsageFromRecord } from "./acp-usage.ts";
import { usageWithRememberedRateLimits, type StructuredUsagePayload } from "./structured-usage.ts";
import { createUpdateNoticeScanner } from "./agent-update-notice.ts";
import { acpOptionKind, buildAcpPermissionDetail } from "./acp-permission.ts";
import { cancelAcpPermissionRequest, writeUnsupportedAcpServerRequest } from "./acp-server-request.ts";
import { planActivityFromEntries, planActivityFromTodoToolOutput } from "./plan-activity.ts";
import { acpPlanContentRecord, withGoalPreamble } from "./structured-plan-goal.ts";
import { acpProviderCapabilitiesEvent } from "./acp-provider-capabilities.ts";
import {
  spawnStructuredOwnedProcess,
  type ManagedBackendOwnedProcess,
  type StructuredProcessOwnershipInput,
} from "./structured-owned-process.ts";
import {
  acpToolOutput,
  bounded,
  isRecord,
  mergeConfigOptions,
  parseAcpModelCatalog,
  parseConfigOptions,
  stringField,
} from "./acp-client-shared.ts";
export { mergeConfigOptions, parseAcpModelCatalog } from "./acp-client-shared.ts";

export const ACP_OPTION_PREFIX = "structured:acp-option:";

export interface CreateAcpClientInput extends StructuredClientCallbacks, StructuredProcessOwnershipInput {
  plan: ProviderLaunchPlan;
  threadId: string;
  runtimeId: string;
  agentId: ProviderCliAgentId;
  sessionRefKind: DiscoveredProviderSessionRef["kind"];
  initialPrompt?: string;
  initialDeliveryId?: string;
  initialGoal?: string;
  initialAttachments?: ComposerAttachmentRef[];
  resumeSessionId?: string;
}

const ACP_REQUEST_TIMEOUT_MS = 15_000;

// Build the ACP session/prompt content blocks: the text plus a NATIVE image
// ContentBlock per attachment ({type:"image", mimeType, data:<base64>} — the
// ACP/MCP image content shape.
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
  private readonly managedProcess: ManagedBackendOwnedProcess;
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
  private pendingModeId?: string;
  private pendingConfigOptions?: Array<{ configId: string; value: string }>;
  private turnOpen = false;
  private recordIndex = 0;
  private goalObjective = "";
  private messageBuffer = "";
  private messageBlockId?: string;
  private thoughtBuffer = "";
  private thoughtBlockId?: string;
  private readonly pendingResponses = new Map<
    number,
    { onResponse: (message: Record<string, unknown>) => void; timer?: NodeJS.Timeout }
  >();
  private readonly pendingPermissions = new Map<string, number | string>();
  private lastRateLimits?: AgentRuntimeRateLimitDto[];
  private activeDeliveryId?: string;
  private readonly readiness: Promise<void>;
  private resolveReadiness!: () => void;
  private rejectReadiness!: (error: Error) => void;

  constructor(input: CreateAcpClientInput) {
    this.readiness = new Promise<void>((resolve, reject) => {
      this.resolveReadiness = resolve;
      this.rejectReadiness = reject;
    });
    this.onEvent = input.onEvent;
    this.tideThreadId = input.threadId;
    this.runtimeId = input.runtimeId;
    this.agentId = input.agentId;
    this.sessionRefKind = input.sessionRefKind;
    this.protocolParams = isRecord(input.plan.protocolParams) ? input.plan.protocolParams : {};
    this.goalObjective = input.initialGoal?.trim() ?? "";
    this.managedProcess = spawnStructuredOwnedProcess({
      ...input,
      providerId: input.agentId,
      command: input.plan.command,
      args: input.plan.args,
      options: {
        cwd: input.plan.cwd,
        env: input.plan.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
      beforeSignal: () => this.prepareForProcessStop(),
    });
    this.child = this.managedProcess.child as ChildProcessWithoutNullStreams;
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.ingest(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
        process.stderr.write(`[tide-acp ${this.runtimeId}] ${chunk}`);
      }
      this.scanUpdate(chunk);
    });
    this.child.on("error", () => {
      if (!this.exited) {
        this.exited = true;
        this.rejectReadiness(new Error("ACP runtime failed to start."));
        this.clearPendingResponses();
        this.onEvent({ kind: "runtime_exited", exitCode: null, activeDeliveryId: this.activeDeliveryId });
      }
    });
    this.child.on("exit", (code) => {
      if (!this.exited) {
        this.exited = true;
        this.rejectReadiness(new Error("ACP runtime exited before session adoption."));
        this.clearPendingResponses();
        this.onEvent({ kind: "runtime_exited", exitCode: code, activeDeliveryId: this.activeDeliveryId });
      }
    });
    this.bootstrap(input);
  }

  get pid(): number | undefined { return this.child.pid ?? undefined; }

  ready(): Promise<void> { return this.readiness; }

  private bootstrap(input: CreateAcpClientInput): void {
    this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "tide", title: "Tide", version: "2.0" },
    }, (response) => {
      const initializeResult = isRecord(response.result) ? response.result : {};
      this.onEvent(acpProviderCapabilitiesEvent(initializeResult));
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
        this.adoptSession(response, undefined, input.initialPrompt, input.initialAttachments, input.initialDeliveryId);
      });
    });
  }

  private adoptSession(
    response: Record<string, unknown>,
    knownSessionId?: string,
    initialPrompt?: string,
    initialAttachments?: ComposerAttachmentRef[],
    initialDeliveryId?: string,
  ): void {
    if (response.error !== undefined) {
      const error = isRecord(response.error) ? response.error : {};
      this.onEvent({
        kind: "turn_completed",
        status: "failed",
        nativeStatus: "session_error",
        notice: stringField(error, "message") ?? "ACP session could not be started.",
      });
      this.rejectReadiness(new Error(stringField(error, "message") ?? "ACP session could not be started."));
      return;
    }
    const result = isRecord(response.result) ? response.result : {};
    const sessionId = stringField(result, "sessionId") ?? knownSessionId;
    if (sessionId === undefined) {
      return;
    }
    this.sessionId = sessionId;
    this.resolveReadiness();
    this.onEvent({
      kind: "session_ref",
      ref: { agentId: this.agentId, kind: this.sessionRefKind, value: sessionId },
    });
    // The agent self-reports its model catalog at session/new (ACP availableModels
    // / opencode configOptions) — surface it so the menu is accurate + the current
    // model is reflected, not a drifted static guess.
    this.emitModelCatalog(result);
    // Approval mode is an ACP session mode (default/autoEdit/yolo/plan) — set
    // it when the launch options ask for a non-default mode. A mid-thread
    // change that arrived before the session was adopted applies now instead.
    const modeId = this.pendingModeId ?? stringField(this.protocolParams, "modeId");
    this.pendingModeId = undefined;
    if (modeId !== undefined && modeId !== "default") {
      this.request("session/set_mode", { sessionId, modeId }, () => undefined);
    }
    // opencode delivers model / effort / mode as `session/set_config_option` (its
    // configOptions surface), NOT the ACP-standard modeId — applied before the first
    // prompt so the chosen model/effort takes effect from turn one.
    const initialConfigOptions =
      this.pendingConfigOptions ?? parseConfigOptions(this.protocolParams.configOptions);
    this.pendingConfigOptions = undefined;
    this.sendConfigOptions(sessionId, initialConfigOptions);
    if (initialPrompt !== undefined && initialPrompt.length > 0) {
      void this.startTurn(
        withGoalPreamble(this.goalObjective, initialPrompt),
        initialAttachments,
        initialDeliveryId,
      );
    }
  }

  // Mid-thread Launch Options change. opencode delivers model / effort / mode as
  // session/set_config_option entries. See
  // mid-thread-launch-option-changes.md + opencode-model-vendor-selection.md.
  async applyConfig(protocolParams: Record<string, unknown>): Promise<boolean> {
    // ACP set_mode / set_config_option have no Tide-side failure signal today, so
    // treat delivery as applied (the live-vs-restart routing for these providers is
    // unchanged by the claude bypass fix). See claude-bypass-live-capability.md. A
    // throw (dead process / closed stdin) degrades to a restart instead of rejecting.
    try {
      this.applyConfigInternal(protocolParams);
      return true;
    } catch {
      return false;
    }
  }

  private applyConfigInternal(protocolParams: Record<string, unknown>): void {
    const configOptions = parseConfigOptions(protocolParams.configOptions);
    if (configOptions !== undefined) {
      if (this.sessionId === undefined) {
        // MERGE by configId: each change carries only its changed keys, so a later
        // pre-adoption change must not clobber an earlier one (e.g. model then effort).
        this.pendingConfigOptions = mergeConfigOptions(this.pendingConfigOptions, configOptions);
        return;
      }
      this.sendConfigOptions(this.sessionId, configOptions);
      return;
    }
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

  // Apply config options SEQUENTIALLY (each after the previous response), not
  // concurrently: opencode's effort option only exists once the model is set, so
  // sending effort before the model change registers gets it rejected. The array is
  // already ordered model → effort → mode (opencodeConfigOptions).
  private sendConfigOptions(
    sessionId: string,
    configOptions: Array<{ configId: string; value: string }> | undefined,
  ): void {
    const options = configOptions ?? [];
    const sendNext = (index: number): void => {
      if (index >= options.length) {
        return;
      }
      const option = options[index];
      this.request(
        "session/set_config_option",
        { sessionId, configId: option.configId, value: option.value },
        () => sendNext(index + 1),
      );
    };
    sendNext(0);
  }

  // Parse the agent's self-reported model catalog from the session/new result and
  // emit it: ACP-standard `models.availableModels`/`currentModelId`, or opencode's
  // `configOptions` model category (provider/model ids → vendor + model).
  private emitModelCatalog(result: Record<string, unknown>): void {
    const catalog = parseAcpModelCatalog(result);
    if (catalog !== undefined) {
      this.onEvent({ kind: "model_catalog", models: catalog.models, currentModel: catalog.currentModel });
    }
  }

  private startTurn(
    text: string,
    attachments?: ComposerAttachmentRef[],
    deliveryId?: string,
  ): { deliveryId: string; state: "working_unconfirmed" } {
    if (this.sessionId === undefined) {
      throw new Error("ACP session is not ready for dispatch.");
    }
    if (this.turnOpen) {
      throw new Error("ACP already has an active turn; queue in the application service.");
    }
    const stableDeliveryId = deliveryId ?? `${this.runtimeId}:delivery:${this.requestId + 1}`;
    this.activeDeliveryId = stableDeliveryId;
    this.turnOpen = true;
    this.onEvent({ kind: "turn_started", deliveryId: stableDeliveryId });
    this.request("session/prompt", {
      sessionId: this.sessionId,
      messageId: stableDeliveryId,
      prompt: acpPromptBlocks(text, attachments),
    }, (response) => {
      this.turnOpen = false;
      this.flushStreams();
      const result = isRecord(response.result) ? response.result : {};
      const stopReason = stringField(result, "stopReason") ?? (response.error !== undefined ? "error" : "end_turn");
      const userMessageId = stringField(result, "userMessageId");
      this.onEvent({
        kind: "delivery_acknowledged",
        deliveryId: stableDeliveryId,
        ...(userMessageId !== undefined ? { providerMessageId: userMessageId } : {}),
      });
      const terminal = normalizeProviderTerminalStatus(this.agentId, stopReason);
      const usage = this.withLastRateLimits(acpUsageFromRecord(result));
      let notice: string | undefined;
      if (response.error !== undefined) {
        const error = isRecord(response.error) ? response.error : {};
        notice = stringField(error, "message") ?? "ACP turn failed.";
      } else if (stopReason === "max_tokens") {
        notice = "ACP provider stopped: maximum tokens reached.";
      } else if (stopReason === "refusal") {
        notice = "ACP provider declined to continue this turn.";
      }
      this.onEvent({
        kind: "turn_completed",
        ...terminal,
        deliveryId: stableDeliveryId,
        ...(notice !== undefined ? { notice } : {}),
        ...(usage !== undefined ? { usage } : {}),
      });
      this.activeDeliveryId = undefined;
    }, null);
    return { deliveryId: stableDeliveryId, state: "working_unconfirmed" };
  }

  async write(input: StructuredRuntimeWrite) {
    if (input.kind === "goal_set") {
      this.goalObjective = input.objective.trim();
      return;
    }
    if (input.kind === "composer_input") {
      const value = withGoalPreamble(this.goalObjective, input.value);
      return this.startTurn(value, input.attachments, input.deliveryId);
    }
    const promptId = input.promptId ?? "";
    const serverRequestId = this.pendingPermissions.get(promptId);
    if (serverRequestId === undefined) {
      return;
    }
    this.pendingPermissions.delete(promptId);
    const optionId = input.value.startsWith(ACP_OPTION_PREFIX)
      ? input.value.slice(ACP_OPTION_PREFIX.length)
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
    await this.managedProcess.stop("runtime_stop");
  }

  private prepareForProcessStop(): void {
    this.exited = true;
    this.clearPendingResponses();
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    onResponse: (message: Record<string, unknown>) => void,
    timeoutMs: number | null = ACP_REQUEST_TIMEOUT_MS,
  ): void {
    this.requestId += 1;
    const requestId = this.requestId;
    const pending: { onResponse: (message: Record<string, unknown>) => void; timer?: NodeJS.Timeout } = { onResponse };
    if (timeoutMs !== null) {
      pending.timer = setTimeout(() => {
        if (!this.pendingResponses.delete(requestId)) return;
        onResponse({ error: { message: `ACP request timed out: ${method}` } });
      }, timeoutMs);
      pending.timer.unref();
    }
    this.pendingResponses.set(requestId, pending);
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
          `[tide-acp ${this.runtimeId}] <- ${String(message.method ?? `response#${String(message.id)}`)}\n`,
        );
      }
      try {
        this.handleMessage(message);
      } catch (error) {
        if (process.env.TIDE_DEBUG_STRUCTURED === "1") {
          process.stderr.write(`[tide-acp ${this.runtimeId}] handler error: ${String(error)}\n`);
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
        if (handler.timer !== undefined) clearTimeout(handler.timer);
        handler.onResponse(message);
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
        return;
      }
      writeUnsupportedAcpServerRequest({
        serverRequestId: message.id as number | string,
        method,
        writeLine: (value) => this.writeLine(value),
        onEvent: this.onEvent,
      });
      return;
    }

    if (method === "session/update") {
      this.handleSessionUpdate(isRecord(params.update) ? params.update : {});
    }
  }

  private clearPendingResponses(): void {
    for (const pending of this.pendingResponses.values()) {
      if (pending.timer !== undefined) clearTimeout(pending.timer);
    }
    this.pendingResponses.clear();
  }

  private handleSessionUpdate(update: Record<string, unknown>): void {
    const kind = stringField(update, "sessionUpdate");
    if (kind === "usage_update" || kind === "usage" || kind === "quota_update") {
      const usage = this.withLastRateLimits(acpUsageFromRecord(update));
      if (usage !== undefined) {
        this.onEvent({ kind: "usage", usage });
      }
      return;
    }
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
        const plan = planActivityFromTodoToolOutput(title, output);
        if (plan !== undefined) this.onEvent({ kind: "live_activity", ...plan });
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
          description: stringField(c, "description") ?? "ACP command",
          trigger: "/" as const,
        }))
        .filter((c) => c.name.length > 0);
      if (commands.length > 0) {
        this.onEvent({ kind: "commands", commands });
      }
      return;
    }
    if (kind === "plan") {
      const plan = planActivityFromEntries(update.entries); // step progress (Slice B′)
      if (plan !== undefined) this.onEvent({ kind: "live_activity", ...plan });
      this.onEvent({ kind: "content_record", ...acpPlanContentRecord(this.runtimeId, update.entries) });
      return;
    }
  }

  // Carry the most recent rate-limit windows forward onto later usage events that omit
  // them (the CLI reports them once per turn, not on every update).
  private withLastRateLimits(usage: StructuredUsagePayload | undefined): StructuredUsagePayload | undefined {
    if (usage?.rateLimits !== undefined && usage.rateLimits.length > 0) {
      this.lastRateLimits = usage.rateLimits;
    }
    return usageWithRememberedRateLimits(usage, this.lastRateLimits);
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
        // ACP options carry a native `kind` (allow_once/allow_always/reject_*); surface it
        // so the card can style + default by semantic instead of guessing from the id.
        const kind = acpOptionKind(option);
        return {
          choiceId: optionId,
          label: name,
          providerValue: `${ACP_OPTION_PREFIX}${optionId}`,
          ...(kind !== undefined ? { kind } : {}),
        };
      })
      .filter((choice): choice is PromptChoice => choice !== undefined);
    if (choices.length === 0) {
      cancelAcpPermissionRequest({
        serverRequestId,
        writeLine: (value) => this.writeLine(value),
        onEvent: this.onEvent,
      });
      return;
    }
    const promptId = `acp-perm-${String(serverRequestId)}`;
    this.pendingPermissions.set(promptId, serverRequestId);
    // Order allow-once first so the card preselects it (the answer routes by optionId, so
    // display order is free). Prefer the native ACP option `kind`; fall back to the optionId
    // convention (`proceed_once`/`proceed`) only when `kind` is absent.
    const rank = (choice: PromptChoice): number => {
      if (choice.kind === "allow_once") return 0;
      if (choice.kind === "allow_always") return 1;
      if (choice.kind === "reject_once" || choice.kind === "reject_always") return 3;
      return choice.choiceId === "proceed_once" ? 0 : choice.choiceId.startsWith("proceed") ? 1 : 2;
    };
    choices.sort((a, b) => rank(a) - rank(b));
    const allowOnce =
      choices.find((choice) => choice.kind === "allow_once") ??
      choices.find((choice) => choice.choiceId === "proceed_once");
    // The diff/command preview + affected paths behind this permission (ACP toolCall).
    const detail = buildAcpPermissionDetail(toolCall);
    const promptState: PromptState = {
      promptId,
      threadId: this.tideThreadId,
      agentId: this.agentId,
      kind: "approval",
      message: title,
      ...(detail !== undefined ? { detail } : {}),
      choices,
      defaultChoiceId: (allowOnce ?? choices[0]).choiceId,
      source: "provider_hook",
    };
    this.onEvent({ kind: "prompt", promptState });
  }
}

export { acpUsageFromRecord };
