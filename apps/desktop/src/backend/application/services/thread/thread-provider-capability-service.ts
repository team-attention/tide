import type { AgentRuntimeHandle } from "../../domains/agent-runtime/agent-runtime.ts";
import type { ThreadRecord } from "../../domains/thread/thread.ts";
import type { AgentRuntimePort } from "../../ports/outbound/agent-runtime-port.ts";
import type { ProviderReadinessPort } from "../../ports/outbound/provider-readiness-port.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import type {
  InvokeProviderCapabilityInput,
  InvokeProviderCapabilityResult,
  SendComposerInput,
  SendComposerInputResult,
} from "./thread-runtime-api.ts";
import { snapshotThread } from "./thread-snapshot.ts";
import type { ThreadStore } from "./thread-store.ts";

export class ThreadProviderCapabilityService {
  private readonly threads: ThreadStore;
  private readonly agentRuntimePort: AgentRuntimePort;
  private readonly providerReadinessPort: ProviderReadinessPort;
  private readonly clock: () => string;
  private readonly sendComposerInput: (input: SendComposerInput) => Promise<ServiceResult<SendComposerInputResult>>;
  private readonly activeOrResumedHandle: (thread: ThreadRecord) => Promise<AgentRuntimeHandle>;

  constructor(input: {
    threads: ThreadStore;
    agentRuntimePort: AgentRuntimePort;
    providerReadinessPort: ProviderReadinessPort;
    clock: () => string;
    sendComposerInput: (input: SendComposerInput) => Promise<ServiceResult<SendComposerInputResult>>;
    activeOrResumedHandle: (thread: ThreadRecord) => Promise<AgentRuntimeHandle>;
  }) {
    this.threads = input.threads;
    this.agentRuntimePort = input.agentRuntimePort;
    this.providerReadinessPort = input.providerReadinessPort;
    this.clock = input.clock;
    this.sendComposerInput = input.sendComposerInput;
    this.activeOrResumedHandle = input.activeOrResumedHandle;
  }

  async invokeProviderCapability(
    input: InvokeProviderCapabilityInput,
  ): Promise<ServiceResult<InvokeProviderCapabilityResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    if (input.invoke.kind === "unsupported") {
      return failure("provider_capability_unsupported", input.invoke.reason);
    }
    if (input.invoke.kind === "provider_prompt_text") {
      return this.invokePromptTextCapability(input.threadId, input.invoke.text);
    }
    if (input.invoke.kind !== "provider_method") {
      return failure(
        "provider_capability_unsupported",
        `Capability ${input.capabilityId} must be handled by a Tide surface or launch-option control.`,
      );
    }
    if (this.agentRuntimePort.invokeCapability === undefined) {
      return failure(
        "provider_capability_unsupported",
        `${thread.agentBinding.agentId} runtime does not support provider capability invocation.`,
      );
    }

    try {
      if (thread.activeRuntimeHandle === undefined) {
        const readiness = await this.providerReadinessPort.check({
          agentId: thread.agentBinding.agentId,
          scope: thread.scope,
          launchOptions: thread.launchOptions,
        });
        if (!readiness.ready) {
          return failure("provider_not_ready", "Provider is not ready for capability invocation.");
        }
      }
      const handle = await this.activeOrResumedHandle(thread);
      const result = await this.agentRuntimePort.invokeCapability(handle, {
        capabilityId: input.capabilityId,
        invoke: input.invoke,
        params: input.params,
      });
      if (result.status === "unsupported") {
        return failure("provider_capability_unsupported", result.reason);
      }
      if (thread.runtimeState === "starting") {
        thread.runtimeState = "idle";
        thread.lifecycleState = "open";
        thread.lastKnownState = "idle";
      }
      thread.updatedAt = this.clock();
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        status: "handled",
        ...(result.result !== undefined ? { result: result.result } : {}),
      };
    } catch (error) {
      return failure(
        "provider_runtime_failed",
        error instanceof Error ? error.message : "Provider capability invocation failed.",
      );
    }
  }

  private async invokePromptTextCapability(
    threadId: string,
    text: string,
  ): Promise<ServiceResult<InvokeProviderCapabilityResult>> {
    const sent = await this.sendComposerInput({ threadId, input: text });
    if (!sent.ok) {
      return sent;
    }
    return {
      ok: true,
      thread: sent.thread,
      runtimeState: sent.runtimeState,
      status: "handled",
      result: { delivery: sent.status },
    };
  }
}
