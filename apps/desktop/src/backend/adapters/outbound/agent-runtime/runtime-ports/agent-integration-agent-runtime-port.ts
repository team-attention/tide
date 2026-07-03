import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  AgentRuntimeCapabilityInvocationInput,
  AgentRuntimeCapabilityInvocationResult,
  AgentSessionConfigInput,
  AgentSessionConfigResult,
  TerminalInput,
} from "../../../../application/domains/agent-runtime/agent-runtime.ts";
import type { ComposerAttachmentRef } from "../../../../application/domains/thread/thread.ts";
import type {
  AgentRuntimePort,
  DiscoveredCommand,
} from "../../../../application/ports/outbound/agent-runtime-port.ts";
import type {
  AgentIntegrationPort,
  ProviderLaunchPlan,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import type { ProviderReadinessPort } from "../../../../application/ports/outbound/provider-readiness-port.ts";
import type {
  AgentId,
  ProviderCliAgentId,
} from "../../../../application/domains/thread/thread.ts";
import type { ProviderUpdateAdvisory } from "../../../../application/domains/provider-readiness/provider-readiness.ts";
import {
  isProviderCliAgentId,
  sessionRefKindForAgent,
} from "../../../../../shared/agent-descriptors.ts";
import { createClaudeStreamJsonClient } from "../structured/claude-stream-json-client.ts";
import { createCodexAppServerClient } from "../structured/codex-app-server-client.ts";
import { createAcpClient } from "../structured/acp-client.ts";
import type {
  StructuredProviderEvent,
  StructuredRuntimeClient,
} from "../structured/structured-runtime-events.ts";
import type { NativeRuntimeEvent, NativeTransport } from "../../../../application/domains/native-agent/native-runtime-event.ts";
import { structuredToNativeRuntimeEvent } from "../clients/structured-to-native-runtime-event.ts";
import { sanitizeProviderRuntimeEnv } from "./provider-runtime-env.ts";

export type AgentIntegrationRegistry = Record<ProviderCliAgentId, AgentIntegrationPort>;

// How long the handshake-only command probe waits for the agent's `commands`
// event before giving up (the caller then keeps its file-discovery fallback).
const COMMAND_PROBE_TIMEOUT_MS = 8000;

// A live structured-transport runtime: the provider's machine protocol over
// plain stdio (claude stream-json / codex app-server / opencode ACP). There is no
// PTY, no scrape, no hooks, no polling — the client pushes normalized
// StructuredProviderEvents. See docs_v2/specs/structured-agent-runtime.md.
interface StructuredRuntimeState {
  client: StructuredRuntimeClient;
  threadId: string;
  agentId: ProviderCliAgentId;
}

export interface CreateAgentIntegrationRuntimePortInput {
  integrations: AgentIntegrationRegistry;
  resolveRuntimeEnvironment?: (input: {
    cwd: string;
    planEnv: Record<string, string>;
  }) => NodeJS.ProcessEnv;
  // Normalized protocol events from the structured runtime clients (content
  // records, prompts, turn ends, session refs).
  onProviderEvent?: (input: {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    event: StructuredProviderEvent;
  }) => Promise<void> | void;
  onNativeEvent?: (input: {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    event: NativeRuntimeEvent;
  }) => Promise<void> | void;
  clock?: () => string;
  idGenerator?: () => string;
  // Resolves a Claude session id to its on-disk `subagents/` dir, enabling the live
  // `Task` fan-out activity watcher. Infra-injected (needs the home dir); absent in
  // tests/probes. See live-turn-activity-visibility.md (Slice B).
  locateSubagentsDir?: (sessionId: string) => string | undefined;
}

// A synchronous source of "a newer CLI is published" advisories, consulted while
// building readiness. The implementation (infra) caches versions and refreshes
// off the critical path; here it is a pure lookup so readiness never blocks on a
// subprocess or the network. Spec: version-management.md (Lane 2).
export interface AgentCliUpdateChecker {
  advisoryFor(
    agentId: ProviderCliAgentId,
    cwd: string,
  ): ProviderUpdateAdvisory | undefined;
  // Re-read installed + latest versions into the cache `advisoryFor` answers from.
  // Optional: only the live (refreshable) checker implements it; absent in tests/older
  // wiring. Used to clear a stale advisory right after an in-place CLI update.
  refresh?(): Promise<unknown>;
}

export interface CreateAgentIntegrationProviderReadinessPortInput {
  integrations: AgentIntegrationRegistry;
  // Optional: attaches a non-blocking update advisory to the readiness result.
  // Absent ⇒ no advisory (older wiring / tests that don't exercise updates).
  updateChecker?: AgentCliUpdateChecker;
}

export function createAgentIntegrationProviderReadinessPort(
  input: CreateAgentIntegrationProviderReadinessPortInput,
): ProviderReadinessPort {
  return {
    async refreshUpdateAdvisories() {
      // Force the version cache fresh so the next `check()` reflects a just-completed
      // in-place CLI update (otherwise the update advisory lingers until the next slow
      // background refresh / restart). No-op when the checker can't refresh.
      try {
        await input.updateChecker?.refresh?.();
      } catch {
        // Refresh is advisory-only; never let a transient checker failure block replay.
      }
    },
    async check(checkInput) {
      if (!isProviderCliAgentId(checkInput.agentId)) {
        return {
          agentId: checkInput.agentId,
          ready: false,
          blockers: [
            {
              kind: "unknown",
              message: "Unknown provider CLI agent.",
              scope: "provider",
              action: "none",
            },
          ],
        };
      }

      const integration = input.integrations[checkInput.agentId];
      const result = await integration.preflight({
        agentId: checkInput.agentId,
        scope: checkInput.scope,
        launchOptions: checkInput.launchOptions,
      });

      // A provider readiness terminal action needs a working directory; the update
      // is a global npm install, so the exact dir does not matter — use the
      // thread's cwd when scoped, else the backend default.
      const cwd =
        checkInput.scope !== undefined && "cwd" in checkInput.scope
          ? checkInput.scope.cwd
          : ".";
      const update = input.updateChecker?.advisoryFor(result.agentId, cwd);

      return {
        agentId: result.agentId,
        ready: result.ready,
        blockers: result.blockers.map((blocker) => ({
          kind: blocker.kind,
          message: blocker.message,
          scope: blocker.scope,
          terminalAction: blocker.terminalAction,
          action: blocker.terminalAction === undefined ? "none" : "open_terminal",
        })),
        // Surface the runtime capabilities the service routes on (mid-turn steer).
        capabilities: { supportsTurnSteer: result.capabilities.supportsTurnSteer },
        // Non-blocking: present only when a newer CLI is published; never gates `ready`.
        ...(update ? { update } : {}),
      };
    },
  };
}

export function createAgentIntegrationAgentRuntimePort(
  input: CreateAgentIntegrationRuntimePortInput,
): AgentRuntimePort {
  return new AgentIntegrationAgentRuntimePort(input);
}

class AgentIntegrationAgentRuntimePort implements AgentRuntimePort {
  private readonly integrations: AgentIntegrationRegistry;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly resolveRuntimeEnvironment?: CreateAgentIntegrationRuntimePortInput["resolveRuntimeEnvironment"];
  private readonly onProviderEvent?: CreateAgentIntegrationRuntimePortInput["onProviderEvent"];
  private readonly onNativeEvent?: CreateAgentIntegrationRuntimePortInput["onNativeEvent"];
  private readonly locateSubagentsDir?: CreateAgentIntegrationRuntimePortInput["locateSubagentsDir"];
  private readonly runtimes = new Map<string, StructuredRuntimeState>();
  // Probed real command sets per (agentId:cwd) — see discoverCommands.
  private readonly commandCache = new Map<string, DiscoveredCommand[]>();
  // In-flight probes per (agentId:cwd) so concurrent discoverCommands calls share
  // one handshake instead of spawning redundant CLI processes.
  private readonly inFlightProbes = new Map<string, Promise<DiscoveredCommand[]>>();

  constructor(input: CreateAgentIntegrationRuntimePortInput) {
    this.integrations = input.integrations;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
    this.resolveRuntimeEnvironment = input.resolveRuntimeEnvironment;
    this.onProviderEvent = input.onProviderEvent;
    this.onNativeEvent = input.onNativeEvent;
    this.locateSubagentsDir = input.locateSubagentsDir;
  }

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    if (!isProviderCliAgentId(input.agentBinding.agentId)) {
      throw new Error("Unknown provider CLI agent.");
    }

    traceAgentRuntime(`start ${input.agentBinding.agentId} thread=${input.threadId}`);
    const integration = this.integrations[input.agentBinding.agentId];
    // The runtime id is generated up front so the launch plan can embed it (codex
    // needs it in its MCP server config env — it does not inherit the parent env).
    const runtimeId = this.idGenerator();
    const plan = await integration.buildStartPlan({
      agentId: input.agentBinding.agentId,
      agentBinding: input.agentBinding,
      scope: input.scope,
      launchOptions: input.launchOptions,
      initialPrompt: input.initialPrompt,
      runtimeId,
    });
    traceAgentRuntime(`plan ${input.agentBinding.agentId} command=${plan.command}`);
    return this.spawnRuntime(
      input.threadId,
      input.agentBinding.agentId,
      plan,
      runtimeId,
      input.initialPrompt,
      undefined,
      input.initialAttachments,
      input.initialGoal,
    );
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    if (!isProviderCliAgentId(input.agentBinding.agentId)) {
      throw new Error("Unknown provider CLI agent.");
    }

    const providerSessionRef = input.agentBinding.providerSessionRef;
    if (providerSessionRef === undefined) {
      throw new Error("Provider session reference is required to resume Agent Runtime.");
    }

    const integration = this.integrations[input.agentBinding.agentId];
    const runtimeId = this.idGenerator();
    const plan = await integration.buildResumePlan({
      agentId: input.agentBinding.agentId,
      providerSessionRef,
      scope: input.scope,
      // The thread's CURRENT options: a resume respawn after a mid-thread
      // model/permission/effort change must launch with the new values.
      launchOptions: input.launchOptions,
      runtimeId,
    });
    return this.spawnRuntime(
      input.threadId,
      input.agentBinding.agentId,
      plan,
      runtimeId,
      undefined,
      providerSessionRef.value,
    );
  }

  async writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void> {
    const runtime = this.runtimes.get(handle.runtimeId);
    if (runtime === undefined) {
      throw new Error("Agent Runtime handle was not found.");
    }
    if (input.kind === "goal_set") {
      await runtime.client.write({ kind: "goal_set", objective: input.value });
      return;
    }
    if (input.kind === "composer_input") {
      await runtime.client.write({
        kind: "composer_input",
        value: input.value,
        attachments: input.attachments,
      });
      return;
    }
    if (input.kind === "prompt_answer") {
      await runtime.client.write({
        kind: "prompt_answer",
        promptId: input.promptId,
        choiceId: input.choiceId,
        value: input.value,
        notes: input.notes,
        stepAnswers: input.stepAnswers,
      });
    }
    // Raw terminal bytes have no meaning on a structured transport.
  }

  // Mid-thread Launch Options change. The integration decides live-vs-restart
  // (provider knowledge); the structured client delivers live updates to the
  // protocol. Everything else — missing runtime, no integration hook, no client
  // hook — degrades to restart_required, never to a silent no-op.
  async applySessionConfig(
    handle: AgentRuntimeHandle,
    input: AgentSessionConfigInput,
  ): Promise<AgentSessionConfigResult> {
    const runtime = this.runtimes.get(handle.runtimeId);
    if (runtime === undefined) {
      return "restart_required";
    }
    const integration = this.integrations[runtime.agentId];
    const plan = integration.buildSessionConfigUpdate?.({
      launchOptions: input.launchOptions,
      changedKeys: input.changedKeys,
    });
    if (plan === undefined || plan.kind === "restart") {
      return "restart_required";
    }
    if (runtime.client.applyConfig === undefined) {
      return "restart_required";
    }
    // A throw here (dead child / broken pipe) degrades to a restart, same as a
    // refusal — never an unhandled rejection on the setLaunchOptions command.
    let acked = false;
    try {
      acked = await runtime.client.applyConfig(plan.protocolParams);
    } catch (error) {
      traceAgentRuntime(
        `applySessionConfig ${runtime.agentId} threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    traceAgentRuntime(
      `applySessionConfig ${runtime.agentId} runtime=${handle.runtimeId} keys=${input.changedKeys.join(",")} acked=${acked}`,
    );
    // A provider REFUSAL (e.g. claude live-switch to bypassPermissions on a session
    // that lacks the capability) degrades to a transparent restart — the resume
    // re-applies every current option via launch argv. Never a phantom "applied".
    return acked ? "applied" : "restart_required";
  }

  async invokeCapability(
    handle: AgentRuntimeHandle,
    input: AgentRuntimeCapabilityInvocationInput,
  ): Promise<AgentRuntimeCapabilityInvocationResult> {
    const runtime = this.runtimes.get(handle.runtimeId);
    if (runtime === undefined) {
      return { status: "unsupported", reason: "Agent Runtime handle was not found." };
    }
    if (input.invoke.kind !== "provider_method") {
      return {
        status: "unsupported",
        reason: `Capability ${input.capabilityId} is not a provider method.`,
      };
    }
    if (runtime.client.invokeCapability === undefined) {
      return {
        status: "unsupported",
        reason: `${runtime.agentId} does not expose provider method invocation.`,
      };
    }
    return runtime.client.invokeCapability(input);
  }

  async interrupt(handle: AgentRuntimeHandle): Promise<void> {
    const runtime = this.runtimes.get(handle.runtimeId);
    if (runtime === undefined) {
      return;
    }
    await runtime.client.interrupt();
  }

  async stop(handle: AgentRuntimeHandle): Promise<void> {
    const runtime = this.runtimes.get(handle.runtimeId);
    if (runtime === undefined) {
      return;
    }
    await runtime.client.stop();
    this.runtimes.delete(handle.runtimeId);
  }

  // Spawn a handshake-only runtime, capture the first `commands` event (the
  // agent's own slash-commands/skills, reported during init/handshake), then
  // stop — no full turn. Cached per (agentId, cwd). claude only emits its init
  // after a first stdin write, so the probe gives it a throwaway initialPrompt
  // and stops the instant commands arrive (before the turn produces output);
  // acp/codex report at handshake with no prompt. See
  // docs_v2/specs/live-provider-command-mirroring.md.
  async discoverCommands(
    agentId: ProviderCliAgentId,
    cwd: string,
  ): Promise<DiscoveredCommand[]> {
    const cacheKey = `${agentId}:${cwd}`;
    const cached = this.commandCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    // Concurrent calls for the same (agent, cwd) share one probe — don't spawn
    // redundant CLI processes while the first handshake is still in flight.
    const inFlight = this.inFlightProbes.get(cacheKey);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const probe = (async (): Promise<DiscoveredCommand[]> => {
      const integration = this.integrations[agentId];
      if (integration === undefined) {
        return [];
      }
      const runtimeId = this.idGenerator();
      const needsPrompt = agentId === "claude";
      let plan: ProviderLaunchPlan;
      try {
        plan = await integration.buildStartPlan({
          agentId,
          agentBinding: { agentId },
          scope: { kind: "project", projectId: cwd, cwd },
          launchOptions: {},
          initialPrompt: needsPrompt ? "tide command probe" : undefined,
          runtimeId,
        });
      } catch {
        return [];
      }

      const commands = await new Promise<DiscoveredCommand[]>((resolve) => {
        let settled = false;
        let client: StructuredRuntimeClient | undefined;
        const finish = (result: DiscoveredCommand[]): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          void Promise.resolve(client?.stop()).catch(() => undefined);
          resolve(result);
        };
        const timer = setTimeout(() => finish([]), COMMAND_PROBE_TIMEOUT_MS);
        const onEvent = (event: StructuredProviderEvent): void => {
          if (event.kind === "commands") {
            finish(event.commands);
          }
        };
        try {
          const probePlan = this.withRuntimeEnvironment({
            ...plan,
            env: { ...plan.env, TIDE_RUNTIME_ID: runtimeId, TIDE_AGENT_ID: agentId },
          });
          client = this.createTransportClient({
            plan: probePlan,
            threadId: `probe-${runtimeId}`,
            runtimeId,
            agentId,
            initialPrompt: needsPrompt ? "tide command probe" : undefined,
            onEvent,
          });
          // If the client emitted `commands` synchronously during construction,
          // finish() already ran with `client` still undefined — stop it now so the
          // process isn't leaked.
          if (settled) {
            void Promise.resolve(client.stop()).catch(() => undefined);
          }
        } catch {
          finish([]);
        }
      });

      if (commands.length > 0) {
        this.commandCache.set(cacheKey, commands);
      }
      return commands;
    })();

    this.inFlightProbes.set(cacheKey, probe);
    try {
      return await probe;
    } finally {
      this.inFlightProbes.delete(cacheKey);
    }
  }

  private spawnRuntime(
    threadId: string,
    agentId: ProviderCliAgentId,
    plan: ProviderLaunchPlan,
    runtimeId: string,
    initialPrompt?: string,
    resumeRef?: string,
    initialAttachments?: ComposerAttachmentRef[],
    initialGoal?: string,
  ): AgentRuntimeHandle {
    // One live runtime per thread: tear down any existing one so a thread can
    // never double-run (two clients on one session tangle the turn).
    for (const [existingRuntimeId, state] of this.runtimes) {
      if (state.threadId === threadId) {
        traceAgentRuntime(`reaping duplicate runtime=${existingRuntimeId} thread=${threadId}`);
        void Promise.resolve(state.client.stop()).catch(() => undefined);
        this.runtimes.delete(existingRuntimeId);
      }
    }
    const runtimePlan: ProviderLaunchPlan = {
      ...plan,
      env: {
        ...plan.env,
        TIDE_THREAD_ID: threadId,
        TIDE_RUNTIME_ID: runtimeId,
        TIDE_AGENT_ID: agentId,
      },
    };
    const runtimePlanWithEnv = this.withRuntimeEnvironment(runtimePlan);
    let nativeSequence = 0;
    let providerSessionId = resumeRef ?? runtimePlanWithEnv.providerSessionRef?.value;
    const emit = (event: StructuredProviderEvent): void => {
      nativeSequence += 1;
      if (event.kind === "session_ref") {
        providerSessionId = event.ref.value;
      }
      void this.onProviderEvent?.({ threadId, agentId, runtimeId, event });
      const nativeEvent = structuredToNativeRuntimeEvent({
        eventId: this.idGenerator(),
        provider: agentId,
        transport: plan.transport as NativeTransport,
        runtimeId,
        tideThreadId: threadId,
        providerSessionId,
        nativeSequence,
        receivedAt: this.clock(),
        event,
      });
      void this.onNativeEvent?.({ threadId, agentId, runtimeId, event: nativeEvent });
    };
    const client = this.createTransportClient({
      plan: runtimePlanWithEnv,
      threadId,
      runtimeId,
      agentId,
      initialPrompt,
      initialAttachments,
      initialGoal,
      resumeRef,
      onEvent: emit,
    });
    this.runtimes.set(runtimeId, { client, threadId, agentId });
    traceAgentRuntime(`spawned ${agentId} runtime=${runtimeId} transport=${String(plan.transport)}`);
    // A launch-assigned session ref (claude minted --session-id) binds the
    // thread immediately; structured clients also emit session_ref from the
    // protocol's own session id.
    if (runtimePlanWithEnv.providerSessionRef !== undefined) {
      emit({ kind: "session_ref", ref: { ...runtimePlanWithEnv.providerSessionRef } });
    }
    return { runtimeId, threadId, agentId };
  }

  private withRuntimeEnvironment(plan: ProviderLaunchPlan): ProviderLaunchPlan {
    let runtimeEnv: NodeJS.ProcessEnv = {};
    if (this.resolveRuntimeEnvironment !== undefined) {
      try {
        runtimeEnv = this.resolveRuntimeEnvironment({ cwd: plan.cwd, planEnv: plan.env });
      } catch {
        runtimeEnv = {};
      }
    }
    const resolvedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(runtimeEnv)) {
      if (value !== undefined) {
        resolvedEnv[key] = value;
      }
    }
    return {
      ...plan,
      // The launch plan wins over shell env for provider configuration, but Tide
      // app/backend ownership env must not leak into the provider process because
      // agent-run shell commands inherit this environment.
      env: sanitizeProviderRuntimeEnv(
        { ...resolvedEnv, ...plan.env },
        { allowRuntimeTags: true },
      ) as Record<string, string>,
    };
  }

  // Build the structured client for a launch plan's transport. Shared by the
  // live runtime (spawnRuntime) and the handshake-only command probe
  // (discoverCommands), which differ only in the onEvent sink + lifecycle.
  private createTransportClient(input: {
    plan: ProviderLaunchPlan;
    threadId: string;
    runtimeId: string;
    agentId: ProviderCliAgentId;
    initialPrompt?: string;
    initialAttachments?: ComposerAttachmentRef[];
    initialGoal?: string;
    resumeRef?: string;
    onEvent: (event: StructuredProviderEvent) => void;
  }): StructuredRuntimeClient {
    switch (input.plan.transport) {
      case "claude_stream_json":
        return createClaudeStreamJsonClient({
          plan: input.plan,
          threadId: input.threadId,
          runtimeId: input.runtimeId,
          initialPrompt: input.initialPrompt,
          initialGoal: input.initialGoal,
          initialAttachments: input.initialAttachments,
          locateSubagentsDir: this.locateSubagentsDir,
          onEvent: input.onEvent,
        });
      case "codex_app_server":
        return createCodexAppServerClient({
          plan: input.plan,
          threadId: input.threadId,
          runtimeId: input.runtimeId,
          initialPrompt: input.initialPrompt,
          initialGoal: input.initialGoal,
          initialAttachments: input.initialAttachments,
          resumeThreadId: input.resumeRef,
          onEvent: input.onEvent,
        });
      case "acp":
        return createAcpClient({
          plan: input.plan,
          threadId: input.threadId,
          runtimeId: input.runtimeId,
          agentId: input.agentId,
          sessionRefKind: sessionRefKindForAgent(input.agentId),
          initialPrompt: input.initialPrompt,
          initialGoal: input.initialGoal,
          initialAttachments: input.initialAttachments,
          resumeSessionId: input.resumeRef,
          onEvent: input.onEvent,
        });
      default:
        throw new Error(`Unsupported runtime transport: ${String(input.plan.transport)}`);
    }
  }
}

function defaultClock(): string {
  return new Date().toISOString();
}

function defaultIdGenerator(): string {
  return `runtime-${Math.random().toString(36).slice(2)}`;
}

function traceAgentRuntime(message: string): void {
  if (process.env.TIDE_BACKEND_TRACE !== "1") {
    return;
  }
  process.stdout.write(`[tide-agent-runtime] ${message}\n`);
}
