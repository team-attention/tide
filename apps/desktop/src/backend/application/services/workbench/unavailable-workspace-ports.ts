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
    async readImageFile() {
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
  };
}

export function createUnavailableWorkspaceCodeIntelligencePort(): WorkspaceCodeIntelligencePort {
  const unavailable = {
    ok: false as const,
    error: {
      code: "workspace_code_intelligence_unavailable" as const,
      message: "Workspace code intelligence is not configured.",
    },
  };
  return {
    async findDefinition() {
      return unavailable;
    },
    async findReferences() {
      return unavailable;
    },
    async getCompletions() {
      return unavailable;
    },
    async getHover() {
      return unavailable;
    },
    async getDocumentHighlights() {
      return unavailable;
    },
    async getSignatureHelp() {
      return unavailable;
    },
    async getDiagnostics() {
      return unavailable;
    },
  };
}
