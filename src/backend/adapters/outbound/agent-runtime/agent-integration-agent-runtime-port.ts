import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  TerminalInput,
} from "../../../application/domains/agent-runtime/agent-runtime.ts";
import type { AgentRuntimePort } from "../../../application/ports/outbound/agent-runtime-port.ts";
import type {
  AgentIntegrationPort,
  ProviderLaunchPlan,
} from "../../../application/ports/outbound/agent-integration-port.ts";
import type { ProviderReadinessPort } from "../../../application/ports/outbound/provider-readiness-port.ts";
import type {
  AgentId,
  ProviderCliAgentId,
} from "../../../application/domains/thread/thread.ts";

export type AgentIntegrationRegistry = Record<ProviderCliAgentId, AgentIntegrationPort>;

export interface PtyProcessHandle {
  runtimeId: string;
  write(data: string): Promise<void> | void;
  stop(): Promise<void> | void;
}

export interface PtyProcessOutput {
  source: "stdout" | "stderr";
  body: string;
}

export interface PtyProcessExit {
  exitCode: number | null;
  signal: string | null;
}

export interface PtyProcessSpawnInput {
  runtimeId: string;
  plan: ProviderLaunchPlan;
  onOutput?: (output: PtyProcessOutput) => void;
  onExit?: (exit: PtyProcessExit) => void;
}

export interface PtyProcessLauncher {
  spawn(input: PtyProcessSpawnInput): Promise<PtyProcessHandle>;
}

interface RuntimeProcessState {
  handle: PtyProcessHandle;
  agentId: ProviderCliAgentId;
  inputTiming?: ProviderLaunchPlan["inputTiming"];
  startupDelayConsumed: boolean;
}

export interface CreateAgentIntegrationRuntimePortInput {
  integrations: AgentIntegrationRegistry;
  launcher: PtyProcessLauncher;
  onOutputFrame?: (frame: {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    source: PtyProcessOutput["source"];
    body: string;
  }) => Promise<void> | void;
  onRuntimeStarted?: (runtime: {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
  }) => Promise<void> | void;
  clock?: () => string;
  idGenerator?: () => string;
}

export interface CreateAgentIntegrationProviderReadinessPortInput {
  integrations: AgentIntegrationRegistry;
}

export function createAgentIntegrationProviderReadinessPort(
  input: CreateAgentIntegrationProviderReadinessPortInput,
): ProviderReadinessPort {
  return {
    async check(checkInput) {
      if (!isProviderCliAgentId(checkInput.agentId)) {
        return {
          agentId: checkInput.agentId,
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
      }

      const integration = input.integrations[checkInput.agentId];
      const result = await integration.preflight({
        agentId: checkInput.agentId,
        scope: checkInput.scope,
        launchOptions: checkInput.launchOptions,
      });

      return {
        agentId: result.agentId,
        ready: result.ready,
        blockers: result.blockers.map((blocker) => ({
          kind: blocker.kind,
          message: blocker.message,
          scope: blocker.scope,
          setup: blocker.setup,
          action: blocker.setup === undefined ? "none" : "open_terminal",
        })),
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
  private readonly launcher: PtyProcessLauncher;
  private readonly onOutputFrame?: CreateAgentIntegrationRuntimePortInput["onOutputFrame"];
  private readonly onRuntimeStarted?: CreateAgentIntegrationRuntimePortInput["onRuntimeStarted"];
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly processes = new Map<string, RuntimeProcessState>();

  constructor(input: CreateAgentIntegrationRuntimePortInput) {
    this.integrations = input.integrations;
    this.launcher = input.launcher;
    this.onOutputFrame = input.onOutputFrame;
    this.onRuntimeStarted = input.onRuntimeStarted;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
  }

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    if (!isProviderCliAgentId(input.agentBinding.agentId)) {
      throw new Error("Tide API Agents do not start through the Provider CLI runtime port.");
    }

    traceAgentRuntime(`start ${input.agentBinding.agentId} thread=${input.threadId}`);
    const integration = this.integrations[input.agentBinding.agentId];
    const plan = await integration.buildStartPlan({
      agentId: input.agentBinding.agentId,
      agentBinding: input.agentBinding,
      scope: input.scope,
      launchOptions: input.launchOptions,
    });
    traceAgentRuntime(`plan ${input.agentBinding.agentId} command=${plan.command}`);

    return this.spawnRuntime(input.threadId, input.agentBinding.agentId, plan);
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    if (!isProviderCliAgentId(input.agentBinding.agentId)) {
      throw new Error("Tide API Agents do not resume through the Provider CLI runtime port.");
    }

    const providerSessionRef = input.agentBinding.providerSessionRef;
    if (providerSessionRef === undefined) {
      throw new Error("Provider session reference is required to resume Agent Runtime.");
    }

    const integration = this.integrations[input.agentBinding.agentId];
    const plan = await integration.buildResumePlan({
      agentId: input.agentBinding.agentId,
      providerSessionRef,
      scope: input.scope,
    });

    return this.spawnRuntime(input.threadId, input.agentBinding.agentId, plan);
  }

  async writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void> {
    const processState = this.processes.get(handle.runtimeId);
    if (processState === undefined) {
      throw new Error("Agent Runtime handle was not found.");
    }

    traceAgentRuntime(`write ${processState.agentId} runtime=${handle.runtimeId} kind=${input.kind}`);
    await waitForStartupWindow(processState);

    if (
      input.kind === "composer_input" &&
      processState.inputTiming?.preSubmitDelayMs !== undefined
    ) {
      await processState.handle.write(input.value);
      await sleep(processState.inputTiming.preSubmitDelayMs);
      await processState.handle.write(submitSequenceForAgent(processState.agentId));
      traceAgentRuntime(`wrote ${processState.agentId} runtime=${handle.runtimeId}`);
      return;
    }

    await processState.handle.write(terminalBytesForInput(processState.agentId, input));
    traceAgentRuntime(`wrote ${processState.agentId} runtime=${handle.runtimeId}`);
  }

  async stop(handle: AgentRuntimeHandle): Promise<void> {
    const processState = this.processes.get(handle.runtimeId);
    if (processState === undefined) {
      return;
    }

    await processState.handle.stop();
    this.processes.delete(handle.runtimeId);
  }

  private async spawnRuntime(
    threadId: string,
    agentId: ProviderCliAgentId,
    plan: ProviderLaunchPlan,
  ): Promise<AgentRuntimeHandle> {
    const runtimeId = this.idGenerator();
    const runtimePlan: ProviderLaunchPlan = {
      ...plan,
      env: {
        ...plan.env,
        TIDE_THREAD_ID: threadId,
        TIDE_RUNTIME_ID: runtimeId,
        TIDE_AGENT_ID: agentId,
      },
      expectedSignalSources: plan.expectedSignalSources.map((source) => ({ ...source })),
    };
    const process = await this.launcher.spawn({
      runtimeId,
      plan: runtimePlan,
      onOutput: (output) => {
        void this.onOutputFrame?.({
          threadId,
          agentId,
          runtimeId,
          source: output.source,
          body: output.body,
        });
      },
    });
    traceAgentRuntime(`spawned ${agentId} runtime=${runtimeId}`);
    this.processes.set(runtimeId, {
      handle: process,
      agentId,
      inputTiming: plan.inputTiming,
      startupDelayConsumed: false,
    });
    void this.onRuntimeStarted?.({
      threadId,
      agentId,
      runtimeId,
    });

    return {
      runtimeId,
      threadId,
      agentId,
    };
  }
}

async function waitForStartupWindow(processState: RuntimeProcessState): Promise<void> {
  if (processState.startupDelayConsumed) {
    return;
  }

  processState.startupDelayConsumed = true;
  await sleep(processState.inputTiming?.startupDelayMs ?? 0);
}

function terminalBytesForInput(agentId: ProviderCliAgentId, input: TerminalInput): string {
  const value = input.value;
  if (input.kind === "prompt_answer") {
    return `${value.length > 0 ? value : input.choiceId ?? value}\r`;
  }

  return `${value}${submitSequenceForAgent(agentId)}`;
}

function submitSequenceForAgent(agentId: ProviderCliAgentId): string {
  return agentId === "claude" ? "\x1b[13u" : "\r";
}

function isProviderCliAgentId(agentId: AgentId): agentId is ProviderCliAgentId {
  return agentId === "codex" || agentId === "claude" || agentId === "antigravity";
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
