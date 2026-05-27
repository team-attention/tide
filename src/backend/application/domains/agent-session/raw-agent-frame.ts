import type { AgentId, ThreadId } from "../thread/thread.ts";

export type RawAgentFrameSource =
  | "pty_transcript"
  | "provider_signal"
  | "provider_log"
  | "provider_history"
  | "stdout"
  | "stderr"
  | "hook_payload";

export interface RawAgentFrame {
  frameId: string;
  threadId: ThreadId;
  agentId: AgentId;
  source: RawAgentFrameSource;
  sourceRef?: string;
  sequence: number;
  observedAt: string;
  body?: string;
}
