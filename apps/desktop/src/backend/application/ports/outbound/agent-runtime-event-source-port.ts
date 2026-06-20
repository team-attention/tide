import type {
  AgentRuntimeEvent,
  InSessionCommand,
} from "../../domains/agent-runtime/agent-runtime-event.ts";
import type { TerminalInput } from "../../domains/agent-runtime/agent-runtime.ts";

// One live event source per Agent Runtime, owned by the Agent Integration.
// It fuses the provider's own signals into one deduped, ordered, typed stream
// (AgentRuntimeEvent) and accepts user turns + interrupts. The Backend service
// consumes this uniformly with no provider-specific lifecycle branching.
// See docs_v2/specs/agent-runtime-event-spine.md.
export interface AgentRuntimeEventSource {
  readonly runtimeId: string;

  // Ordered lifecycle events for this runtime until runtime.exited.
  // Single-consumer: the Backend service owns iteration (Open Question 1).
  events(): AsyncIterable<AgentRuntimeEvent>;

  // Send a user turn into the runtime (composer input or prompt answer).
  submit(input: TerminalInput): Promise<void>;

  // Interrupt/steer the active turn. The adapter delivers the provider-native
  // interrupt and is expected to emit turn.ended(reason="interrupted").
  interrupt(): Promise<void>;

  // Discover provider In-Session Commands for the slash/options menu, if any.
  queryCommands?(prefix: string): Promise<InSessionCommand[]>;

  // Stop the runtime and release its provider process.
  stop(): Promise<void>;
}
