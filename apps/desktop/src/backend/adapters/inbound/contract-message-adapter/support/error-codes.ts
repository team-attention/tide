import type { ServiceError } from "../../../../application/services/thread/thread-runtime-service.ts";
import type { ContractErrorCode } from "../../../../../shared/contracts/index.ts";
// Extracted from backend-contract-message-adapter.ts (spec: navigable-source-structure).

export function contractCodeFromServiceError(error: ServiceError): ContractErrorCode {
  switch (error.code) {
    case "thread_not_found":
    case "provider_not_ready":
    case "agent_runtime_unavailable":
      return error.code;
    case "provider_runtime_failed":
      return "provider_runtime_failed";
    case "browser_runtime_unavailable":
    case "browser_runtime_timeout":
      return "agent_runtime_unavailable";
    case "agent_binding_locked":
    case "thread_not_draft":
    case "prompt_not_found":
    case "no_pending_input":
    case "invalid_workbench_command":
    case "invalid_thread_title":
    case "workbench_target_not_found":
    case "workbench_stale_reference":
    case "workbench_user_controlled":
    case "unsupported_tide_mcp_tool":
    case "directory_trust_unavailable":
    case "provider_capability_unsupported":
    case "workspace_file_unavailable":
    case "workspace_file_not_found":
    case "workspace_file_outside_scope":
    case "workspace_file_not_image":
    case "workspace_file_not_text":
    case "workspace_file_unreadable":
    case "workspace_file_too_large":
    case "workspace_file_edit_conflict":
    case "workspace_command_unavailable":
    case "workspace_command_invalid":
    case "workspace_command_outside_scope":
    case "workspace_code_intelligence_unavailable":
    case "workspace_code_definition_not_found":
    case "workspace_code_references_not_found":
    case "browser_runtime_error":
    case "browser_runtime_invalid_response":
      return "invalid_command";
  }
}

export function isRetryableServiceError(error: ServiceError): boolean {
  return (
    error.code === "provider_not_ready" ||
    error.code === "agent_runtime_unavailable" ||
    error.code === "provider_runtime_failed" ||
    error.code === "browser_runtime_unavailable" ||
    error.code === "browser_runtime_timeout"
  );
}
