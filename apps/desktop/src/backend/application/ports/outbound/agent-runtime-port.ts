import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  AgentRuntimeCapabilityInvocationInput,
  AgentRuntimeCapabilityInvocationResult,
  AgentRuntimeDispatchResult,
  AgentSessionConfigInput,
  AgentSessionConfigResult,
  TerminalInput,
} from "../../domains/agent-runtime/agent-runtime.ts";
import type { ProviderCliAgentId } from "../../domains/thread/thread.ts";

// One slash-command (`/`) or skill (`$`) the agent itself reports — the shape of
// the structured `commands` event, surfaced in the composer menu.
export interface DiscoveredCommand {
  name: string;
  description: string;
  trigger: "/" | "$";
}

export interface AgentRuntimePort {
  start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle>;
  resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle>;
  writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<AgentRuntimeDispatchResult | void>;
  // Apply a mid-thread Launch Options change to the LIVE session when the
  // provider protocol supports it; "restart_required" tells the caller to
  // restart the runtime before the next turn instead. See
  // docs_v2/specs/mid-thread-launch-option-changes.md.
  applySessionConfig(
    handle: AgentRuntimeHandle,
    input: AgentSessionConfigInput,
  ): Promise<AgentSessionConfigResult>;
  invokeCapability?(
    handle: AgentRuntimeHandle,
    input: AgentRuntimeCapabilityInvocationInput,
  ): Promise<AgentRuntimeCapabilityInvocationResult>;
  // Abort the in-flight turn but keep the runtime alive + resumable.
  interrupt(handle: AgentRuntimeHandle): Promise<void>;
  stop(handle: AgentRuntimeHandle): Promise<void>;
  shutdown?(): Promise<void>;
  // Discover the agent's REAL command set (the list the provider CLI itself
  // exposes) by running a handshake-only runtime and capturing its `commands`
  // event, without a full turn — for the composer's / and $ menu on the Start
  // Composer. See docs_v2/specs/live-provider-command-mirroring.md.
  discoverCommands?(agentId: ProviderCliAgentId, cwd: string): Promise<DiscoveredCommand[]>;
}
