import type { RawAgentFrame } from "../../domains/agent-session/raw-agent-frame.ts";

export interface PtyTranscriptPort {
  append(frame: RawAgentFrame): Promise<void>;
}
