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
import type { PromptState } from "../../application/domains/thread/thread.ts";
import { createFixtureAgentSessionReader } from "../../application/services/fixture-agent-session-reader.ts";
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
    void persistThreadEvents(persistence, events);
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
  });
}

function createPersistentLiveBackendAdapter(input: {
  adapter: ReturnType<typeof createBackendContractMessageAdapter>;
  service: ThreadRuntimeService;
  persistence: ThreadPersistenceService;
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

    const restored = await input.service.restoreThreads({
      threads: listed.value.map(threadSeedFromStorageRecord),
    });
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
      await persistThreadEvents(input.persistence, events);
      return events;
    },
  };
}

async function persistThreadEvents(
  persistence: ThreadPersistenceService,
  events: BackendEventEnvelope[],
): Promise<void> {
  for (const event of events) {
    if (
      event.kind !== "thread.started" &&
      event.kind !== "thread.hydrated" &&
      event.kind !== "thread.archived" &&
      event.kind !== "thread.pinChanged"
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
        await recordBlockUpdateInThreadCache(service, update);
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
        await recordBlockUpdateInThreadCache(service, update);
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
        await recordBlockUpdateInThreadCache(service, update);
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
      await recordBlockUpdateInThreadCache(service, update);
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
    for (let index = 0; index < lines.length; index += 1) {
      const record = parseJsonObject(lines[index]);
      if (record?.type !== "event_msg") {
        continue;
      }
      const payload = recordField(record, "payload");
      if (payload?.type !== "agent_message") {
        continue;
      }
      const message = stringField(payload, "message");
      if (message === undefined) {
        continue;
      }
      const frameKey = `${rolloutPath}:${index}:agent_message`;
      if (input.seenKeys.has(frameKey)) {
        continue;
      }
      input.seenKeys.add(frameKey);
      frames.push({
        source: "provider_history",
        sourceRef: rolloutPath,
        payloadKind: "provider_record",
        payload: {
          type: "message",
          role: "agent",
          status: "complete",
          blockId: `provider:${input.threadId}:${sessionId}:${index}`,
          body: message,
          sourceRuntimeId: input.runtimeId,
        },
        body: message,
      });
    }
  }
  return frames;
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
    for (let index = 0; index < lines.length; index += 1) {
      const record = parseJsonObject(lines[index]);
      if (record?.type !== "assistant") {
        continue;
      }
      const message = recordField(record, "message");
      if (message?.role !== "assistant") {
        continue;
      }
      const body = claudeAssistantTextContent(message.content);
      if (body === undefined) {
        continue;
      }
      const frameKey = `${transcriptPath}:${index}:assistant`;
      if (input.seenKeys.has(frameKey)) {
        continue;
      }
      input.seenKeys.add(frameKey);
      frames.push({
        source: "provider_history",
        sourceRef: transcriptPath,
        payloadKind: "provider_record",
        payload: {
          type: "message",
          role: "agent",
          status: "complete",
          blockId: `provider:${input.threadId}:${sessionId}:${index}`,
          body,
          sourceRuntimeId: input.runtimeId,
        },
        body,
      });
    }
  }
  return frames;
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

    for (const line of transcriptText.split(/\r?\n/)) {
      const record = parseJsonObject(line);
      if (record === undefined || record.type !== "PLANNER_RESPONSE") {
        continue;
      }
      const content = stringField(record, "content");
      const stepIndex = numberField(record, "step_index");
      if (content === undefined || stepIndex === undefined) {
        continue;
      }

      const frameKey = `${transcriptPath}:${stepIndex}:PLANNER_RESPONSE`;
      if (input.seenKeys.has(frameKey)) {
        continue;
      }
      input.seenKeys.add(frameKey);

      const blockId = `provider:${input.threadId}:${conversationId}:${stepIndex}`;
      frames.push({
        source: "provider_history",
        sourceRef: transcriptPath,
        payloadKind: "provider_record",
        payload: {
          type: "message",
          role: "agent",
          status: "complete",
          blockId,
          body: content,
          sourceRuntimeId: input.runtimeId,
        },
        body: content,
      });
    }
  }

  return frames;
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
  service: ThreadRuntimeService,
  update: AgentSessionBlockUpdate,
): Promise<void> {
  if (update.kind === "upsert") {
    await service.recordAgentSessionBlock({
      threadId: update.block.threadId,
      block: update.block,
    });
    return;
  }

  if (update.kind === "reset") {
    for (const block of update.blocks) {
      await service.recordAgentSessionBlock({
        threadId: block.threadId,
        block,
      });
    }
  }
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
