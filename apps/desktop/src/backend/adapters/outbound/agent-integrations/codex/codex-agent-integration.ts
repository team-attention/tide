import type {
  AgentIntegrationCapabilities,
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentIntegrationReadinessBlocker,
  AgentPromptSignalInput,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderLaunchPlan,
  ProviderSetupSurfaceAction,
  ProviderSignalSource,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import type { PromptState, ThreadScope } from "../../../../application/domains/thread/thread.ts";

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
        message: "Tide Codex hook/bootstrap setup is required.",
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
    });
  }

  detectPromptState(input: AgentPromptSignalInput): PromptState | null {
    if (
      input.source !== "provider_hook" ||
      input.eventName !== "PermissionRequest"
    ) {
      return null;
    }
    if (!isRecord(input.payload)) {
      return null;
    }

    const toolInput = isRecord(input.payload.tool_input)
      ? input.payload.tool_input
      : undefined;
    const message =
      stringValue(toolInput?.description) ??
      stringValue(toolInput?.command) ??
      stringValue(input.payload.tool_name) ??
      "Codex permission required.";

    return {
      promptId: codexPromptId(input.payload, message),
      threadId: input.threadId,
      agentId: "codex",
      kind: "permission",
      message,
      source: "provider_hook",
    };
  }

  private codexLaunchPlan(input: {
    executablePath: string;
    cwd: string;
    codexHome?: string;
    resumeRef?: string;
    launchOptions?: Record<string, unknown>;
    initialPrompt?: string;
  }): ProviderLaunchPlan {
    const env: Record<string, string> = {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };
    if (input.codexHome !== undefined) {
      env.CODEX_HOME = input.codexHome;
    }

    const launchOptionArgs = codexLaunchOptionArgs(input.launchOptions);
    // Deliver the first user message as Codex's positional [PROMPT] so the
    // session starts a turn immediately, instead of typing it into the TUI.
    const promptArgs =
      input.initialPrompt !== undefined && input.initialPrompt.length > 0
        ? [input.initialPrompt]
        : [];
    const args =
      input.resumeRef === undefined
        ? [
            "--no-alt-screen",
            ...launchOptionArgs,
            "--dangerously-bypass-hook-trust",
            ...codexConfigArgs(this.tideMcp),
            ...promptArgs,
          ]
        : [
            "resume",
            "--no-alt-screen",
            input.resumeRef,
            ...launchOptionArgs,
            "--dangerously-bypass-hook-trust",
            ...codexConfigArgs(this.tideMcp),
            ...promptArgs,
          ];

    return {
      command: input.executablePath,
      args,
      env,
      cwd: input.cwd,
      inputTiming: {
        startupDelayMs: 5000,
        preSubmitDelayMs: 350,
      },
      expectedSignalSources: expectedSignalSources.map((source) => ({ ...source })),
    };
  }
}

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
    "features.hooks=true",
    'plugins."browser-use@openai-bundled".enabled=false',
  ];

  if (tideMcp !== undefined) {
    config.push(`mcp_servers.tide.command=${codexConfigString(tideMcp.command)}`);
    config.push(
      `mcp_servers.tide.args=[${tideMcp.args.map(codexConfigString).join(",")}]`,
    );
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
  if (
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

function codexPromptId(
  payload: Record<string, unknown>,
  message: string,
): string {
  return (
    stringValue(payload.call_id) ??
    stringValue(payload.turn_id) ??
    `codex-permission-${message}`
  );
}
