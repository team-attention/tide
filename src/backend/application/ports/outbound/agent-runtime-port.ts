import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  TerminalInput,
} from "../../domains/agent-runtime/agent-runtime.ts";

export interface AgentRuntimePort {
  start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle>;
  resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle>;
  writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void>;
  stop(handle: AgentRuntimeHandle): Promise<void>;
}
