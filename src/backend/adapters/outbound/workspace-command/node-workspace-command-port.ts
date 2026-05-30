import { spawn } from "node:child_process";
import path from "node:path";

import type {
  WorkspaceCommandCwdResult,
  WorkspaceCommandPort,
  WorkspaceCommandRunResult,
} from "../../../application/ports/outbound/workspace-command-port.ts";

export function createNodeWorkspaceCommandPort(): WorkspaceCommandPort {
  return new NodeWorkspaceCommandPort();
}

class NodeWorkspaceCommandPort implements WorkspaceCommandPort {
  async resolveCwd(input: {
    root: string;
    cwd?: string;
  }): Promise<WorkspaceCommandCwdResult> {
    const root = path.resolve(input.root);
    const cwdInput = input.cwd ?? ".";
    const candidate = path.isAbsolute(cwdInput)
      ? path.resolve(cwdInput)
      : path.resolve(root, cwdInput);

    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
      return {
        ok: false,
        error: {
          code: "workspace_command_outside_scope",
          message: "Command cwd is outside the Thread root.",
        },
      };
    }

    return {
      ok: true,
      cwd: {
        root,
        cwd: candidate,
        relativeCwd: path.relative(root, candidate) || ".",
      },
    };
  }

  async run(input: {
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
    byteLimit: number;
    startedAt: string;
  }): Promise<WorkspaceCommandRunResult> {
    if (input.command.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: "workspace_command_invalid",
          message: "Command is required.",
        },
      };
    }

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let settled = false;
      let timedOut = false;

      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        shell: false,
        env: process.env,
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, input.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        const next = appendBounded(stdout, chunk.toString("utf8"), input.byteLimit);
        stdout = next.value;
        truncated ||= next.truncated;
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const next = appendBounded(stderr, chunk.toString("utf8"), input.byteLimit);
        stderr = next.value;
        truncated ||= next.truncated;
      });

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        const completedAt = new Date().toISOString();
        const message = error instanceof Error ? error.message : "Command failed to start.";
        const transcript = boundedTranscript(
          commandTranscript({
            command: input.command,
            args: input.args,
            cwd: input.cwd,
            stdout,
            stderr: `${stderr}${message}\n`,
            exitCode: null,
            signal: null,
          }),
          input.byteLimit,
        );
        resolve({
          ok: true,
          run: {
            command: input.command,
            args: [...input.args],
            cwd: input.cwd,
            exitCode: null,
            signal: null,
            stdout,
            stderr: `${stderr}${message}\n`,
            transcript,
            truncated: true,
            timedOut,
            startedAt: input.startedAt,
            completedAt,
          },
        });
      });

      child.on("close", (exitCode, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        const completedAt = new Date().toISOString();
        const transcriptSource = commandTranscript({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          stdout,
          stderr,
          exitCode,
          signal,
        });
        const transcript = boundedTranscript(transcriptSource, input.byteLimit);

        resolve({
          ok: true,
          run: {
            command: input.command,
            args: [...input.args],
            cwd: input.cwd,
            exitCode,
            signal,
            stdout,
            stderr,
            transcript,
            truncated: truncated || transcript.length < transcriptSource.length,
            timedOut,
            startedAt: input.startedAt,
            completedAt,
          },
        });
      });
    });
  }
}

function appendBounded(
  current: string,
  chunk: string,
  byteLimit: number,
): { value: string; truncated: boolean } {
  const next = `${current}${chunk}`;
  if (next.length <= byteLimit) {
    return { value: next, truncated: false };
  }
  return {
    value: next.slice(0, byteLimit),
    truncated: true,
  };
}

function boundedTranscript(value: string, byteLimit: number): string {
  return value.length <= byteLimit ? value : value.slice(0, byteLimit);
}

function commandTranscript(input: {
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
}): string {
  const prompt = `$ cd ${input.cwd}\n$ ${[input.command, ...input.args].join(" ")}\n`;
  const exit = `[exit ${input.exitCode ?? input.signal ?? "unknown"}]\n`;
  return `${prompt}${input.stdout}${input.stderr}${exit}`;
}
