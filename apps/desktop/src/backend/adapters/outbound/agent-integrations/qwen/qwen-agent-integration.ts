import type {
  AgentIntegrationCapabilities,
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderLaunchPlan,
  SessionConfigUpdateInput,
  SessionConfigUpdatePlan,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import type { ThreadScope } from "../../../../application/domains/thread/thread.ts";
import { npmInstallReadinessTerminalAction } from "../shared/provider-cli-commands.ts";

// Qwen Code speaks ACP over stdio with `qwen --acp` (the same transport family as
// opencode, with provider-specific launch/readiness only). The shared ACP client
// owns initialize/session/new/session/load/prompt, permission prompts, and model
// catalog updates.

export interface QwenProviderState {
  authenticated: boolean;
}

export type QwenExecutableResolver = (
  command: "qwen" | "npm",
) => Promise<string | undefined> | string | undefined;

export type QwenProviderStateReader = (input: {
  cwd: string;
  executablePath: string;
}) => Promise<QwenProviderState> | QwenProviderState;

export interface QwenTideMcpConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface CreateQwenAgentIntegrationInput {
  resolveExecutable: QwenExecutableResolver;
  readProviderState: QwenProviderStateReader;
  defaultCwd?: string;
  tideMcp?: QwenTideMcpConfig;
}

const qwenCapabilities: AgentIntegrationCapabilities = {
  supportsResume: true,
  supportsTideMcp: true,
  supportsHooks: false,
  supportsReadableHistory: false,
  supportsTurnSteer: false,
};

export function createQwenAgentIntegration(
  input: CreateQwenAgentIntegrationInput,
): AgentIntegrationPort {
  return new QwenAgentIntegration(input);
}

class QwenAgentIntegration implements AgentIntegrationPort {
  private readonly resolveExecutable: QwenExecutableResolver;
  private readonly readProviderState: QwenProviderStateReader;
  private readonly defaultCwd: string;
  private readonly tideMcp?: QwenTideMcpConfig;

  constructor(input: CreateQwenAgentIntegrationInput) {
    this.resolveExecutable = input.resolveExecutable;
    this.readProviderState = input.readProviderState;
    this.defaultCwd = input.defaultCwd ?? ".";
    this.tideMcp = input.tideMcp;
  }

  async preflight(
    input: AgentIntegrationPreflightInput,
  ): Promise<AgentIntegrationPreflightResult> {
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    const executablePath = await this.resolveExecutable("qwen");
    if (executablePath === undefined) {
      const npmPath = (await this.resolveExecutable("npm")) ?? "npm";
      return {
        agentId: "qwen",
        ready: false,
        blockers: [
          {
            kind: "not_installed",
            scope: "provider",
            message: "Qwen Code executable was not found.",
            terminalAction: npmInstallReadinessTerminalAction({ npmPath, agentId: "qwen", cwd }),
          },
        ],
        capabilities: qwenCapabilities,
      };
    }

    const providerState = await this.readProviderState({ cwd, executablePath });
    if (!providerState.authenticated) {
      return {
        agentId: "qwen",
        ready: false,
        blockers: [
          {
            kind: "not_authenticated",
            scope: "provider",
            message:
              "Qwen Code has no model credentials configured. Run `qwen`, then use `/auth` " +
              "or configure ~/.qwen/settings.json / .qwen/.env.",
            terminalAction: {
              command: executablePath,
              args: [],
              cwd,
              expectedCompletion: "retry_preflight",
            },
          },
        ],
        capabilities: qwenCapabilities,
      };
    }

    return {
      agentId: "qwen",
      ready: true,
      blockers: [],
      capabilities: qwenCapabilities,
      launchPlan: this.qwenLaunchPlan({ executablePath, cwd, launchOptions: input.launchOptions }),
    };
  }

  async buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("qwen")) ?? "qwen";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    return this.qwenLaunchPlan({ executablePath, cwd, launchOptions: input.launchOptions });
  }

  async buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("qwen")) ?? "qwen";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    return this.qwenLaunchPlan({ executablePath, cwd, launchOptions: input.launchOptions });
  }

  buildSessionConfigUpdate(input: SessionConfigUpdateInput): SessionConfigUpdatePlan {
    return {
      kind: "live",
      protocolParams: qwenProtocolParams(input.launchOptions, input.changedKeys),
    };
  }

  private qwenLaunchPlan(input: {
    executablePath: string;
    cwd: string;
    launchOptions?: Record<string, unknown>;
  }): ProviderLaunchPlan {
    return {
      command: input.executablePath,
      args: ["--acp"],
      env: {},
      cwd: input.cwd,
      transport: "acp",
      protocolParams: {
        cwd: input.cwd,
        ...qwenProtocolParams(input.launchOptions, ["model", "permission"]),
        ...(this.tideMcp !== undefined
          ? {
              mcpServers: [
                {
                  name: "tide",
                  command: this.tideMcp.command,
                  args: this.tideMcp.args,
                  env: Object.entries(this.tideMcp.env ?? {}).map(([name, value]) => ({ name, value })),
                },
              ],
            }
          : {}),
      },
    };
  }
}

function cwdFromScope(scope: ThreadScope | undefined, fallback: string): string {
  if (scope === undefined) {
    return fallback;
  }
  return scope.kind === "project" ? scope.cwd : scope.scratchCwd;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function qwenProtocolParams(
  launchOptions: Record<string, unknown> | undefined,
  changedKeys: ReadonlyArray<string>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const configOptions = qwenConfigOptions(launchOptions, changedKeys);
  if (configOptions.length > 0) {
    params.configOptions = configOptions;
  }
  if (changedKeys.includes("permission")) {
    const permission = stringValue(launchOptions?.permission);
    if (permission !== undefined) {
      params.modeId = permission;
    }
  }
  return params;
}

export function qwenConfigOptions(
  launchOptions: Record<string, unknown> | undefined,
  changedKeys: ReadonlyArray<string>,
): Array<{ configId: string; value: string }> {
  if (!changedKeys.includes("model")) {
    return [];
  }
  const model = stringValue(launchOptions?.model);
  return model === undefined || model === "Qwen default"
    ? []
    : [{ configId: "model", value: model }];
}
