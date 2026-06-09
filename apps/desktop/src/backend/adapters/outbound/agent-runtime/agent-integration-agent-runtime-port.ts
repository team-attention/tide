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
  RuntimeReadinessGate,
} from "../../../application/ports/outbound/agent-integration-port.ts";
import type { ProviderReadinessPort } from "../../../application/ports/outbound/provider-readiness-port.ts";
import type { RuntimeReadinessRegistry } from "../../../application/services/runtime-readiness-registry.ts";
import {
  type CodexMenuNavigation,
  decodeCodexMenuNavigation,
} from "../../../application/services/provider-tui-parsers.ts";
import type {
  AgentId,
  ProviderCliAgentId,
} from "../../../application/domains/thread/thread.ts";

export type AgentIntegrationRegistry = Record<ProviderCliAgentId, AgentIntegrationPort>;

export interface PtyProcessHandle {
  runtimeId: string;
  // PID of the spawned process (the PTY host). Used to deterministically find the
  // rollout file the provider CLI this run owns is actually writing, instead of
  // guessing by recency + prompt text.
  pid?: number;
  write(data: string): Promise<void> | void;
  resize?(cols: number, rows: number): void;
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
  threadId: string;
  agentId: ProviderCliAgentId;
  inputTiming?: ProviderLaunchPlan["inputTiming"];
  startupDelayConsumed: boolean;
  hookTrustPromptHandled: boolean;
}

export interface CreateAgentIntegrationRuntimePortInput {
  integrations: AgentIntegrationRegistry;
  launcher: PtyProcessLauncher;
  onOutputFrame?: (frame: {
    threadId: string;
    agentId: ProviderCliAgentId;
    runtimeId: string;
    // PID of this run's spawned PTY host, so the provider session binding can find
    // the exact rollout this process owns instead of matching by prompt text.
    runtimePid?: number;
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
  // Gates the first-turn handoff for tool_surface_ready agents: the first prompt is
  // delivered only after this runtime's Tide MCP tool surface is ready.
  readinessRegistry?: RuntimeReadinessRegistry;
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
  private readonly readinessRegistry?: RuntimeReadinessRegistry;
  private readonly processes = new Map<string, RuntimeProcessState>();

  constructor(input: CreateAgentIntegrationRuntimePortInput) {
    this.integrations = input.integrations;
    this.launcher = input.launcher;
    this.onOutputFrame = input.onOutputFrame;
    this.onRuntimeStarted = input.onRuntimeStarted;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
    this.readinessRegistry = input.readinessRegistry;
  }

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    if (!isProviderCliAgentId(input.agentBinding.agentId)) {
      throw new Error("Tide API Agents do not start through the Provider CLI runtime port.");
    }

    traceAgentRuntime(`start ${input.agentBinding.agentId} thread=${input.threadId}`);
    const integration = this.integrations[input.agentBinding.agentId];
    // Generate the runtime id up front so the launch plan can embed it (codex needs
    // it in its MCP server config env — it does not inherit the parent env).
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

    const handle = await this.spawnRuntime(
      input.threadId,
      input.agentBinding.agentId,
      plan,
      runtimeId,
    );
    // First-turn handoff: tool_surface_ready agents (codex/claude) receive their
    // first prompt via writeInput AFTER the tool surface is ready — never via launch
    // argv — so the turn cannot start before MCP tools are registered for dispatch.
    // immediate agents (antigravity) carry the prompt in their launch plan, so the
    // port does nothing here. See docs_v2/specs/agent-turn-handoff-readiness.md.
    this.deliverFirstTurn(handle, integration.initialTurnReadiness(), input.initialPrompt);
    return handle;
  }

  private deliverFirstTurn(
    handle: AgentRuntimeHandle,
    gate: RuntimeReadinessGate,
    initialPrompt: string | undefined,
  ): void {
    if (
      gate.kind !== "tool_surface_ready" ||
      initialPrompt === undefined ||
      initialPrompt.length === 0
    ) {
      return;
    }
    void (async () => {
      try {
        if (this.readinessRegistry !== undefined) {
          await this.readinessRegistry.awaitToolSurface(handle.runtimeId);
        }
        await this.writeInput(handle, {
          kind: "composer_input",
          value: initialPrompt,
          submittedAt: this.clock(),
        });
        traceAgentRuntime(`first-turn delivered runtime=${handle.runtimeId}`);
      } catch (error) {
        traceAgentRuntime(
          `first-turn delivery failed runtime=${handle.runtimeId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();
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
    const runtimeId = this.idGenerator();
    const plan = await integration.buildResumePlan({
      agentId: input.agentBinding.agentId,
      providerSessionRef,
      scope: input.scope,
      runtimeId,
    });

    return this.spawnRuntime(input.threadId, input.agentBinding.agentId, plan, runtimeId);
  }

  async writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void> {
    const processState = this.processes.get(handle.runtimeId);
    if (processState === undefined) {
      throw new Error("Agent Runtime handle was not found.");
    }

    traceAgentRuntime(`write ${processState.agentId} runtime=${handle.runtimeId} kind=${input.kind}`);
    // A CLI TUI needs a beat after spawn before it will accept typed input; typing
    // the first message too early drops it and the turn never starts. The readiness
    // gate covers MCP-tool registration, this covers TUI input-readiness. Once per
    // runtime, on its first write.
    await waitForStartupWindow(processState);

    // Answering a TUI approval/choice menu is not typed text: the providerValue is a
    // menu-navigation token. Replay it as keyed navigation (ArrowDown/ArrowUp + Enter)
    // on the live PTY so the agent's own menu cursor lands on the chosen option. This
    // applies to codex AND claude — both surface their shell-command/tool permission as
    // an interactive boxed menu in the hidden PTY (claude's "Do you want to proceed? ❯1.
    // Yes 2.… 3.No"). A non-nav value (hook prompts, free-form "Other") decodes to null
    // and falls through to the generic typed path. See agent-prompt-surfacing.md.
    if (
      input.kind === "prompt_answer" &&
      (processState.agentId === "codex" || processState.agentId === "claude")
    ) {
      const navigation = decodeCodexMenuNavigation(input.value);
      if (navigation !== null) {
        await sendCodexMenuNavigation(processState.handle, navigation);
        traceAgentRuntime(`wrote ${processState.agentId} menu nav runtime=${handle.runtimeId} steps=${navigation.steps}`);
        return;
      }
    }

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
    runtimeId: string,
  ): Promise<AgentRuntimeHandle> {
    // One live runtime process per Thread. Under heavy concurrent spawning we have
    // seen a Thread end up with TWO live provider processes (two PTYs, two rollouts)
    // that then both write the same provider session spool and tangle the turn — the
    // turn never settles and the UI hangs "Working". Tear down any existing process
    // for this Thread before starting a new one so a Thread can never double-run.
    for (const [existingRuntimeId, state] of this.processes) {
      if (state.threadId === threadId) {
        traceAgentRuntime(`reaping duplicate runtime=${existingRuntimeId} thread=${threadId}`);
        void Promise.resolve(state.handle.stop()).catch(() => undefined);
        this.processes.delete(existingRuntimeId);
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
      expectedSignalSources: plan.expectedSignalSources.map((source) => ({ ...source })),
    };
    const process = await this.launcher.spawn({
      runtimeId,
      plan: runtimePlan,
      onOutput: (output) => {
        maybeAutoTrustCodexHooks(this.processes.get(runtimeId), output.body);
        void this.onOutputFrame?.({
          threadId,
          agentId,
          runtimeId,
          runtimePid: this.processes.get(runtimeId)?.handle.pid,
          source: output.source,
          body: output.body,
        });
      },
    });
    traceAgentRuntime(`spawned ${agentId} runtime=${runtimeId}`);
    this.processes.set(runtimeId, {
      handle: process,
      threadId,
      agentId,
      inputTiming: plan.inputTiming,
      startupDelayConsumed: false,
      hookTrustPromptHandled: false,
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

// Codex shows an interactive "Hooks need review" trust prompt the first time it
// sees Tide's generated hooks (the --dangerously-bypass-hook-trust flag only
// applies to `codex exec`, not the TUI). Auto-select "Trust all and continue"
// (ArrowDown to option 2, then Enter); Codex persists the trust in config.toml
// keyed by the hooks path, so this only happens once per hooks file. Without
// this the hidden PTY blocks here forever and the Agent never answers.
const CODEX_HOOK_TRUST_PROMPT = /Hooks need review|Trust all and continue/;
function maybeAutoTrustCodexHooks(
  processState: RuntimeProcessState | undefined,
  body: string,
): void {
  if (
    processState === undefined ||
    processState.hookTrustPromptHandled ||
    processState.agentId !== "codex" ||
    !CODEX_HOOK_TRUST_PROMPT.test(body)
  ) {
    return;
  }
  processState.hookTrustPromptHandled = true;
  void (async () => {
    // Move cursor from "1. Review hooks" to "2. Trust all and continue".
    await processState.handle.write("\x1b[B");
    await sleep(150);
    await processState.handle.write("\r");
  })();
}

// codex's TUI reads one key event at a time and needs a beat between them (the same
// reason the hook-trust auto-answer sleeps between ArrowDown and Enter). Drive the menu
// cursor with |steps| ArrowDown (steps>0) or ArrowUp (steps<0) presses, each followed
// by a short delay, then Enter to submit the highlighted option.
const CODEX_MENU_KEY_DELAY_MS = 120;
const ARROW_DOWN = "\x1b[B";
const ARROW_UP = "\x1b[A";
async function sendCodexMenuNavigation(
  handle: PtyProcessHandle,
  navigation: CodexMenuNavigation,
): Promise<void> {
  const key = navigation.steps >= 0 ? ARROW_DOWN : ARROW_UP;
  const presses = Math.abs(navigation.steps);
  for (let i = 0; i < presses; i += 1) {
    await handle.write(key);
    await sleep(CODEX_MENU_KEY_DELAY_MS);
  }
  await handle.write("\r");
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
  return (
    agentId === "codex" ||
    agentId === "claude" ||
    agentId === "antigravity" ||
    agentId === "gemini"
  );
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
