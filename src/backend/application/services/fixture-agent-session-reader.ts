import type {
  AgentSessionBlock,
  AgentSessionBlockKind,
  AgentSessionBlockStatus,
  AgentSessionBlockUpdate,
  AgentSessionReadInput,
  AgentSessionReadResult,
  AgentSessionReader,
} from "../domains/agent-session/agent-session-block.ts";
import type { RawAgentFrame } from "../domains/agent-session/raw-agent-frame.ts";
import type {
  AgentId,
  PromptChoice,
  PromptKind,
  PromptState,
  ThreadId,
} from "../domains/thread/thread.ts";

export function createFixtureAgentSessionReader(): AgentSessionReader {
  return new FixtureAgentSessionReader();
}

class FixtureAgentSessionReader implements AgentSessionReader {
  read(input: AgentSessionReadInput): AgentSessionReadResult {
    const existingBlocks = new Map(
      input.existingBlocks.map((block) => [block.blockId, block]),
    );
    const blockUpdates: AgentSessionBlockUpdate[] = [];
    let promptState: PromptState | undefined;

    for (const frame of [...input.frames].sort(compareFrames)) {
      const block = blockFromFrame(input, frame, existingBlocks);
      existingBlocks.set(block.blockId, block);
      blockUpdates.push({ kind: "upsert", block });

      const prompt = promptStateFromBlock(block, frame);
      if (prompt !== undefined) {
        promptState = prompt;
      }
    }

    return {
      blockUpdates,
      promptState,
      lastKnownState: promptState === undefined ? undefined : promptLastKnownState(promptState.kind),
      diagnostics: [],
    };
  }
}

function blockFromFrame(
  input: AgentSessionReadInput,
  frame: RawAgentFrame,
  existingBlocks: Map<string, AgentSessionBlock>,
): AgentSessionBlock {
  if (isPtyTextFrame(frame)) {
    return ptyBlockFromFrame(input.thread.threadId, frame, existingBlocks);
  }

  const payload = payloadObject(frame);
  if (payload === undefined) {
    return rawBlockFromFrame(input.thread.threadId, frame);
  }

  switch (payload.type) {
    case "message":
      return messageBlockFromFrame(input.thread.threadId, frame, payload);
    case "approval_prompt":
      return promptBlockFromFrame(input.thread.threadId, frame, payload, "approval_prompt");
    case "question_prompt":
      return promptBlockFromFrame(input.thread.threadId, frame, payload, "question_prompt");
    case "choice_prompt":
      return promptBlockFromFrame(input.thread.threadId, frame, payload, "choice_prompt");
    case "workbench_reference":
      return workbenchReferenceBlockFromFrame(input.thread.threadId, frame, payload);
    default:
      return rawBlockFromFrame(input.thread.threadId, frame);
  }
}

function messageBlockFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
): AgentSessionBlock {
  const role = payload.role === "user" ? "user" : "agent";
  const body = typeof payload.body === "string" ? payload.body : rawText(frame);
  const status = blockStatus(payload.status, "complete");

  return {
    blockId: stringField(payload.blockId) ?? `block:${threadId}:${frame.frameId}`,
    threadId,
    agentId: frame.agentId,
    kind: role === "user" ? "user_message" : "agent_message",
    role,
    sourceFrameIds: [frame.frameId],
    status,
    body,
    createdAt: frame.observedAt,
    updatedAt: frame.observedAt,
  };
}

function promptBlockFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
  kind: Extract<AgentSessionBlockKind, "approval_prompt" | "question_prompt" | "choice_prompt">,
): AgentSessionBlock {
  const promptId = stringField(payload.promptId) ?? frame.frameId;
  const choices = promptChoices(payload.choices);

  return {
    blockId: `prompt:${threadId}:${promptId}`,
    threadId,
    agentId: frame.agentId,
    kind,
    role: "runtime",
    sourceFrameIds: [frame.frameId],
    status: "needs_input",
    title: titleForPrompt(kind),
    body: stringField(payload.message),
    data: {
      promptId,
      message: stringField(payload.message) ?? "",
      choices,
    },
    rawFallback: rawText(frame),
    createdAt: frame.observedAt,
    updatedAt: frame.observedAt,
  };
}

function workbenchReferenceBlockFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
): AgentSessionBlock {
  const targetThreadId = stringField(payload.targetThreadId) ?? threadId;
  const unavailable = targetThreadId !== threadId;

  return {
    blockId: stringField(payload.blockId) ?? `workbench:${threadId}:${frame.frameId}`,
    threadId,
    agentId: frame.agentId,
    kind: "workbench_reference",
    role: "system",
    sourceFrameIds: [frame.frameId],
    status: "complete",
    title: stringField(payload.label),
    data: {
      targetThreadId,
      paneId: stringField(payload.paneId) ?? "",
      label: stringField(payload.label) ?? "",
      unavailable,
    },
    rawFallback: rawText(frame),
    createdAt: frame.observedAt,
    updatedAt: frame.observedAt,
  };
}

function ptyBlockFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  existingBlocks: Map<string, AgentSessionBlock>,
): AgentSessionBlock {
  const blockId = `pty:${threadId}:${frame.sourceRef ?? frame.frameId}`;
  const existing = existingBlocks.get(blockId);
  const body = appendPtyText(existing?.body ?? existing?.rawFallback, rawText(frame));
  const priorFrameIds = existing?.sourceFrameIds ?? [];

  return {
    blockId,
    threadId,
    agentId: frame.agentId,
    kind: "raw_block",
    role: "runtime",
    sourceFrameIds: appendUnique(priorFrameIds, frame.frameId),
    status: body.endsWith("\n") ? "complete" : "streaming",
    body,
    rawFallback: body,
    createdAt: existing?.createdAt ?? frame.observedAt,
    updatedAt: frame.observedAt,
  };
}

function rawBlockFromFrame(threadId: ThreadId, frame: RawAgentFrame): AgentSessionBlock {
  const rawFallback = rawText(frame);

  return {
    blockId: `raw:${threadId}:${frame.frameId}`,
    threadId,
    agentId: frame.agentId,
    kind: "raw_block",
    role: "runtime",
    sourceFrameIds: [frame.frameId],
    status: "complete",
    body: rawFallback,
    rawFallback,
    createdAt: frame.observedAt,
    updatedAt: frame.observedAt,
  };
}

function promptStateFromBlock(
  block: AgentSessionBlock,
  frame: RawAgentFrame,
): PromptState | undefined {
  if (
    block.kind !== "approval_prompt" &&
    block.kind !== "question_prompt" &&
    block.kind !== "choice_prompt"
  ) {
    return undefined;
  }

  return {
    promptId: stringField(block.data?.promptId) ?? block.blockId,
    threadId: block.threadId,
    agentId: block.agentId,
    kind: promptKindForBlock(block.kind),
    message: stringField(block.data?.message) ?? block.body ?? "",
    choices: promptChoices(block.data?.choices),
    source: promptSource(frame),
  };
}

function promptKindForBlock(
  kind: Extract<AgentSessionBlockKind, "approval_prompt" | "question_prompt" | "choice_prompt">,
): PromptKind {
  if (kind === "approval_prompt") {
    return "approval";
  }
  if (kind === "choice_prompt") {
    return "choice";
  }
  return "question";
}

function promptLastKnownState(kind: PromptKind) {
  return kind === "approval" || kind === "permission"
    ? "waiting_for_approval"
    : "waiting_for_input";
}

function promptSource(frame: RawAgentFrame): PromptState["source"] {
  if (frame.source === "pty_transcript" || frame.source === "interactive_pty") {
    return "pty";
  }
  if (frame.source === "hook_payload") {
    return "provider_hook";
  }
  return "provider_signal";
}

function titleForPrompt(
  kind: Extract<AgentSessionBlockKind, "approval_prompt" | "question_prompt" | "choice_prompt">,
): string {
  if (kind === "approval_prompt") {
    return "Approval";
  }
  if (kind === "choice_prompt") {
    return "Choice";
  }
  return "Question";
}

function isPtyTextFrame(frame: RawAgentFrame): boolean {
  return (
    frame.source === "pty_transcript" ||
    frame.source === "interactive_pty" ||
    frame.payloadKind === "ansi_text"
  );
}

function payloadObject(frame: RawAgentFrame): Record<string, unknown> | undefined {
  if (frame.payload !== null && typeof frame.payload === "object" && !Array.isArray(frame.payload)) {
    return frame.payload as Record<string, unknown>;
  }
  return undefined;
}

function promptChoices(value: unknown): PromptChoice[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((choice, index): PromptChoice | undefined => {
      if (choice === null || typeof choice !== "object" || Array.isArray(choice)) {
        return undefined;
      }
      const fields = choice as Record<string, unknown>;
      const providerValue = stringField(fields.providerValue);
      if (providerValue === undefined) {
        return undefined;
      }
      return {
        choiceId: stringField(fields.choiceId) ?? `choice-${index + 1}`,
        label: stringField(fields.label) ?? providerValue,
        providerValue,
      };
    })
    .filter((choice): choice is PromptChoice => choice !== undefined);
}

function blockStatus(value: unknown, fallback: AgentSessionBlockStatus): AgentSessionBlockStatus {
  if (
    value === "pending" ||
    value === "streaming" ||
    value === "complete" ||
    value === "failed" ||
    value === "needs_input"
  ) {
    return value;
  }
  return fallback;
}

function rawText(frame: RawAgentFrame): string {
  if (typeof frame.payload === "string") {
    return frame.payload;
  }
  if (frame.body !== undefined) {
    return frame.body;
  }
  if (frame.payload !== undefined) {
    return JSON.stringify(frame.payload);
  }
  return "";
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function appendPtyText(existingText: string | undefined, frameText: string): string {
  return existingText === undefined ? frameText : `${existingText}${frameText}`;
}

function compareFrames(left: RawAgentFrame, right: RawAgentFrame): number {
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.frameId.localeCompare(right.frameId);
}
