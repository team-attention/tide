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
  readAntigravityProviderStateFromHome,
  readClaudeProviderStateFromHome,
  readCodexProviderStateFromHome,
  readGeminiProviderStateFromHome,
} from "./provider-state-readers.ts";
import {
  antigravityProviderSessionRefFromTranscriptPath,
  claudeProviderSessionRefFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
  providerSessionRefFromProviderSignalPayload,
  type DiscoveredProviderSessionRef,
} from "./provider-session-ref.ts";
import {
  rebuildAntigravityConversation,
  rebuildClaudeConversation,
  rebuildCodexConversation,
  rebuildConversationFromProviderHistory,
} from "./provider-conversation-rebuilders.ts";
import { parseProviderUsage } from "./provider-usage.ts";
import { recentCodexRollouts } from "./recent-provider-files.ts";
import {
  readAntigravityProviderHistoryFramesFromHome,
  readClaudeProviderHistoryFramesFromHome,
  readClaudeProviderSessionRefsFromHome,
  readCodexProviderHistoryFramesFromHome,
  readCodexProviderSessionRefsFromHome,
  readProviderSignalFramesFromSpool,
  type AntigravityProviderHistoryFrame,
  type ClaudeProviderHistoryFrame,
  type CodexProviderHistoryFrame,
  type ProviderSignalSpoolFrame,
} from "./provider-history-readers.ts";
export {
  readAntigravityProviderHistoryFramesFromHome,
  readClaudeProviderHistoryFramesFromHome,
  readClaudeProviderSessionRefsFromHome,
  readCodexProviderHistoryFramesFromHome,
  readCodexProviderSessionRefsFromHome,
  readProviderSignalFramesFromSpool,
};
export type {
  AntigravityProviderHistoryFrame,
  ClaudeProviderHistoryFrame,
  CodexProviderHistoryFrame,
  ProviderSignalSpoolFrame,
};
export {
  rebuildAntigravityConversation,
  rebuildClaudeConversation,
  rebuildCodexConversation,
};
export type { DiscoveredProviderSessionRef };
export {
  antigravityProviderSessionRefFromTranscriptPath,
  claudeProviderSessionRefFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
  providerSessionRefFromProviderSignalPayload,
};
export {
  readAntigravityProviderStateFromHome,
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
import { antigravityRecordIsTurnEnd } from "../../adapters/outbound/agent-integrations/antigravity/antigravity-transcript-turn-detection.ts";
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
  isAntigravityPluginBootstrapReady,
  isClaudeBootstrapReady,
  isCodexBootstrapReady,
  providerBootstrapArtifactsForHome,
} from "./provider-bootstrap-artifacts.ts";
import type {
  AgentSessionBlock,
  AgentSessionBlockUpdate,
} from "../../application/domains/agent-session/agent-session-block.ts";
import type { AgentId, ProviderCliAgentId, PromptState } from "../../application/domains/thread/thread.ts";
import type { AgentTurnOutcome } from "../../application/ports/outbound/agent-integration-port.ts";
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
    }),
    antigravity: createAntigravityAgentIntegration({
      resolveExecutable: () => resolveExecutable("agy"),
      readProviderState: ({ cwd }) => readAntigravityProviderStateFromHome(homeDir, cwd),
      tidePlugin: {
        installSourcePath: bootstrapArtifacts.antigravityPluginSourcePath,
      },
      defaultCwd: process.cwd(),
    }),
    gemini: createGeminiAgentIntegration({
      resolveExecutable: () => resolveExecutable("gemini"),
      readProviderState: ({ cwd }) => readGeminiProviderStateFromHome(homeDir, cwd),
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
  // Shared first-turn handoff gate: the runtime port waits on it before delivering a
  // tool_surface_ready agent's first prompt; the Tide MCP socket server marks a
  // runtime ready when that runtime completes its tools/list handshake.
  const readinessRegistry = createRuntimeReadinessRegistry();
  const providerCliRuntimePort = createAgentIntegrationAgentRuntimePort({
    integrations,
    launcher: ptyLauncher,
    readinessRegistry,
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
    composerAttachmentStorePort: createNodeComposerAttachmentStorePort(),
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
    adapter: createBackendContractMessageAdapter({
      service,
      // Detect which provider-CLI agents are installed locally (executable resolves).
      // The composer menu enables these and shows the rest disabled. Evaluated per
      // thread.list so a CLI installed after launch is picked up.
      detectAvailableAgents: () =>
        (["codex", "claude", "antigravity", "gemini"] as const).filter(
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
  providerSignalSpoolDir: string;
}) {
  const reader = createFixtureAgentSessionReader();
  const blocksByThread = new Map<string, AgentSessionBlock[]>();
  // Last usage signature emitted per thread, so identical usage isn't re-emitted
  // on every history poll (the chip would otherwise churn every tick).
  const usageSignatureByThread = new Map<string, string>();

  // Reads a provider transcript, parses its last-known context/token usage, and
  // emits `agentRuntime.usageChanged` when it differs from the last emit. A no-op
  // when the transcript is missing or carries no usage yet.
  const emitProviderUsage = (emitInput: {
    threadId: string;
    agentId: ProviderCliAgentId;
    transcriptPath?: string;
  }): void => {
    // Usage is a non-essential decoration: it must NEVER throw and stall the
    // history-emit path (which renders the agent's actual answer). Any parse
    // failure is swallowed.
    try {
      if (emitInput.transcriptPath === undefined) {
        return;
      }
      const text = readBoundedTail(emitInput.transcriptPath, 256 * 1024);
      if (text === undefined) {
        return;
      }
      const usage = parseProviderUsage(text, emitInput.agentId);
      if (usage === undefined) {
        return;
      }
      const signature = JSON.stringify(usage);
      if (usageSignatureByThread.get(emitInput.threadId) === signature) {
        return;
      }
      usageSignatureByThread.set(emitInput.threadId, signature);
      input.onEvent?.({
        contractVersion: CONTRACT_VERSION,
        eventId: nextEventId(),
        kind: "agentRuntime.usageChanged",
        emittedAt: new Date().toISOString(),
        payload: { threadId: emitInput.threadId, usage },
      });
    } catch {
      // ignore — usage is best-effort.
    }
  };

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
  const geminiHistoryByRuntime = new Map<
    string,
    { sinceMs: number; seenKeys: Set<string>; pollingStarted: boolean }
  >();
  // One-source rule for the turn's final answer. Every agent persists its reply to a
  // history file (claude transcript / codex rollout / gemini session) — that file,
  // surfaced by the streaming history reader, is the SOLE content source. The turn-end
  // outcome (claude Stop hook `last_assistant_message`, codex `task_complete`) is a
  // settle signal whose `finalMessage` is only a *fallback* answer, used when the
  // history file has not yielded the reply yet (gemini's one-shot read; a transcript
  // that lags its turn-end marker). We scope that fallback by the turn's user message:
  // once the reader has emitted an answer for a turn, the outcome's finalMessage for the
  // same turn is suppressed. This replaces the old body-compare dedup (`isDuplicate…`)
  // with a structural guarantee that the reply renders exactly once.
  const answeredTurnByThread = new Map<string, string>();
  const markTurnAnswered = (
    threadId: string,
    userMessage: string | undefined,
  ): void => {
    if (userMessage !== undefined) {
      answeredTurnByThread.set(threadId, userMessage);
    }
  };
  const turnAlreadyAnswered = (
    threadId: string,
    userMessage: string | undefined,
  ): boolean =>
    userMessage !== undefined && answeredTurnByThread.get(threadId) === userMessage;
  // True when this update renders a non-empty agent_message — i.e. the turn's reply.
  const isAnswerUpdate = (update: AgentSessionBlockUpdate): boolean =>
    update.kind === "upsert" &&
    update.block.kind === "agent_message" &&
    typeof update.block.body === "string" &&
    update.block.body.trim().length > 0;
  // The one-source rule for a streaming history reader. The reader and the turn-end
  // fallback race (the Stop hook can fire before the next 1s poll reads the transcript,
  // or after) — whichever emits the answer first wins; the loser suppresses its copy.
  // Returns true when this answer update should be SKIPPED. Non-answer updates (tool
  // calls, reasoning, prompts) always pass through.
  const suppressAlreadyAnsweredReply = (
    threadId: string,
    userMessage: string | undefined,
    update: AgentSessionBlockUpdate,
  ): boolean => {
    if (!isAnswerUpdate(update)) {
      return false;
    }
    if (turnAlreadyAnswered(threadId, userMessage)) {
      return true;
    }
    markTurnAnswered(threadId, userMessage);
    return false;
  };
  // Per-runtime rolling PTY buffer + last-surfaced signature for TUI prompts (codex's
  // boxed approval/choice menus, which have no hook). Generic plumbing: detection lives
  // in the Agent Integration; this only feeds text in, surfaces once, and drops the
  // buffer when the prompt clears. See docs_v2/specs/agent-prompt-surfacing.md.
  const ptyPromptByRuntime = new Map<
    string,
    { buffer: string; surfacedSignature?: string }
  >();

  // Uniform turn settle. Every Agent Integration produces an AgentTurnOutcome from
  // its OWN signals (claude/codex hook payload, codex rollout, antigravity
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
    // Identify the turn so the final-answer fallback can stand down once the history
    // reader has already shown this turn's reply (the one-source rule above).
    const hydratedForTurn = await service.hydrateThread({ threadId: args.threadId });
    const turnUserMessage = hydratedForTurn.ok
      ? latestUserMessageForProviderHistory(hydratedForTurn.thread)
      : undefined;
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
      const hydrated = await service.hydrateThread({ threadId: args.threadId });
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
        await recordBlockUpdateInThreadCache(input.persistence, service, update);
        emitBlockUpdate({ update, blocks: args.nextBlocks, onEvent: input.onEvent });
      }
    };

    // Fallback answer: only when the history reader has not already produced this
    // turn's reply. Marking the turn answered keeps a later poll from re-ingesting it.
    if (
      args.outcome.finalMessage !== undefined &&
      !turnAlreadyAnswered(args.threadId, turnUserMessage)
    ) {
      // Claim the turn synchronously BEFORE awaiting, so a concurrent reader poll can't
      // slip into the await window and emit a second copy of the same reply.
      markTurnAnswered(args.threadId, turnUserMessage);
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
  };

  // History-driven settle: read the bound rollout/transcript tail, ask the adapter
  // whether the current turn ended (and with what outcome), and apply it uniformly.
  // The binding-independent counterpart of the hook path. Used by the per-provider
  // history emitters (codex rollout, antigravity transcript).
  const settleFromHistory = async (args: {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    boundPath: string | undefined;
    expectedUserMessage: string | undefined;
    nextBlocks: Map<string, AgentSessionBlock>;
  }): Promise<void> => {
    if (args.boundPath === undefined) {
      return;
    }
    const tail = readBoundedTail(args.boundPath, 256 * 1024);
    if (tail === undefined) {
      return;
    }
    const outcome = input.integrations[args.agentId].turnEndFromHistory(
      tail,
      args.expectedUserMessage,
    );
    if (outcome === null) {
      return;
    }
    await ingestTurnOutcomeAndSettle({
      outcome,
      threadId: args.threadId,
      agentId: args.agentId,
      runtimeId: args.runtimeId,
      nextBlocks: args.nextBlocks,
    });
  };

  const emitProviderSignals = async (frameInput: {
    threadId: string;
    agentId: ProviderCliAgentId;
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
      // Hook-driven turn-end (claude agent-idle / codex codex-stop): the adapter
      // decides whether this hook ends the turn and extracts the outcome from the
      // runtime-keyed payload. Apply it uniformly (answer/notice + settle).
      const hookOutcome = input.integrations[frameInput.agentId].turnEndFromHook(
        signalFrame.eventName,
        signalFrame.payload,
      );
      if (hookOutcome !== null) {
        const sessionId =
          typeof signalFrame.payload === "object" &&
          signalFrame.payload !== null &&
          typeof (signalFrame.payload as Record<string, unknown>).session_id === "string"
            ? ((signalFrame.payload as Record<string, unknown>).session_id as string)
            : undefined;
        await ingestTurnOutcomeAndSettle({
          outcome: hookOutcome,
          threadId: frameInput.threadId,
          agentId: frameInput.agentId,
          runtimeId: frameInput.runtimeId,
          sessionId,
          nextBlocks,
        });
      }
    }
    blocksByThread.set(frameInput.threadId, [...nextBlocks.values()]);
  };

  // Tail a provider's transcript/signal file by re-running `emit` once per interval
  // WHILE the turn is running, then stop a few cycles after it goes idle. (The old
  // fixed poll count gave up at ~45s, so a slow concurrent turn that finished later
  // got stuck "Working" forever because its on-disk answer was never re-read.) The
  // hard cap is only a runaway safety net for a turn whose end is never detected.
  const pollWhileRunning = (
    threadId: string,
    state: { pollingStarted: boolean },
    emit: () => Promise<void>,
    intervalMs: number,
  ): void => {
    if (state.pollingStarted) {
      return;
    }
    state.pollingStarted = true;
    let hardCap = Math.ceil((90 * 60 * 1000) / intervalMs);
    let idleGrace = 3;
    const poll = async (): Promise<void> => {
      if (hardCap <= 0) {
        return;
      }
      hardCap -= 1;
      await emit();
      const hydrated = await input.service().hydrateThread({ threadId });
      const running =
        hydrated.ok &&
        (hydrated.thread.runtimeState === "running" ||
          hydrated.thread.runtimeState === "starting");
      if (running) {
        idleGrace = 3;
      } else if (--idleGrace <= 0) {
        return;
      }
      const timer = setTimeout(() => void poll(), intervalMs);
      timer.unref?.();
    };
    const timer = setTimeout(() => void poll(), intervalMs);
    timer.unref?.();
  };

  // End a running turn that has settled but emitted no normal turn-end signal, so the
  // UI doesn't hang "Working". WHETHER a turn ended is decided structurally per
  // provider (typed frames / events) — never by scanning free text for error wording.
  const endRunningTurn = async (threadId: string): Promise<void> => {
    const service = input.service();
    const hydrated = await service.hydrateThread({ threadId });
    if (!hydrated.ok) {
      return;
    }
    if (
      hydrated.thread.runtimeState !== "running" &&
      hydrated.thread.runtimeState !== "starting"
    ) {
      return;
    }
    await emitTurnComplete({ threadId, service, onEvent: input.onEvent });
  };

  // Structural codex turn-end detection from the bound rollout (no regex / text
  // matching), scoped to the current turn. codex writes a typed `event_msg` whose
  // payload type is `task_complete` on a normal finish and `turn_aborted` on a
  // limit / error / interrupt. We poll for either so a turn settles even when the
  // `codex-stop` HOOK never fires (which otherwise hangs the UI "Working" forever and
  // never consumes a queued follow-up). `task_complete` is only honored once we've
  // located the current turn's user message, so a prior turn's completion can't end
  // this one early.
  // Read the bound rollout tail and delegate the typed turn-end decision to the
  // codex Agent Integration's detection logic. The provider lifecycle knowledge
  // (event_msg task_complete / turn_aborted, honored-once user-message guard)
  // lives in the codex adapter, not in shared infrastructure.
  const codexRolloutTurnEnded = (
    boundRolloutPath: string | undefined,
    expectedUserMessage: string | undefined,
  ): boolean => {
    if (boundRolloutPath === undefined) {
      return false;
    }
    const text = readBoundedTail(boundRolloutPath, 256 * 1024);
    if (text === undefined) {
      return false;
    }
    return codexRolloutTurnEndedFromText(text, expectedUserMessage);
  };

  const scheduleProviderSignalPolling = (frameInput: {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
  }): void => {
    const signalState =
      providerSignalsByRuntime.get(frameInput.runtimeId) ??
      { seenKeys: new Set<string>(), pollingStarted: false };
    providerSignalsByRuntime.set(frameInput.runtimeId, signalState);
    pollWhileRunning(
      frameInput.threadId,
      signalState,
      () => emitProviderSignals(frameInput),
      500,
    );
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
      boundRolloutPath: hydrated.thread.agentBinding.providerSessionRef?.transcriptPath,
    });
    emitProviderUsage({
      threadId: frameInput.threadId,
      agentId: "codex",
      transcriptPath: hydrated.thread.agentBinding.providerSessionRef?.transcriptPath,
    });
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
        if (
          suppressAlreadyAnsweredReply(frameInput.threadId, expectedUserMessage, update)
        ) {
          continue;
        }
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
    // Authoritative codex turn-end from the rollout (task_complete / turn_aborted),
    // AFTER ingesting frames so the answer is recorded first. Surfaces a credit /
    // rate-limit notice when codex finished without producing a response. Runs on
    // zero-frame polls too, so a turn can't hang "Working".
    await settleFromHistory({
      threadId: frameInput.threadId,
      agentId: "codex",
      runtimeId: frameInput.runtimeId,
      boundPath: hydrated.thread.agentBinding.providerSessionRef?.transcriptPath,
      expectedUserMessage,
      nextBlocks,
    });
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
    pollWhileRunning(
      frameInput.threadId,
      historyState,
      () => emitCodexHistory(frameInput),
      1000,
    );
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
      boundTranscriptPath: hydrated.thread.agentBinding.providerSessionRef?.transcriptPath,
    });
    emitProviderUsage({
      threadId: frameInput.threadId,
      agentId: "claude",
      transcriptPath: hydrated.thread.agentBinding.providerSessionRef?.transcriptPath,
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
        // The transcript is claude's content source: it writes the assistant answer
        // ~0.3s before the Stop hook fires. Whichever of the two reads the reply first
        // (this poll, or the hook fallback) wins; the other suppresses its copy so the
        // answer renders exactly once (one-source rule).
        if (
          suppressAlreadyAnsweredReply(frameInput.threadId, expectedUserMessage, update)
        ) {
          continue;
        }
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
    pollWhileRunning(
      frameInput.threadId,
      historyState,
      () => emitClaudeHistory(frameInput),
      1000,
    );
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
    const expectedUserMessage = latestUserMessageForProviderHistory(hydrated.thread);

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
      boundTranscriptPath: hydrated.thread.agentBinding.providerSessionRef?.transcriptPath,
    });
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
        if (
          suppressAlreadyAnsweredReply(frameInput.threadId, expectedUserMessage, update)
        ) {
          continue;
        }
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
    // Antigravity emits no turn-end hook, so the runtime never sees `agent-idle`.
    // Its turn-end is read from the transcript (terminal PLANNER_RESPONSE) through
    // the same uniform settle path as codex's rollout.
    await settleFromHistory({
      threadId: frameInput.threadId,
      agentId: "antigravity",
      runtimeId: frameInput.runtimeId,
      boundPath: hydrated.thread.agentBinding.providerSessionRef?.transcriptPath,
      expectedUserMessage: undefined,
      nextBlocks,
    });
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
    pollWhileRunning(
      frameInput.threadId,
      historyState,
      () => emitAntigravityHistory(frameInput),
      1000,
    );
  };

  // Gemini writes a session JSONL (user / gemini records) under
  // ~/.gemini/tmp/<project>/chats/session-*.jsonl. It fires no usable turn-end hook
  // in the prompt-interactive path, so — like antigravity — turn-end + the final
  // answer are read from that session file. Gemini does not report the session path
  // via a hook, so the bound session is discovered by recency: the most recent
  // session file written since this runtime started.
  const emitGeminiHistory = async (frameInput: {
    threadId: string;
    agentId: "gemini";
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
      geminiHistoryByRuntime.get(frameInput.runtimeId) ??
      { sinceMs: Date.now() - 15_000, seenKeys: new Set<string>(), pollingStarted: false };
    geminiHistoryByRuntime.set(frameInput.runtimeId, historyState);

    const boundPath =
      hydrated.thread.agentBinding.providerSessionRef?.transcriptPath ??
      findRecentGeminiSessionPath(input.homeDir, historyState.sinceMs);
    if (boundPath === undefined) {
      return;
    }
    await recordDiscoveredProviderSessionRef({
      service,
      persistence: input.persistence,
      threadId: frameInput.threadId,
      providerSessionRef: {
        agentId: "gemini",
        kind: "gemini_session",
        value: boundPath,
        transcriptPath: boundPath,
      },
    });
    const nextBlocks = new Map(
      (blocksByThread.get(frameInput.threadId) ?? []).map((block) => [block.blockId, block]),
    );
    await settleFromHistory({
      threadId: frameInput.threadId,
      agentId: "gemini",
      runtimeId: frameInput.runtimeId,
      boundPath,
      expectedUserMessage,
      nextBlocks,
    });
    blocksByThread.set(frameInput.threadId, [...nextBlocks.values()]);
  };

  const scheduleGeminiHistoryPolling = (frameInput: {
    threadId: string;
    agentId: "gemini";
    runtimeId: string;
  }): void => {
    const historyState =
      geminiHistoryByRuntime.get(frameInput.runtimeId) ??
      { sinceMs: Date.now() - 15_000, seenKeys: new Set<string>(), pollingStarted: false };
    geminiHistoryByRuntime.set(frameInput.runtimeId, historyState);
    pollWhileRunning(
      frameInput.threadId,
      historyState,
      () => emitGeminiHistory(frameInput),
      1000,
    );
  };

  // Surface a provider's TUI prompt scraped from the hidden PTY (codex's boxed
  // approval/choice menus have no hook). The box can split across PTY chunks, so
  // accumulate a bounded rolling buffer per runtime and ask the Agent Integration to
  // detect a prompt in it. Idempotent lifecycle: while a prompt is pending, the
  // provider's redraws of the same box are no-ops; when it is answered (the thread's
  // promptState clears) drop the buffer so the now-stale box can't re-surface, while a
  // genuinely repeated prompt re-renders a fresh box and surfaces again.
  const MAX_PTY_PROMPT_BUFFER = 16_384;
  const maybeSurfacePtyPrompt = async (frameInput: {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    body: string;
  }): Promise<void> => {
    const service = input.service();
    const hydrated = await service.hydrateThread({ threadId: frameInput.threadId });
    if (!hydrated.ok) {
      return;
    }

    const state =
      ptyPromptByRuntime.get(frameInput.runtimeId) ?? { buffer: "" };
    ptyPromptByRuntime.set(frameInput.runtimeId, state);

    // A prompt we surfaced was answered/cleared → its box text is stale; drop it.
    if (
      state.surfacedSignature !== undefined &&
      hydrated.thread.promptState === undefined
    ) {
      state.buffer = "";
      state.surfacedSignature = undefined;
    }

    state.buffer = (state.buffer + frameInput.body).slice(-MAX_PTY_PROMPT_BUFFER);

    // A prompt is already pending and unanswered: redraws of the same box are no-ops.
    if (hydrated.thread.promptState !== undefined) {
      return;
    }

    const promptState = input.integrations[frameInput.agentId].detectPromptState({
      threadId: frameInput.threadId,
      source: "pty_transcript",
      text: state.buffer,
    });
    if (promptState === null) {
      return;
    }
    state.surfacedSignature = promptState.promptId;
    await emitPromptState({ promptState, service, onEvent: input.onEvent });
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
      agentId: ProviderCliAgentId;
      runtimeId: string;
    }): void {
      scheduleProviderSignalPolling(runtime);
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
      if (runtime.agentId === "gemini") {
        scheduleGeminiHistoryPolling({
          threadId: runtime.threadId,
          agentId: "gemini",
          runtimeId: runtime.runtimeId,
        });
      }
    },
    async ingestOutput(frameInput: {
      threadId: string;
      agentId: ProviderCliAgentId;
      runtimeId: string;
      runtimePid?: number;
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
      // Surface any TUI prompt the agent rendered into the hidden PTY (codex's boxed
      // approval/choice menus; a no-op for providers that prompt only via hooks).
      await maybeSurfacePtyPrompt({
        threadId: frameInput.threadId,
        agentId: frameInput.agentId,
        runtimeId: frameInput.runtimeId,
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

      if (frameInput.agentId === "gemini") {
        await emitGeminiHistory({
          threadId: frameInput.threadId,
          agentId: frameInput.agentId,
          runtimeId: frameInput.runtimeId,
        });
        scheduleGeminiHistoryPolling({
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

function executableForAgent(
  agentId: "codex" | "claude" | "antigravity" | "gemini",
): string {
  return agentId === "antigravity" ? "agy" : agentId;
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

// Discover the gemini session JSONL for the current turn by recency: gemini does not
// report its session path via a hook, so bind the most recent
// ~/.gemini/tmp/<project>/chats/session-*.jsonl written since the runtime started.
function findRecentGeminiSessionPath(
  homeDir: string,
  sinceMs: number,
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
  let best: { path: string; mtimeMs: number } | undefined;
  for (const project of projectDirs) {
    const chatsDir = join(tmpRoot, project, "chats");
    let names: string[];
    try {
      names = readdirSync(chatsDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("session-") || !name.endsWith(".jsonl")) {
        continue;
      }
      const path = join(chatsDir, name);
      try {
        const mtimeMs = statSync(path).mtimeMs;
        if (mtimeMs >= sinceMs && (best === undefined || mtimeMs > best.mtimeMs)) {
          best = { path, mtimeMs };
        }
      } catch {
        // Skip files that vanished between listing and stat.
      }
    }
  }
  return best?.path;
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













