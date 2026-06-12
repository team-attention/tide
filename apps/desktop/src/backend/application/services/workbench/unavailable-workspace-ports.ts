import type { WorkspaceCodeIntelligencePort } from "../../ports/outbound/workspace-code-intelligence-port.ts";
import type { WorkspaceCommandPort } from "../../ports/outbound/workspace-command-port.ts";
import type { WorkspaceFilePort } from "../../ports/outbound/workspace-file-port.ts";

// Null-object port implementations used when a workspace capability is not
// configured. Each method returns a clean "unavailable" Contract-shaped error
// instead of throwing, so the service degrades gracefully. Extracted from
// thread-runtime-service.ts to keep the service focused on behavior.

export function createUnavailableWorkspaceFilePort(): WorkspaceFilePort {
  return {
    async listTree() {
      return {
        ok: false,
        error: {
          code: "workspace_file_unavailable",
          message: "Workspace file access is not configured.",
        },
      };
    },
    async readTextFile() {
      return {
        ok: false,
        error: {
          code: "workspace_file_unavailable",
          message: "Workspace file access is not configured.",
        },
      };
    },
    async searchContent() {
      return {
        ok: false,
        error: {
          code: "workspace_file_unavailable",
          message: "Workspace file access is not configured.",
        },
      };
    },
    async replaceText() {
      return {
        ok: false,
        error: {
          code: "workspace_file_unavailable",
          message: "Workspace file access is not configured.",
        },
      };
    },
    async writeTextFile() {
      return {
        ok: false,
        error: {
          code: "workspace_file_unavailable",
          message: "Workspace file access is not configured.",
        },
      };
    },
  };
}

export function createUnavailableWorkspaceCommandPort(): WorkspaceCommandPort {
  return {
    async resolveCwd() {
      return {
        ok: false,
        error: {
          code: "workspace_command_unavailable",
          message: "Workspace command access is not configured.",
        },
      };
    },
    async run() {
      return {
        ok: false,
        error: {
          code: "workspace_command_unavailable",
          message: "Workspace command access is not configured.",
        },
      };
    },
  };
}

export function createUnavailableWorkspaceCodeIntelligencePort(): WorkspaceCodeIntelligencePort {
  return {
    async findDefinition() {
      return {
        ok: false,
        error: {
          code: "workspace_code_intelligence_unavailable",
          message: "Workspace code intelligence is not configured.",
        },
      };
    },
    async findReferences() {
      return {
        ok: false,
        error: {
          code: "workspace_code_intelligence_unavailable",
          message: "Workspace code intelligence is not configured.",
        },
      };
    },
  };
}
