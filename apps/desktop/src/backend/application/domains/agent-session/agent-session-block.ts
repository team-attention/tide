import type { RawAgentFrame } from "./raw-agent-frame.ts";
import type {
  AgentBinding,
  AgentId,
  LastKnownState,
  PromptState,
  ThreadId,
  ThreadSnapshot,
} from "../thread/thread.ts";

export type AgentSessionBlockRole =
  | "user"
  | "agent"
  | "reasoning"
  | "tool"
  | "system"
  | "runtime";

export type AgentSessionBlockStatus =
  | "pending"
  | "streaming"
  | "complete"
  | "failed"
  | "needs_input";

export type AgentSessionBlockKind =
  | "user_message"
  | "agent_message"
  | "reasoning"
  | "markdown"
  | "code_block"
  | "working_status"
  | "progress_status"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "error"
  | "tool_call"
  | "tool_result"
  | "command_run"
  | "file_read"
  | "file_edit"
  | "search"
  | "browser_action"
  | "mcp_call"
  | "file_change"
  | "diff_summary"
  | "generated_file"
  | "link"
  | "attachment"
  | "workbench_reference"
  | "approval_prompt"
  | "question_prompt"
  | "choice_prompt"
  | "command_picker"
  | "model_picker"
  | "usage"
  | "agent_activity"
  // A live agent checklist / plan: the to-do list a coding agent maintains and
  // checks off as it works (claude TodoWrite, codex turn/plan/updated, ACP plan).
  // One stable block per runtime, upserted in place; entries live in data.entries.
  // Rendered by the pinned Goal & Checklist panel, NOT as a transcript turn.
  // See specs/thread-goal-and-checklist-panel.md.
  | "plan"
  | "raw_block";

export interface AgentSessionBlock {
  blockId: string;
  threadId: ThreadId;
  agentId: AgentId;
  kind: AgentSessionBlockKind;
  parentBlockId?: string;
  role: AgentSessionBlockRole;
  sourceFrameIds: string[];
  localProvenance?: Record<string, unknown>;
  status: AgentSessionBlockStatus;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  rawFallback?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSessionReadInput {
  thread: ThreadSnapshot;
  agentBinding: AgentBinding;
  frames: RawAgentFrame[];
  existingBlocks: AgentSessionBlock[];
}

export interface AgentSessionReadResult {
  blockUpdates: AgentSessionBlockUpdate[];
  promptState?: PromptState;
  lastKnownState?: LastKnownState;
  diagnostics: ReaderDiagnostic[];
}

export interface AgentSessionReader {
  read(input: AgentSessionReadInput): AgentSessionReadResult;
}

export type AgentSessionBlockUpdate =
  | { kind: "upsert"; block: AgentSessionBlock }
  | {
      kind: "complete";
      blockId: string;
      threadId: ThreadId;
      status: "complete" | "failed";
      updatedAt: string;
    }
  | {
      kind: "reset";
      reason: "cache_rebuild" | "reader_repair";
      blocks: AgentSessionBlock[];
    };

export interface ReaderDiagnostic {
  frameId?: string;
  severity: "debug" | "warning";
  message: string;
}

export function createLocalUserMessageBlock(input: {
  threadId: ThreadId;
  agentId: AgentId;
  input: string;
  submittedAt: string;
  localId: string;
  deliveryId?: string;
  deliveryState?: string;
}): AgentSessionBlock {
  return {
    blockId: `local:${input.threadId}:${input.localId}`,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: "user_message",
    role: "user",
    sourceFrameIds: [],
    localProvenance: {
      kind: "composer_input",
      localId: input.localId,
      ...(input.deliveryId !== undefined ? { deliveryId: input.deliveryId } : {}),
      ...(input.deliveryState !== undefined ? { deliveryState: input.deliveryState } : {}),
      submittedAt: input.submittedAt,
    },
    status: "complete",
    body: input.input,
    createdAt: input.submittedAt,
    updatedAt: input.submittedAt,
  };
}

export function compareAgentSessionBlocks(
  left: AgentSessionBlock,
  right: AgentSessionBlock,
): number {
  const createdComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdComparison !== 0) {
    return createdComparison;
  }
  return left.blockId.localeCompare(right.blockId);
}
