import type { WorkspaceCodeIntelligenceErrorCode } from "../../ports/outbound/workspace-code-intelligence-port.ts";
import type { WorkspaceCommandErrorCode } from "../../ports/outbound/workspace-command-port.ts";
import type { WorkspaceFileErrorCode } from "../../ports/outbound/workspace-file-port.ts";

// The service result/error contract shared by ThreadRuntimeService and its
// collaborators. Extracted from thread-runtime-service.ts so collaborators can
// return service results without importing the facade.

export type ServiceErrorCode =
  | "thread_not_found"
  | "thread_not_draft"
  | "agent_binding_locked"
  | "provider_not_ready"
  | "prompt_not_found"
  | "no_pending_input"
  | "agent_runtime_unavailable"
  | "invalid_workbench_command"
  | "invalid_thread_title"
  | "workbench_target_not_found"
  | "workbench_stale_reference"
  | "workbench_user_controlled"
  | "browser_runtime_unavailable"
  | "browser_runtime_timeout"
  | "browser_runtime_error"
  | "browser_runtime_invalid_response"
  | "unsupported_tide_mcp_tool"
  | "directory_trust_unavailable"
  | "provider_capability_unsupported"
  | "provider_runtime_failed"
  | WorkspaceCodeIntelligenceErrorCode
  | WorkspaceCommandErrorCode
  | WorkspaceFileErrorCode;

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
}

export type ServiceResult<T> = ({ ok: true } & T) | { ok: false; error: ServiceError };

export function failure(
  code: ServiceErrorCode,
  message: string,
): { ok: false; error: ServiceError } {
  return { ok: false, error: { code, message } };
}
