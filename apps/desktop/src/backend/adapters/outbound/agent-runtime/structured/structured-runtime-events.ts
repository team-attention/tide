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
  // existing frame→block reader pipeline renders it unchanged. This is the
  // FINAL, persisted form of a block.
  | {
      kind: "content_record";
      sourceRef: string;
      payload: Record<string, unknown>;
      body: string;
    }
  // A live STREAMING update for an in-flight message/reasoning block. UI-only:
  // it upserts the block (text flows token-by-token) WITHOUT the reader/persist
  // pipeline — per-token disk writes would blow the perf budget. The matching
  // `content_record` (SAME blockId) finalizes + persists when the block
  // completes. Carries the full accumulated body each time (idempotent upsert).
  | {
      kind: "content_delta";
      blockId: string;
      role: "agent" | "reasoning";
      blockKind: "agent_message" | "reasoning";
      body: string;
    }
  // The provider is waiting on the user (tool permission, question). The
  // runtime client constructs the full PromptState — including choice values it
  // can route back as a structured response (no keystrokes).
  | { kind: "prompt"; promptState: PromptState }
  // The provider withdrew a pending interaction (e.g. interrupt cancelled it).
  | { kind: "prompt_withdrawn"; promptId: string }
  // The provider's available slash-commands / skills (claude init slash_commands
  // + skills, codex skills/list, gemini available_commands_update). Surfaced in
  // the composer "/" (commands) and "$" (skills) menus.
  | {
      kind: "commands";
      commands: Array<{ name: string; description: string; trigger: "/" | "$" }>;
    }
  // A non-blocking, out-of-band notice from the runtime process (currently an
  // "update available" banner the CLI printed to stderr). Surfaced as a native
  // OS notification, never a transcript block.
  | { kind: "runtime_notice"; level: "info"; message: string }
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
  // Abort the in-flight turn via the provider's protocol interrupt, leaving the
  // process ALIVE and resumable (claude control_request:interrupt / codex
  // turn/interrupt / gemini session/cancel). The provider emits its turn-end so
  // the thread settles; the next message reuses this same session.
  interrupt(): Promise<void>;
  // Tear the process down (thread teardown / duplicate-runtime reap).
  stop(): Promise<void>;
  pid?: number;
}

export type StructuredRuntimeWrite =
  | { kind: "composer_input"; value: string }
  | { kind: "prompt_answer"; promptId?: string; choiceId?: string; value: string };

export interface StructuredClientCallbacks {
  onEvent: (event: StructuredProviderEvent) => void;
}
