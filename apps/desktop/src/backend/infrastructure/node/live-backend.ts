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
} from "./provider-state-readers.ts";
import {
  claudeProviderSessionRefFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
  type DiscoveredProviderSessionRef,
} from "./provider-session-ref.ts";
import {
  rebuildClaudeConversation,
  rebuildCodexConversation,
  rebuildConversationFromProviderHistory,
} from "./provider-conversation-rebuilders.ts";
import { recentCodexRollouts } from "./recent-provider-files.ts";
import {
  readClaudeProviderSessionRefsFromHome,
  readCodexProviderSessionRefsFromHome,
} from "./provider-history-readers.ts";
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

import {
  createBackendContractMessageAdapter,
  toAgentSessionBlockDto,
  toProviderReadinessDto,
  toThreadSummaryDto,
  toWorkbenchPaneRefDto,
} from "../../adapters/inbound/contract-message-adapter/backend-contract-message-adapter.ts";
import { createTideMcpSocketServer } from "../../adapters/inbound/tide-mcp-server/tide-mcp-socket-bridge.ts";
import { createRuntimeReadinessRegistry } from "../../application/services/runtime-readiness-registry.ts";
import { createTideMcpToolSurfaceAdapter } from "../../adapters/inbound/tide-mcp-tool-surface/tide-mcp-tool-surface-adapter.ts";
import {
  createAgentIntegrationAgentRuntimePort,
  createAgentIntegrationProviderReadinessPort,
  type AgentIntegrationRegistry,
} from "../../adapters/outbound/agent-runtime/agent-integration-agent-runtime-port.ts";
import type { StructuredProviderEvent } from "../../adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
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
import { createFileAppStorage } from "../../adapters/outbound/app-storage/file-app-storage.ts";
import {
  createClaudeAgentIntegration,
  type ClaudeProviderState,
} from "../../adapters/outbound/agent-integrations/claude/claude-agent-integration.ts";
import {
  createCodexAgentIntegration,
  type CodexProviderState,
} from "../../adapters/outbound/agent-integrations/codex/codex-agent-integration.ts";
import { createGeminiAgentIntegration } from "../../adapters/outbound/agent-integrations/gemini/gemini-agent-integration.ts";
import { createOpencodeAgentIntegration } from "../../adapters/outbound/agent-integrations/opencode/opencode-agent-integration.ts";
import { codexRolloutTurnEnded as codexRolloutTurnEndedFromText } from "../../adapters/outbound/agent-integrations/codex/codex-rollout-turn-detection.ts";
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
import { createNodeComposerAttachmentStorePort } from "../../adapters/outbound/composer-attachment-store/node-composer-attachment-store.ts";
import { createNodeProviderTrustPort } from "../../adapters/outbound/provider-trust/node-provider-trust-port.ts";
import {
  ensureProviderBootstrapArtifacts,
  providerBootstrapArtifactsForHome,
} from "./provider-bootstrap-artifacts.ts";
import type {
  AgentSessionBlock,
  AgentSessionBlockUpdate,
} from "../../application/domains/agent-session/agent-session-block.ts";
import type { AgentId, ProviderCliAgentId, PromptState } from "../../application/domains/thread/thread.ts";
import type {
  AgentTurnOutcome,
  DiscoveredProviderSessionRef as AdapterProviderSessionRef,
} from "../../application/ports/outbound/agent-integration-port.ts";
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
  PROVIDER_CLI_AGENT_IDS,
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

// Claude Code (the claude provider) defers MCP tools and discovers them via
// ToolSearch. A vague prompt made it search for bare names like "tide_open_browser"
// — which don't match the real "mcp__tide__*" names — so it stalled before ever
// opening a Browser Pane. Name the tools exactly and tell it to call them directly.
function tideClaudeContextPrompt(): string {
  return [
    "You are running inside Tide, a terminal workspace. Tide exposes real, callable MCP",
    'tools (MCP server name "tide") that control the Tide UI. Their exact names are:',
    "- mcp__tide__tide_open_browser — open/navigate a visible Tide Browser Pane (args: url, title, disposition)",
    "- mcp__tide__tide_observe_browser — read a Browser Pane's content (args: paneId, revision)",
    "- mcp__tide__tide_act_browser — click or type in a Browser Pane (args: paneId, revision, action, selector, text)",
    "- mcp__tide__tide_observe_thread / mcp__tide__tide_observe_workbench — read current Thread/Workbench state",
    "- mcp__tide__tide_open_terminal / mcp__tide__tide_run_terminal_command — visible Terminal Pane",
    "- mcp__tide__tide_read_file / mcp__tide__tide_open_file / mcp__tide__tide_edit_file — files with visible Editor/Diff Panes",
    "",
    "When the user asks to open, show, browse, or navigate a URL/page/file/Tide surface, call",
    "the matching mcp__tide__ tool DIRECTLY — do not fall back to shell. If these tools appear",
    'as deferred, load them by their exact name (e.g. ToolSearch "select:mcp__tide__tide_open_browser")',
    "and then call them. Open a Browser Pane with mcp__tide__tide_open_browser first, then use",
    "mcp__tide__tide_observe_browser and mcp__tide__tide_act_browser to read and act on it.",
  ].join("\n");
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




export function createLiveAgentSessionEventProjector(input: {
  service: () => ThreadRuntimeService;
  persistence: ThreadPersistenceService;
  onEvent?: (event: BackendEventEnvelope) => void;
  homeDir: string;
  integrations: AgentIntegrationRegistry;
}) {
  const reader = createFixtureAgentSessionReader();
  const blocksByThread = new Map<string, AgentSessionBlock[]>();

  // Conversation-cache persistence is COALESCED. A streaming turn produces many
  // content_record block updates; persisting the full conversation on each one is
  // O(messages) full-disk writes per turn (see docs perf E1). Instead we record
  // blocks in the service synchronously (authoritative, in-memory) and schedule a
  // trailing debounced disk write, with a hard flush at the durability-critical
  // moments: turn end, prompt open, runtime exit, and backend shutdown. The cache
  // is a best-effort restore optimization, so losing at most the last debounce
  // window of an INCOMPLETE turn on a hard kill is acceptable; every settled state
  // is always flushed. `TIDE_DEBUG_PERSIST=1` logs each actual write.
  const PERSIST_DEBOUNCE_MS = 300;
  const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const persistInFlight = new Map<string, Promise<void>>();
  let persistWriteCount = 0;

  const runPersist = async (threadId: string): Promise<void> => {
    // Serialize per thread so two atomic writes never race on the same tmp file.
    const prior = persistInFlight.get(threadId) ?? Promise.resolve();
    const next = prior
      .catch(() => {})
      .then(async () => {
        if (process.env.TIDE_DEBUG_PERSIST === "1") {
          persistWriteCount += 1;
          process.stdout.write(
            `[tide-persist] write #${persistWriteCount} thread=${threadId}\n`,
          );
        }
        await persistThreadBlocks({
          persistence: input.persistence,
          service: input.service(),
          threadId,
        });
      });
    persistInFlight.set(threadId, next);
    await next;
    if (persistInFlight.get(threadId) === next) {
      persistInFlight.delete(threadId);
    }
  };

  const schedulePersist = (threadId: string): void => {
    const existing = persistTimers.get(threadId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      persistTimers.delete(threadId);
      void runPersist(threadId);
    }, PERSIST_DEBOUNCE_MS);
    // Never keep the event loop alive solely for a pending best-effort cache write.
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    persistTimers.set(threadId, timer);
  };

  const flushPersist = async (threadId: string): Promise<void> => {
    const timer = persistTimers.get(threadId);
    if (timer !== undefined) {
      clearTimeout(timer);
      persistTimers.delete(threadId);
    }
    await runPersist(threadId);
  };

  const flushAllPersists = async (): Promise<void> => {
    const ids = new Set<string>([...persistTimers.keys(), ...persistInFlight.keys()]);
    await Promise.all([...ids].map((id) => flushPersist(id)));
  };

  // Last usage signature emitted per thread, so identical usage isn't re-emitted
  // on every history poll (the chip would otherwise churn every tick).

  // Reads a provider transcript, parses its last-known context/token usage, and
  // emits `agentRuntime.usageChanged` when it differs from the last emit. A no-op
  // when the transcript is missing or carries no usage yet.
  // Uniform turn settle. Every Agent Integration produces an AgentTurnOutcome from
  // its OWN signals (claude/codex hook payload, codex rollout
  // transcript); this shared path applies it identically — the provider-specific
  // "circus" lives in the adapters, not here. `finalMessage` becomes the agent
  // answer block; `notice` (rate limit / out of credits / empty / error) becomes a
  // visible `error` block so the turn never settles silently empty. Both go through
  // the same reader pipeline as streamed content and are deduped by body, so they
  // never duplicate what the transcript already produced. Then the turn settles.
  const ingestTurnOutcomeAndSettle = async (args: {
    outcome: AgentTurnOutcome;
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    sessionId?: string;
    nextBlocks: Map<string, AgentSessionBlock>;
  }): Promise<void> => {
    const service = input.service();
    const ingest = async (
      kind: "message" | "notice",
      rawBody: string,
    ): Promise<void> => {
      const body = rawBody.trim();
      if (body.length === 0) {
        return;
      }
      let hash = 5381;
      for (let i = 0; i < body.length; i += 1) {
        hash = ((hash << 5) + hash + body.charCodeAt(i)) | 0;
      }
      const sessionId = args.sessionId ?? args.runtimeId;
      const blockId = `provider:${args.threadId}:${sessionId}:${kind}:${(hash >>> 0).toString(36)}`;
      const hydrated = service.peekThread(args.threadId);
      if (!hydrated.ok) {
        return;
      }
      const payload =
        kind === "message"
          ? {
              type: "message",
              role: "agent",
              status: "complete",
              blockId,
              body,
              sourceRuntimeId: args.runtimeId,
            }
          : {
              type: "notice",
              status: "failed",
              blockId,
              body,
              sourceRuntimeId: args.runtimeId,
            };
      const frame = await service.appendRawAgentFrame({
        threadId: args.threadId,
        agentId: args.agentId,
        source: "provider_history",
        sourceRef: blockId,
        payloadKind: "provider_record",
        payload,
        body,
      });
      const result = reader.read({
        thread: hydrated.thread,
        agentBinding: hydrated.thread.agentBinding,
        frames: [frame],
        existingBlocks: [...args.nextBlocks.values()],
      });
      for (const update of result.blockUpdates) {
        await recordBlockUpdateInService(service, update);
        emitBlockUpdate({ update, blocks: args.nextBlocks, onEvent: input.onEvent });
      }
      schedulePersist(args.threadId);
    };

    // finalMessage is content ONLY for one-shot agents (gemini), whose single session
    // read has no competing streaming reader. claude/codex return no finalMessage from
    // turn-end (their readers own the answer), so nothing is double-produced. The
    // body-hashed blockId makes repeated polls idempotent.
    if (args.outcome.finalMessage !== undefined) {
      await ingest("message", args.outcome.finalMessage);
    }
    if (args.outcome.notice !== undefined) {
      await ingest("notice", args.outcome.notice.message);
    }
    await emitTurnComplete({
      threadId: args.threadId,
      service,
      onEvent: input.onEvent,
    });
    // Turn settled — the conversation's durable state matters now; flush eagerly.
    await flushPersist(args.threadId);
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
    const hydrated = service.peekThread(frameInput.threadId);
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
      await recordBlockUpdateInService(service, update);
    }
    blocksByThread.set(frameInput.threadId, [...nextBlocks.values()]);
    schedulePersist(frameInput.threadId);
    await emitPromptState({
      promptState: readResult.promptState,
      service,
      onEvent: input.onEvent,
    });
  };

  return {
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
    // Normalized protocol events from a STRUCTURED provider runtime (the
    // runtime-event spine realized): content records flow through the same
    // frame→block reader as everything else; prompts/turn-ends/session-refs hit
    // the service directly. NO pollers exist for these runtimes — the protocol
    // pushes. See docs_v2/specs/structured-agent-runtime.md.
    async ingestStructuredProviderEvent(eventInput: {
      threadId: string;
      agentId: ProviderCliAgentId;
      runtimeId: string;
      event: StructuredProviderEvent;
    }): Promise<void> {
      const service = input.service();
      const event = eventInput.event;
      if (event.kind === "session_ref") {
        await recordDiscoveredProviderSessionRef({
          service,
          persistence: input.persistence,
          threadId: eventInput.threadId,
          providerSessionRef: event.ref,
        });
        return;
      }
      if (event.kind === "content_record") {
        await appendFrameAndEmit({
          threadId: eventInput.threadId,
          agentId: eventInput.agentId,
          source: "provider_history",
          sourceRef: event.sourceRef,
          payloadKind: "provider_record",
          payload: event.payload,
          body: event.body,
        });
        return;
      }
      if (event.kind === "content_delta") {
        // Live streaming: upsert the block in the in-memory cache and emit the
        // UI event ONLY — no frame append, no reader, no persist (per-token disk
        // writes would blow the perf budget). The matching content_record
        // finalizes + persists the same blockId when the block completes.
        const now = new Date().toISOString();
        const blocks = new Map(
          (blocksByThread.get(eventInput.threadId) ?? []).map((b) => [b.blockId, b]),
        );
        const existing = blocks.get(event.blockId);
        const block: AgentSessionBlock = {
          blockId: event.blockId,
          threadId: eventInput.threadId,
          agentId: eventInput.agentId,
          kind: event.blockKind,
          role: event.role,
          sourceFrameIds: existing?.sourceFrameIds ?? [],
          status: "streaming",
          body: event.body,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        emitBlockUpdate({ update: { kind: "upsert", block }, blocks, onEvent: input.onEvent });
        blocksByThread.set(eventInput.threadId, [...blocks.values()]);
        return;
      }
      if (event.kind === "prompt") {
        await emitPromptState({
          promptState: event.promptState,
          service,
          onEvent: input.onEvent,
        });
        // A prompt pauses the turn waiting on the user; make the conversation up
        // to this point durable so a restart shows it (the stale prompt itself is
        // reconciled away on reopen).
        await flushPersist(eventInput.threadId);
        return;
      }
      if (event.kind === "commands") {
        input.onEvent?.({
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "agentRuntime.commandsChanged",
          emittedAt: new Date().toISOString(),
          payload: {
            threadId: eventInput.threadId,
            agentId: eventInput.agentId,
            commands: event.commands,
          },
        });
        return;
      }
      if (event.kind === "runtime_notice") {
        input.onEvent?.({
          contractVersion: CONTRACT_VERSION,
          eventId: nextEventId(),
          kind: "agentRuntime.noticePosted",
          emittedAt: new Date().toISOString(),
          payload: {
            threadId: eventInput.threadId,
            agentId: eventInput.agentId,
            level: event.level,
            message: event.message,
          },
        });
        return;
      }
      if (event.kind === "prompt_withdrawn") {
        // The provider cancelled its own pending interaction. The next
        // turn_completed (which always follows) clears card+queue in
        // recordTurnComplete; nothing to do eagerly.
        return;
      }
      if (event.kind === "turn_completed") {
        if (event.usage !== undefined) {
          emitStructuredUsage({
            threadId: eventInput.threadId,
            usage: event.usage,
            onEvent: input.onEvent,
          });
        }
        const nextBlocks = new Map(
          (blocksByThread.get(eventInput.threadId) ?? []).map((block) => [
            block.blockId,
            block,
          ]),
        );
        const outcome: AgentTurnOutcome =
          event.notice !== undefined
            ? { notice: { severity: "error", message: event.notice } }
            : {};
        await ingestTurnOutcomeAndSettle({
          outcome,
          threadId: eventInput.threadId,
          agentId: eventInput.agentId,
          runtimeId: eventInput.runtimeId,
          nextBlocks,
        });
        blocksByThread.set(eventInput.threadId, [...nextBlocks.values()]);
        return;
      }
      if (event.kind === "runtime_exited") {
        // A crash mid-turn must not strand the thread "Working": settle it.
        // (recordTurnComplete is a no-op when the thread is already idle.)
        await emitTurnComplete({
          threadId: eventInput.threadId,
          service,
          onEvent: input.onEvent,
        });
        await flushPersist(eventInput.threadId);
      }
    },
    // Flush every pending debounced conversation-cache write immediately. Wired to
    // backend shutdown so a clean quit never loses the trailing debounce window.
    async flushPendingPersists(): Promise<void> {
      await flushAllPersists();
    },
  };
}

// Token usage reported natively by a structured protocol turn (claude result
// modelUsage; codex thread/tokenUsage/updated; gemini _meta.quota).
function emitStructuredUsage(input: {
  threadId: string;
  usage: { inputTokens?: number; outputTokens?: number; contextWindow?: number; totalTokens?: number };
  onEvent?: (event: BackendEventEnvelope) => void;
}): void {
  const total = input.usage.totalTokens;
  if (total === undefined) {
    return;
  }
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: nextEventId(),
    kind: "agentRuntime.usageChanged",
    emittedAt: new Date().toISOString(),
    payload: {
      threadId: input.threadId,
      usage: {
        totalTokens: total,
        ...(input.usage.contextWindow !== undefined
          ? { contextWindow: input.usage.contextWindow }
          : {}),
      },
    },
  });
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

// Record a block update in the service's authoritative in-memory state ONLY.
// Disk persistence is coalesced separately (schedulePersist/flushPersist in the
// projector) so a streaming turn doesn't rewrite the whole conversation per block.
async function recordBlockUpdateInService(
  service: ThreadRuntimeService,
  update: AgentSessionBlockUpdate,
): Promise<void> {
  if (update.kind === "upsert") {
    await service.recordAgentSessionBlock({
      threadId: update.block.threadId,
      block: update.block,
    });
  } else if (update.kind === "reset") {
    for (const block of update.blocks) {
      await service.recordAgentSessionBlock({ threadId: block.threadId, block });
    }
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
  try {
    await persistThreadBlocksUnsafe(input);
  } catch (error) {
    // The Agent Session cache is a best-effort restore optimization — the live
    // service holds the authoritative blocks in memory and the next write persists
    // the full list again. A transient FS error (concurrent atomic-write rename
    // race, or teardown removing the dir mid-write) must never crash the backend.
    process.emitWarning(
      error instanceof Error ? error.message : String(error),
      { type: "TidePersistenceCacheWarning" },
    );
  }
}

async function persistThreadBlocksUnsafe(input: {
  persistence: ThreadPersistenceService;
  service: ThreadRuntimeService;
  threadId: string;
}): Promise<void> {
  const hydrated = input.service.peekThread(input.threadId);
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
      queuedInputs: result.thread.queuedInputs,
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
  // Announce the waiting state too: prompt.changed alone leaves a BACKGROUND
  // thread's rail row without its attention dot/notification (adversarial
  // review finding) — the rail listens to agentRuntime.stateChanged.
  input.onEvent?.({
    contractVersion: CONTRACT_VERSION,
    eventId: nextEventId(),
    kind: "agentRuntime.stateChanged",
    emittedAt: new Date().toISOString(),
    payload: {
      threadId: result.thread.threadId,
      state: result.runtimeState,
      changedAt: result.thread.updatedAt,
      queuedInputs: result.thread.queuedInputs,
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

// Provider CLI command names: pure registry data, the only place infrastructure
// may know a provider-specific value.
const providerCliCommands = {
  codex: "codex",
  claude: "claude",
  gemini: "gemini",
  opencode: "opencode",
} as const;

function executableForAgent(
  agentId: "codex" | "claude" | "gemini" | "opencode",
): string {
  return providerCliCommands[agentId];
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









// Reads the leading bytes of a file (codex session_meta and the first user turn
// live near the top), bounded so large transcripts stay cheap to scan.

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
  return [];
}

// Locates the on-disk gemini session file for a Tide-minted session id:
// ~/.gemini/tmp/<project>/chats/session-<ts>-<uuid8>.jsonl whose header line
// carries the full sessionId. Deterministic — keyed by the assigned id, never by
// recency — so concurrent same-prompt threads can never swap sessions.
// Locates the on-disk claude transcript for a Tide-minted session id:
// ~/.claude/projects/<munged-cwd>/<session-id>.jsonl. Deterministic — keyed by
// the assigned id (the filename IS the id), never by recency. The project dir is
// scanned because claude munges its OWN canonical cwd, which can differ from
// Tide's spelling via symlinks (/var -> /private/var) or casing.
export function locateClaudeTranscriptFile(
  homeDir: string,
  sessionId: string,
): string | undefined {
  const projectsRoot = join(homeDir, ".claude", "projects");
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  for (const project of projectDirs) {
    const candidate = join(projectsRoot, project, `${sessionId}.jsonl`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function locateGeminiSessionFile(
  homeDir: string,
  sessionId: string,
): string | undefined {
  const tmpRoot = join(homeDir, ".gemini", "tmp");
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(tmpRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  const idFragment = sessionId.slice(0, 8);
  for (const project of projectDirs) {
    const chatsDir = join(tmpRoot, project, "chats");
    let names: string[];
    try {
      names = readdirSync(chatsDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("session-") || !/\.jsonl?$/.test(name)) {
        continue;
      }
      // The filename embeds the first 8 chars of the session id; the header line
      // carries the full id. Both must match.
      if (!name.includes(idFragment)) {
        continue;
      }
      const path = join(chatsDir, name);
      try {
        const headerLine = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
        const header = JSON.parse(headerLine) as Record<string, unknown>;
        if (header.sessionId === sessionId) {
          return path;
        }
      } catch {
        // Skip unreadable/partial files; the next poll retries.
      }
    }
  }
  return undefined;
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













