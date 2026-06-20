import path from "node:path";

import type {
  WorkspaceCommandCwdResult,
  WorkspaceCommandPort,
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
}
