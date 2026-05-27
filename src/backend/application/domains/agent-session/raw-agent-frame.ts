import type { AgentId, ThreadId } from "../thread/thread.ts";

export type RawAgentFrameSource =
  | "structured_batch"
  | "interactive_pty"
  | "raw_output"
  | "pty_transcript"
  | "provider_signal"
  | "provider_log"
  | "provider_history"
  | "stdout"
  | "stderr"
  | "hook_payload";

export type RawAgentFramePayloadKind =
  | "json"
  | "text"
  | "ansi_text"
  | "stdout"
  | "stderr"
  | "provider_record"
  | "binary_summary";

export interface RawAgentFrame {
  frameId: string;
  threadId: ThreadId;
  agentId: AgentId;
  source: RawAgentFrameSource;
  sourceRef?: string;
  sequence: number;
  observedAt: string;
  payloadKind?: RawAgentFramePayloadKind;
  payload?: unknown;
  body?: string;
  truncated?: boolean;
}
