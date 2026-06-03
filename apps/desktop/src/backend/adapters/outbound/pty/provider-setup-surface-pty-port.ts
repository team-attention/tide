import type { ProviderLaunchPlan } from "../../../application/ports/outbound/agent-integration-port.ts";
import type {
  ProviderSetupSurfaceStartInput,
  ProviderSetupSurfaceTerminalPort,
} from "../../../application/ports/outbound/provider-setup-surface-terminal-port.ts";
import type { PtyProcessLauncher } from "../agent-runtime/agent-integration-agent-runtime-port.ts";

export interface CreatePtyProviderSetupSurfaceTerminalPortInput {
  launcher: PtyProcessLauncher;
  idGenerator?: () => string;
}

export function createPtyProviderSetupSurfaceTerminalPort(
  input: CreatePtyProviderSetupSurfaceTerminalPortInput,
): ProviderSetupSurfaceTerminalPort {
  return new PtyProviderSetupSurfaceTerminalPort(input);
}

class PtyProviderSetupSurfaceTerminalPort implements ProviderSetupSurfaceTerminalPort {
  private readonly launcher: PtyProcessLauncher;
  private readonly idGenerator: () => string;

  constructor(input: CreatePtyProviderSetupSurfaceTerminalPortInput) {
    this.launcher = input.launcher;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
  }

  async start(input: ProviderSetupSurfaceStartInput) {
    const runtimeId = this.idGenerator();
    const process = await this.launcher.spawn({
      runtimeId,
      plan: setupLaunchPlan(input),
      onOutput: input.onOutput,
      onExit: input.onExit,
    });

    return {
      surfaceRuntimeId: runtimeId,
      write: (data: string) => process.write(data),
      stop: () => process.stop(),
    };
  }
}

function setupLaunchPlan(input: ProviderSetupSurfaceStartInput): ProviderLaunchPlan {
  return {
    command: input.command,
    args: [...input.args],
    env: {
      ...input.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
    cwd: input.cwd,
    expectedSignalSources: [
      {
        kind: "pty_transcript",
        description: "Visible Provider Setup Surface terminal output.",
      },
    ],
  };
}

function defaultIdGenerator(): string {
  return `setup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
