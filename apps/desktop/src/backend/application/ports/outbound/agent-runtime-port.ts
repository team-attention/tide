import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  AgentSessionConfigInput,
  AgentSessionConfigResult,
  TerminalInput,
} from "../../domains/agent-runtime/agent-runtime.ts";

export interface AgentRuntimePort {
  start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle>;
  resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle>;
  writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void>;
  // Apply a mid-thread Launch Options change to the LIVE session when the
  // provider protocol supports it; "restart_required" tells the caller to
  // restart the runtime before the next turn instead. See
  // docs_v2/specs/mid-thread-launch-option-changes.md.
  applySessionConfig(
    handle: AgentRuntimeHandle,
    input: AgentSessionConfigInput,
  ): Promise<AgentSessionConfigResult>;
  // Abort the in-flight turn but keep the runtime alive + resumable.
  interrupt(handle: AgentRuntimeHandle): Promise<void>;
  stop(handle: AgentRuntimeHandle): Promise<void>;
}
