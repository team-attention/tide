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

export interface WorkspaceCommandPort {
  resolveCwd(input: {
    root: string;
    cwd?: string;
  }): Promise<WorkspaceCommandCwdResult>;
}
