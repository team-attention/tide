import type {
  WorkbenchTerminalHandle,
  WorkbenchTerminalPort,
  WorkbenchTerminalStartInput,
} from "../../../application/ports/outbound/workbench-terminal-port.ts";
import type { PtyProcessLauncher } from "./pty-process.ts";

export interface CreatePtyWorkbenchTerminalPortInput {
  launcher: PtyProcessLauncher;
  resolveRuntimeEnvironment?: (input: {
    cwd: string;
    planEnv: Record<string, string>;
  }) => NodeJS.ProcessEnv;
}

export function createPtyWorkbenchTerminalPort(
  input: CreatePtyWorkbenchTerminalPortInput,
): WorkbenchTerminalPort {
  return new PtyWorkbenchTerminalPort(input);
}

class PtyWorkbenchTerminalPort implements WorkbenchTerminalPort {
  private readonly launcher: PtyProcessLauncher;
  private readonly resolveRuntimeEnvironment?: CreatePtyWorkbenchTerminalPortInput["resolveRuntimeEnvironment"];

  constructor(input: CreatePtyWorkbenchTerminalPortInput) {
    this.launcher = input.launcher;
    this.resolveRuntimeEnvironment = input.resolveRuntimeEnvironment;
  }

  async start(input: WorkbenchTerminalStartInput): Promise<WorkbenchTerminalHandle> {
    const terminalEnv = {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG ?? process.env.LC_ALL ?? "en_US.UTF-8",
      ...(input.env ?? {}),
    };
    const handle = await this.launcher.spawn({
      runtimeId: `workbench-terminal:${input.threadId}:${input.paneId}`,
      plan: {
        command: input.command,
        args: input.args,
        // A GUI app launched from Finder inherits no TERM/LANG, so the user's
        // shell ran with a bogus terminal: backspace/redraw landed wrong (no
        // xterm terminfo), colors were off (no 256-color), and multibyte text
        // showed as boxes (no UTF-8 locale). xterm.js emulates xterm-256color.
        env: this.resolveEnvironment(input.cwd, terminalEnv),
        cwd: input.cwd,
        expectedSignalSources: [],
      },
      emulateTerminalQueries: false,
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

  private resolveEnvironment(
    cwd: string,
    planEnv: Record<string, string>,
  ): Record<string, string> {
    if (this.resolveRuntimeEnvironment === undefined) {
      return planEnv;
    }

    let runtimeEnv: NodeJS.ProcessEnv = {};
    try {
      runtimeEnv = this.resolveRuntimeEnvironment({ cwd, planEnv });
    } catch {
      runtimeEnv = {};
    }

    const resolvedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(runtimeEnv)) {
      if (value !== undefined) {
        resolvedEnv[key] = value;
      }
    }
    // Terminal plan values must win over shell env: xterm.js owns TERM/COLORTERM
    // and callers may pass explicit overrides.
    return { ...resolvedEnv, ...planEnv };
  }
}
