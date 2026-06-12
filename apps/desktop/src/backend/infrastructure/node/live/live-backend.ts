import { discoverAdoptedThreadSeeds, rebuildAdoptedConversation } from "./live-provider-discovery.ts";
import { executableForAgent, resolveExecutable } from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";
import { locateClaudeTranscriptFile } from "../../../adapters/outbound/agent-integrations/claude/claude-history-connector.ts";
import { tideClaudeContextPrompt } from "../../../adapters/outbound/agent-integrations/claude/claude-agent-integration.ts";
import { createLiveAgentSessionEventProjector, nextEventId, persistThreadBlocks } from "./live-projector.ts";
import { spawnSync } from "node:child_process";

import { createHash } from "node:crypto";

import {
  closeSync,
  existsSync,
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
  readBoundedTail,
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
  rebuildConversationFromProviderHistory,
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

import type {
  AgentSessionBlock,
  AgentSessionBlockUpdate,
} from "../../../application/domains/agent-session/agent-session-block.ts";

import type { AgentId, ProviderCliAgentId, PromptState } from "../../../application/domains/thread/thread.ts";

import type {
  AgentTurnOutcome,
  DiscoveredProviderSessionRef as AdapterProviderSessionRef,
} from "../../../application/ports/outbound/agent-integration-port.ts";

import { createFixtureAgentSessionReader } from "../../../application/services/thread/fixture-agent-session-reader.ts";

import {
  adoptedThreadSeedsFromSessions,
  discoverLocalSessions,
  isInternalSessionTitle,
  type DiscoveryFs,
} from "../../../application/services/provider/provider-session-discovery.ts";

import {
  createThreadPersistenceService,
  THREAD_STORAGE_VERSION,
  type ProviderSessionRefRecord,
  type ThreadPersistenceService,
  type ThreadStorageRecord,
} from "../../../application/services/thread/thread-persistence-service.ts";

import {
  createThreadRuntimeService,
  type PtyTranscriptPort,
  type RawAgentFrame,
  type TideMcpToolName,
  type ThreadSeed,
  type ThreadRuntimeAsyncEvent,
  type ThreadRuntimeService,
} from "../../../application/services/thread/thread-runtime-service.ts";

import {
  CONTRACT_VERSION,
  PROVIDER_CLI_AGENT_IDS,
  type BackendEventEnvelope,
  type ThreadSummaryDto,
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

  return createPersistentLiveBackendAdapter({
    flushPendingPersists: () => projector.flushPendingPersists(),
    adapter: createBackendContractMessageAdapter({
      service,
      // Detect which provider-CLI agents are installed locally (executable resolves).
      // The composer menu enables these and shows the rest disabled. Evaluated per
      // thread.list so a CLI installed after launch is picked up.
      detectAvailableAgents: () =>
        PROVIDER_CLI_AGENT_IDS.filter(
          (agentId) =>
            integrations[agentId] !== undefined &&
            resolveExecutable(executableForAgent(agentId)) !== undefined,
        ),
    }),
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
  flushPendingPersists: () => Promise<void>;
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
        // A thread whose worktree/project directory was deleted is "tangled": its
        // files and new runs can't work. Surface a clear notice at the top so
        // opening it explains the state instead of silently failing.
        const threadCwd =
          record.scope.kind === "project" ? record.scope.cwd : undefined;
        if (threadCwd !== undefined && !existsSync(threadCwd)) {
          seed.cachedBlocks = [
            worktreeMissingBlock(record.threadId, record.agentBinding.agentId, threadCwd),
            ...(seed.cachedBlocks ?? []),
          ];
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
    // Flush coalesced conversation-cache writes (wired to backend shutdown).
    flushPendingPersists: input.flushPendingPersists,
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
      event.kind !== "thread.renamed" &&
      event.kind !== "thread.launchOptionsChanged"
    ) {
      continue;
    }
    const payload = event.payload as { thread?: ThreadSummaryDto };
    if (payload.thread === undefined) {
      continue;
    }
    // Preserve the persisted cache pointer + ref paths: this summary-derived record
    // doesn't model them, and a wholesale save would orphan the thread's
    // agent-session-cache (making a reopened thread look empty after restart).
    const saved = await persistence.saveThreadMetadataPreservingCache(
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
    // Carry the persisted pin through restore. Without this the restored thread is
    // unpinned in memory, and the next metadata event (e.g. opening it →
    // thread.hydrated) writes pinned=false back to disk, erasing the pin.
    pinned: record.pinned,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

// Rebuild the FULL conversation (all user + agent turns) from the coding agent's
// own persisted session file (codex rollout / claude transcript). This restores
// any thread on restart — including ones created before Tide cached blocks —
// since the agent's session is the durable source of truth.





// A synthetic top-of-thread notice for a thread whose worktree/project directory
// no longer exists on disk (e.g. the worktree was deleted) — the "tangled" state.
function worktreeMissingBlock(
  threadId: string,
  agentId: AgentSessionBlock["agentId"],
  cwd: string,
): AgentSessionBlock {
  const now = new Date().toISOString();
  return {
    blockId: `worktree-missing:${threadId}`,
    threadId,
    agentId,
    kind: "error",
    role: "system",
    sourceFrameIds: [],
    status: "failed",
    title: "Worktree unavailable",
    body: `⚠ This thread's working directory is gone:\n\`${cwd}\`\n\nIts worktree was likely removed, so files and new runs can't be shown here. Re-create the worktree at that path, or start a new thread.`,
    createdAt: now,
    updatedAt: now,
  };
}

// Extracts plain text from a provider message `content` (string or content-part array).

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
