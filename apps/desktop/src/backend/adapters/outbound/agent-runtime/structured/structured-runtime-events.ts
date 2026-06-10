// The normalized event stream a STRUCTURED provider runtime emits to the
// projector. This is the runtime-event spine realized: with the structured
// machine protocols (claude stream-json control protocol, codex app-server,
// gemini ACP) these events are produced NATIVELY by the provider — never
// inferred from PTY scrapes, hook spools, or history-file polling.
//
// Every shape here is evidence-based: captured live from the real CLIs
// (transcripts under /tmp/tide-proto-evidence/, summarized in
// docs_v2/specs/structured-agent-runtime.md). Do not extend from memory.
import type { PromptState } from "../../../../application/domains/thread/thread.ts";
import type { DiscoveredProviderSessionRef } from "../../../../application/ports/outbound/agent-integration-port.ts";

export type StructuredProviderEvent =
  // The provider announced (or confirmed) its session identity.
  | { kind: "session_ref"; ref: DiscoveredProviderSessionRef }
  // One conversation record (message / reasoning / tool_call / tool_result).
  // `payload` uses the SAME shapes the provider history connectors emit, so the
  // existing frame→block reader pipeline renders it unchanged.
  | {
      kind: "content_record";
      sourceRef: string;
      payload: Record<string, unknown>;
      body: string;
    }
  // The provider is waiting on the user (tool permission, question). The
  // runtime client constructs the full PromptState — including choice values it
  // can route back as a structured response (no keystrokes).
  | { kind: "prompt"; promptState: PromptState }
  // The provider withdrew a pending interaction (e.g. interrupt cancelled it).
  | { kind: "prompt_withdrawn"; promptId: string }
  // The turn ended. `notice` carries a user-visible failure/limit message.
  | {
      kind: "turn_completed";
      notice?: string;
      usage?: { inputTokens?: number; outputTokens?: number; contextWindow?: number; totalTokens?: number };
    }
  // The runtime process exited (crash or normal end-of-session).
  | { kind: "runtime_exited"; exitCode: number | null };

export interface StructuredRuntimeClient {
  // Routes composer input and prompt answers to the protocol.
  write(input: StructuredRuntimeWrite): Promise<void>;
  stop(): Promise<void>;
  pid?: number;
}

export type StructuredRuntimeWrite =
  | { kind: "composer_input"; value: string }
  | { kind: "prompt_answer"; promptId?: string; choiceId?: string; value: string };

export interface StructuredClientCallbacks {
  onEvent: (event: StructuredProviderEvent) => void;
}
