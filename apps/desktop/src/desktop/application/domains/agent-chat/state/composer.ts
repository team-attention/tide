import type { AgentChatAgentId, AgentChatComposerAttachment, AgentChatComposerMessageAttachment, AgentChatComposerSurfaceKind, AgentChatContextChip, AgentChatPromptStepAnswer, AgentChatProviderSetupSurfaceAction, AgentChatShellState, AgentChatShellUpdateResult, AgentChatThreadSummary } from "./types.ts";
import { defaultModelValueForAgent, defaultPermissionForAgent, runtimeSourceForAgent } from "./agent-vocab.ts";
import { cloneStringRecord, launchOptionsForState } from "./launch-options.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

export function updateComposerDraft(
  state: AgentChatShellState,
  draft: string,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        draft,
        // The slash/skill command menu opens on both the Start Composer and a
        // started Thread. On the Start Composer it lists only the project/user
        // command + skill files (prompt templates that work as a first message);
        // the provider's built-in session commands (/model, /clear, …) are filtered
        // out there since they only apply to a running session (see choice-surfaces).
        activeSurface:
          composerSurfaceForDraft(draft) ??
          (state.composer.activeSurface === "command_suggestions"
            ? null
            : state.composer.activeSurface),
      },
    },
    command: null,
  };
}

export function addComposerAttachment(
  state: AgentChatShellState,
  attachment: AgentChatComposerAttachment,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        attachments: [...state.composer.attachments, attachment],
      },
    },
    command: null,
  };
}

export function removeComposerAttachment(
  state: AgentChatShellState,
  attachmentId: string,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        attachments: state.composer.attachments.filter(
          (attachment) => attachment.id !== attachmentId,
        ),
      },
    },
    command: null,
  };
}

export function addComposerContextChip(
  state: AgentChatShellState,
  chip: AgentChatContextChip,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        contextChips: [...state.composer.contextChips, chip],
      },
    },
    command: null,
  };
}

export function removeComposerContextChip(
  state: AgentChatShellState,
  chipId: string,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        contextChips: state.composer.contextChips.filter((chip) => chip.id !== chipId),
      },
    },
    command: null,
  };
}

export function setComposerContextChipComment(
  state: AgentChatShellState,
  chipId: string,
  comment: string,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        contextChips: state.composer.contextChips.map((chip) =>
          chip.id === chipId ? { ...chip, comment } : chip,
        ),
      },
    },
    command: null,
  };
}

export function setComposerActiveSurface(
  state: AgentChatShellState,
  surface: AgentChatComposerSurfaceKind | null,
): AgentChatShellUpdateResult {
  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        activeSurface: surface,
      },
    },
    command: null,
  };
}

export function selectComposerAgent(
  state: AgentChatShellState,
  agentId: AgentChatAgentId,
): AgentChatShellUpdateResult {
  if (state.thread) {
    return { state, command: null };
  }

  const runtimeSource = runtimeSourceForAgent(agentId);
  const launchOptions = {
    ...state.composer.startOptions.launchOptions,
    model: defaultModelValueForAgent(agentId),
    permission: defaultPermissionForAgent(agentId),
  };

  return {
    state: {
      ...state,
      composer: {
        ...state.composer,
        activeSurface: null,
        startOptions: {
          ...state.composer.startOptions,
          agentBinding: {
            ...state.composer.startOptions.agentBinding,
            agentId,
            runtimeSource,
          },
          launchOptions,
        },
      },
    },
    command: null,
  };
}

// Answers the active prompt with free-text (the prompt card's "Other" / custom
// reply, or Skip with an empty value), clearing the prompt.
export function answerPromptText(
  state: AgentChatShellState,
  value: string,
  notes?: string,
): AgentChatShellUpdateResult {
  if (state.promptState === null) {
    return { state, command: null };
  }
  return {
    // Keep the composer draft: the answer (`value`) is the prompt card's own field, not
    // the composer — clearing it would wipe an in-progress follow-up (spec).
    state: { ...state, promptState: null },
    command: {
      kind: "prompt.answer",
      payload: {
        threadId: state.promptState.threadId,
        promptId: state.promptState.promptId,
        value,
        // AskUserQuestion note (free text the user attached to their answer); omitted otherwise.
        ...(notes !== undefined && notes.length > 0 ? { notes } : {}),
      },
    },
  };
}

// Answers a multi-step prompt (wizard): one answer per step, submitted together at the
// end. Clears the prompt; keeps the composer draft (the answers are the card's own fields).
export function answerPromptSteps(
  state: AgentChatShellState,
  stepAnswers: AgentChatPromptStepAnswer[],
): AgentChatShellUpdateResult {
  if (state.promptState === null) {
    return { state, command: null };
  }
  return {
    state: { ...state, promptState: null },
    command: {
      kind: "prompt.answer",
      payload: {
        threadId: state.promptState.threadId,
        promptId: state.promptState.promptId,
        stepAnswers,
      },
    },
  };
}

// Explicit interrupt: stop the in-flight turn. The session stays resumable, so
// the next message continues via the agent's native resume. Any queued input is
// dropped (the user chose to interrupt).
export function interruptComposer(
  state: AgentChatShellState,
): AgentChatShellUpdateResult {
  if (state.thread === null) {
    return { state, command: null };
  }
  // Interrupt is the universal escape: it must work in EVERY non-idle runtime state,
  // including waiting_for_input/waiting_for_approval. A Thread parked on a prompt the
  // UI isn't surfacing (a missed prompt.changed) would otherwise be unrecoverable —
  // the queue never drains (recordTurnComplete holds it while a prompt is live) and
  // there was no Stop. Stop routes to the backend stopAgentRuntime, which clears the
  // prompt and drains a queued follow-up / settles to idle. Same for all providers.
  const busy =
    state.runtimeState === "running" ||
    state.runtimeState === "starting" ||
    state.runtimeState === "waiting_for_input" ||
    state.runtimeState === "waiting_for_approval";
  if (!busy) {
    return { state, command: null };
  }
  // Interrupting kills the in-flight prompt (the backend clears it too) — drop the card
  // optimistically so the composer is usable immediately, not blocked on prompt.answer.
  const interrupted = state.promptState === null ? state : { ...state, promptState: null };
  // With a queued follow-up, Stop CONSUMES it: the current turn ends and the queued
  // message runs next. Keep the optimistic row + stay running (the backend confirms
  // with the new turn). With no queue it's a plain interrupt: settle to idle instantly
  // so the Working indicator/timer stops and the next message is a fresh turn.
  if (state.queuedInputs.length > 0) {
    return {
      state: interrupted,
      command: {
        kind: "agentRuntime.stop",
        payload: { threadId: state.thread.threadId },
      },
    };
  }
  return {
    state: { ...interrupted, runtimeState: "idle" },
    command: {
      kind: "agentRuntime.stop",
      payload: { threadId: state.thread.threadId },
    },
  };
}

function generateThreadId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `id-${random.slice(0, 12)}`;
}

// Formats an attached content chip into the outgoing message: a labeled header,
// the user's per-region note (if any), then the referenced content.
function formatContextChipForMessage(chip: AgentChatContextChip): string {
  const head = `**↳ ${chip.label}**`;
  const note = chip.comment && chip.comment.trim().length > 0 ? `\n${chip.comment.trim()}` : "";
  return `${head}${note}\n\n${chip.text}`;
}

export function submitComposer(
  state: AgentChatShellState,
): AgentChatShellUpdateResult {
  const draft = state.composer.draft.trim();
  const attachments = state.composer.attachments;
  const chips = state.composer.contextChips;
  // A message with no text but with pasted images or attached content chips is
  // still a valid send. Attached content is prepended to the message as context.
  if (draft.length === 0 && attachments.length === 0 && chips.length === 0) {
    return { state, command: null };
  }
  const input =
    chips.length === 0
      ? draft
      : `${chips.map(formatContextChipForMessage).join("\n\n")}${draft.length > 0 ? `\n\n${draft}` : ""}`;

  if (state.promptState) {
    return {
      state,
      command: {
        kind: "prompt.answer",
        payload: {
          threadId: state.promptState.threadId,
          promptId: state.promptState.promptId,
          value: input,
        },
      },
    };
  }

  const messageAttachments = attachmentsForMessage(attachments);
  // Clear the draft on send (every path) so re-clicking submit can't resend the
  // same message and spawn a duplicate thread / duplicate user row.
  const composerAfterSend = { ...state.composer, draft: "", attachments: [], contextChips: [] };

  if (state.thread) {
    // Optimistically show the sent message as a pending row (instant feedback, and
    // it hides the empty-thread placeholder). The backend's authoritative queue —
    // carried on the command's agentRuntime.stateChanged — then reconciles it: an
    // idle send runs (queue empty → the row clears), a busy send keeps it queued.
    return {
      state: {
        ...state,
        queuedInputs: [...state.queuedInputs, input],
        composer: composerAfterSend,
      },
      command: {
        kind: "composer.sendInput",
        payload: {
          threadId: state.thread.threadId,
          input,
          // Carry the current composer launch options (e.g. a changed model /
          // reasoning) so follow-ups honor them, not just the thread's original.
          launchOptions: launchOptionsForState(state),
          ...(messageAttachments ? { attachments: messageAttachments } : {}),
        },
      },
    };
  }

  // Optimistic new thread: open it instantly with a client-generated id and pass
  // that id to the backend (startThread honors it). The view switches to the new
  // thread immediately, so a slow backend can't leave the user clicking again and
  // spawning duplicate threads.
  const startOptions = state.composer.startOptions;
  const newThreadId = generateThreadId();
  const nowIso = new Date().toISOString();
  const optimisticThread: AgentChatThreadSummary = {
    threadId: newThreadId,
    title: input.length > 0 ? input.slice(0, 80) : "New thread",
    agentBinding: startOptions.agentBinding,
    scope: startOptions.scope ?? { kind: "scratch", scratchCwd: "Scratch" },
    launchOptions: startOptions.launchOptions,
    createdAt: nowIso,
    updatedAt: nowIso,
    pinned: false,
    archived: false,
    lastKnownState: "running",
  };

  return {
    state: {
      ...state,
      thread: optimisticThread,
      runtimeState: "starting",
      queuedInputs: [],
      composer: composerAfterSend,
    },
    command: {
      kind: "thread.start",
      payload: {
        threadId: newThreadId,
        initialMessage: input,
        agentBinding: startOptions.agentBinding,
        scope: startOptions.scope,
        launchOptions: startOptions.launchOptions,
        ...(messageAttachments ? { attachments: messageAttachments } : {}),
      },
    },
  };
}

// Edit/remove a queued (not-yet-sent) message at `index` in the follow-up stack.
// The runtime has not seen it, so this only updates the optimistic stack and asks
// the backend to correct its queued input. A blank value discards that message.
// Spec: docs_v2/specs/composer-message-edit.md.
export function editQueuedInput(
  state: AgentChatShellState,
  index: number,
  value: string,
): AgentChatShellUpdateResult {
  if (!state.thread || state.queuedInputs[index] === undefined) {
    return { state, command: null };
  }
  const discards = value.trim().length === 0;
  const queuedInputs = discards
    ? state.queuedInputs.filter((_, i) => i !== index)
    : state.queuedInputs.map((entry, i) => (i === index ? value : entry));
  return {
    state: { ...state, queuedInputs },
    command: {
      kind: "composer.editQueuedInput",
      payload: { threadId: state.thread.threadId, value, index },
    },
  };
}

function attachmentsForMessage(
  attachments: AgentChatComposerAttachment[],
): AgentChatComposerMessageAttachment[] | null {
  if (attachments.length === 0) {
    return null;
  }
  return attachments.map((attachment) => ({
    name: attachment.name,
    mediaType: attachment.mediaType,
    dataBase64: attachment.dataBase64,
  }));
}

// The trigger token the user is currently typing: a trigger char that starts a
// word (preceded by start-of-text or whitespace) and runs to the end of the
// draft (no trailing whitespace yet). This mirrors the provider apps, whose
// suggestion menu stays open while you type the token ANYWHERE in the message,
// not only as the very first character. Returns the trigger, the query typed
// after it, and the index of the trigger char (so a pick can splice in place).
const COMPOSER_TRIGGER_PATTERN = /(?:^|\s)([/$@!])(\S*)$/;

export function activeComposerTrigger(
  draft: string,
): { trigger: "/" | "$" | "@" | "!"; query: string; tokenStart: number } | null {
  const match = draft.match(COMPOSER_TRIGGER_PATTERN);
  if (match === null) {
    return null;
  }
  const query = match[2];
  return {
    trigger: match[1] as "/" | "$" | "@" | "!",
    query,
    tokenStart: draft.length - query.length - 1,
  };
}

function composerSurfaceForDraft(draft: string): AgentChatComposerSurfaceKind | null {
  return activeComposerTrigger(draft) === null ? null : "command_suggestions";
}

export function providerSetupCommandPayload(
  setup: AgentChatProviderSetupSurfaceAction,
): AgentChatProviderSetupSurfaceAction {
  const payload: AgentChatProviderSetupSurfaceAction = {
    command: setup.command,
    args: [...setup.args],
    cwd: setup.cwd,
    expectedCompletion: setup.expectedCompletion,
  };
  if (setup.env !== undefined) {
    payload.env = cloneStringRecord(setup.env);
  }
  return payload;
}
