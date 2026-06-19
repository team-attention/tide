export type WorkspaceCommandErrorCode =
  | "workspace_command_unavailable"
  | "workspace_command_invalid"
  | "workspace_command_outside_scope";

export interface WorkspaceCommandError {
  code: WorkspaceCommandErrorCode;
  message: string;
}

export interface WorkspaceCommandCwd {
  root: string;
  cwd: string;
  relativeCwd: string;
}

export type WorkspaceCommandCwdResult =
  | { ok: true; cwd: WorkspaceCommandCwd }
  | { ok: false; error: WorkspaceCommandError };

export interface WorkspaceCommandRun {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  transcript: string;
  truncated: boolean;
  timedOut: boolean;
  startedAt: string;
  completedAt: string;
}

export type WorkspaceCommandRunResult =
  | { ok: true; run: WorkspaceCommandRun }
  | { ok: false; error: WorkspaceCommandError };

export interface WorkspaceCommandPort {
  resolveCwd(input: {
    root: string;
    cwd?: string;
  }): Promise<WorkspaceCommandCwdResult>;

  run(input: {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs: number;
    byteLimit: number;
    startedAt: string;
  }): Promise<WorkspaceCommandRunResult>;
}
