import type {
  WorkbenchTerminalHandle,
  WorkbenchTerminalPort,
  WorkbenchTerminalStartInput,
} from "../../../application/ports/outbound/workbench-terminal-port.ts";
import type { PtyProcessLauncher } from "./pty-process.ts";

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
        // A GUI app launched from Finder inherits no TERM/LANG, so the user's
        // shell ran with a bogus terminal: backspace/redraw landed wrong (no
        // xterm terminfo), colors were off (no 256-color), and multibyte text
        // showed as boxes (no UTF-8 locale). xterm.js emulates xterm-256color.
        env: {
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          LANG: process.env.LANG ?? process.env.LC_ALL ?? "en_US.UTF-8",
        },
        cwd: input.cwd,
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
}
