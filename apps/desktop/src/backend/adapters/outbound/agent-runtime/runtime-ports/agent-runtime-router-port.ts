import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  AgentSessionConfigInput,
  AgentSessionConfigResult,
  TerminalInput,
} from "../../../../application/domains/agent-runtime/agent-runtime.ts";
import type { AgentRuntimePort } from "../../../../application/ports/outbound/agent-runtime-port.ts";
import type {
  ProviderReadinessCheckInput,
  ProviderReadinessResult,
} from "../../../../application/domains/provider-readiness/provider-readiness.ts";
import type { ProviderReadinessPort } from "../../../../application/ports/outbound/provider-readiness-port.ts";
import type { AgentId } from "../../../../application/domains/thread/thread.ts";

export interface CreateAgentRuntimeRouterPortInput {
  providerCliRuntime: AgentRuntimePort;
  tideApiRuntime: AgentRuntimePort;
}

export interface CreateProviderReadinessRouterPortInput {
  providerCliReadiness: ProviderReadinessPort;
  tideApiReadiness: ProviderReadinessPort;
}

export function createAgentRuntimeRouterPort(
  input: CreateAgentRuntimeRouterPortInput,
): AgentRuntimePort {
  return new AgentRuntimeRouterPort(input);
}

export function createProviderReadinessRouterPort(
  input: CreateProviderReadinessRouterPortInput,
): ProviderReadinessPort {
  return {
    check(checkInput: ProviderReadinessCheckInput): Promise<ProviderReadinessResult> {
      return runtimeLaneForAgent(checkInput.agentId) === "tide_api"
        ? input.tideApiReadiness.check(checkInput)
        : input.providerCliReadiness.check(checkInput);
    },
  };
}

class AgentRuntimeRouterPort implements AgentRuntimePort {
  private readonly providerCliRuntime: AgentRuntimePort;
  private readonly tideApiRuntime: AgentRuntimePort;

  constructor(input: CreateAgentRuntimeRouterPortInput) {
    this.providerCliRuntime = input.providerCliRuntime;
    this.tideApiRuntime = input.tideApiRuntime;
  }

  start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    return runtimeLaneForAgent(input.agentBinding.agentId) === "tide_api"
      ? this.tideApiRuntime.start(input)
      : this.providerCliRuntime.start(input);
  }

  resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    return runtimeLaneForAgent(input.agentBinding.agentId) === "tide_api"
      ? this.tideApiRuntime.resume(input)
      : this.providerCliRuntime.resume(input);
  }

  writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void> {
    return runtimeLaneForAgent(handle.agentId) === "tide_api"
      ? this.tideApiRuntime.writeInput(handle, input)
      : this.providerCliRuntime.writeInput(handle, input);
  }

  applySessionConfig(
    handle: AgentRuntimeHandle,
    input: AgentSessionConfigInput,
  ): Promise<AgentSessionConfigResult> {
    return runtimeLaneForAgent(handle.agentId) === "tide_api"
      ? this.tideApiRuntime.applySessionConfig(handle, input)
      : this.providerCliRuntime.applySessionConfig(handle, input);
  }

  interrupt(handle: AgentRuntimeHandle): Promise<void> {
    return runtimeLaneForAgent(handle.agentId) === "tide_api"
      ? this.tideApiRuntime.interrupt(handle)
      : this.providerCliRuntime.interrupt(handle);
  }

  stop(handle: AgentRuntimeHandle): Promise<void> {
    return runtimeLaneForAgent(handle.agentId) === "tide_api"
      ? this.tideApiRuntime.stop(handle)
      : this.providerCliRuntime.stop(handle);
  }
}

function runtimeLaneForAgent(agentId: AgentId): "provider_cli" | "tide_api" {
  return agentId === "openai_api" ? "tide_api" : "provider_cli";
}
