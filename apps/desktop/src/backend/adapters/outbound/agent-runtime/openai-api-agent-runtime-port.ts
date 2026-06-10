import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  TerminalInput,
} from "../../../application/domains/agent-runtime/agent-runtime.ts";
import type { AgentRuntimePort } from "../../../application/ports/outbound/agent-runtime-port.ts";
import type {
  ProviderReadinessCheckInput,
  ProviderReadinessResult,
} from "../../../application/domains/provider-readiness/provider-readiness.ts";
import type { ProviderReadinessPort } from "../../../application/ports/outbound/provider-readiness-port.ts";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_OPENAI_TOOL_ROUNDS = 4;

export interface OpenAiProviderAccount {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export type OpenAiProviderAccountReader = (input: {
  accountId?: string;
}) => OpenAiProviderAccount | undefined;

export interface OpenAiApiAgentRuntimeFrame {
  threadId: string;
  agentId: "openai_api";
  source: "structured_batch";
  sourceRef?: string;
  payloadKind: "json";
  payload: Record<string, unknown>;
  body: string;
}

export type OpenAiResponseInput = string | OpenAiResponseInputItem[];

export type OpenAiResponseInputItem = Record<string, unknown>;

export interface OpenAiFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
}

export interface OpenAiFunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
  raw: Record<string, unknown>;
}

export interface OpenAiResponseResult {
  responseId?: string;
  outputText: string;
  raw: unknown;
  outputItems: Array<Record<string, unknown>>;
  functionCalls: OpenAiFunctionCall[];
  reasoningItems: Array<Record<string, unknown>>;
}

export interface OpenAiResponseClient {
  createResponse(input: {
    account: OpenAiProviderAccount;
    model: string;
    input: OpenAiResponseInput;
    tools?: OpenAiFunctionTool[];
    previousResponseId?: string;
    instructions?: string;
  }): Promise<OpenAiResponseResult>;
}

export interface OpenAiApiToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface OpenAiApiToolExecutorInput {
  session: {
    runtimeId: string;
    agentId: "openai_api";
    threadId: string;
  };
  toolName: string;
  input?: Record<string, unknown>;
}

export type OpenAiApiToolExecutionResult =
  | { ok: true; output: unknown }
  | {
      ok: false;
      error: {
        code?: string;
        message: string;
      };
    };

export type OpenAiApiToolExecutor = (
  input: OpenAiApiToolExecutorInput,
) => Promise<OpenAiApiToolExecutionResult>;

export type OpenAiApiToolLister = () => OpenAiApiToolDefinition[];

export interface OpenAiApiToolInstructionsInput {
  tools: OpenAiApiToolDefinition[];
}

export interface CreateOpenAiApiAgentRuntimePortInput {
  readAccount: OpenAiProviderAccountReader;
  client: OpenAiResponseClient;
  onRawFrame?: (frame: OpenAiApiAgentRuntimeFrame) => Promise<void> | void;
  listTools?: OpenAiApiToolLister;
  executeTool?: OpenAiApiToolExecutor;
  toolInstructions?: string;
  maxToolRounds?: number;
  clock?: () => string;
  idGenerator?: () => string;
}

export interface CreateOpenAiProviderAccountReadinessPortInput {
  readAccount: OpenAiProviderAccountReader;
}

interface OpenAiRuntimeState {
  handle: AgentRuntimeHandle;
  account: OpenAiProviderAccount;
  launchOptions?: Record<string, unknown>;
}

export interface CreateOpenAiResponsesClientInput {
  fetch?: OpenAiFetch;
}

export type OpenAiFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export function createOpenAiProviderAccountReadinessPort(
  input: CreateOpenAiProviderAccountReadinessPortInput,
): ProviderReadinessPort {
  return {
    async check(checkInput: ProviderReadinessCheckInput): Promise<ProviderReadinessResult> {
      if (checkInput.agentId !== "openai_api") {
        return {
          agentId: checkInput.agentId,
          ready: false,
          blockers: [
            {
              kind: "unknown",
              message: "Tide API readiness only supports OpenAI API.",
              scope: "provider",
              action: "none",
            },
          ],
        };
      }

      const account = input.readAccount({});
      if (account?.apiKey.trim()) {
        return { agentId: "openai_api", ready: true, blockers: [] };
      }

      return {
        agentId: "openai_api",
        ready: false,
        blockers: [
          {
            kind: "provider_account_required",
            message: "OpenAI Provider Account setup is required before starting this Tide API Agent.",
            scope: "provider",
            action: "open_provider",
          },
        ],
      };
    },
  };
}

export function createOpenAiApiAgentRuntimePort(
  input: CreateOpenAiApiAgentRuntimePortInput,
): AgentRuntimePort {
  return new OpenAiApiAgentRuntimePort(input);
}

export function createOpenAiResponsesClient(
  input: CreateOpenAiResponsesClientInput = {},
): OpenAiResponseClient {
  const fetcher = input.fetch ?? globalFetch;

  return {
    async createResponse(request) {
      const baseUrl = normalizedBaseUrl(request.account.baseUrl);
      const body: Record<string, unknown> = {
        model: request.model,
        input: request.input,
      };
      if (request.tools !== undefined && request.tools.length > 0) {
        body.tools = request.tools;
      }
      if (request.previousResponseId !== undefined) {
        body.previous_response_id = request.previousResponseId;
      }
      if (request.instructions !== undefined && request.instructions.trim().length > 0) {
        body.instructions = request.instructions;
      }

      const response = await fetcher(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.account.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      const parsed = parseJson(text);
      if (!response.ok) {
        throw new Error(`OpenAI Responses API returned ${response.status}: ${boundedText(text)}`);
      }
      const outputItems = extractOpenAiOutputItems(parsed);
      return {
        responseId: stringField(parsed, "id"),
        outputText: extractOpenAiOutputText(parsed),
        raw: parsed,
        outputItems,
        functionCalls: extractOpenAiFunctionCalls(outputItems),
        reasoningItems: outputItems.filter(isOpenAiReasoningItem),
      };
    },
  };
}

export function createEnvironmentOpenAiProviderAccountReader(
  env: NodeJS.ProcessEnv,
): OpenAiProviderAccountReader {
  return () => {
    const apiKey = env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey.trim().length === 0) {
      return undefined;
    }
    return {
      apiKey,
      baseUrl: env.OPENAI_BASE_URL,
      defaultModel: env.OPENAI_MODEL,
    };
  };
}

export function buildOpenAiFunctionToolsFromTideTools(
  tools: OpenAiApiToolDefinition[],
): OpenAiFunctionTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: { ...tool.inputSchema },
    strict: false,
  }));
}

type ParsedToolArguments =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

class OpenAiApiAgentRuntimePort implements AgentRuntimePort {
  private readonly readAccount: OpenAiProviderAccountReader;
  private readonly client: OpenAiResponseClient;
  private readonly onRawFrame?: CreateOpenAiApiAgentRuntimePortInput["onRawFrame"];
  private readonly listTools?: OpenAiApiToolLister;
  private readonly executeTool?: OpenAiApiToolExecutor;
  private readonly toolInstructions?: string;
  private readonly maxToolRounds: number;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly runtimes = new Map<string, OpenAiRuntimeState>();

  constructor(input: CreateOpenAiApiAgentRuntimePortInput) {
    this.readAccount = input.readAccount;
    this.client = input.client;
    this.onRawFrame = input.onRawFrame;
    this.listTools = input.listTools;
    this.executeTool = input.executeTool;
    this.toolInstructions = input.toolInstructions;
    this.maxToolRounds = input.maxToolRounds ?? DEFAULT_OPENAI_TOOL_ROUNDS;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
  }

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    assertOpenAiApiBinding(input.agentBinding.agentId);
    const account = requireAccount(this.readAccount({}));
    const handle = this.createHandle(input.threadId);
    this.runtimes.set(handle.runtimeId, {
      handle,
      account,
      launchOptions: cloneLaunchOptions(input.launchOptions),
    });
    return handle;
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    assertOpenAiApiBinding(input.agentBinding.agentId);
    const account = requireAccount(this.readAccount({}));
    const handle = this.createHandle(input.threadId);
    this.runtimes.set(handle.runtimeId, {
      handle,
      account,
    });
    return handle;
  }

  async writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void> {
    const runtime = this.runtimes.get(handle.runtimeId);
    if (runtime === undefined) {
      throw new Error("Tide API Agent Runtime handle was not found.");
    }

    const tools = buildOpenAiFunctionToolsFromTideTools(this.listTools?.() ?? []);
    const model = modelFromLaunchOptions(runtime.launchOptions, runtime.account.defaultModel);
    let response = await this.client.createResponse({
      account: runtime.account,
      model,
      input: input.value,
      tools,
      instructions: this.toolInstructions,
    });

    let completedToolRounds = 0;
    while (response.functionCalls.length > 0) {
      if (completedToolRounds >= this.maxToolRounds) {
        await this.emitMessageFrame(runtime, {
          responseId: response.responseId ?? this.idGenerator(),
          body: `OpenAI API Agent stopped because the tool-call limit (${this.maxToolRounds}) was reached.`,
          status: "failed",
        });
        return;
      }

      const toolOutputs: OpenAiResponseInputItem[] = [];
      for (const toolCall of response.functionCalls) {
        const execution = await this.executeOpenAiToolCall(runtime, toolCall);
        toolOutputs.push({
          type: "function_call_output",
          call_id: toolCall.callId,
          output: JSON.stringify(execution),
        });
      }

      completedToolRounds += 1;
      response = await this.client.createResponse({
        account: runtime.account,
        model,
        input: [
          ...response.reasoningItems,
          ...response.functionCalls.map((toolCall) => toolCall.raw),
          ...toolOutputs,
        ],
        tools,
        previousResponseId: response.responseId,
        instructions: this.toolInstructions,
      });
    }

    await this.emitMessageFrame(runtime, {
      responseId: response.responseId ?? this.idGenerator(),
      body: response.outputText,
      status: "complete",
    });
  }

  async interrupt(handle: AgentRuntimeHandle): Promise<void> {
    // The OpenAI API lane has no long-lived turn to abort mid-flight; dropping
    // the runtime ends the in-flight request.
    this.runtimes.delete(handle.runtimeId);
  }

  async stop(handle: AgentRuntimeHandle): Promise<void> {
    this.runtimes.delete(handle.runtimeId);
  }

  private createHandle(threadId: string): AgentRuntimeHandle {
    return {
      runtimeId: this.idGenerator(),
      threadId,
      agentId: "openai_api",
    };
  }

  private async executeOpenAiToolCall(
    runtime: OpenAiRuntimeState,
    toolCall: OpenAiFunctionCall,
  ): Promise<OpenAiApiToolExecutionResult> {
    const parsedArguments = parseOpenAiToolArguments(toolCall.argumentsJson);
    await this.emitToolCallFrame(runtime, toolCall, parsedArguments);

    const execution =
      parsedArguments.ok && this.executeTool !== undefined
        ? await this.executeTool({
            session: {
              runtimeId: runtime.handle.runtimeId,
              agentId: "openai_api",
              threadId: runtime.handle.threadId,
            },
            toolName: toolCall.name,
            input: parsedArguments.value,
          })
        : toolExecutionFailure(
            parsedArguments.ok
              ? "No Tide tool executor is available for OpenAI API Agent tool calls."
              : parsedArguments.error,
            parsedArguments.ok ? "tool_executor_unavailable" : "invalid_tool_arguments",
          );

    await this.emitToolResultFrame(runtime, toolCall, execution);
    return execution;
  }

  private async emitMessageFrame(
    runtime: OpenAiRuntimeState,
    input: {
      responseId: string;
      body: string;
      status: "complete" | "failed";
    },
  ): Promise<void> {
    await this.onRawFrame?.({
      threadId: runtime.handle.threadId,
      agentId: "openai_api",
      source: "structured_batch",
      sourceRef: input.responseId,
      payloadKind: "json",
      payload: {
        type: "message",
        role: "agent",
        status: input.status,
        blockId: `openai:${runtime.handle.threadId}:${input.responseId}`,
        body: input.body,
        responseId: input.responseId,
      },
      body: input.body,
    });
  }

  private async emitToolCallFrame(
    runtime: OpenAiRuntimeState,
    toolCall: OpenAiFunctionCall,
    parsedArguments: ParsedToolArguments,
  ): Promise<void> {
    const body = `${toolCall.name} ${toolCall.argumentsJson}`;
    await this.onRawFrame?.({
      threadId: runtime.handle.threadId,
      agentId: "openai_api",
      source: "structured_batch",
      sourceRef: toolCall.callId,
      payloadKind: "json",
      payload: {
        type: "tool_call",
        role: "tool",
        status: parsedArguments.ok ? "complete" : "failed",
        blockId: `openai-tool-call:${runtime.handle.threadId}:${toolCall.callId}`,
        toolName: toolCall.name,
        callId: toolCall.callId,
        arguments: parsedArguments.ok ? parsedArguments.value : undefined,
        argumentsJson: toolCall.argumentsJson,
        body,
      },
      body,
    });
  }

  private async emitToolResultFrame(
    runtime: OpenAiRuntimeState,
    toolCall: OpenAiFunctionCall,
    execution: OpenAiApiToolExecutionResult,
  ): Promise<void> {
    const body = JSON.stringify(execution);
    await this.onRawFrame?.({
      threadId: runtime.handle.threadId,
      agentId: "openai_api",
      source: "structured_batch",
      sourceRef: toolCall.callId,
      payloadKind: "json",
      payload: {
        type: "tool_result",
        role: "tool",
        status: execution.ok ? "complete" : "failed",
        blockId: `openai-tool-result:${runtime.handle.threadId}:${toolCall.callId}`,
        toolName: toolCall.name,
        callId: toolCall.callId,
        ok: execution.ok,
        output: execution.ok ? execution.output : undefined,
        error: execution.ok ? undefined : execution.error,
        body,
      },
      body,
    });
  }
}

function assertOpenAiApiBinding(agentId: string): void {
  if (agentId !== "openai_api") {
    throw new Error("OpenAI API runtime only supports the openai_api Agent.");
  }
}

function requireAccount(account: OpenAiProviderAccount | undefined): OpenAiProviderAccount {
  if (account === undefined || account.apiKey.trim().length === 0) {
    throw new Error("OpenAI Provider Account setup is required before starting this Tide API Agent.");
  }
  return account;
}

function modelFromLaunchOptions(
  launchOptions: Record<string, unknown> | undefined,
  defaultModel: string | undefined,
): string {
  const model = launchOptions?.model;
  if (typeof model === "string" && model.trim().length > 0) {
    return model;
  }
  if (defaultModel !== undefined && defaultModel.trim().length > 0) {
    return defaultModel;
  }
  return DEFAULT_OPENAI_MODEL;
}

function normalizedBaseUrl(value: string | undefined): string {
  const baseUrl = value?.trim() || DEFAULT_OPENAI_BASE_URL;
  return baseUrl.replace(/\/+$/, "");
}

function extractOpenAiOutputItems(value: unknown): Array<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const output = (value as Record<string, unknown>).output;
  if (!Array.isArray(output)) {
    return [];
  }
  return output.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item),
  );
}

function extractOpenAiFunctionCalls(
  outputItems: Array<Record<string, unknown>>,
): OpenAiFunctionCall[] {
  const calls: OpenAiFunctionCall[] = [];
  for (const item of outputItems) {
    if (item.type !== "function_call") {
      continue;
    }
    const callId = stringField(item, "call_id");
    const name = stringField(item, "name");
    const argumentsJson = stringField(item, "arguments");
    if (callId === undefined || name === undefined || argumentsJson === undefined) {
      continue;
    }
    calls.push({
      callId,
      name,
      argumentsJson,
      raw: { ...item },
    });
  }
  return calls;
}

function isOpenAiReasoningItem(item: Record<string, unknown>): boolean {
  return item.type === "reasoning";
}

function extractOpenAiOutputText(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const outputText = stringField(value, "output_text");
    if (outputText !== undefined) {
      return outputText;
    }
    const output = (value as Record<string, unknown>).output;
    if (Array.isArray(output)) {
      const parts: string[] = [];
      for (const item of output) {
        if (item === null || typeof item !== "object" || Array.isArray(item)) {
          continue;
        }
        const content = (item as Record<string, unknown>).content;
        if (!Array.isArray(content)) {
          continue;
        }
        for (const contentPart of content) {
          if (
            contentPart !== null &&
            typeof contentPart === "object" &&
            !Array.isArray(contentPart)
          ) {
            const text = stringField(contentPart, "text");
            if (text !== undefined) {
              parts.push(text);
            }
          }
        }
      }
      if (parts.length > 0) {
        return parts.join("");
      }
    }
  }
  return "";
}

function parseOpenAiToolArguments(argumentsJson: string): ParsedToolArguments {
  try {
    const parsed = JSON.parse(argumentsJson);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
    return { ok: false, error: "OpenAI function-call arguments must be a JSON object." };
  } catch {
    return { ok: false, error: "OpenAI function-call arguments were not valid JSON." };
  }
}

function toolExecutionFailure(
  message: string,
  code: string,
): OpenAiApiToolExecutionResult {
  return {
    ok: false,
    error: { code, message },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function cloneLaunchOptions(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return launchOptions === undefined ? undefined : { ...launchOptions };
}

function boundedText(text: string): string {
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

async function globalFetch(
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) {
  return fetch(url, init);
}

function defaultClock(): string {
  return new Date().toISOString();
}

function defaultIdGenerator(): string {
  return `runtime-${Math.random().toString(36).slice(2)}`;
}
