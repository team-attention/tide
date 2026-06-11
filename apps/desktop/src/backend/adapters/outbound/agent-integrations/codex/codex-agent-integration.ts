import type {
  AgentIntegrationCapabilities,
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentIntegrationReadinessBlocker,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderLaunchPlan,
  ProviderSetupSurfaceAction,
  ProviderSignalSource,
  SessionConfigUpdateInput,
  SessionConfigUpdatePlan,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import type {
  ThreadScope,
} from "../../../../application/domains/thread/thread.ts";

export interface CodexProviderState {
  authenticated: boolean;
  onboardingComplete: boolean;
  trustedCwds: string[];
  hookBootstrapReady: boolean;
  codexHome?: string;
}

export type CodexExecutableResolver = (
  command: "codex",
) => Promise<string | undefined> | string | undefined;

export type CodexProviderStateReader = (input: {
  cwd: string;
  executablePath: string;
  launchOptions?: Record<string, unknown>;
}) => Promise<CodexProviderState> | CodexProviderState;

export interface CodexTideMcpConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface CreateCodexAgentIntegrationInput {
  resolveExecutable: CodexExecutableResolver;
  readProviderState: CodexProviderStateReader;
  tideMcp?: CodexTideMcpConfig;
  defaultCwd?: string;
}

const codexCapabilities: AgentIntegrationCapabilities = {
  supportsHiddenPty: true,
  supportsResume: true,
  supportsTideMcp: true,
  supportsHooks: true,
  supportsReadableHistory: true,
  requiresTerminalKeyProtocol: false,
  // codex app-server exposes turn/steer — new input is injected into the active
  // turn (expectedTurnId precondition) instead of queued until it ends.
  supportsTurnSteer: true,
};

const expectedSignalSources: ProviderSignalSource[] = [
  {
    kind: "pty_transcript",
    description: "Captured hidden PTY input and output.",
  },
  {
    kind: "provider_hook",
    description: "Codex UserPromptSubmit, PermissionRequest, and Stop hooks.",
  },
  {
    kind: "provider_history",
    description: "Codex rollout JSONL under provider-owned session history.",
  },
  {
    kind: "tide_mcp",
    description: "Tide MCP Tool Surface attached to the same Codex session.",
  },
];

export function createCodexAgentIntegration(
  input: CreateCodexAgentIntegrationInput,
): AgentIntegrationPort {
  return new CodexAgentIntegration(input);
}

class CodexAgentIntegration implements AgentIntegrationPort {
  private readonly resolveExecutable: CodexExecutableResolver;
  private readonly readProviderState: CodexProviderStateReader;
  private readonly tideMcp?: CodexTideMcpConfig;
  private readonly defaultCwd: string;

  constructor(input: CreateCodexAgentIntegrationInput) {
    this.resolveExecutable = input.resolveExecutable;
    this.readProviderState = input.readProviderState;
    this.tideMcp = cloneTideMcpConfig(input.tideMcp);
    this.defaultCwd = input.defaultCwd ?? ".";
  }

  async preflight(
    input: AgentIntegrationPreflightInput,
  ): Promise<AgentIntegrationPreflightResult> {
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    const executablePath = await this.resolveExecutable("codex");
    if (executablePath === undefined) {
      return {
        agentId: "codex",
        ready: false,
        blockers: [
          {
            kind: "not_installed",
            scope: "provider",
            message: "Codex CLI executable was not found.",
          },
        ],
        capabilities: codexCapabilities,
      };
    }

    const providerState = await this.readProviderState({
      cwd,
      executablePath,
      launchOptions: input.launchOptions,
    });
    const setup = codexSetupAction(executablePath, cwd);
    const hookSetup = codexSetupAction(executablePath, cwd, providerState.codexHome);
    const blockers: AgentIntegrationReadinessBlocker[] = [];

    if (!providerState.authenticated) {
      blockers.push({
        kind: "not_authenticated" as const,
        scope: "provider" as const,
        message: "Codex authentication is required before starting a Thread.",
        setup,
      });
    }
    if (!providerState.onboardingComplete) {
      blockers.push({
        kind: "onboarding_required" as const,
        scope: "provider" as const,
        message: "Codex onboarding must be completed before starting a Thread.",
        setup,
      });
    }
    if (!providerState.trustedCwds.includes(cwd)) {
      blockers.push({
        kind: "directory_trust_required" as const,
        scope: "execution_context" as const,
        message: "Codex Directory Trust is required for this Execution Context.",
        setup,
      });
    }
    if (!providerState.hookBootstrapReady) {
      blockers.push({
        kind: "hook_bootstrap_required" as const,
        scope: "integration" as const,
        message: "Tide Codex MCP bootstrap setup is required.",
        setup: hookSetup,
      });
    }

    if (blockers.length > 0) {
      return {
        agentId: "codex",
        ready: false,
        blockers,
        capabilities: codexCapabilities,
      };
    }

    return {
      agentId: "codex",
      ready: true,
      blockers: [],
      capabilities: codexCapabilities,
      launchPlan: this.codexLaunchPlan({
        executablePath,
        cwd,
        codexHome: providerState.codexHome,
        resumeRef: undefined,
        launchOptions: input.launchOptions,
      }),
    };
  }

  async buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("codex")) ?? "codex";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    const providerState = await this.readProviderState({
      cwd,
      executablePath,
      launchOptions: input.launchOptions,
    });

    return this.codexLaunchPlan({
      executablePath,
      cwd,
      codexHome: providerState.codexHome,
      resumeRef: undefined,
      launchOptions: input.launchOptions,
      initialPrompt: input.initialPrompt,
      runtimeId: input.runtimeId,
    });
  }

  async buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("codex")) ?? "codex";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    const providerState = await this.readProviderState({
      cwd,
      executablePath,
      launchOptions: input.launchOptions,
    });

    return this.codexLaunchPlan({
      executablePath,
      cwd,
      codexHome: providerState.codexHome,
      resumeRef: input.providerSessionRef.value,
      launchOptions: input.launchOptions,
      runtimeId: input.runtimeId,
    });
  }

  // Mid-thread Launch Options change. Model + reasoning effort apply LIVE as
  // turn/start overrides ("for this turn and subsequent turns", codex-cli 0.136
  // bindings). A permission change maps to sandbox + approvalPolicy; the
  // per-turn `sandboxPolicy` is a structured object Tide cannot safely
  // construct, so it restarts instead — thread/resume accepts the same simple
  // sandbox/approvalPolicy values the start path already maps.
  buildSessionConfigUpdate(input: SessionConfigUpdateInput): SessionConfigUpdatePlan {
    const params: Record<string, unknown> = {};
    for (const key of input.changedKeys) {
      if (key === "model") {
        const model = stringValue(input.launchOptions.model);
        if (model === undefined) {
          return { kind: "restart" };
        }
        params.model = model;
        continue;
      }
      if (key === "reasoning") {
        const reasoning = stringValue(input.launchOptions.reasoning);
        if (
          reasoning !== "low" &&
          reasoning !== "medium" &&
          reasoning !== "high" &&
          reasoning !== "xhigh"
        ) {
          return { kind: "restart" };
        }
        params.effort = reasoning;
        continue;
      }
      return { kind: "restart" };
    }
    return { kind: "live", protocolParams: params };
  }

  private codexLaunchPlan(input: {
    executablePath: string;
    cwd: string;
    codexHome?: string;
    resumeRef?: string;
    launchOptions?: Record<string, unknown>;
    initialPrompt?: string;
    runtimeId?: string;
  }): ProviderLaunchPlan {
    // codex spawns its MCP server with ONLY the config-declared env (it does not
    // inherit codex's own process env, unlike claude). So the Tide MCP bridge's
    // session identity (TIDE_RUNTIME_ID/TIDE_AGENT_ID) MUST be embedded in the
    // codex MCP server config env here, or every Tide tool call fails session
    // resolution and codex hangs "Working" with no result.
    const tideMcp =
      this.tideMcp === undefined || input.runtimeId === undefined
        ? this.tideMcp
        : {
            ...this.tideMcp,
            env: {
              ...this.tideMcp.env,
              TIDE_RUNTIME_ID: input.runtimeId,
              TIDE_AGENT_ID: "codex",
            },
          };
    const env: Record<string, string> = {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };
    if (input.codexHome !== undefined) {
      env.CODEX_HOME = input.codexHome;
    }

    // STRUCTURED TRANSPORT: the app-server protocol over plain stdio — the same
    // protocol the Codex IDE extension speaks. Session parameters (cwd,
    // approvalPolicy, sandbox, model, reasoning effort) ride thread/start via
    // protocolParams; Tide MCP config rides `-c` overrides (verified: app-server
    // accepts the global -c flag). No TUI: no hook-trust box, no startup delays.
    // Approvals arrive as server-initiated JSON-RPC requests and the model does
    // not proceed until the decision result is written back.
    const reasoning = stringValue(input.launchOptions?.reasoning);
    const args = [
      "app-server",
      ...(reasoning === "low" || reasoning === "medium" || reasoning === "high" || reasoning === "xhigh"
        ? ["-c", `model_reasoning_effort=${codexConfigString(reasoning)}`]
        : []),
      ...codexConfigArgs(tideMcp),
    ];

    return {
      command: input.executablePath,
      args,
      env,
      cwd: input.cwd,
      transport: "codex_app_server",
      protocolParams: codexThreadStartParams(input.launchOptions),
      expectedSignalSources: expectedSignalSources.map((source) => ({ ...source })),
    };
  }
}

// Maps a parsed codex TUI approval/choice box into a normalized PromptState. Each
// option becomes a choice whose providerValue is a codex-menu navigation token
// (`codex-menu:<steps>`, signed offset from the cursor's default row) that the runtime
// port replays as ArrowDown/ArrowUp + Enter. defaultChoiceId is the cursor option, so
// v2 highlights codex's own default. promptId is the content signature so the same box
// re-rendered across PTY chunks dedupes to one surfaced prompt.

function codexSetupAction(
  executablePath: string,
  cwd: string,
  codexHome?: string,
): ProviderSetupSurfaceAction {
  const action: ProviderSetupSurfaceAction = {
    command: executablePath,
    args: ["--no-alt-screen"],
    cwd,
    expectedCompletion: "retry_preflight",
  };
  if (codexHome !== undefined) {
    action.env = { CODEX_HOME: codexHome };
  }
  return action;
}

function codexConfigArgs(tideMcp: CodexTideMcpConfig | undefined): string[] {
  const config = [
    'plugins."browser-use@openai-bundled".enabled=false',
    // Stream the model's reasoning summary so Tide can show codex's thinking
    // (without this, reasoning items arrive empty — verified live).
    "model_reasoning_summary=detailed",
  ];

  if (tideMcp !== undefined) {
    config.push(`mcp_servers.tide.command=${codexConfigString(tideMcp.command)}`);
    config.push(
      `mcp_servers.tide.args=[${tideMcp.args.map(codexConfigString).join(",")}]`,
    );
    // Tide's own MCP tools are first-party and trusted (we inject this server), so
    // auto-approve all of them — no per-tool permission prompt. Other (user/3rd-party)
    // MCP servers keep codex's native approval flow, so behavior matches using codex
    // in a plain terminal. See agent-turn-handoff-readiness.md.
    config.push(`mcp_servers.tide.default_tools_approval_mode=${codexConfigString("approve")}`);
    for (const [key, value] of Object.entries(tideMcp.env ?? {}).sort()) {
      config.push(
        `mcp_servers.tide.env.${key}=${codexConfigString(value)}`,
      );
    }
  }

  return config.flatMap((entry) => ["-c", entry]);
}

function codexConfigString(value: string): string {
  return JSON.stringify(value);
}

// thread/start parameters for the app-server transport: the SAME approval/
// sandbox expansion the TUI flags used, expressed as protocol values
// (bindings: ThreadStartParams.approvalPolicy / sandbox / model).
function codexThreadStartParams(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const model = stringValue(launchOptions?.model);
  if (model !== undefined) {
    params.model = model;
  }
  const permission = stringValue(launchOptions?.permission);
  if (permission === "ask-for-approval") {
    params.sandbox = "workspace-write";
    params.approvalPolicy = "on-request";
  } else if (permission === "approve-for-me") {
    params.sandbox = "workspace-write";
    params.approvalPolicy = "on-failure";
  } else if (permission === "full-access" || permission === "dangerously-bypass-approvals-and-sandbox") {
    params.sandbox = "danger-full-access";
    params.approvalPolicy = "never";
  } else if (
    permission === "read-only" ||
    permission === "workspace-write" ||
    permission === "danger-full-access"
  ) {
    params.sandbox = permission;
  } else if (
    permission === "untrusted" ||
    permission === "on-request" ||
    permission === "never" ||
    permission === "on-failure"
  ) {
    params.approvalPolicy = permission;
  }
  return params;
}

function codexLaunchOptionArgs(
  launchOptions: Record<string, unknown> | undefined,
): string[] {
  const args: string[] = [];
  const model = stringValue(launchOptions?.model);
  if (model !== undefined) {
    args.push("--model", model);
  }

  // Reasoning effort maps to codex's `model_reasoning_effort` config override.
  const reasoning = stringValue(launchOptions?.reasoning);
  if (reasoning === "low" || reasoning === "medium" || reasoning === "high" || reasoning === "xhigh") {
    args.push("-c", `model_reasoning_effort=${codexConfigString(reasoning)}`);
  }

  const permission = stringValue(launchOptions?.permission);
  // Friendly approval modes (mirroring the Codex app) expand to a sandbox +
  // approval-policy pair. Legacy raw values (workspace-write, on-request, …) from
  // older threads still map directly to a single flag below.
  if (permission === "ask-for-approval") {
    args.push("--sandbox", "workspace-write", "--ask-for-approval", "on-request");
  } else if (permission === "approve-for-me") {
    args.push("--sandbox", "workspace-write", "--ask-for-approval", "on-failure");
  } else if (permission === "full-access") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (
    permission === "read-only" ||
    permission === "workspace-write" ||
    permission === "danger-full-access"
  ) {
    args.push("--sandbox", permission);
  } else if (
    permission === "untrusted" ||
    permission === "on-request" ||
    permission === "never" ||
    permission === "on-failure"
  ) {
    args.push("--ask-for-approval", permission);
  } else if (permission === "dangerously-bypass-approvals-and-sandbox") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }

  return args;
}

function cwdFromScope(scope: ThreadScope | undefined, fallback: string): string {
  if (scope === undefined) {
    return fallback;
  }
  return scope.kind === "project" ? scope.cwd : scope.scratchCwd;
}

function cloneTideMcpConfig(
  input: CodexTideMcpConfig | undefined,
): CodexTideMcpConfig | undefined {
  if (input === undefined) {
    return undefined;
  }
  return {
    command: input.command,
    args: [...input.args],
    env: input.env === undefined ? undefined : { ...input.env },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
