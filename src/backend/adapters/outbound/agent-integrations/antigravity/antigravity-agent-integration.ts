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

export interface AntigravityProviderState {
  authenticated: boolean;
  onboardingComplete: boolean;
  trustedCwds: string[];
  pluginBootstrapReady: boolean;
}

export type AntigravityExecutableResolver = (
  command: "agy",
) => Promise<string | undefined> | string | undefined;

export type AntigravityProviderStateReader = (input: {
  cwd: string;
  executablePath: string;
  launchOptions?: Record<string, unknown>;
}) => Promise<AntigravityProviderState> | AntigravityProviderState;

export interface AntigravityTidePluginConfig {
  installSourcePath?: string;
}

export interface CreateAntigravityAgentIntegrationInput {
  resolveExecutable: AntigravityExecutableResolver;
  readProviderState: AntigravityProviderStateReader;
  tidePlugin?: AntigravityTidePluginConfig;
  defaultCwd?: string;
}

const antigravityCapabilities: AgentIntegrationCapabilities = {
  supportsHiddenPty: true,
  supportsResume: true,
  supportsTideMcp: true,
  supportsHooks: true,
  supportsReadableHistory: true,
  requiresTerminalKeyProtocol: true,
};

const expectedSignalSources: ProviderSignalSource[] = [
  {
    kind: "pty_transcript",
    description: "Captured hidden PTY input and output.",
  },
  {
    kind: "provider_hook",
    description:
      "Antigravity PreInvocation, PreToolUse, PostToolUse, PostInvocation, and Stop hooks from the Tide plugin.",
  },
  {
    kind: "provider_history",
    description:
      "Antigravity readable transcript JSONL and conversation references under provider-owned history.",
  },
  {
    kind: "tide_mcp",
    description:
      "Tide MCP Tool Surface attached through Antigravity plugin mcp_config.json.",
  },
];

export function createAntigravityAgentIntegration(
  input: CreateAntigravityAgentIntegrationInput,
): AgentIntegrationPort {
  return new AntigravityAgentIntegration(input);
}

class AntigravityAgentIntegration implements AgentIntegrationPort {
  private readonly resolveExecutable: AntigravityExecutableResolver;
  private readonly readProviderState: AntigravityProviderStateReader;
  private readonly tidePlugin?: AntigravityTidePluginConfig;
  private readonly defaultCwd: string;

  constructor(input: CreateAntigravityAgentIntegrationInput) {
    this.resolveExecutable = input.resolveExecutable;
    this.readProviderState = input.readProviderState;
    this.tidePlugin = cloneTidePluginConfig(input.tidePlugin);
    this.defaultCwd = input.defaultCwd ?? ".";
  }

  async preflight(
    input: AgentIntegrationPreflightInput,
  ): Promise<AgentIntegrationPreflightResult> {
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    const executablePath = await this.resolveExecutable("agy");
    if (executablePath === undefined) {
      return {
        agentId: "antigravity",
        ready: false,
        blockers: [
          {
            kind: "not_installed",
            scope: "provider",
            message: "Antigravity CLI executable was not found.",
          },
        ],
        capabilities: antigravityCapabilities,
      };
    }

    const providerState = await this.readProviderState({
      cwd,
      executablePath,
      launchOptions: input.launchOptions,
    });
    const providerSetup = antigravityProviderSetupAction(executablePath, cwd);
    const pluginSetup = antigravityPluginSetupAction(
      executablePath,
      cwd,
      this.tidePlugin,
    );
    const blockers: AgentIntegrationReadinessBlocker[] = [];

    if (!providerState.authenticated) {
      blockers.push({
        kind: "not_authenticated",
        scope: "provider",
        message:
          "Antigravity authentication is required before starting a Thread.",
        setup: providerSetup,
      });
    }
    if (!providerState.onboardingComplete) {
      blockers.push({
        kind: "onboarding_required",
        scope: "provider",
        message:
          "Antigravity onboarding must be completed before starting a Thread.",
        setup: providerSetup,
      });
    }
    if (!providerState.trustedCwds.includes(cwd)) {
      blockers.push({
        kind: "directory_trust_required",
        scope: "execution_context",
        message:
          "Antigravity workspace trust is required for this Execution Context.",
        setup: providerSetup,
      });
    }
    if (!providerState.pluginBootstrapReady) {
      blockers.push({
        kind: "hook_bootstrap_required",
        scope: "integration",
        message:
          "Tide Antigravity plugin/bootstrap setup is required for hooks and MCP.",
        setup: pluginSetup,
      });
    }

    if (blockers.length > 0) {
      return {
        agentId: "antigravity",
        ready: false,
        blockers,
        capabilities: antigravityCapabilities,
      };
    }

    return {
      agentId: "antigravity",
      ready: true,
      blockers: [],
      capabilities: antigravityCapabilities,
      launchPlan: this.antigravityLaunchPlan({
        executablePath,
        cwd,
        conversationRef: undefined,
      }),
    };
  }

  async buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("agy")) ?? "agy";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);

    return this.antigravityLaunchPlan({
      executablePath,
      cwd,
      conversationRef: undefined,
    });
  }

  async buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("agy")) ?? "agy";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);

    return this.antigravityLaunchPlan({
      executablePath,
      cwd,
      conversationRef: input.providerSessionRef.value,
    });
  }

  detectPromptState(input: AgentPromptSignalInput): PromptState | null {
    if (
      input.source !== "provider_hook" ||
      input.eventName !== "PreToolUse" ||
      !isRecord(input.payload)
    ) {
      return null;
    }

    const toolCall = isRecord(input.payload.toolCall)
      ? input.payload.toolCall
      : undefined;
    if (stringValue(toolCall?.name) !== "run_command") {
      return null;
    }

    const args = isRecord(toolCall?.args) ? toolCall.args : undefined;
    const message = stringValue(args?.CommandLine);
    if (message === undefined) {
      return null;
    }

    return {
      promptId: antigravityPromptId(input.payload, message),
      threadId: input.threadId,
      agentId: "antigravity",
      kind: "permission",
      message,
      source: "provider_hook",
    };
  }

  private antigravityLaunchPlan(input: {
    executablePath: string;
    cwd: string;
    conversationRef?: string;
  }): ProviderLaunchPlan {
    const args =
      input.conversationRef === undefined
        ? []
        : ["--conversation", input.conversationRef];

    return {
      command: input.executablePath,
      args,
      env: {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
      cwd: input.cwd,
      expectedSignalSources: expectedSignalSources.map((source) => ({
        ...source,
      })),
    };
  }
}

function antigravityProviderSetupAction(
  executablePath: string,
  cwd: string,
): ProviderSetupSurfaceAction {
  return {
    command: executablePath,
    args: [],
    cwd,
    expectedCompletion: "retry_preflight",
  };
}

function antigravityPluginSetupAction(
  executablePath: string,
  cwd: string,
  tidePlugin: AntigravityTidePluginConfig | undefined,
): ProviderSetupSurfaceAction {
  if (tidePlugin?.installSourcePath !== undefined) {
    return {
      command: executablePath,
      args: ["plugin", "install", tidePlugin.installSourcePath],
      cwd,
      expectedCompletion: "retry_preflight",
    };
  }

  return antigravityProviderSetupAction(executablePath, cwd);
}

function cwdFromScope(scope: ThreadScope | undefined, fallback: string): string {
  if (scope === undefined) {
    return fallback;
  }
  return scope.kind === "project" ? scope.cwd : scope.scratchCwd;
}

function cloneTidePluginConfig(
  input: AntigravityTidePluginConfig | undefined,
): AntigravityTidePluginConfig | undefined {
  if (input === undefined) {
    return undefined;
  }
  return { installSourcePath: input.installSourcePath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function antigravityPromptId(
  payload: Record<string, unknown>,
  message: string,
): string {
  const conversationId = stringValue(payload.conversationId);
  const stepIdx = typeof payload.stepIdx === "number" ? payload.stepIdx : undefined;
  if (conversationId !== undefined && stepIdx !== undefined) {
    return `antigravity-permission-${conversationId}-${stepIdx}`;
  }
  return `antigravity-permission-${message}`;
}
