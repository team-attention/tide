import type {
  WorkbenchTerminalHandle,
  WorkbenchTerminalPort,
  WorkbenchTerminalStartInput,
} from "../../../application/ports/outbound/workbench-terminal-port.ts";
import type { PtyProcessLauncher } from "../agent-runtime/agent-integration-agent-runtime-port.ts";

export interface CreatePtyWorkbenchTerminalPortInput {
  launcher: PtyProcessLauncher;
}

export function createPtyWorkbenchTerminalPort(
  input: CreatePtyWorkbenchTerminalPortInput,
): WorkbenchTerminalPort {
  return new PtyWorkbenchTerminalPort(input);
}

class PtyWorkbenchTerminalPort implements WorkbenchTerminalPort {
  private readonly launcher: PtyProcessLauncher;

  constructor(input: CreatePtyWorkbenchTerminalPortInput) {
    this.launcher = input.launcher;
  }

  async start(input: WorkbenchTerminalStartInput): Promise<WorkbenchTerminalHandle> {
    const handle = await this.launcher.spawn({
      runtimeId: `workbench-terminal:${input.threadId}:${input.paneId}`,
      plan: {
        command: input.command,
        args: input.args,
        env: {},
        cwd: input.cwd,
        expectedSignalSources: [],
      },
      onOutput: input.onOutput,
      onExit: input.onExit,
    });

    return {
      terminalRuntimeId: handle.runtimeId,
      write: (data) => handle.write(data),
      resize: (cols, rows) => handle.resize?.(cols, rows),
      stop: () => handle.stop(),
    };
  }
}
