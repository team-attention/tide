import type {
  AgentSessionBlock,
  AgentSessionBlockKind,
  AgentSessionBlockStatus,
  AgentSessionBlockUpdate,
  AgentSessionReadInput,
  AgentSessionReadResult,
  AgentSessionReader,
} from "../../domains/agent-session/agent-session-block.ts";
import type { RawAgentFrame } from "../../domains/agent-session/raw-agent-frame.ts";
import type {
  AgentId,
  PromptChoice,
  PromptKind,
  PromptState,
  ThreadId,
} from "../../domains/thread/thread.ts";

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
      const blocks = blocksFromFrame(input, frame, existingBlocks);
      for (const block of blocks) {
        existingBlocks.set(block.blockId, block);
        blockUpdates.push({ kind: "upsert", block });

        const prompt = promptStateFromBlock(block, frame);
        if (prompt !== undefined) {
          promptState = prompt;
        }
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

function blocksFromFrame(
  input: AgentSessionReadInput,
  frame: RawAgentFrame,
  existingBlocks: Map<string, AgentSessionBlock>,
): AgentSessionBlock[] {
  if (isPtyTextFrame(frame)) {
    // Legacy/raw PTY evidence is not a visible terminal renderer: old provider
    // CLI captures included cursor redraws and spinners that are unreadable as
    // text. Keep the raw frame as evidence but do NOT render it as a visible
    // Agent Session block.
    return [];
  }

  const payload = payloadObject(frame);
  if (payload === undefined) {
    return [rawBlockFromFrame(input.thread.threadId, frame)];
  }

  switch (payload.type) {
    case "message":
      return [messageBlockFromFrame(input.thread.threadId, frame, payload)];
    case "notice":
      return [noticeBlockFromFrame(input.thread.threadId, frame, payload)];
    case "reasoning":
      return reasoningBlockFromFrame(input.thread.threadId, frame, payload);
    case "tool_call":
      if (isMcpProtocolNoiseTool(payload)) {
        return [];
      }
      return [toolBlockFromFrame(input.thread.threadId, frame, payload, "tool_call")];
    case "tool_result":
      if (isMcpProtocolNoiseTool(payload)) {
        return [];
      }
      return blocksFromToolResult(input.thread.threadId, frame, payload);
    case "approval_prompt":
      return [promptBlockFromFrame(input.thread.threadId, frame, payload, "approval_prompt")];
    case "question_prompt":
      return [promptBlockFromFrame(input.thread.threadId, frame, payload, "question_prompt")];
    case "choice_prompt":
      return [promptBlockFromFrame(input.thread.threadId, frame, payload, "choice_prompt")];
    case "workbench_reference":
      return [workbenchReferenceBlockFromFrame(input.thread.threadId, frame, payload)];
    case "plan":
      return [planBlockFromFrame(input.thread.threadId, frame, payload)];
    case "provider_signal":
      // A consumed control signal (a hook payload that did not resolve into a
      // renderable prompt). It is runtime transport, not agent output, so it is
      // used for Prompt State / session bookkeeping and never rendered as a
      // visible block. See spec D4 exception / BR-3b.
      return [];
    default:
      return [rawBlockFromFrame(input.thread.threadId, frame)];
  }
}

// The agent's MCP capability-discovery calls (list_mcp_resources / list_mcp_tools)
// are protocol housekeeping, not user-meaningful tool activity, so they are kept
// out of the visible session instead of showing as empty "{}" / "resources: []".
const MCP_PROTOCOL_NOISE_TOOLS = new Set(["list_mcp_resources", "list_mcp_tools"]);
function isMcpProtocolNoiseTool(payload: Record<string, unknown>): boolean {
  const toolName = stringField(payload.toolName);
  return toolName !== undefined && MCP_PROTOCOL_NOISE_TOOLS.has(toolName);
}

function blocksFromToolResult(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
): AgentSessionBlock[] {
  const output = recordField(payload.output);
  if (
    payload.toolName === "tide_edit_file" &&
    payload.ok === true &&
    output?.kind === "edit_file"
  ) {
    return fileEditBlocksFromFrame(threadId, frame, payload, output);
  }
  if (
    payload.toolName === "tide_run_terminal_command" &&
    payload.ok === true &&
    output?.kind === "run_terminal_command"
  ) {
    return [commandRunBlockFromFrame(threadId, frame, payload, output)];
  }
  return [toolBlockFromFrame(threadId, frame, payload, "tool_result")];
}

// A turn that ended with no usable answer (rate limit / out of credits / empty
// output / error) surfaces a visible `error` block so the user sees why, instead of
// a silent empty turn. Produced uniformly from each provider's AgentTurnOutcome.notice.
function noticeBlockFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
): AgentSessionBlock {
  const body = typeof payload.body === "string" ? payload.body : rawText(frame);
  return {
    blockId: stringField(payload.blockId) ?? `block:${threadId}:${frame.frameId}`,
    threadId,
    agentId: frame.agentId,
    kind: "error",
    role: "system",
    sourceFrameIds: [frame.frameId],
    status: blockStatus(payload.status, "failed"),
    body,
    createdAt: frame.observedAt,
    updatedAt: frame.observedAt,
  };
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

// Reasoning/thinking from a provider (codex summary text, etc.) becomes a
// reasoning block — rendered as a quiet, collapsible disclosure, not as an
// answer turn. Empty reasoning (encrypted-only, no readable summary) is dropped.
function reasoningBlockFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
): AgentSessionBlock[] {
  const body = typeof payload.body === "string" ? payload.body : rawText(frame);
  if (body.trim().length === 0) {
    return [];
  }
  return [
    {
      blockId: stringField(payload.blockId) ?? `reasoning:${threadId}:${frame.frameId}`,
      threadId,
      agentId: frame.agentId,
      kind: "reasoning",
      role: "reasoning",
      sourceFrameIds: [frame.frameId],
      status: blockStatus(payload.status, "complete"),
      title: stringField(payload.title) ?? "Thinking",
      body,
      createdAt: frame.observedAt,
      updatedAt: frame.observedAt,
    },
  ];
}

function toolBlockFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
  kind: Extract<AgentSessionBlockKind, "tool_call" | "tool_result">,
): AgentSessionBlock {
  const toolName = stringField(payload.toolName) ?? "tool";
  const callId = stringField(payload.callId) ?? frame.frameId;
  const body = stringField(payload.body) ?? rawText(frame);
  const status = blockStatus(payload.status, kind === "tool_result" ? "complete" : "pending");
  const data: Record<string, unknown> = {
    toolName,
    callId,
  };

  if ("arguments" in payload) {
    data.arguments = payload.arguments;
  }
  if ("ok" in payload) {
    data.ok = payload.ok;
  }
  if ("output" in payload) {
    data.output = payload.output;
  }
  if ("error" in payload) {
    data.error = payload.error;
  }

  return {
    blockId: stringField(payload.blockId) ?? `${kind}:${threadId}:${callId}`,
    threadId,
    agentId: frame.agentId,
    kind,
    role: "tool",
    sourceFrameIds: [frame.frameId],
    status,
    title: toolName,
    body,
    data,
    rawFallback: rawText(frame),
    createdAt: frame.observedAt,
    updatedAt: frame.observedAt,
  };
}

function fileEditBlocksFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
  output: Record<string, unknown>,
): AgentSessionBlock[] {
  const callId = stringField(payload.callId) ?? frame.frameId;
  const relativePath = stringField(output.relativePath) ?? "file";
  const replacementCount = numberField(output.replacementCount) ?? 0;
  const beforeByteLength = numberField(output.beforeByteLength) ?? 0;
  const afterByteLength = numberField(output.afterByteLength) ?? 0;
  const diff = stringField(output.diff) ?? "";

  return [
    {
      blockId: `file-edit:${threadId}:${callId}`,
      threadId,
      agentId: frame.agentId,
      kind: "file_edit",
      role: "tool",
      sourceFrameIds: [frame.frameId],
      status: "complete",
      title: relativePath,
      body: `${replacementCount} replacement${replacementCount === 1 ? "" : "s"} in ${relativePath}`,
      data: {
        toolName: "tide_edit_file",
        callId,
        relativePath,
        replacementCount,
        beforeByteLength,
        afterByteLength,
      },
      rawFallback: rawText(frame),
      createdAt: frame.observedAt,
      updatedAt: frame.observedAt,
    },
    {
      blockId: `diff-summary:${threadId}:${callId}`,
      threadId,
      agentId: frame.agentId,
      kind: "diff_summary",
      role: "tool",
      sourceFrameIds: [frame.frameId],
      status: "complete",
      title: `Diff: ${relativePath}`,
      body: diff,
      data: {
        toolName: "tide_edit_file",
        callId,
        relativePath,
      },
      rawFallback: rawText(frame),
      createdAt: frame.observedAt,
      updatedAt: frame.observedAt,
    },
  ];
}

function commandRunBlockFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
  output: Record<string, unknown>,
): AgentSessionBlock {
  const callId = stringField(payload.callId) ?? frame.frameId;
  const command = stringField(output.command) ?? "command";
  const args = stringArrayField(output.args);
  const title = [command, ...args].join(" ");
  const status = output.status === "failed" ? "failed" : "complete";

  return {
    blockId: `command-run:${threadId}:${callId}`,
    threadId,
    agentId: frame.agentId,
    kind: "command_run",
    role: "tool",
    sourceFrameIds: [frame.frameId],
    status,
    title,
    body: stringField(output.transcript) ?? stringField(payload.body) ?? rawText(frame),
    data: {
      toolName: "tide_run_terminal_command",
      callId,
      command,
      args,
      cwd: stringField(output.cwd) ?? "",
      exitCode: nullableNumberField(output.exitCode),
      signal: nullableStringField(output.signal),
      timedOut: booleanField(output.timedOut) ?? false,
      truncated: booleanField(output.truncated) ?? false,
    },
    rawFallback: rawText(frame),
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
      // The adapter's pre-selected option (e.g. Allow). Dropped here = the
      // Prompt Card renders with nothing selected and Submit disabled.
      defaultChoiceId: stringField(payload.defaultChoiceId),
    },
    rawFallback: rawText(frame),
    createdAt: frame.observedAt,
    updatedAt: frame.observedAt,
  };
}

// The agent's live checklist/plan. Every provider re-emits the WHOLE list on each
// change (claude TodoWrite replaces todos[], codex turn/plan/updated resends plan[],
// ACP plan resends entries[]), and the adapter keys it with a stable blockId
// (plan:<runtimeId>), so this upserts ONE block in place rather than appending.
// Entries are normalized to { text, status } in data.entries; rendered by the
// pinned Goal & Checklist panel, not as a transcript turn.
function planBlockFromFrame(
  threadId: ThreadId,
  frame: RawAgentFrame,
  payload: Record<string, unknown>,
): AgentSessionBlock {
  const entries = planEntries(payload.entries);

  return {
    blockId: stringField(payload.blockId) ?? `plan:${threadId}`,
    threadId,
    agentId: frame.agentId,
    kind: "plan",
    role: "system",
    sourceFrameIds: [frame.frameId],
    status: blockStatus(payload.status, "complete"),
    title: stringField(payload.title),
    data: { entries },
    rawFallback: rawText(frame),
    createdAt: frame.observedAt,
    updatedAt: frame.observedAt,
  };
}

type PlanEntryStatus = "pending" | "in_progress" | "done";

function planEntries(value: unknown): Array<{ text: string; status: PlanEntryStatus }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: Array<{ text: string; status: PlanEntryStatus }> = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const fields = item as Record<string, unknown>;
    const text = stringField(fields.text);
    if (text === undefined || text.trim().length === 0) {
      continue;
    }
    entries.push({ text, status: planEntryStatus(fields.status) });
  }
  return entries;
}

// Adapters normalize provider statuses to these three before the reader sees them;
// anything unrecognized falls back to pending (surfaced, never dropped).
function planEntryStatus(value: unknown): PlanEntryStatus {
  const status = stringField(value);
  if (status === "in_progress" || status === "done") {
    return status;
  }
  return "pending";
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
    defaultChoiceId: stringField(block.data?.defaultChoiceId),
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
    return cleanTerminalText(frame.payload);
  }
  if (frame.body !== undefined) {
    return cleanTerminalText(frame.body);
  }
  if (frame.payload !== undefined) {
    return JSON.stringify(frame.payload);
  }
  return "";
}

// Provider CLIs emit a full TUI over the PTY: ANSI/CSI escape sequences, OSC
// sequences, cursor moves, bracketed-paste markers, and C0 control bytes.
// Showing that verbatim in a Raw Block is unreadable (e.g.
// "[?2004h [>4;0m … Hooks need review"). Strip the escape/control noise so the
// underlying text is legible.
function cleanTerminalText(text: string): string {
  // Strip terminal control output so provider TUI dumps are legible in a
  // Raw Block (OSC, CSI/SGR, cursor moves, bracketed-paste, C0 controls).
  return text
    .replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001B[@-Z\\-_=>()#][0-9A-Za-z]?/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableNumberField(value: unknown): number | null {
  return value === null ? null : numberField(value) ?? null;
}

function nullableStringField(value: unknown): string | null {
  return value === null ? null : stringField(value) ?? null;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  if (
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  return value as Record<string, unknown>;
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
