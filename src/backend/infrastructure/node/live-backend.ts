import { spawnSync } from "node:child_process";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBackendContractMessageAdapter,
  toAgentSessionBlockDto,
  toProviderReadinessDto,
  toThreadSummaryDto,
  toWorkbenchPaneRefDto,
} from "../../adapters/inbound/contract-message-adapter/backend-contract-message-adapter.ts";
import { createTideMcpSocketServer } from "../../adapters/inbound/tide-mcp-server/tide-mcp-socket-bridge.ts";
import { createTideMcpToolSurfaceAdapter } from "../../adapters/inbound/tide-mcp-tool-surface/tide-mcp-tool-surface-adapter.ts";
import {
  createAgentIntegrationAgentRuntimePort,
  createAgentIntegrationProviderReadinessPort,
  type AgentIntegrationRegistry,
} from "../../adapters/outbound/agent-runtime/agent-integration-agent-runtime-port.ts";
import {
  createAgentRuntimeRouterPort,
  createProviderReadinessRouterPort,
} from "../../adapters/outbound/agent-runtime/agent-runtime-router-port.ts";
import {
  createEnvironmentOpenAiProviderAccountReader,
  createOpenAiApiAgentRuntimePort,
  createOpenAiProviderAccountReadinessPort,
  createOpenAiResponsesClient,
} from "../../adapters/outbound/agent-runtime/openai-api-agent-runtime-port.ts";
import {
  createAntigravityAgentIntegration,
  type AntigravityProviderState,
} from "../../adapters/outbound/agent-integrations/antigravity/antigravity-agent-integration.ts";
import { createFileAppStorage } from "../../adapters/outbound/app-storage/file-app-storage.ts";
import {
  createClaudeAgentIntegration,
  type ClaudeProviderState,
} from "../../adapters/outbound/agent-integrations/claude/claude-agent-integration.ts";
import {
  createCodexAgentIntegration,
  type CodexProviderState,
} from "../../adapters/outbound/agent-integrations/codex/codex-agent-integration.ts";
import {
  createAgentSessionBlockCompletedEventFromUpdate,
  createAgentSessionBlockUpsertedEventFromBlock,
} from "../../adapters/outbound/desktop-contract/agent-session-block-event-adapter.ts";
import { createTypeScriptCodeIntelligencePort } from "../../adapters/outbound/code-intelligence/typescript-code-intelligence-port.ts";
import { createPythonPtyProcessLauncher } from "../../adapters/outbound/pty/python-pty-process-launcher.ts";
import { createPtyProviderSetupSurfaceTerminalPort } from "../../adapters/outbound/pty/provider-setup-surface-pty-port.ts";
import { createPtyWorkbenchTerminalPort } from "../../adapters/outbound/pty/workbench-terminal-pty-port.ts";
import { createNodeWorkspaceCommandPort } from "../../adapters/outbound/workspace-command/node-workspace-command-port.ts";
import { createNodeWorkspaceFilePort } from "../../adapters/outbound/workspace-file/node-workspace-file-port.ts";
import {
  ensureProviderBootstrapArtifacts,
  isAntigravityPluginBootstrapReady,
  isClaudeBootstrapReady,
  isCodexBootstrapReady,
  providerBootstrapArtifactsForHome,
} from "./provider-bootstrap-artifacts.ts";
import type {
  AgentSessionBlock,
  AgentSessionBlockUpdate,
} from "../../application/domains/agent-session/agent-session-block.ts";
import type { AgentId, PromptState } from "../../application/domains/thread/thread.ts";
import { createFixtureAgentSessionReader } from "../../application/services/fixture-agent-session-reader.ts";
import {
  adoptedThreadSeedsFromSessions,
  discoverLocalSessions,
  isInternalSessionTitle,
  type DiscoveryFs,
} from "../../application/services/provider-session-discovery.ts";
import {
  createThreadPersistenceService,
  THREAD_STORAGE_VERSION,
  type ProviderSessionRefRecord,
  type ThreadPersistenceService,
  type ThreadStorageRecord,
} from "../../application/services/thread-persistence-service.ts";
import {
  createThreadRuntimeService,
  type PtyTranscriptPort,
  type RawAgentFrame,
  type TideMcpToolName,
  type ThreadSeed,
  type ThreadRuntimeAsyncEvent,
  type ThreadRuntimeService,
} from "../../application/services/thread-runtime-service.ts";
import {
  CONTRACT_VERSION,
  type BackendEventEnvelope,
  type ThreadSummaryDto,
} from "../../../shared/contracts/index.ts";

export interface CreateLiveBackendContractMessageAdapterInput {
  onEvent?: (event: BackendEventEnvelope) => void;
  appDataRoot?: string;
  env?: NodeJS.ProcessEnv;
  startMcpSocket?: boolean;
}

export function createLiveBackendContractMessageAdapter(
  input: CreateLiveBackendContractMessageAdapterInput = {},
) {
  const env = input.env ?? process.env;
  const homeDir = env.HOME ?? process.cwd();
  const appDataRoot = input.appDataRoot ?? env.TIDE_APP_DATA_ROOT ?? join(homeDir, ".tide-v2");
  const tideSocket =
    env.TIDE_SOCKET ?? join(tmpdir(), `tide-mcp-${process.pid}.sock`);
  const tideMcpEntrypoint =
    env.TIDE_MCP_ENTRYPOINT ??
    join(dirname(fileURLToPath(import.meta.url)), "backend-entrypoint.js");
  const persistence = createThreadPersistenceService({
    storage: createFileAppStorage({ appDataRoot }),
    clock: liveClock,
    readerVersion: "live-v1",
  });
  const emitBackendEvents = (events: BackendEventEnvelope[]): void => {
    for (const event of events) {
      input.onEvent?.(event);
    }
    void persistThreadEvents(persistence, service, events);
  };
  const bootstrapArtifacts = ensureProviderBootstrapArtifacts({
    homeDir,
    tideCommand: env.TIDE_BIN ?? process.execPath,
    tideMcpEntrypoint,
    tideSocket,
    tidePane: env.TIDE_PANE,
    tideWindow: env.TIDE_WINDOW,
  });
  const integrations = {
    codex: createCodexAgentIntegration({
      resolveExecutable: () => resolveExecutable("codex"),
      readProviderState: ({ cwd }) => readCodexProviderStateFromHome(homeDir, cwd),
      tideMcp: {
        command: bootstrapArtifacts.tideMcpCommandPath,
        args: [],
        env: { TIDE_SOCKET: tideSocket },
      },
      defaultCwd: process.cwd(),
    }),
    claude: createClaudeAgentIntegration({
      resolveExecutable: () => resolveExecutable("claude"),
      readProviderState: ({ cwd }) => readClaudeProviderStateFromHome(homeDir, cwd),
      mcpConfigPath: bootstrapArtifacts.claudeMcpConfigPath,
      settingsPath: bootstrapArtifacts.claudeSettingsPath,
      tideContextPrompt: "You are running inside Tide. Use Tide MCP tools when available.",
      defaultCwd: process.cwd(),
    }),
    antigravity: createAntigravityAgentIntegration({
      resolveExecutable: () => resolveExecutable("agy"),
      readProviderState: ({ cwd }) => readAntigravityProviderStateFromHome(homeDir, cwd),
      tidePlugin: {
        installSourcePath: bootstrapArtifacts.antigravityPluginSourcePath,
      },
      defaultCwd: process.cwd(),
    }),
  };
  let service: ThreadRuntimeService;
  const ptyLauncher = createPythonPtyProcessLauncher();
  const openAiAccountReader = createEnvironmentOpenAiProviderAccountReader(env);
  const projector = createLiveAgentSessionEventProjector({
    service: () => service,
    persistence,
    onEvent: input.onEvent,
    homeDir,
    integrations,
    providerSignalSpoolDir: bootstrapArtifacts.providerSignalSpoolDir,
  });
  const providerCliRuntimePort = createAgentIntegrationAgentRuntimePort({
    integrations,
    launcher: ptyLauncher,
    onOutputFrame: (frame) => {
      void projector.ingestOutput(frame);
    },
    onRuntimeStarted: (runtime) => {
      projector.trackRuntime(runtime);
    },
  });
  const tideApiRuntimePort = createOpenAiApiAgentRuntimePort({
    readAccount: openAiAccountReader,
    client: createOpenAiResponsesClient(),
    listTools: () => service.listTideMcpTools(),
    executeTool: async (toolCall) => {
      const result = await service.handleTideMcpToolCall({
        session: toolCall.session,
        toolName: toolCall.toolName as TideMcpToolName,
        input: toolCall.input,
      });
      if (!result.ok) {
        return {
          ok: false,
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        };
      }
      return {
        ok: true,
        output: result.output,
      };
    },
    toolInstructions:
      "Use Tide tools when you need current Thread, Workbench, or Browser Pane state. Do not guess Tide UI state when a Tide tool can observe it.",
    onRawFrame: (frame) => {
      return projector.ingestStructuredFrame(frame);
    },
  });
  service = createThreadRuntimeService({
    agentRuntimePort: createAgentRuntimeRouterPort({
      providerCliRuntime: providerCliRuntimePort,
      tideApiRuntime: tideApiRuntimePort,
    }),
    providerReadinessPort: createProviderReadinessRouterPort({
      providerCliReadiness: createAgentIntegrationProviderReadinessPort({
        integrations,
      }),
      tideApiReadiness: createOpenAiProviderAccountReadinessPort({
        readAccount: openAiAccountReader,
      }),
    }),
    providerSetupSurfaceTerminalPort: createPtyProviderSetupSurfaceTerminalPort({
      launcher: ptyLauncher,
    }),
    workbenchTerminalPort: createPtyWorkbenchTerminalPort({
      launcher: ptyLauncher,
    }),
    ptyTranscriptPort: createMemoryPtyTranscriptPort(),
    workspaceCommandPort: createNodeWorkspaceCommandPort(),
    workspaceFilePort: createNodeWorkspaceFilePort(),
    workspaceCodeIntelligencePort: createTypeScriptCodeIntelligencePort(),
    defaultWorkbenchTerminalCommand: env.SHELL ?? "sh",
    onAsyncEvent: (event) => {
      emitBackendEvents(backendEventsFromThreadRuntimeAsyncEvent(event));
    },
  });
  if (input.startMcpSocket !== false) {
    const mcpSocketServer = createTideMcpSocketServer({
      socketPath: tideSocket,
      adapter: createTideMcpToolSurfaceAdapter({ service }),
    });
    void mcpSocketServer.listen().catch((error: unknown) => {
      process.emitWarning(
        error instanceof Error
          ? error.message
          : "Tide MCP socket bridge failed to start.",
        { type: "TideMcpSocketBridgeWarning" },
      );
    });
  }

  return createPersistentLiveBackendAdapter({
    adapter: createBackendContractMessageAdapter({ service }),
    service,
    persistence,
    homeDir,
    appDataRoot,
  });
}

function createPersistentLiveBackendAdapter(input: {
  adapter: ReturnType<typeof createBackendContractMessageAdapter>;
  service: ThreadRuntimeService;
  persistence: ThreadPersistenceService;
  homeDir: string;
  appDataRoot: string;
}) {
  let restorePromise: Promise<void> | null = null;

  const restorePersistedThreads = async (): Promise<void> => {
    const listed = await input.persistence.listThreadMetadata();
    if (!listed.ok) {
      process.emitWarning(listed.error.message, {
        type: "TidePersistenceRestoreWarning",
      });
      return;
    }

    // Restore each thread WITH its persisted Agent Session blocks so reopening a
    // thread after a restart shows the prior conversation (not an empty pane).
    const seeds = await Promise.all(
      listed.value.map(async (record) => {
        const seed = threadSeedFromStorageRecord(record);
        // Prefer the coding agent's own persisted session (codex rollout / claude
        // transcript) as the source of truth — this restores the FULL conversation
        // for any thread, including ones started before Tide cached blocks.
        const fromProvider = rebuildConversationFromProviderHistory(record);
        if (fromProvider.length > 0) {
          seed.cachedBlocks = fromProvider;
        } else {
          const hydrated = await input.persistence.hydrateThread(record.threadId, {});
          if (hydrated.ok && hydrated.value.blocks.length > 0) {
            seed.cachedBlocks = hydrated.value.blocks;
          }
        }
        return seed;
      }),
    );
    // Adopt provider sessions that exist in local history (started outside Tide)
    // for known project cwds, so the thread list reflects real local sessions.
    const adopted = discoverAdoptedThreadSeeds({
      homeDir: input.homeDir,
      appDataRoot: input.appDataRoot,
      persistedRecords: listed.value,
    });
    for (const seed of adopted) {
      const blocks = rebuildAdoptedConversation(seed);
      if (blocks.length > 0) {
        seed.cachedBlocks = blocks;
      }
    }

    // Drop auto-review / internal sub-sessions (e.g. approval-assessment passes)
    // from BOTH persisted and adopted seeds — they are not real conversations.
    const threads = [...seeds, ...adopted].filter(
      (seed) => !isInternalSessionTitle(seed.title),
    );
    const restored = await input.service.restoreThreads({ threads });
    if (!restored.ok) {
      process.emitWarning(restored.error.message, {
        type: "TidePersistenceRestoreWarning",
      });
    }
  };

  return {
    async handleMessage(message: unknown): Promise<BackendEventEnvelope[]> {
      restorePromise ??= restorePersistedThreads();
      await restorePromise;
      const events = await input.adapter.handleMessage(message);
      await persistThreadEvents(input.persistence, input.service, events);
      return events;
    },
  };
}

async function persistThreadEvents(
  persistence: ThreadPersistenceService,
  service: ThreadRuntimeService,
  events: BackendEventEnvelope[],
): Promise<void> {
  const blockThreadIds = new Set<string>();
  for (const event of events) {
    if (event.kind === "agentSessionBlock.upserted") {
      const blockThreadId = (event.payload as { block?: { threadId?: unknown } }).block?.threadId;
      if (typeof blockThreadId === "string") {
        blockThreadIds.add(blockThreadId);
      }
    }
    if (
      event.kind !== "thread.started" &&
      event.kind !== "thread.hydrated" &&
      event.kind !== "thread.archived" &&
      event.kind !== "thread.pinChanged" &&
      event.kind !== "thread.renamed"
    ) {
      continue;
    }
    const payload = event.payload as { thread?: ThreadSummaryDto };
    if (payload.thread === undefined) {
      continue;
    }
    const saved = await persistence.saveThreadMetadata(
      threadStorageRecordFromThreadSummary(payload.thread),
    );
    if (!saved.ok) {
      process.emitWarning(saved.error.message, {
        type: "TidePersistenceSaveWarning",
      });
    }
  }
  for (const threadId of blockThreadIds) {
    await persistThreadBlocks({ persistence, service, threadId });
  }
}

export function backendEventsFromThreadRuntimeAsyncEvent(
  event: ThreadRuntimeAsyncEvent,
): BackendEventEnvelope[] {
  const emittedAt = new Date().toISOString();

  switch (event.kind) {
    case "workbench_changed":
      return [
        {
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "workbench.changed",
          emittedAt,
          payload: {
            threadId: event.thread.threadId,
            panes: event.thread.workbench.panes.map(toWorkbenchPaneRefDto),
            ...(event.thread.workbench.activePaneId === undefined
              ? {}
              : { activePaneId: event.thread.workbench.activePaneId }),
          },
        },
      ];
    case "workbench_terminal_output":
      return [
        {
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "workbench.terminalOutput",
          emittedAt,
          payload: {
            threadId: event.threadId,
            paneId: event.paneId,
            source: event.source,
            chunk: event.chunk,
          },
        },
      ];
    case "provider_readiness_changed":
      return [
        {
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "providerReadiness.changed",
          emittedAt,
          payload: {
            threadId: event.threadId,
            readiness: toProviderReadinessDto(event.readiness),
          },
        },
      ];
    case "agent_session_block_upserted":
      return [
        {
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "agentSessionBlock.upserted",
          emittedAt,
          payload: {
            block: toAgentSessionBlockDto(event.thread, event.block),
          },
        },
      ];
    case "agent_runtime_state_changed":
      return [
        {
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "agentRuntime.stateChanged",
          emittedAt,
          payload: {
            threadId: event.thread.threadId,
            state: event.runtimeState,
            changedAt: event.thread.updatedAt,
          },
        },
      ];
    case "thread_hydrated":
      return [
        {
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "thread.hydrated",
          emittedAt,
          payload: {
            thread: toThreadSummaryDto(event.thread),
            blocks: event.blocks.map((block) =>
              toAgentSessionBlockDto(event.thread, block),
            ),
            runtimeState: event.runtimeState,
            workbenchPanes: event.thread.workbench.panes.map(toWorkbenchPaneRefDto),
          },
        },
      ];
  }
}

export function threadSeedFromStorageRecord(record: ThreadStorageRecord): ThreadSeed {
  const providerSessionRef = record.providerSessionRef;
  const lastKnownState =
    record.archived || record.lastKnownState === "archived"
      ? "archived"
      : record.lastKnownState === "running"
        ? "idle"
        : record.lastKnownState;

  return {
    threadId: record.threadId,
    title: record.title,
    agentBinding: {
      ...record.agentBinding,
      providerSessionRef:
        providerSessionRef === undefined
          ? record.agentBinding.providerSessionRef
          : {
              kind: providerSessionRef.kind,
              value: providerSessionRef.value,
              transcriptPath: providerSessionRef.transcriptPath,
              logPath: providerSessionRef.logPath,
            },
    },
    scope: { ...record.scope },
    launchOptions: cloneLaunchOptions(record.launchOptions),
    lifecycleState: record.archived ? "archived" : "open",
    runtimeState: "not_started",
    lastKnownState,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// Rebuild the FULL conversation (all user + agent turns) from the coding agent's
// own persisted session file (codex rollout / claude transcript). This restores
// any thread on restart — including ones created before Tide cached blocks —
// since the agent's session is the durable source of truth.
function rebuildConversationFromProviderHistory(
  record: ThreadStorageRecord,
): AgentSessionBlock[] {
  const ref = record.providerSessionRef;
  const filePath = ref?.transcriptPath;
  if (ref === undefined || filePath === undefined) {
    return [];
  }
  const text = readBoundedTail(filePath, 1024 * 1024);
  if (text === undefined) {
    return [];
  }
  const agentId = record.agentBinding.agentId;
  if (ref.kind === "codex_rollout") {
    return rebuildCodexConversation(text, record.threadId, ref.value, agentId);
  }
  if (ref.kind === "claude_transcript") {
    return rebuildClaudeConversation(text, record.threadId, ref.value, agentId);
  }
  if (ref.kind === "antigravity_conversation") {
    return rebuildAntigravityConversation(text, record.threadId, ref.value, agentId);
  }
  return [];
}

function conversationBlock(input: {
  threadId: string;
  sessionId: string;
  index: number;
  agentId: AgentId;
  isUser: boolean;
  body: string;
  timestamp: string;
  blockId?: string;
}): AgentSessionBlock {
  return {
    blockId: input.blockId ?? `provider:${input.threadId}:${input.sessionId}:${input.index}`,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: input.isUser ? "user_message" : "agent_message",
    role: input.isUser ? "user" : "agent",
    sourceFrameIds: [],
    status: "complete",
    body: input.body,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

function toolConversationBlock(input: {
  threadId: string;
  agentId: AgentId;
  blockId: string;
  kind: "tool_call" | "tool_result";
  toolName: string;
  callId: string;
  body: string;
  data: Record<string, unknown>;
  timestamp: string;
}): AgentSessionBlock {
  return {
    blockId: input.blockId,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: input.kind,
    role: "tool",
    sourceFrameIds: [],
    status: "complete",
    title: input.toolName,
    body: input.body,
    data: { toolName: input.toolName, callId: input.callId, ...input.data },
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function rebuildCodexConversation(
  text: string,
  threadId: string,
  sessionId: string,
  agentId: AgentId,
): AgentSessionBlock[] {
  const blocks: AgentSessionBlock[] = [];
  const lines = text.split(/\r?\n/);
  const timestamp = new Date().toISOString();
  const toolNameByCallId = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const record = parseJsonObject(lines[index]);
    const payload = recordField(record, "payload");
    if (record?.type === "event_msg") {
      const isUser = payload?.type === "user_message";
      if (!isUser && payload?.type !== "agent_message") {
        continue;
      }
      const body = stringField(payload, "message") ?? (isUser ? joinTextContent(payload?.content) : undefined);
      if (body === undefined || body.length === 0) {
        continue;
      }
      blocks.push(conversationBlock({ threadId, sessionId, index, agentId, isUser, body, timestamp }));
      continue;
    }
    if (record?.type !== "response_item" || payload === undefined) {
      continue;
    }
    const toolFrame = codexToolFramePayload({
      payload,
      threadId,
      sessionId,
      index,
      runtimeId: "",
      toolNameByCallId,
    });
    if (toolFrame === undefined) {
      continue;
    }
    blocks.push(
      toolConversationBlock({
        threadId,
        agentId,
        blockId: String(toolFrame.blockId),
        kind: toolFrame.type === "tool_call" ? "tool_call" : "tool_result",
        toolName: String(toolFrame.toolName),
        callId: String(toolFrame.callId),
        body: String(toolFrame.body ?? ""),
        data:
          toolFrame.type === "tool_call"
            ? { arguments: toolFrame.arguments }
            : { ok: true, output: toolFrame.output },
        timestamp,
      }),
    );
  }
  return blocks;
}

export function rebuildClaudeConversation(
  text: string,
  threadId: string,
  sessionId: string,
  agentId: AgentId,
): AgentSessionBlock[] {
  const blocks: AgentSessionBlock[] = [];
  const lines = text.split(/\r?\n/);
  const timestamp = new Date().toISOString();
  const toolNameByCallId = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const record = parseJsonObject(lines[index]);
    const isUser = record?.type === "user";
    if (!isUser && record?.type !== "assistant") {
      continue;
    }
    const message = recordField(record, "message");
    if (message?.role !== (isUser ? "user" : "assistant")) {
      continue;
    }
    const blockId = `provider:${threadId}:${sessionId}:${index}`;
    const body = isUser ? joinTextContent(message.content) : claudeAssistantTextContent(message.content);
    if (body !== undefined && body.length > 0) {
      blocks.push(conversationBlock({ threadId, sessionId, index, agentId, isUser, body, timestamp }));
    }
    if (isUser) {
      for (const result of claudeToolResultItems(message.content)) {
        blocks.push(
          toolConversationBlock({
            threadId,
            agentId,
            blockId: `${blockId}:${result.callId}`,
            kind: "tool_result",
            toolName: toolNameByCallId.get(result.callId) ?? "tool",
            callId: result.callId,
            body: boundedToolText(result.output),
            data: { ok: true, output: result.output },
            timestamp,
          }),
        );
      }
      continue;
    }
    for (const tool of claudeToolUseItems(message.content)) {
      toolNameByCallId.set(tool.callId, tool.toolName);
      blocks.push(
        toolConversationBlock({
          threadId,
          agentId,
          blockId: `${blockId}:${tool.callId}`,
          kind: "tool_call",
          toolName: tool.toolName,
          callId: tool.callId,
          body: boundedToolText(tool.argumentsText),
          data: { arguments: tool.argumentsText },
          timestamp,
        }),
      );
    }
  }
  return blocks;
}

// Extracts plain text from a provider message `content` (string or content-part array).
function joinTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts = content
    .map((item) => {
      const record = unknownRecord(item);
      return record ? (stringField(record, "text") ?? stringField(record, "input_text")) : undefined;
    })
    .filter((value): value is string => typeof value === "string");
  return parts.length > 0 ? parts.join("") : undefined;
}

export function threadStorageRecordFromThreadSummary(
  thread: ThreadSummaryDto,
): ThreadStorageRecord {
  const providerSessionRef = thread.agentBinding.providerSessionRef;
  const cwd = thread.scope.kind === "project" ? thread.scope.cwd : thread.scope.scratchCwd;

  return {
    storageVersion: THREAD_STORAGE_VERSION,
    threadId: thread.threadId,
    title: thread.title,
    pinned: thread.pinned,
    archived: thread.archived,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    agentBinding: {
      agentId: thread.agentBinding.agentId,
      runtimeSource: thread.agentBinding.runtimeSource,
      providerSessionRef:
        providerSessionRef === undefined
          ? undefined
          : {
              kind: providerSessionRef.kind,
              value: providerSessionRef.value,
              transcriptPath: providerSessionRef.transcriptPath,
              logPath: providerSessionRef.logPath,
            },
    },
    scope: { ...thread.scope },
    launchOptions: cloneLaunchOptions(thread.launchOptions),
    executionContext: { cwd },
    providerSessionRef:
      providerSessionRef === undefined
        ? undefined
        : {
            agentId: thread.agentBinding.agentId,
            kind: providerSessionRef.kind,
            value: providerSessionRef.value,
            transcriptPath: providerSessionRef.transcriptPath,
            logPath: providerSessionRef.logPath,
            observedAt: thread.updatedAt,
          },
    lastKnownState: thread.archived ? "archived" : thread.lastKnownState,
  };
}

function liveClock(): string {
  return new Date().toISOString();
}

function cloneLaunchOptions(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return launchOptions === undefined ? undefined : { ...launchOptions };
}

export function readCodexProviderStateFromHome(
  homeDir: string,
  cwd: string,
): CodexProviderState {
  const realCodexHome = join(homeDir, ".codex");
  const bootstrapArtifacts = providerBootstrapArtifactsForHome({ homeDir });
  const auth = readJsonFile(join(realCodexHome, "auth.json"));
  const configPath = join(realCodexHome, "config.toml");
  const config = readTextFile(configPath);

  return {
    authenticated: hasCodexAuth(auth),
    onboardingComplete: config !== undefined,
    trustedCwds: config === undefined ? [] : codexTrustedCwds(config),
    hookBootstrapReady: isCodexBootstrapReady(bootstrapArtifacts),
    codexHome: bootstrapArtifacts.codexHome,
  };
}

export function readClaudeProviderStateFromHome(
  homeDir: string,
  cwd: string,
): ClaudeProviderState {
  const state = readJsonFile(join(homeDir, ".claude.json"));
  const projects = recordField(state, "projects");
  const project = recordField(projects, cwd);

  return {
    authenticated: Boolean(recordField(state, "oauthAccount") ?? stringField(state, "userID")),
    onboardingComplete: state?.hasCompletedOnboarding === true,
    trustedCwds: project?.hasTrustDialogAccepted === true ? [cwd] : [],
    hookBootstrapReady: isClaudeBootstrapReady(
      providerBootstrapArtifactsForHome({ homeDir }),
    ),
  };
}

export function readAntigravityProviderStateFromHome(
  homeDir: string,
  cwd: string,
): AntigravityProviderState {
  const oauth = readJsonFile(join(homeDir, ".gemini", "oauth_creds.json"));
  const accounts = readJsonFile(join(homeDir, ".gemini", "google_accounts.json"));
  const onboarding = readJsonFile(join(homeDir, ".gemini", "antigravity-cli", "cache", "onboarding.json"));
  const settings = readJsonFile(join(homeDir, ".gemini", "antigravity-cli", "settings.json"));
  const trustedWorkspaces = arrayOfStrings(settings?.trustedWorkspaces);

  return {
    authenticated: oauth !== undefined || accounts !== undefined,
    onboardingComplete: onboarding?.onboardingComplete === true,
    trustedCwds: trustedWorkspaces,
    pluginBootstrapReady: isAntigravityPluginBootstrapReady(
      providerBootstrapArtifactsForHome({ homeDir }),
    ),
  };
}

export function createLiveAgentSessionEventProjector(input: {
  service: () => ThreadRuntimeService;
  persistence: ThreadPersistenceService;
  onEvent?: (event: BackendEventEnvelope) => void;
  homeDir: string;
  integrations: AgentIntegrationRegistry;
  providerSignalSpoolDir: string;
}) {
  const reader = createFixtureAgentSessionReader();
  const blocksByThread = new Map<string, AgentSessionBlock[]>();
  const providerSignalsByRuntime = new Map<
    string,
    { seenKeys: Set<string>; pollingStarted: boolean }
  >();
  const antigravityHistoryByRuntime = new Map<
    string,
    { sinceMs: number; seenKeys: Set<string>; pollingStarted: boolean }
  >();
  const codexHistoryByRuntime = new Map<
    string,
    { sinceMs: number; seenKeys: Set<string>; pollingStarted: boolean }
  >();
  const claudeHistoryByRuntime = new Map<
    string,
    { sinceMs: number; seenKeys: Set<string>; pollingStarted: boolean }
  >();
  const providerSessionRefsByRuntime = new Map<
    string,
    { sinceMs: number; seenKeys: Set<string>; pollingStarted: boolean }
  >();

  const emitProviderSignals = async (frameInput: {
    threadId: string;
    agentId: "codex" | "claude" | "antigravity";
    runtimeId: string;
  }): Promise<void> => {
    const signalState =
      providerSignalsByRuntime.get(frameInput.runtimeId) ??
      { seenKeys: new Set<string>(), pollingStarted: false };
    providerSignalsByRuntime.set(frameInput.runtimeId, signalState);
    const signalFrames = readProviderSignalFramesFromSpool({
      spoolDir: input.providerSignalSpoolDir,
      threadId: frameInput.threadId,
      agentId: frameInput.agentId,
      runtimeId: frameInput.runtimeId,
      seenKeys: signalState.seenKeys,
    });
    if (signalFrames.length === 0) {
      return;
    }

    const service = input.service();
    const hydrated = await service.hydrateThread({ threadId: frameInput.threadId });
    if (!hydrated.ok) {
      return;
    }
    const nextBlocks = new Map(
      (blocksByThread.get(frameInput.threadId) ?? []).map((block) => [
        block.blockId,
        block,
      ]),
    );

    for (const signalFrame of signalFrames) {
      const providerSessionRef = providerSessionRefFromProviderSignalPayload(
        frameInput.agentId,
        signalFrame.payload,
      );
      if (providerSessionRef !== undefined) {
        await recordDiscoveredProviderSessionRef({
          service,
          persistence: input.persistence,
          threadId: frameInput.threadId,
          providerSessionRef,
        });
      }
      const promptState = input.integrations[frameInput.agentId].detectPromptState({
        threadId: frameInput.threadId,
        source: "provider_hook",
        eventName: signalFrame.eventName,
        payload: signalFrame.payload,
      });
      const payload = promptStatePayload(promptState) ?? {
        type: "provider_signal",
        eventName: signalFrame.eventName,
        payload: signalFrame.payload,
      };
      const frame = await service.appendRawAgentFrame({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        source: "hook_payload",
        sourceRef: signalFrame.sourceRef,
        payloadKind: "json",
        payload,
        body: JSON.stringify(signalFrame.payload),
      });
      const readResult = reader.read({
        thread: hydrated.thread,
        agentBinding: hydrated.thread.agentBinding,
        frames: [frame],
        existingBlocks: [...nextBlocks.values()],
      });
      for (const update of readResult.blockUpdates) {
        emitBlockUpdate({
          update,
          blocks: nextBlocks,
          onEvent: input.onEvent,
        });
      }
      await emitPromptState({
        promptState: readResult.promptState ?? promptState ?? undefined,
        service,
        onEvent: input.onEvent,
      });
      if (TURN_END_SIGNAL_EVENTS.has(signalFrame.eventName)) {
        await emitTurnComplete({
          threadId: frameInput.threadId,
          service,
          onEvent: input.onEvent,
        });
      }
    }
    blocksByThread.set(frameInput.threadId, [...nextBlocks.values()]);
  };

  const scheduleProviderSignalPolling = (frameInput: {
    threadId: string;
    agentId: "codex" | "claude" | "antigravity";
    runtimeId: string;
  }): void => {
    const signalState =
      providerSignalsByRuntime.get(frameInput.runtimeId) ??
      { seenKeys: new Set<string>(), pollingStarted: false };
    providerSignalsByRuntime.set(frameInput.runtimeId, signalState);
    if (signalState.pollingStarted) {
      return;
    }

    signalState.pollingStarted = true;
    let remainingPolls = 90;
    const poll = (): void => {
      if (remainingPolls <= 0) {
        return;
      }
      remainingPolls -= 1;
      void emitProviderSignals(frameInput).finally(() => {
        const timer = setTimeout(poll, 500);
        timer.unref?.();
      });
    };
    const timer = setTimeout(poll, 0);
    timer.unref?.();
  };

  const emitProviderSessionRefs = async (frameInput: {
    threadId: string;
    agentId: "codex" | "claude" | "antigravity";
    runtimeId: string;
  }): Promise<void> => {
    if (frameInput.agentId === "antigravity") {
      return;
    }

    const service = input.service();
    const hydrated = await service.hydrateThread({ threadId: frameInput.threadId });
    if (!hydrated.ok) {
      return;
    }
    const expectedUserMessage = latestUserMessageForProviderHistory(hydrated.thread);
    if (expectedUserMessage === undefined) {
      return;
    }
    const refState =
      providerSessionRefsByRuntime.get(frameInput.runtimeId) ??
      {
        sinceMs: Date.now() - 15_000,
        seenKeys: new Set<string>(),
        pollingStarted: false,
      };
    providerSessionRefsByRuntime.set(frameInput.runtimeId, refState);

    const providerSessionRefs =
      frameInput.agentId === "codex"
        ? readCodexProviderSessionRefsFromHome({
            homeDir: input.homeDir,
            sinceMs: refState.sinceMs,
            seenKeys: refState.seenKeys,
            expectedUserMessage,
          })
        : readClaudeProviderSessionRefsFromHome({
            homeDir: input.homeDir,
            sinceMs: refState.sinceMs,
            seenKeys: refState.seenKeys,
            expectedUserMessage,
          });

    for (const providerSessionRef of providerSessionRefs) {
      await recordDiscoveredProviderSessionRef({
        service,
        persistence: input.persistence,
        threadId: frameInput.threadId,
        providerSessionRef,
      });
    }
  };

  const scheduleProviderSessionRefPolling = (frameInput: {
    threadId: string;
    agentId: "codex" | "claude" | "antigravity";
    runtimeId: string;
  }): void => {
    if (frameInput.agentId === "antigravity") {
      return;
    }

    const refState =
      providerSessionRefsByRuntime.get(frameInput.runtimeId) ??
      {
        sinceMs: Date.now() - 15_000,
        seenKeys: new Set<string>(),
        pollingStarted: false,
      };
    providerSessionRefsByRuntime.set(frameInput.runtimeId, refState);
    if (refState.pollingStarted) {
      return;
    }

    refState.pollingStarted = true;
    let remainingPolls = 45;
    const poll = (): void => {
      if (remainingPolls <= 0) {
        return;
      }
      remainingPolls -= 1;
      void emitProviderSessionRefs(frameInput).finally(() => {
        const timer = setTimeout(poll, 1000);
        timer.unref?.();
      });
    };
    const timer = setTimeout(poll, 1000);
    timer.unref?.();
  };

  const emitCodexHistory = async (frameInput: {
    threadId: string;
    agentId: "codex";
    runtimeId: string;
  }): Promise<void> => {
    const service = input.service();
    const hydrated = await service.hydrateThread({ threadId: frameInput.threadId });
    if (!hydrated.ok) {
      return;
    }
    const expectedUserMessage = latestUserMessageForProviderHistory(hydrated.thread);
    if (expectedUserMessage === undefined) {
      return;
    }

    const historyState =
      codexHistoryByRuntime.get(frameInput.runtimeId) ??
      {
        sinceMs: Date.now() - 15_000,
        seenKeys: new Set<string>(),
        pollingStarted: false,
      };
    codexHistoryByRuntime.set(frameInput.runtimeId, historyState);

    const historyFrames = readCodexProviderHistoryFramesFromHome({
      homeDir: input.homeDir,
      threadId: frameInput.threadId,
      runtimeId: frameInput.runtimeId,
      sinceMs: historyState.sinceMs,
      seenKeys: historyState.seenKeys,
      expectedUserMessage,
    });
    if (historyFrames.length === 0) {
      return;
    }

    const nextBlocks = new Map(
      (blocksByThread.get(frameInput.threadId) ?? []).map((block) => [
        block.blockId,
        block,
      ]),
    );
    for (const historyFrame of historyFrames) {
      await recordDiscoveredProviderSessionRef({
        service,
        persistence: input.persistence,
        threadId: frameInput.threadId,
        providerSessionRef: codexProviderSessionRefFromRolloutPath(historyFrame.sourceRef),
      });
      const providerFrame = await service.appendRawAgentFrame({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        source: historyFrame.source,
        sourceRef: historyFrame.sourceRef,
        payloadKind: historyFrame.payloadKind,
        payload: historyFrame.payload,
        body: historyFrame.body,
      });
      const providerReadResult = reader.read({
        thread: hydrated.thread,
        agentBinding: hydrated.thread.agentBinding,
        frames: [providerFrame],
        existingBlocks: [...nextBlocks.values()],
      });
      for (const update of providerReadResult.blockUpdates) {
        await recordBlockUpdateInThreadCache(input.persistence, service, update);
        emitBlockUpdate({
          update,
          blocks: nextBlocks,
          onEvent: input.onEvent,
        });
      }
      await emitPromptState({
        promptState: providerReadResult.promptState,
        service,
        onEvent: input.onEvent,
      });
    }
    blocksByThread.set(frameInput.threadId, [...nextBlocks.values()]);
  };

  const scheduleCodexHistoryPolling = (frameInput: {
    threadId: string;
    agentId: "codex";
    runtimeId: string;
  }): void => {
    const historyState =
      codexHistoryByRuntime.get(frameInput.runtimeId) ??
      {
        sinceMs: Date.now() - 15_000,
        seenKeys: new Set<string>(),
        pollingStarted: false,
      };
    codexHistoryByRuntime.set(frameInput.runtimeId, historyState);
    if (historyState.pollingStarted) {
      return;
    }

    historyState.pollingStarted = true;
    let remainingPolls = 45;
    const poll = (): void => {
      if (remainingPolls <= 0) {
        return;
      }
      remainingPolls -= 1;
      void emitCodexHistory(frameInput).finally(() => {
        const timer = setTimeout(poll, 1000);
        timer.unref?.();
      });
    };
    const timer = setTimeout(poll, 1000);
    timer.unref?.();
  };

  const emitClaudeHistory = async (frameInput: {
    threadId: string;
    agentId: "claude";
    runtimeId: string;
  }): Promise<void> => {
    const service = input.service();
    const hydrated = await service.hydrateThread({ threadId: frameInput.threadId });
    if (!hydrated.ok) {
      return;
    }
    const expectedUserMessage = latestUserMessageForProviderHistory(hydrated.thread);
    if (expectedUserMessage === undefined) {
      return;
    }

    const historyState =
      claudeHistoryByRuntime.get(frameInput.runtimeId) ??
      {
        sinceMs: Date.now() - 15_000,
        seenKeys: new Set<string>(),
        pollingStarted: false,
      };
    claudeHistoryByRuntime.set(frameInput.runtimeId, historyState);

    const historyFrames = readClaudeProviderHistoryFramesFromHome({
      homeDir: input.homeDir,
      threadId: frameInput.threadId,
      runtimeId: frameInput.runtimeId,
      sinceMs: historyState.sinceMs,
      seenKeys: historyState.seenKeys,
      expectedUserMessage,
    });
    if (historyFrames.length === 0) {
      return;
    }

    const nextBlocks = new Map(
      (blocksByThread.get(frameInput.threadId) ?? []).map((block) => [
        block.blockId,
        block,
      ]),
    );
    for (const historyFrame of historyFrames) {
      await recordDiscoveredProviderSessionRef({
        service,
        persistence: input.persistence,
        threadId: frameInput.threadId,
        providerSessionRef:
          claudeProviderSessionRefFromTranscriptPath(historyFrame.sourceRef),
      });
      const providerFrame = await service.appendRawAgentFrame({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        source: historyFrame.source,
        sourceRef: historyFrame.sourceRef,
        payloadKind: historyFrame.payloadKind,
        payload: historyFrame.payload,
        body: historyFrame.body,
      });
      const providerReadResult = reader.read({
        thread: hydrated.thread,
        agentBinding: hydrated.thread.agentBinding,
        frames: [providerFrame],
        existingBlocks: [...nextBlocks.values()],
      });
      for (const update of providerReadResult.blockUpdates) {
        await recordBlockUpdateInThreadCache(input.persistence, service, update);
        emitBlockUpdate({
          update,
          blocks: nextBlocks,
          onEvent: input.onEvent,
        });
      }
      await emitPromptState({
        promptState: providerReadResult.promptState,
        service,
        onEvent: input.onEvent,
      });
    }
    blocksByThread.set(frameInput.threadId, [...nextBlocks.values()]);
  };

  const scheduleClaudeHistoryPolling = (frameInput: {
    threadId: string;
    agentId: "claude";
    runtimeId: string;
  }): void => {
    const historyState =
      claudeHistoryByRuntime.get(frameInput.runtimeId) ??
      {
        sinceMs: Date.now() - 15_000,
        seenKeys: new Set<string>(),
        pollingStarted: false,
      };
    claudeHistoryByRuntime.set(frameInput.runtimeId, historyState);
    if (historyState.pollingStarted) {
      return;
    }

    historyState.pollingStarted = true;
    let remainingPolls = 45;
    const poll = (): void => {
      if (remainingPolls <= 0) {
        return;
      }
      remainingPolls -= 1;
      void emitClaudeHistory(frameInput).finally(() => {
        const timer = setTimeout(poll, 1000);
        timer.unref?.();
      });
    };
    const timer = setTimeout(poll, 1000);
    timer.unref?.();
  };

  const emitAntigravityHistory = async (frameInput: {
    threadId: string;
    agentId: "antigravity";
    runtimeId: string;
  }): Promise<void> => {
    const service = input.service();
    const hydrated = await service.hydrateThread({ threadId: frameInput.threadId });
    if (!hydrated.ok) {
      return;
    }

    const historyState =
      antigravityHistoryByRuntime.get(frameInput.runtimeId) ??
      {
        sinceMs: Date.now() - 15_000,
        seenKeys: new Set<string>(),
        pollingStarted: false,
      };
    antigravityHistoryByRuntime.set(frameInput.runtimeId, historyState);

    const historyFrames = readAntigravityProviderHistoryFramesFromHome({
      homeDir: input.homeDir,
      threadId: frameInput.threadId,
      runtimeId: frameInput.runtimeId,
      sinceMs: historyState.sinceMs,
      seenKeys: historyState.seenKeys,
    });
    if (historyFrames.length === 0) {
      return;
    }

    const nextBlocks = new Map(
      (blocksByThread.get(frameInput.threadId) ?? []).map((block) => [
        block.blockId,
        block,
      ]),
    );
    for (const historyFrame of historyFrames) {
      await recordDiscoveredProviderSessionRef({
        service,
        persistence: input.persistence,
        threadId: frameInput.threadId,
        providerSessionRef:
          antigravityProviderSessionRefFromTranscriptPath(historyFrame.sourceRef),
      });
      const providerFrame = await service.appendRawAgentFrame({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        source: historyFrame.source,
        sourceRef: historyFrame.sourceRef,
        payloadKind: historyFrame.payloadKind,
        payload: historyFrame.payload,
        body: historyFrame.body,
      });
      const providerReadResult = reader.read({
        thread: hydrated.thread,
        agentBinding: hydrated.thread.agentBinding,
        frames: [providerFrame],
        existingBlocks: [...nextBlocks.values()],
      });
      for (const update of providerReadResult.blockUpdates) {
        await recordBlockUpdateInThreadCache(input.persistence, service, update);
        emitBlockUpdate({
          update,
          blocks: nextBlocks,
          onEvent: input.onEvent,
        });
      }
      await emitPromptState({
        promptState: providerReadResult.promptState,
        service,
        onEvent: input.onEvent,
      });
    }
    blocksByThread.set(frameInput.threadId, [...nextBlocks.values()]);
  };

  const scheduleAntigravityHistoryPolling = (frameInput: {
    threadId: string;
    agentId: "antigravity";
    runtimeId: string;
  }): void => {
    const historyState =
      antigravityHistoryByRuntime.get(frameInput.runtimeId) ??
      {
        sinceMs: Date.now() - 15_000,
        seenKeys: new Set<string>(),
        pollingStarted: false,
      };
    antigravityHistoryByRuntime.set(frameInput.runtimeId, historyState);
    if (historyState.pollingStarted) {
      return;
    }

    historyState.pollingStarted = true;
    let remainingPolls = 45;
    const poll = (): void => {
      if (remainingPolls <= 0) {
        return;
      }
      remainingPolls -= 1;
      void emitAntigravityHistory(frameInput).finally(() => {
        const timer = setTimeout(poll, 1000);
        timer.unref?.();
      });
    };
    const timer = setTimeout(poll, 1000);
    timer.unref?.();
  };

  const appendFrameAndEmit = async (frameInput: {
    threadId: string;
    agentId: RawAgentFrame["agentId"];
    source: RawAgentFrame["source"];
    sourceRef?: string;
    payloadKind?: RawAgentFrame["payloadKind"];
    payload?: unknown;
    body?: string;
  }): Promise<void> => {
    const service = input.service();
    const frame = await service.appendRawAgentFrame({
      threadId: frameInput.threadId,
      agentId: frameInput.agentId,
      source: frameInput.source,
      sourceRef: frameInput.sourceRef,
      payloadKind: frameInput.payloadKind,
      payload: frameInput.payload,
      body: frameInput.body,
    });
    const hydrated = await service.hydrateThread({ threadId: frameInput.threadId });
    if (!hydrated.ok) {
      return;
    }

    const existingBlocks = blocksByThread.get(frameInput.threadId) ?? [];
    const readResult = reader.read({
      thread: hydrated.thread,
      agentBinding: hydrated.thread.agentBinding,
      frames: [frame],
      existingBlocks,
    });

    const nextBlocks = new Map(existingBlocks.map((block) => [block.blockId, block]));
    for (const update of readResult.blockUpdates) {
      emitBlockUpdate({
        update,
        blocks: nextBlocks,
        onEvent: input.onEvent,
      });
      await recordBlockUpdateInThreadCache(input.persistence, service, update);
    }
    blocksByThread.set(frameInput.threadId, [...nextBlocks.values()]);
    await emitPromptState({
      promptState: readResult.promptState,
      service,
      onEvent: input.onEvent,
    });
  };

  return {
    trackRuntime(runtime: {
      threadId: string;
      agentId: "codex" | "claude" | "antigravity";
      runtimeId: string;
    }): void {
      scheduleProviderSignalPolling(runtime);
      scheduleProviderSessionRefPolling(runtime);
      if (runtime.agentId === "codex") {
        scheduleCodexHistoryPolling({
          threadId: runtime.threadId,
          agentId: "codex",
          runtimeId: runtime.runtimeId,
        });
      }
      if (runtime.agentId === "claude") {
        scheduleClaudeHistoryPolling({
          threadId: runtime.threadId,
          agentId: "claude",
          runtimeId: runtime.runtimeId,
        });
      }
    },
    async ingestOutput(frameInput: {
      threadId: string;
      agentId: "codex" | "claude" | "antigravity";
      runtimeId: string;
      source: "stdout" | "stderr";
      body: string;
    }): Promise<void> {
      await appendFrameAndEmit({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        source: "pty_transcript",
        sourceRef: frameInput.runtimeId,
        payloadKind: "ansi_text",
        payload: { stream: frameInput.source },
        body: frameInput.body,
      });
      await emitProviderSignals({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        runtimeId: frameInput.runtimeId,
      });
      scheduleProviderSignalPolling({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        runtimeId: frameInput.runtimeId,
      });
      await emitProviderSessionRefs({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        runtimeId: frameInput.runtimeId,
      });
      scheduleProviderSessionRefPolling({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        runtimeId: frameInput.runtimeId,
      });

      if (frameInput.agentId === "codex") {
        await emitCodexHistory({
          threadId: frameInput.threadId,
          agentId: frameInput.agentId,
          runtimeId: frameInput.runtimeId,
        });
        scheduleCodexHistoryPolling({
          threadId: frameInput.threadId,
          agentId: frameInput.agentId,
          runtimeId: frameInput.runtimeId,
        });
        return;
      }

      if (frameInput.agentId === "claude") {
        await emitClaudeHistory({
          threadId: frameInput.threadId,
          agentId: frameInput.agentId,
          runtimeId: frameInput.runtimeId,
        });
        scheduleClaudeHistoryPolling({
          threadId: frameInput.threadId,
          agentId: frameInput.agentId,
          runtimeId: frameInput.runtimeId,
        });
        return;
      }

      if (frameInput.agentId !== "antigravity") {
        return;
      }

      await emitAntigravityHistory({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        runtimeId: frameInput.runtimeId,
      });
      scheduleAntigravityHistoryPolling({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        runtimeId: frameInput.runtimeId,
      });
    },
    async ingestStructuredFrame(frameInput: {
      threadId: string;
      agentId: "openai_api";
      source: "structured_batch";
      sourceRef?: string;
      payloadKind: "json";
      payload: Record<string, unknown>;
      body: string;
    }): Promise<void> {
      await appendFrameAndEmit(frameInput);
    },
  };
}

export interface AntigravityProviderHistoryFrame {
  source: "provider_history";
  sourceRef: string;
  payloadKind: "provider_record";
  payload: Record<string, unknown>;
  body: string;
}

export interface CodexProviderHistoryFrame {
  source: "provider_history";
  sourceRef: string;
  payloadKind: "provider_record";
  payload: Record<string, unknown>;
  body: string;
}

export interface ClaudeProviderHistoryFrame {
  source: "provider_history";
  sourceRef: string;
  payloadKind: "provider_record";
  payload: Record<string, unknown>;
  body: string;
}

export interface ProviderSignalSpoolFrame {
  source: "hook_payload";
  sourceRef: string;
  eventName: string;
  payload: unknown;
}

export type DiscoveredProviderSessionRef = Omit<
  ProviderSessionRefRecord,
  "observedAt"
>;

export function antigravityProviderSessionRefFromTranscriptPath(
  transcriptPath: string,
): DiscoveredProviderSessionRef {
  return {
    agentId: "antigravity",
    kind: "antigravity_conversation",
    value: antigravityConversationIdFromTranscriptPath(transcriptPath),
    transcriptPath,
  };
}

export function codexProviderSessionRefFromRolloutPath(
  rolloutPath: string,
): DiscoveredProviderSessionRef {
  return {
    agentId: "codex",
    kind: "codex_rollout",
    value: codexSessionIdFromRolloutPath(rolloutPath),
    transcriptPath: rolloutPath,
  };
}

export function claudeProviderSessionRefFromTranscriptPath(
  transcriptPath: string,
): DiscoveredProviderSessionRef {
  return {
    agentId: "claude",
    kind: "claude_transcript",
    value: claudeSessionIdFromTranscriptPath(transcriptPath),
    transcriptPath,
  };
}

export function providerSessionRefFromProviderSignalPayload(
  agentId: "codex" | "claude" | "antigravity",
  payload: unknown,
): DiscoveredProviderSessionRef | undefined {
  const record = unknownRecord(payload);
  if (record === undefined) {
    return undefined;
  }

  const transcriptPath =
    stringField(record, "transcript_path") ?? stringField(record, "transcriptPath");
  if (agentId === "codex") {
    const sessionId =
      stringField(record, "session_id") ??
      stringField(record, "sessionId") ??
      (transcriptPath === undefined
        ? undefined
        : codexSessionIdFromRolloutPath(transcriptPath));
    return sessionId === undefined
      ? undefined
      : {
          agentId: "codex",
          kind: "codex_rollout",
          value: sessionId,
          transcriptPath,
        };
  }

  if (agentId === "claude") {
    const sessionId =
      stringField(record, "session_id") ??
      stringField(record, "sessionId") ??
      (transcriptPath === undefined
        ? undefined
        : claudeSessionIdFromTranscriptPath(transcriptPath));
    return sessionId === undefined
      ? undefined
      : {
          agentId: "claude",
          kind: "claude_transcript",
          value: sessionId,
          transcriptPath,
        };
  }

  const conversationId =
    stringField(record, "conversationId") ??
    stringField(record, "conversation_id") ??
    (transcriptPath === undefined
      ? undefined
      : antigravityConversationIdFromTranscriptPath(transcriptPath));
  return conversationId === undefined
    ? undefined
    : {
        agentId: "antigravity",
        kind: "antigravity_conversation",
        value: conversationId,
        transcriptPath,
      };
}

export function readCodexProviderSessionRefsFromHome(input: {
  homeDir: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
}): DiscoveredProviderSessionRef[] {
  const providerSessionRefs: DiscoveredProviderSessionRef[] = [];
  for (const rolloutPath of recentCodexRollouts(input.homeDir, input.sinceMs)) {
    if (
      input.expectedUserMessage !== undefined &&
      !codexRolloutContainsUserMessage(rolloutPath, input.expectedUserMessage)
    ) {
      continue;
    }
    const frameKey = `codex:${rolloutPath}`;
    if (input.seenKeys.has(frameKey)) {
      continue;
    }
    input.seenKeys.add(frameKey);
    providerSessionRefs.push(codexProviderSessionRefFromRolloutPath(rolloutPath));
  }
  return providerSessionRefs;
}

export function readClaudeProviderSessionRefsFromHome(input: {
  homeDir: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
}): DiscoveredProviderSessionRef[] {
  const providerSessionRefs: DiscoveredProviderSessionRef[] = [];
  for (const transcriptPath of recentClaudeTranscripts(input.homeDir, input.sinceMs)) {
    if (
      input.expectedUserMessage !== undefined &&
      !claudeTranscriptContainsUserMessage(
        transcriptPath,
        input.expectedUserMessage,
      )
    ) {
      continue;
    }
    const frameKey = `claude:${transcriptPath}`;
    if (input.seenKeys.has(frameKey)) {
      continue;
    }
    input.seenKeys.add(frameKey);
    providerSessionRefs.push(
      claudeProviderSessionRefFromTranscriptPath(transcriptPath),
    );
  }
  return providerSessionRefs;
}

export function readCodexProviderHistoryFramesFromHome(input: {
  homeDir: string;
  threadId: string;
  runtimeId: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
}): CodexProviderHistoryFrame[] {
  const frames: CodexProviderHistoryFrame[] = [];
  for (const rolloutPath of recentCodexRollouts(input.homeDir, input.sinceMs)) {
    if (
      input.expectedUserMessage !== undefined &&
      !codexRolloutContainsUserMessage(rolloutPath, input.expectedUserMessage)
    ) {
      continue;
    }
    const sessionId = codexSessionIdFromRolloutPath(rolloutPath);
    const rolloutText = readBoundedTail(rolloutPath, 256 * 1024);
    if (rolloutText === undefined) {
      continue;
    }

    const lines = rolloutText.split(/\r?\n/);
    // Only the reply to the CURRENT turn: emit agent messages that come after the
    // latest occurrence of the expected user message. A codex rollout accumulates
    // the whole session, so without this gate prior turns' replies leak in.
    let latestUserIndex = -1;
    if (input.expectedUserMessage !== undefined) {
      for (let i = 0; i < lines.length; i += 1) {
        const r = parseJsonObject(lines[i]);
        const p = recordField(r, "payload");
        if (r?.type !== "event_msg" || p?.type !== "user_message") {
          continue;
        }
        const content = p.content;
        if (
          stringField(p, "message") === input.expectedUserMessage ||
          (Array.isArray(content) &&
            content.some((item) => inputTextContentEquals(item, input.expectedUserMessage ?? "")))
        ) {
          latestUserIndex = i;
        }
      }
    }
    // Tool calls carry their name on the `function_call`/`custom_tool_call`
    // line; the matching `*_output` line only has the call_id. Track names so a
    // result block can show the same provider-native tool name as its call.
    const toolNameByCallId = new Map<string, string>();
    const pushFrame = (index: number, payload: Record<string, unknown>, body: string): void => {
      const frameKey = `${rolloutPath}:${index}:${payload.type}`;
      if (input.seenKeys.has(frameKey)) {
        return;
      }
      input.seenKeys.add(frameKey);
      frames.push({
        source: "provider_history",
        sourceRef: rolloutPath,
        payloadKind: "provider_record",
        payload,
        body,
      });
    };
    for (let index = 0; index < lines.length; index += 1) {
      if (input.expectedUserMessage !== undefined && index <= latestUserIndex) {
        continue;
      }
      const record = parseJsonObject(lines[index]);
      const payload = recordField(record, "payload");
      if (record?.type === "event_msg") {
        if (payload?.type !== "agent_message") {
          continue;
        }
        const message = stringField(payload, "message");
        if (message === undefined) {
          continue;
        }
        pushFrame(
          index,
          {
            type: "message",
            role: "agent",
            status: "complete",
            blockId: `provider:${input.threadId}:${sessionId}:${index}`,
            body: message,
            sourceRuntimeId: input.runtimeId,
          },
          message,
        );
        continue;
      }
      if (record?.type !== "response_item" || payload === undefined) {
        continue;
      }
      const toolFrame = codexToolFramePayload({
        payload,
        threadId: input.threadId,
        sessionId,
        index,
        runtimeId: input.runtimeId,
        toolNameByCallId,
      });
      if (toolFrame !== undefined) {
        pushFrame(index, toolFrame, String(toolFrame.body ?? ""));
      }
    }
  }
  return frames;
}

// Maps a codex rollout `response_item` tool payload to a tool_call/tool_result
// frame payload that the Agent Session reader turns into a tool block. Returns
// undefined for non-tool response items (reasoning, output_text, etc.).
function codexToolFramePayload(input: {
  payload: Record<string, unknown>;
  threadId: string;
  sessionId: string;
  index: number;
  runtimeId: string;
  toolNameByCallId: Map<string, string>;
}): Record<string, unknown> | undefined {
  const { payload } = input;
  const type = stringField(payload, "type");
  const callId = stringField(payload, "call_id");
  const blockId = `provider:${input.threadId}:${input.sessionId}:${input.index}`;
  const base = {
    blockId,
    callId: callId ?? blockId,
    status: "complete",
    sourceRuntimeId: input.runtimeId,
  };
  if (type === "function_call" || type === "custom_tool_call") {
    const toolName = stringField(payload, "name") ?? "tool";
    if (callId !== undefined) {
      input.toolNameByCallId.set(callId, toolName);
    }
    // function_call carries a JSON `arguments` string; custom_tool_call an `input`.
    const args = stringField(payload, "arguments") ?? stringField(payload, "input") ?? "";
    return {
      type: "tool_call",
      toolName,
      arguments: args,
      body: boundedToolText(args),
      ...base,
    };
  }
  if (type === "function_call_output" || type === "custom_tool_call_output") {
    const toolName = (callId !== undefined ? input.toolNameByCallId.get(callId) : undefined) ?? "tool";
    const output = codexToolOutputText(payload.output);
    return {
      type: "tool_result",
      toolName,
      ok: true,
      output,
      body: boundedToolText(output),
      ...base,
    };
  }
  return undefined;
}

// codex tool output is usually a string, but some tools wrap it in
// `{ output: string }` or content parts; extract readable text either way.
function codexToolOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  const record = unknownRecord(output);
  if (record !== undefined) {
    return stringField(record, "output") ?? joinTextContent(record.content) ?? "";
  }
  return joinTextContent(output) ?? "";
}

// Tool args/output can be large (full file contents, long command output). Keep
// the rendered body bounded so the transcript stays readable and light.
function boundedToolText(text: string): string {
  const limit = 2000;
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more chars)` : text;
}

export function readClaudeProviderHistoryFramesFromHome(input: {
  homeDir: string;
  threadId: string;
  runtimeId: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
}): ClaudeProviderHistoryFrame[] {
  const frames: ClaudeProviderHistoryFrame[] = [];
  for (const transcriptPath of recentClaudeTranscripts(input.homeDir, input.sinceMs)) {
    if (
      input.expectedUserMessage !== undefined &&
      !claudeTranscriptContainsUserMessage(
        transcriptPath,
        input.expectedUserMessage,
      )
    ) {
      continue;
    }
    const sessionId = claudeSessionIdFromTranscriptPath(transcriptPath);
    const transcriptText = readBoundedTail(transcriptPath, 256 * 1024);
    if (transcriptText === undefined) {
      continue;
    }

    const lines = transcriptText.split(/\r?\n/);
    // Only the reply to the CURRENT turn: emit assistant messages after the latest
    // occurrence of the expected user message (the transcript holds the whole
    // session, so prior turns' replies would otherwise leak in).
    let latestUserIndex = -1;
    if (input.expectedUserMessage !== undefined) {
      for (let i = 0; i < lines.length; i += 1) {
        const r = parseJsonObject(lines[i]);
        if (r?.type !== "user") {
          continue;
        }
        const m = recordField(r, "message");
        if (m?.role !== "user") {
          continue;
        }
        const content = m.content;
        if (
          content === input.expectedUserMessage ||
          (Array.isArray(content) &&
            content.some((item) => inputTextContentEquals(item, input.expectedUserMessage ?? "")))
        ) {
          latestUserIndex = i;
        }
      }
    }
    const toolNameByCallId = new Map<string, string>();
    const pushFrame = (key: string, payload: Record<string, unknown>, body: string): void => {
      const frameKey = `${transcriptPath}:${key}`;
      if (input.seenKeys.has(frameKey)) {
        return;
      }
      input.seenKeys.add(frameKey);
      frames.push({
        source: "provider_history",
        sourceRef: transcriptPath,
        payloadKind: "provider_record",
        payload,
        body,
      });
    };
    for (let index = 0; index < lines.length; index += 1) {
      if (input.expectedUserMessage !== undefined && index <= latestUserIndex) {
        continue;
      }
      const record = parseJsonObject(lines[index]);
      const message = recordField(record, "message");
      const blockId = `provider:${input.threadId}:${sessionId}:${index}`;
      if (record?.type === "assistant" && message?.role === "assistant") {
        // Agent text becomes a message block; tool_use items become tool_call
        // blocks. Both come from the same assistant line, so disambiguate the
        // block ids by call id.
        const body = claudeAssistantTextContent(message.content);
        if (body !== undefined) {
          pushFrame(
            `${index}:assistant`,
            {
              type: "message",
              role: "agent",
              status: "complete",
              blockId,
              body,
              sourceRuntimeId: input.runtimeId,
            },
            body,
          );
        }
        for (const tool of claudeToolUseItems(message.content)) {
          toolNameByCallId.set(tool.callId, tool.toolName);
          pushFrame(
            `${index}:tool_use:${tool.callId}`,
            {
              type: "tool_call",
              toolName: tool.toolName,
              callId: tool.callId,
              arguments: tool.argumentsText,
              body: boundedToolText(tool.argumentsText),
              status: "complete",
              blockId: `${blockId}:${tool.callId}`,
              sourceRuntimeId: input.runtimeId,
            },
            boundedToolText(tool.argumentsText),
          );
        }
        continue;
      }
      if (record?.type === "user") {
        // Intermediate user turns carry tool_result content; render those as
        // tool_result blocks. Plain user prompts are added locally, not here.
        for (const result of claudeToolResultItems(message?.content)) {
          const toolName = toolNameByCallId.get(result.callId) ?? "tool";
          pushFrame(
            `${index}:tool_result:${result.callId}`,
            {
              type: "tool_result",
              toolName,
              callId: result.callId,
              ok: true,
              output: result.output,
              body: boundedToolText(result.output),
              status: "complete",
              blockId: `${blockId}:${result.callId}`,
              sourceRuntimeId: input.runtimeId,
            },
            boundedToolText(result.output),
          );
        }
      }
    }
  }
  return frames;
}

// Extracts claude `tool_use` content items (assistant message) as tool calls.
function claudeToolUseItems(
  content: unknown,
): { callId: string; toolName: string; argumentsText: string }[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const items: { callId: string; toolName: string; argumentsText: string }[] = [];
  for (const item of content) {
    const record = unknownRecord(item);
    if (record?.type !== "tool_use") {
      continue;
    }
    const callId = stringField(record, "id") ?? `tool:${items.length}`;
    const toolName = stringField(record, "name") ?? "tool";
    const input = record.input;
    const argumentsText =
      typeof input === "string" ? input : input === undefined ? "" : JSON.stringify(input);
    items.push({ callId, toolName, argumentsText });
  }
  return items;
}

// Extracts claude `tool_result` content items (intermediate user message).
function claudeToolResultItems(content: unknown): { callId: string; output: string }[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const items: { callId: string; output: string }[] = [];
  for (const item of content) {
    const record = unknownRecord(item);
    if (record?.type !== "tool_result") {
      continue;
    }
    const callId = stringField(record, "tool_use_id") ?? `tool:${items.length}`;
    const output =
      typeof record.content === "string"
        ? record.content
        : joinTextContent(record.content) ?? "";
    items.push({ callId, output });
  }
  return items;
}

export function readProviderSignalFramesFromSpool(input: {
  spoolDir: string;
  threadId: string;
  agentId: "codex" | "claude" | "antigravity";
  runtimeId: string;
  seenKeys: Set<string>;
}): ProviderSignalSpoolFrame[] {
  const spoolPath = join(input.spoolDir, `${input.runtimeId}.jsonl`);
  const spoolText = readBoundedTail(spoolPath, 128 * 1024);
  if (spoolText === undefined) {
    return [];
  }

  const frames: ProviderSignalSpoolFrame[] = [];
  const lines = spoolText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const record = parseJsonObject(lines[index]);
    if (record === undefined) {
      continue;
    }
    if (
      stringField(record, "threadId") !== input.threadId ||
      stringField(record, "runtimeId") !== input.runtimeId ||
      stringField(record, "agent") !== input.agentId
    ) {
      continue;
    }
    const eventName = stringField(record, "event");
    if (eventName === undefined) {
      continue;
    }
    const frameKey = `${spoolPath}:${index}`;
    if (input.seenKeys.has(frameKey)) {
      continue;
    }
    input.seenKeys.add(frameKey);
    frames.push({
      source: "hook_payload",
      sourceRef: spoolPath,
      eventName,
      payload: record.payload,
    });
  }
  return frames;
}

export function readAntigravityProviderHistoryFramesFromHome(input: {
  homeDir: string;
  threadId: string;
  runtimeId: string;
  sinceMs: number;
  seenKeys: Set<string>;
}): AntigravityProviderHistoryFrame[] {
  const frames: AntigravityProviderHistoryFrame[] = [];
  for (const transcriptPath of recentAntigravityTranscripts(input.homeDir, input.sinceMs)) {
    const conversationId = antigravityConversationIdFromTranscriptPath(transcriptPath);
    const transcriptText = readBoundedTail(transcriptPath, 128 * 1024);
    if (transcriptText === undefined) {
      continue;
    }

    // The live reader projects agent activity only (user prompts are added
    // locally with local provenance). Tool calls live on PLANNER_RESPONSE
    // entries; their results are the following typed MODEL entries.
    for (const item of antigravityConversationItems(transcriptText, { includeUser: false })) {
      const blockId = `provider:${input.threadId}:${conversationId}:${item.blockSuffix}`;
      const frameKey = `${transcriptPath}:${item.blockSuffix}`;
      if (input.seenKeys.has(frameKey)) {
        continue;
      }
      input.seenKeys.add(frameKey);
      const payload =
        item.kind === "message"
          ? {
              type: "message",
              role: "agent",
              status: "complete",
              blockId,
              body: item.body,
              sourceRuntimeId: input.runtimeId,
            }
          : {
              type: item.kind,
              toolName: item.toolName,
              callId: blockId,
              ...(item.kind === "tool_call" ? { arguments: item.body } : { ok: true, output: item.body }),
              body: item.body,
              status: "complete",
              blockId,
              sourceRuntimeId: input.runtimeId,
            };
      frames.push({
        source: "provider_history",
        sourceRef: transcriptPath,
        payloadKind: "provider_record",
        payload,
        body: item.body,
      });
    }
  }

  return frames;
}

interface AntigravityConversationItem {
  kind: "message" | "tool_call" | "tool_result";
  role: "user" | "agent";
  blockSuffix: string;
  toolName?: string;
  body: string;
}

// Walks an antigravity transcript into ordered conversation items. A
// PLANNER_RESPONSE (source MODEL) carries tool_calls (the call) and/or content
// (the agent's visible text); the following typed MODEL entry is the call's
// result. CONVERSATION_HISTORY/SYSTEM and reasoning (`thinking`) are skipped.
function antigravityConversationItems(
  text: string,
  options: { includeUser: boolean },
): AntigravityConversationItem[] {
  const items: AntigravityConversationItem[] = [];
  let pendingToolName: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record === undefined) {
      continue;
    }
    const type = stringField(record, "type");
    const source = stringField(record, "source");
    const step = numberField(record, "step_index") ?? items.length;

    if (type === "USER_INPUT") {
      const body = unwrapAntigravityUserRequest(stringField(record, "content"));
      if (options.includeUser && body.length > 0) {
        items.push({ kind: "message", role: "user", blockSuffix: `${step}`, body });
      }
      continue;
    }
    if (source !== "MODEL") {
      continue;
    }
    if (type === "PLANNER_RESPONSE") {
      const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
      toolCalls.forEach((call, callIndex) => {
        const callRecord = unknownRecord(call);
        if (callRecord === undefined) {
          return;
        }
        const toolName = stringField(callRecord, "name") ?? "tool";
        pendingToolName = toolName;
        const argsText = callRecord.args === undefined ? "" : JSON.stringify(callRecord.args);
        items.push({
          kind: "tool_call",
          role: "agent",
          blockSuffix: `${step}:call:${callIndex}`,
          toolName,
          body: boundedToolText(argsText),
        });
      });
      const content = stringField(record, "content");
      if (content !== undefined && content.length > 0) {
        items.push({ kind: "message", role: "agent", blockSuffix: `${step}`, body: content });
      }
      continue;
    }
    // Any other MODEL-sourced typed entry is the preceding call's result.
    const content = stringField(record, "content");
    if (content === undefined || content.length === 0) {
      continue;
    }
    items.push({
      kind: "tool_result",
      role: "agent",
      blockSuffix: `${step}:result`,
      toolName: pendingToolName ?? type ?? "tool",
      body: boundedToolText(content),
    });
    pendingToolName = undefined;
  }
  return items;
}

// USER_INPUT content is wrapped in <USER_REQUEST>…</USER_REQUEST>; show the
// inner prompt text.
function unwrapAntigravityUserRequest(content: string | undefined): string {
  if (content === undefined) {
    return "";
  }
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  return (match ? match[1] : content).trim();
}

export function rebuildAntigravityConversation(
  text: string,
  threadId: string,
  conversationId: string,
  agentId: AgentId,
): AgentSessionBlock[] {
  const timestamp = new Date().toISOString();
  return antigravityConversationItems(text, { includeUser: true }).map((item) => {
    const blockId = `provider:${threadId}:${conversationId}:${item.blockSuffix}`;
    if (item.kind === "message") {
      return conversationBlock({
        threadId,
        sessionId: conversationId,
        index: 0,
        agentId,
        isUser: item.role === "user",
        body: item.body,
        timestamp,
        blockId,
      });
    }
    return toolConversationBlock({
      threadId,
      agentId,
      blockId,
      kind: item.kind,
      toolName: item.toolName ?? "tool",
      callId: blockId,
      body: item.body,
      data: item.kind === "tool_call" ? { arguments: item.body } : { ok: true, output: item.body },
      timestamp,
    });
  });
}

function promptStatePayload(
  promptState: PromptState | null | undefined,
): Record<string, unknown> | undefined {
  if (promptState === null || promptState === undefined) {
    return undefined;
  }
  return {
    type:
      promptState.kind === "approval" || promptState.kind === "permission"
        ? "approval_prompt"
        : promptState.kind === "choice"
          ? "choice_prompt"
          : "question_prompt",
    promptId: promptState.promptId,
    message: promptState.message,
    choices: promptState.choices,
  };
}

function emitBlockUpdate(input: {
  update: AgentSessionBlockUpdate;
  blocks: Map<string, AgentSessionBlock>;
  onEvent?: (event: BackendEventEnvelope) => void;
}): void {
  if (input.update.kind === "upsert") {
    input.blocks.set(input.update.block.blockId, input.update.block);
    input.onEvent?.(
      createAgentSessionBlockUpsertedEventFromBlock({
        eventId: nextEventId(),
        emittedAt: new Date().toISOString(),
        block: input.update.block,
      }),
    );
    return;
  }

  if (input.update.kind === "complete") {
    input.onEvent?.(
      createAgentSessionBlockCompletedEventFromUpdate({
        eventId: nextEventId(),
        emittedAt: new Date().toISOString(),
        update: input.update,
      }),
    );
  }
}

async function recordBlockUpdateInThreadCache(
  persistence: ThreadPersistenceService,
  service: ThreadRuntimeService,
  update: AgentSessionBlockUpdate,
): Promise<void> {
  let threadId: string | undefined;
  if (update.kind === "upsert") {
    await service.recordAgentSessionBlock({
      threadId: update.block.threadId,
      block: update.block,
    });
    threadId = update.block.threadId;
  } else if (update.kind === "reset") {
    for (const block of update.blocks) {
      await service.recordAgentSessionBlock({ threadId: block.threadId, block });
    }
    threadId = update.blocks[0]?.threadId;
  }
  if (threadId !== undefined) {
    await persistThreadBlocks({ persistence, service, threadId });
  }
}

// Persist the thread's full current Agent Session block list so a restart can
// restore the conversation. Blocks live as references in the service; fill the
// required block fields to write the durable cache.
async function persistThreadBlocks(input: {
  persistence: ThreadPersistenceService;
  service: ThreadRuntimeService;
  threadId: string;
}): Promise<void> {
  const hydrated = await input.service.hydrateThread({ threadId: input.threadId });
  if (!hydrated.ok || hydrated.blocks.length === 0) {
    return;
  }
  const agentId = hydrated.thread.agentBinding.agentId;
  const blocks = hydrated.blocks.map((ref) => ({
    blockId: ref.blockId,
    threadId: input.threadId,
    agentId: ref.agentId ?? agentId,
    kind: ref.kind,
    role: ref.role ?? "runtime",
    sourceFrameIds: ref.sourceFrameIds ?? [],
    localProvenance: ref.localProvenance,
    status: ref.status,
    title: ref.title,
    body: ref.body,
    data: ref.data,
    rawFallback: ref.rawFallback,
    createdAt: ref.createdAt ?? ref.updatedAt,
    updatedAt: ref.updatedAt,
  })) as AgentSessionBlock[];
  const saved = await input.persistence.writeAgentSessionCache(input.threadId, {
    blocks,
    sourceFingerprint: `local:${blocks.length}:${blocks[blocks.length - 1]?.updatedAt ?? ""}`,
  });
  if (!saved.ok) {
    process.emitWarning(saved.error.message, { type: "TidePersistenceCacheWarning" });
  }
}

// Provider Stop-hook signal events that mean "the current turn has ended".
// codex forwards `codex-stop`; claude/antigravity forward `agent-idle`.
const TURN_END_SIGNAL_EVENTS = new Set(["codex-stop", "agent-idle"]);

// On a turn-end signal, return the runtime to idle (so the UI stops showing
// "working") or flush a queued Composer input into the next turn.
async function emitTurnComplete(input: {
  threadId: string;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
}): Promise<void> {
  const result = await input.service.recordTurnComplete({ threadId: input.threadId });
  if (!result.ok) {
    return;
  }
  // If a queued input was flushed into the next turn, surface its user-message
  // block so the conversation shows the queued message (then the new turn runs).
  if (result.submittedBlock !== undefined) {
    input.onEvent?.({
      contractVersion: CONTRACT_VERSION,
      eventId: nextEventId(),
      kind: "agentSessionBlock.upserted",
      emittedAt: new Date().toISOString(),
      payload: {
        block: toAgentSessionBlockDto(result.thread, result.submittedBlock),
      },
    });
  }
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: nextEventId(),
    kind: "agentRuntime.stateChanged",
    emittedAt: new Date().toISOString(),
    payload: {
      threadId: result.thread.threadId,
      state: result.runtimeState,
      changedAt: result.thread.updatedAt,
    },
  });
}

async function emitPromptState(input: {
  promptState?: PromptState;
  service: ThreadRuntimeService;
  onEvent?: (event: BackendEventEnvelope) => void;
}): Promise<void> {
  if (input.promptState === undefined) {
    return;
  }

  const result = await input.service.recordProviderPromptState({
    threadId: input.promptState.threadId,
    promptState: input.promptState,
  });
  if (!result.ok) {
    return;
  }

  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: nextEventId(),
    kind: "prompt.changed",
    emittedAt: new Date().toISOString(),
    payload: {
      threadId: result.thread.threadId,
      prompt: result.promptState,
    },
  });
}

async function recordDiscoveredProviderSessionRef(input: {
  service: ThreadRuntimeService;
  persistence: ThreadPersistenceService;
  threadId: string;
  providerSessionRef: DiscoveredProviderSessionRef;
}): Promise<void> {
  const recorded = await input.service.recordProviderSessionRef({
    threadId: input.threadId,
    agentId: input.providerSessionRef.agentId,
    providerSessionRef: {
      kind: input.providerSessionRef.kind,
      value: input.providerSessionRef.value,
      transcriptPath: input.providerSessionRef.transcriptPath,
      logPath: input.providerSessionRef.logPath,
    },
  });
  if (!recorded.ok) {
    return;
  }

  const attached = recorded.thread.agentBinding.providerSessionRef;
  if (
    attached?.kind !== input.providerSessionRef.kind ||
    attached.value !== input.providerSessionRef.value ||
    attached.transcriptPath !== input.providerSessionRef.transcriptPath ||
    attached.logPath !== input.providerSessionRef.logPath
  ) {
    return;
  }

  const persisted = await input.persistence.attachProviderSessionRef(input.threadId, {
    ...input.providerSessionRef,
    observedAt: new Date().toISOString(),
  });
  if (!persisted.ok) {
    process.emitWarning(persisted.error.message, {
      type: "TideProviderSessionRefWarning",
    });
  }
}

function nextEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resolveExecutable(command: string): string | undefined {
  const result = spawnSync("which", [command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return undefined;
  }
  const resolved = result.stdout.trim();
  return resolved.length > 0 ? resolved : undefined;
}

function createMemoryPtyTranscriptPort(): PtyTranscriptPort {
  const frames: RawAgentFrame[] = [];
  return {
    async append(frame) {
      frames.push(frame);
    },
  };
}

function readJsonFile(path: string): Record<string, unknown> | undefined {
  const text = readTextFile(path);
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function recentAntigravityTranscripts(homeDir: string, sinceMs: number): string[] {
  const brainDir = join(homeDir, ".gemini", "antigravity-cli", "brain");
  let entries;
  try {
    entries = readdirSync(brainDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const transcriptPaths: { path: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const transcriptPath = join(
      brainDir,
      entry.name,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    try {
      const stat = statSync(transcriptPath);
      if (stat.mtimeMs >= sinceMs) {
        transcriptPaths.push({ path: transcriptPath, mtimeMs: stat.mtimeMs });
      }
    } catch {
      // Ignore conversations without readable transcript evidence.
    }
  }

  return transcriptPaths
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .slice(-8)
    .map((entry) => entry.path);
}

function recentCodexRollouts(homeDir: string, sinceMs: number): string[] {
  const realSessionsDir = join(homeDir, ".codex", "sessions");
  const overlaySessionsDir = join(
    providerBootstrapArtifactsForHome({ homeDir }).codexHome,
    "sessions",
  );
  const rolloutPaths = recentProviderFiles({
    rootDir: realSessionsDir,
    sinceMs,
    maxDepth: 4,
    matches: (name) => /^rollout-.+\.jsonl$/.test(name),
  });
  if (!isSymlink(overlaySessionsDir)) {
    rolloutPaths.push(
      ...recentProviderFiles({
        rootDir: overlaySessionsDir,
        sinceMs,
        maxDepth: 4,
        matches: (name) => /^rollout-.+\.jsonl$/.test(name),
      }),
    );
  }
  return [...new Set(rolloutPaths)];
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function recentClaudeTranscripts(homeDir: string, sinceMs: number): string[] {
  return recentProviderFiles({
    rootDir: join(homeDir, ".claude", "projects"),
    sinceMs,
    maxDepth: 2,
    matches: (name) => /^[0-9a-f-]+\.jsonl$/i.test(name),
  });
}

function recentProviderFiles(input: {
  rootDir: string;
  sinceMs: number;
  maxDepth: number;
  matches: (name: string) => boolean;
}): string[] {
  const filePaths: { path: string; mtimeMs: number }[] = [];
  let visitedEntries = 0;
  const maxEntries = 3000;

  const visit = (dir: string, depth: number): void => {
    if (visitedEntries >= maxEntries || depth > input.maxDepth) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (visitedEntries >= maxEntries) {
        return;
      }
      visitedEntries += 1;
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !input.matches(entry.name)) {
        continue;
      }

      try {
        const stat = statSync(entryPath);
        if (stat.mtimeMs >= input.sinceMs) {
          filePaths.push({ path: entryPath, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // Ignore unreadable provider history files.
      }
    }
  };

  visit(input.rootDir, 0);

  return filePaths
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .slice(-8)
    .map((entry) => entry.path);
}

function readBoundedTail(path: string, maxBytes: number): string | undefined {
  let fileDescriptor: number | undefined;
  try {
    const stat = statSync(path);
    const bytesToRead = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(bytesToRead);
    fileDescriptor = openSync(path, "r");
    readSync(fileDescriptor, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
    return buffer.toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fileDescriptor !== undefined) {
      closeSync(fileDescriptor);
    }
  }
}

// Reads the leading bytes of a file (codex session_meta and the first user turn
// live near the top), bounded so large transcripts stay cheap to scan.
function readBoundedHead(path: string, maxBytes: number): string | undefined {
  let fileDescriptor: number | undefined;
  try {
    const stat = statSync(path);
    const bytesToRead = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(bytesToRead);
    fileDescriptor = openSync(path, "r");
    readSync(fileDescriptor, buffer, 0, bytesToRead, 0);
    return buffer.toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fileDescriptor !== undefined) {
      closeSync(fileDescriptor);
    }
  }
}

// Encodes a cwd into Claude's project directory name (path separators and dots
// become dashes, e.g. /Users/x/tide -> -Users-x-tide).
function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

interface RegisteredProjectEntry {
  projectId: string;
  name: string;
  cwd: string;
}

function readRegisteredProjects(appDataRoot: string): RegisteredProjectEntry[] {
  const raw = readTextFile(join(appDataRoot, "project-registry.json"));
  if (raw === undefined) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      const cwd = typeof entry?.cwd === "string" ? entry.cwd : undefined;
      const projectId = typeof entry?.projectId === "string" ? entry.projectId : undefined;
      if (cwd === undefined || projectId === undefined) {
        return [];
      }
      return [{ projectId, name: typeof entry?.name === "string" ? entry.name : projectId, cwd }];
    });
  } catch {
    return [];
  }
}

function createDiscoveryFs(homeDir: string): DiscoveryFs {
  return {
    listClaudeTranscripts: (cwd) => {
      const dir = join(homeDir, ".claude", "projects", claudeProjectDirName(cwd));
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      const out: { path: string; sessionId: string; mtimeMs: number }[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !/^[0-9a-f-]+\.jsonl$/i.test(entry.name)) {
          continue;
        }
        const path = join(dir, entry.name);
        try {
          out.push({ path, sessionId: entry.name.replace(/\.jsonl$/i, ""), mtimeMs: statSync(path).mtimeMs });
        } catch {
          // Skip transcripts that vanished between listing and stat.
        }
      }
      return out;
    },
    listCodexRollouts: () =>
      recentCodexRollouts(homeDir, 0).flatMap((path) => {
        try {
          return [{ path, mtimeMs: statSync(path).mtimeMs }];
        } catch {
          return [];
        }
      }),
    antigravityConversationForCwd: (cwd) => {
      const cache = readJsonFile(join(homeDir, ".gemini", "antigravity-cli", "cache", "last_conversations.json"));
      const conversationId = cache !== undefined && typeof cache[cwd] === "string" ? (cache[cwd] as string) : undefined;
      if (conversationId === undefined) {
        return undefined;
      }
      const transcriptPath = join(
        homeDir,
        ".gemini",
        "antigravity-cli",
        "brain",
        conversationId,
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      try {
        return { conversationId, transcriptPath, mtimeMs: statSync(transcriptPath).mtimeMs };
      } catch {
        return undefined;
      }
    },
    readText: (path) => readBoundedHead(path, 256 * 1024),
  };
}

function discoverAdoptedThreadSeeds(input: {
  homeDir: string;
  appDataRoot: string;
  persistedRecords: ThreadStorageRecord[];
}): ThreadSeed[] {
  const registry = readRegisteredProjects(input.appDataRoot);
  const projectIdByCwd = new Map(registry.map((entry) => [entry.cwd, entry.projectId]));
  const cwds = new Set<string>(registry.map((entry) => entry.cwd));
  for (const record of input.persistedRecords) {
    if (record.scope.kind === "project") {
      cwds.add(record.scope.cwd);
      projectIdByCwd.set(record.scope.cwd, record.scope.projectId);
    }
  }
  if (cwds.size === 0) {
    return [];
  }

  const existingRefValues = new Set<string>();
  for (const record of input.persistedRecords) {
    const value = record.providerSessionRef?.value ?? record.agentBinding.providerSessionRef?.value;
    if (value !== undefined) {
      existingRefValues.add(value);
    }
  }
  const existingThreadIds = new Set(input.persistedRecords.map((record) => record.threadId));

  const sessions = discoverLocalSessions({
    cwds: [...cwds],
    fs: createDiscoveryFs(input.homeDir),
  });
  return adoptedThreadSeedsFromSessions({
    sessions,
    projectIdForCwd: (cwd) => projectIdByCwd.get(cwd) ?? basename(cwd),
    existingRefValues,
    existingThreadIds,
  });
}

function rebuildAdoptedConversation(seed: ThreadSeed): AgentSessionBlock[] {
  const ref = seed.agentBinding.providerSessionRef;
  const filePath = ref?.transcriptPath;
  if (ref === undefined || filePath === undefined) {
    return [];
  }
  const text = readBoundedTail(filePath, 1024 * 1024);
  if (text === undefined) {
    return [];
  }
  const agentId = seed.agentBinding.agentId;
  if (ref.kind === "codex_rollout") {
    return rebuildCodexConversation(text, seed.threadId, ref.value, agentId);
  }
  if (ref.kind === "claude_transcript") {
    return rebuildClaudeConversation(text, seed.threadId, ref.value, agentId);
  }
  if (ref.kind === "antigravity_conversation") {
    return rebuildAntigravityConversation(text, seed.threadId, ref.value, agentId);
  }
  return [];
}

function latestUserMessageForProviderHistory(
  thread: { cachedBlocks: Array<{ kind: string; body?: string }> },
): string | undefined {
  for (let index = thread.cachedBlocks.length - 1; index >= 0; index -= 1) {
    const block = thread.cachedBlocks[index];
    if (block?.kind === "user_message" && typeof block.body === "string") {
      return block.body;
    }
  }
  return undefined;
}

function codexRolloutContainsUserMessage(
  rolloutPath: string,
  expectedUserMessage: string,
): boolean {
  const text = readBoundedTail(rolloutPath, 256 * 1024);
  if (text === undefined) {
    return false;
  }

  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    const payload = recordField(record, "payload");
    if (payload?.type !== "user_message") {
      continue;
    }
    if (stringField(payload, "message") === expectedUserMessage) {
      return true;
    }
    const content = payload.content;
    if (
      Array.isArray(content) &&
      content.some((item) => inputTextContentEquals(item, expectedUserMessage))
    ) {
      return true;
    }
  }
  return false;
}

function claudeTranscriptContainsUserMessage(
  transcriptPath: string,
  expectedUserMessage: string,
): boolean {
  const text = readBoundedTail(transcriptPath, 256 * 1024);
  if (text === undefined) {
    return false;
  }

  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record?.type !== "user") {
      continue;
    }
    const message = recordField(record, "message");
    if (message?.role !== "user") {
      continue;
    }
    const content = message.content;
    if (content === expectedUserMessage) {
      return true;
    }
    if (
      Array.isArray(content) &&
      content.some((item) => inputTextContentEquals(item, expectedUserMessage))
    ) {
      return true;
    }
  }
  return false;
}

function inputTextContentEquals(item: unknown, expectedUserMessage: string): boolean {
  const record = unknownRecord(item);
  if (record === undefined) {
    return false;
  }
  return (
    stringField(record, "text") === expectedUserMessage ||
    stringField(record, "input_text") === expectedUserMessage
  );
}

function claudeAssistantTextContent(content: unknown): string | undefined {
  if (typeof content === "string" && content.length > 0) {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const textParts = content
    .map((item) => stringField(unknownRecord(item), "text"))
    .filter((text): text is string => text !== undefined);
  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(line);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function antigravityConversationIdFromTranscriptPath(transcriptPath: string): string {
  const marker = `${join(".system_generated", "logs", "transcript.jsonl")}`;
  const prefix = transcriptPath.endsWith(marker)
    ? transcriptPath.slice(0, -marker.length - 1)
    : transcriptPath;
  const parts = prefix.split(/[\\/]/);
  return parts[parts.length - 1] ?? "unknown";
}

function codexSessionIdFromRolloutPath(rolloutPath: string): string {
  const name = basename(rolloutPath);
  const match = name.match(
    /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/,
  );
  if (match?.[1] !== undefined) {
    return match[1];
  }
  return name.replace(/^rollout-/, "").replace(/\.jsonl$/, "");
}

function claudeSessionIdFromTranscriptPath(transcriptPath: string): string {
  return basename(transcriptPath).replace(/\.jsonl$/, "");
}

function hasCodexAuth(value: Record<string, unknown> | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return (
    typeof value.auth_mode === "string" ||
    typeof value.OPENAI_API_KEY === "string" ||
    recordField(value, "tokens") !== undefined
  );
}

function codexTrustedCwds(config: string): string[] {
  const trusted: string[] = [];
  const projectHeader = /^\[projects\."([^"]+)"\]$/;
  let activeProject: string | undefined;

  for (const line of config.split(/\r?\n/)) {
    const header = line.match(projectHeader);
    if (header !== null) {
      activeProject = header[1];
      continue;
    }
    if (activeProject !== undefined && line.trim() === 'trust_level = "trusted"') {
      trusted.push(activeProject);
    }
  }

  return trusted;
}

function recordField(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const field = value?.[key];
  if (field !== null && typeof field === "object" && !Array.isArray(field)) {
    return field as Record<string, unknown>;
  }
  return undefined;
}

function unknownRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function stringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function numberField(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const field = value?.[key];
  return typeof field === "number" ? field : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
