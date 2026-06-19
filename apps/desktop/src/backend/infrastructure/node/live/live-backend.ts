import { resolveExecutable } from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";
import { createLiveAgentUpdateChecker } from "../provider/agent-update-checker.ts";
import { locateClaudeTranscriptFile } from "../../../adapters/outbound/agent-integrations/claude/claude-history-connector.ts";
import { tideClaudeContextPrompt } from "../../../adapters/outbound/agent-integrations/claude/claude-agent-integration.ts";
import { createLiveAgentSessionEventProjector, nextEventId } from "./live-projector.ts";
import {
  createPersistentLiveBackendAdapter,
  persistThreadEvents,
} from "./live-backend-restore.ts";
import { resolveAugmentedEnvironment } from "./resolve-shell-path.ts";
export {
  threadSeedFromStorageRecord,
  threadStorageRecordFromThreadSummary,
} from "./live-backend-restore.ts";
import { spawnSync } from "node:child_process";

import { createHash } from "node:crypto";

import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";

import { tmpdir } from "node:os";

import { basename, dirname, join } from "node:path";

import { fileURLToPath } from "node:url";

import {
  readBoundedHead,
  readJsonFile,
  readTextFile,
} from "./live-backend-fs.ts";

import {
  readClaudeProviderStateFromHome,
  readCodexProviderStateFromHome,
  readGeminiProviderStateFromHome,
  readOpencodeProviderStateFromHome,
} from "../provider/provider-state-readers.ts";

import {
  claudeProviderSessionRefFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
  type DiscoveredProviderSessionRef,
} from "../provider/provider-session-ref.ts";

import {
  rebuildClaudeConversation,
  rebuildCodexConversation,
} from "../provider/provider-conversation-rebuilders.ts";

import { recentCodexRollouts } from "../provider/recent-provider-files.ts";

import {
  readClaudeProviderSessionRefsFromHome,
  readCodexProviderSessionRefsFromHome,
} from "../provider/provider-history-readers.ts";

export {
  readClaudeProviderSessionRefsFromHome,
  readCodexProviderSessionRefsFromHome,
};

export {
  rebuildClaudeConversation,
  rebuildCodexConversation,
};

export type { DiscoveredProviderSessionRef };

export {
  claudeProviderSessionRefFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
};

export {
  readClaudeProviderStateFromHome,
  readCodexProviderStateFromHome,
};

import { createBackendContractMessageAdapter } from "../../../adapters/inbound/contract-message-adapter/contract-message-adapter.ts";
import {
  toAgentSessionBlockDto,
  toProviderReadinessDto,
  toThreadSummaryDto,
} from "../../../adapters/inbound/contract-message-adapter/dto/thread-dtos.ts";
import { toWorkbenchPaneRefDto } from "../../../adapters/inbound/contract-message-adapter/dto/workbench-dtos.ts";

import { createTideMcpSocketServer } from "../../../adapters/inbound/tide-mcp-server/tide-mcp-socket-bridge.ts";

import { createRuntimeReadinessRegistry } from "../../../application/services/provider/runtime-readiness-registry.ts";

import { createTideMcpToolSurfaceAdapter } from "../../../adapters/inbound/tide-mcp-tool-surface/tide-mcp-tool-surface-adapter.ts";

import {
  createAgentIntegrationAgentRuntimePort,
  createAgentIntegrationProviderReadinessPort,
  type AgentIntegrationRegistry,
} from "../../../adapters/outbound/agent-runtime/runtime-ports/agent-integration-agent-runtime-port.ts";

import type { StructuredProviderEvent } from "../../../adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";

import {
  createAgentRuntimeRouterPort,
  createProviderReadinessRouterPort,
} from "../../../adapters/outbound/agent-runtime/runtime-ports/agent-runtime-router-port.ts";

import {
  createEnvironmentOpenAiProviderAccountReader,
  createOpenAiApiAgentRuntimePort,
  createOpenAiProviderAccountReadinessPort,
  createOpenAiResponsesClient,
} from "../../../adapters/outbound/agent-runtime/runtime-ports/openai-api-agent-runtime-port.ts";

import { createFileAppStorage } from "../../../adapters/outbound/app-storage/file-app-storage.ts";

import {
  createClaudeAgentIntegration,
  type ClaudeProviderState,
} from "../../../adapters/outbound/agent-integrations/claude/claude-agent-integration.ts";

import {
  createCodexAgentIntegration,
  type CodexProviderState,
} from "../../../adapters/outbound/agent-integrations/codex/codex-agent-integration.ts";

import { createGeminiAgentIntegration } from "../../../adapters/outbound/agent-integrations/gemini/gemini-agent-integration.ts";

import { createOpencodeAgentIntegration } from "../../../adapters/outbound/agent-integrations/opencode/opencode-agent-integration.ts";
import { createProviderDetection } from "../provider/provider-detection.ts";

import { codexRolloutTurnEnded as codexRolloutTurnEndedFromText } from "../../../adapters/outbound/agent-integrations/codex/codex-rollout-turn-detection.ts";

import {
  createAgentSessionBlockCompletedEventFromUpdate,
  createAgentSessionBlockUpsertedEventFromBlock,
} from "../../../adapters/outbound/desktop-contract/agent-session-block-event-adapter.ts";

import { createWorkspaceCodeIntelligenceRouter } from "../../../adapters/outbound/code-intelligence/code-intelligence-router.ts";

import { createPythonPtyProcessLauncher } from "../../../adapters/outbound/pty/python-pty-process-launcher.ts";

import { createPtyProviderSetupSurfaceTerminalPort } from "../../../adapters/outbound/pty/provider-setup-surface-pty-port.ts";

import { createPtyWorkbenchTerminalPort } from "../../../adapters/outbound/pty/workbench-terminal-pty-port.ts";

import { createNodeWorkspaceCommandPort } from "../../../adapters/outbound/workspace-command/node-workspace-command-port.ts";

import { createNodeWorkspaceFilePort } from "../../../adapters/outbound/workspace-file/node-workspace-file-port.ts";

import { createNodeComposerAttachmentStorePort } from "../../../adapters/outbound/composer-attachment-store/node-composer-attachment-store.ts";

import { createNodeProviderTrustPort } from "../../../adapters/outbound/provider-trust/node-provider-trust-port.ts";

import {
  ensureProviderBootstrapArtifacts,
  providerBootstrapArtifactsForHome,
} from "../provider/provider-bootstrap-artifacts.ts";

import type { AgentSessionBlockUpdate } from "../../../application/domains/agent-session/agent-session-block.ts";

import type { AgentId, ProviderCliAgentId, PromptState } from "../../../application/domains/thread/thread.ts";

import type {
  AgentTurnOutcome,
  DiscoveredProviderSessionRef as AdapterProviderSessionRef,
} from "../../../application/ports/outbound/agent-integration-port.ts";

import { createFixtureAgentSessionReader } from "../../../application/services/thread/fixture-agent-session-reader.ts";

import {
  adoptedThreadSeedsFromSessions,
  discoverLocalSessions,
  type DiscoveryFs,
} from "../../../application/services/provider/provider-session-discovery.ts";

import { createThreadPersistenceService } from "../../../application/services/thread/thread-persistence-service.ts";

import {
  createThreadRuntimeService,
  type PtyTranscriptPort,
  type RawAgentFrame,
  type TideMcpToolName,
  type ThreadRuntimeAsyncEvent,
  type ThreadRuntimeService,
} from "../../../application/services/thread/thread-runtime-service.ts";

import {
  CONTRACT_VERSION,
  type BackendEventEnvelope,
} from "../../../../shared/contracts/index.ts";

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
  // Stable per-install MCP socket path (a short hash of the app data root), NOT
  // pid-based. A pid-based path changed on every backend restart, so agents spawned
  // by an earlier backend pointed at a dead socket and their MCP tool calls hung
  // forever. With a stable path the new backend re-binds the same socket (the server
  // unlinks the stale file) and existing agents reconnect to it.
  const tideSocket =
    env.TIDE_SOCKET ??
    join(tmpdir(), `tide-mcp-${createHash("sha1").update(appDataRoot).digest("hex").slice(0, 12)}.sock`);
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
      tideContextPrompt: tideClaudeContextPrompt(),
      defaultCwd: process.cwd(),
      locateSessionFile: (sessionId) => locateClaudeTranscriptFile(homeDir, sessionId),
    }),
    gemini: createGeminiAgentIntegration({
      resolveExecutable: () => resolveExecutable("gemini"),
      readProviderState: ({ cwd }) => readGeminiProviderStateFromHome(homeDir, cwd),
      defaultCwd: process.cwd(),
      tideMcp: {
        command: bootstrapArtifacts.tideMcpCommandPath,
        args: [],
        env: { TIDE_SOCKET: tideSocket },
      },
    }),
    opencode: createOpencodeAgentIntegration({
      resolveExecutable: () => resolveExecutable("opencode"),
      readProviderState: ({ cwd }) => readOpencodeProviderStateFromHome(homeDir, cwd),
      defaultCwd: process.cwd(),
      tideMcp: {
        command: bootstrapArtifacts.tideMcpCommandPath,
        args: [],
        env: { TIDE_SOCKET: tideSocket },
      },
    }),
  };
  // Background agent-CLI update detection (spec: version-management.md, Lane 2).
  const agentUpdateChecker = createLiveAgentUpdateChecker({
    agentIds: Object.keys(integrations) as ProviderCliAgentId[],
    resolveExecutable,
  });

  let service: ThreadRuntimeService;
  const ptyLauncher = createPythonPtyProcessLauncher();
  const openAiAccountReader = createEnvironmentOpenAiProviderAccountReader(env);
  const projector = createLiveAgentSessionEventProjector({
    service: () => service,
    persistence,
    onEvent: input.onEvent,
    homeDir,
    integrations,
  });
  // Shared first-turn handoff gate: the runtime port waits on it before delivering a
  // tool_surface_ready agent's first prompt; the Tide MCP socket server marks a
  // runtime ready when that runtime completes its tools/list handshake.
  const readinessRegistry = createRuntimeReadinessRegistry();
  const providerCliRuntimePort = createAgentIntegrationAgentRuntimePort({
    integrations,
    resolveRuntimeEnvironment: ({ cwd, planEnv }) =>
      resolveAugmentedEnvironment({ currentEnv: { ...env, ...planEnv }, cwd }),
    // The projector serializes ingestion per thread (see serializeIngest), so a
    // fire-and-forget dispatch here can't race a thread's events against each other.
    onProviderEvent: (providerEvent) => {
      void projector.ingestStructuredProviderEvent(providerEvent);
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
        updateChecker: agentUpdateChecker,
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
      resolveRuntimeEnvironment: ({ cwd, planEnv }) =>
        resolveAugmentedEnvironment({ currentEnv: { ...env, ...planEnv }, cwd }),
    }),
    ptyTranscriptPort: createMemoryPtyTranscriptPort(),
    workspaceCommandPort: createNodeWorkspaceCommandPort({
      resolveRuntimeEnvironment: ({ cwd, planEnv }) =>
        resolveAugmentedEnvironment({ currentEnv: { ...env, ...planEnv }, cwd }),
    }),
    workspaceFilePort: createNodeWorkspaceFilePort(),
    composerAttachmentStorePort: createNodeComposerAttachmentStorePort(join(appDataRoot, "attachments")),
    providerTrustPort: createNodeProviderTrustPort(homeDir, bootstrapArtifacts.codexHome),
    ensureScratchDirectory: (threadId: string) => {
      const dir = join(appDataRoot, "scratch", threadId);
      mkdirSync(dir, { recursive: true });
      // Canonicalize to the real on-disk casing. app.getPath("userData") is derived
      // from productName ("Tide"), but the directory on a case-insensitive macOS FS is
      // physically "tide" (created lowercase by an earlier run). A provider's trust
      // check (claude ~/.claude.json, codex config.toml) is a case-SENSITIVE string
      // match against the cwd it resolves via getcwd() — i.e. the stored casing. If we
      // trust the "Tide" string but the kernel resolves the launch cwd to the stored
      // "tide", claude shows its directory-trust dialog and the hidden-PTY turn hangs
      // forever. Node's JS realpathSync does NOT correct case on macOS; realpathSync.native
      // (libc realpath) returns the true on-disk casing, matching the provider's getcwd.
      return realpathSync.native(dir);
    },
    // TS in-process + LSP-on-PATH engines behind one router (spec:
    // workbench-editor-language-intelligence).
    workspaceCodeIntelligencePort: createWorkspaceCodeIntelligenceRouter(),
    defaultWorkbenchTerminalCommand: env.SHELL ?? "sh",
    defaultWorkbenchTerminalArgs: env.SHELL === undefined ? [] : ["-l"],
    onAsyncEvent: (event) => {
      emitBackendEvents(backendEventsFromThreadRuntimeAsyncEvent(event));
    },
  });
  if (input.startMcpSocket !== false) {
    const mcpSocketServer = createTideMcpSocketServer({
      socketPath: tideSocket,
      adapter: createTideMcpToolSurfaceAdapter({ service }),
      readinessRegistry,
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

  // Installed-agent detection + opencode model catalog, surfaced on thread.listed.
  const detection = createProviderDetection({
    hasIntegration: (agentId) => integrations[agentId] !== undefined,
    resolveExecutable,
  });
  // Deliver opencode's catalog OUT OF BAND so the agent menu (availableAgents on thread.listed)
  // is never blocked behind opencode's slower subprocesses: enumerate once OFF the startup
  // critical path and push providerCatalog.changed when ready. (The adapter re-pushes it after a
  // vendor connect.) See provider-cli-setup-handoff.md.
  setImmediate(() => {
    // Enumerate asynchronously: opencode's CLI spawns can take seconds, and doing them
    // synchronously here froze the backend event loop — delaying the already-computed
    // thread.list reply (and so the cold-boot rail skeleton) by ~2.5s. Off the loop, the
    // catalog simply arrives a moment later without blocking anything.
    void (async () => {
      emitBackendEvents([
        {
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "providerCatalog.changed",
          emittedAt: new Date().toISOString(),
          payload: {
            opencodeModels: await detection.enumerateOpencodeModels(),
            opencodeVendors: await detection.enumerateOpencodeVendors(),
            opencodeEnvironment: await detection.opencodeEnvironment(),
          },
        },
      ]);
    })();
  });

  return createPersistentLiveBackendAdapter({
    flushPendingPersists: () => projector.flushPendingPersists(),
    adapter: createBackendContractMessageAdapter({
      service,
      // detection's methods === the adapter's thread.listed detection inputs.
      ...detection,
      discoverProviderCommands: (agentId, cwd) => providerCliRuntimePort.discoverCommands?.(agentId as ProviderCliAgentId, cwd) ?? Promise.resolve([]),
    }),
    service,
    persistence,
    homeDir,
    appDataRoot,
    emitBackendEvents,
  });
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
            layoutMode: event.thread.workbench.layoutMode,
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
            queuedInputs: event.thread.queuedInputs,
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
            workbenchLayoutMode: event.thread.workbench.layoutMode,
          },
        },
      ];
  }
}


function liveClock(): string {
  return new Date().toISOString();
}


function createMemoryPtyTranscriptPort(): PtyTranscriptPort {
  const frames: RawAgentFrame[] = [];
  return {
    async append(frame) {
      frames.push(frame);
    },
  };
}

// Decomposed (spec: navigable-source-structure): the projector lives in
// live-projector.ts, provider session discovery in live-provider-discovery.ts.
export { createLiveAgentSessionEventProjector } from "./live-projector.ts";
export { discoverAdoptedThreadSeeds, rebuildAdoptedConversation } from "./live-provider-discovery.ts";
export { locateClaudeTranscriptFile } from "../../../adapters/outbound/agent-integrations/claude/claude-history-connector.ts";
export { locateGeminiSessionFile } from "../../../adapters/outbound/agent-integrations/gemini/gemini-history-connector.ts";
