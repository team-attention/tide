import type { ProductShellAgentMonitorPromptChoice, ProductShellState, ProductShellUpdateResult } from "./types.ts";
import { addComposerAttachment, addComposerContextChip, answerPromptSteps, answerPromptText, applyAgentChatBackendEvent, editQueuedInput, interruptComposer, removeComposerAttachment, removeComposerContextChip, resolveComposerNewWorktreeIntent, selectAgentChatChoiceSurfaceRow, setComposerActiveSurface, setComposerContextChipComment, setComposerFolderScope, setComposerNewWorktreeIntent, submitComposer, updateComposerDraft } from "../../agent-chat/agent-chat.ts";
import type { AgentChatChoiceSurfaceView, AgentChatCommandOption, AgentChatComposerAttachment, AgentChatComposerSurfaceKind, AgentChatContextChip, AgentChatPromptState, AgentChatPromptStepAnswer } from "../../agent-chat/agent-chat.ts";
import { agentChatWithProjects, projectsFromThreads } from "./view-model.ts";
import { applyAppChromeBackendEvent } from "../../app-chrome/app-chrome-state.ts";
import { toProductShellThreadFromSummary } from "./thread-list.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

// Open / close the inline "new worktree" name input for a project. The actual
// git worktree creation happens in Main (project registry) once a name is
// submitted. See docs_v2/specs/worktree-creation.md.
export function startProductShellWorktreeCreate(
  state: ProductShellState,
  projectId: string,
): ProductShellState {
  return { ...state, creatingWorktreeForProjectId: projectId, leftRailMenu: null };
}

export function cancelProductShellWorktreeCreate(
  state: ProductShellState,
): ProductShellState {
  return { ...state, creatingWorktreeForProjectId: null };
}

export function setProductShellProviderCommands(
  state: ProductShellState,
  commands: AgentChatCommandOption[],
): ProductShellState {
  return { ...state, providerCommands: commands };
}

export function setProductShellComposerActiveSurface(
  state: ProductShellState,
  surface: AgentChatComposerSurfaceKind | null,
): ProductShellState {
  return {
    ...state,
    agentChat: setComposerActiveSurface(state.agentChat, surface).state,
  };
}

// Scopes the Start Composer to a chip-picked folder without registering it as a
// persisted project. It surfaces in the left Projects list only once a Thread is
// started in it (thread-derived).
export function setProductShellComposerFolderScope(
  state: ProductShellState,
  cwd: string,
): ProductShellState {
  return {
    ...state,
    agentChat: setComposerFolderScope(state.agentChat, cwd).state,
  };
}

// Mark the Start Composer to create a new git worktree on send (deferred). See
// docs_v2/specs/worktree-start-experience.md.
export function setProductShellComposerNewWorktreeIntent(
  state: ProductShellState,
  intent: { name?: string; baseBranch?: string },
): ProductShellState {
  return {
    ...state,
    agentChat: setComposerNewWorktreeIntent(state.agentChat, intent).state,
  };
}

// After the worktree is created at send time, re-scope the Start Composer to it
// and reset the worktree launch option to the new cwd's "current folder".
export function resolveProductShellComposerNewWorktree(
  state: ProductShellState,
  resolved: { cwd: string; branch: string },
): ProductShellState {
  return {
    ...state,
    agentChat: resolveComposerNewWorktreeIntent(state.agentChat, resolved).state,
  };
}

export function selectProductShellChoiceSurfaceRow(
  state: ProductShellState,
  surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
  rowId: string,
): ProductShellUpdateResult {
  const result = selectAgentChatChoiceSurfaceRow(
    agentChatWithProjects(state),
    surfaceKind,
    rowId,
    state.activeThreadId ?? undefined,
  );
  return {
    state: {
      ...state,
      agentChat: result.state,
      ...(result.command?.kind === "workbench.command" && result.command.payload.command === "open_review"
        ? { workbenchOpen: true }
        : {}),
    },
    command: result.command,
  };
}

export function answerProductShellPromptText(
  state: ProductShellState,
  value: string,
  notes?: string,
): ProductShellUpdateResult {
  const result = answerPromptText(agentChatWithProjects(state), value, notes);
  return { state: { ...state, agentChat: result.state }, command: result.command };
}

export function answerProductShellPromptSteps(
  state: ProductShellState,
  stepAnswers: AgentChatPromptStepAnswer[],
): ProductShellUpdateResult {
  const result = answerPromptSteps(agentChatWithProjects(state), stepAnswers);
  return { state: { ...state, agentChat: result.state }, command: result.command };
}

export function answerProductShellMonitorPromptChoice(
  state: ProductShellState,
  input: {
    threadId: string;
    promptId: string;
    choice: ProductShellAgentMonitorPromptChoice;
  },
): ProductShellUpdateResult {
  const snapshot = state.runtimeSnapshotsByThreadId[input.threadId];
  const choice = snapshot?.prompt?.promptId === input.promptId
    ? snapshot.prompt.choices.find((candidate) => candidate.choiceId === input.choice.choiceId)
    : input.choice;
  if (choice === undefined) {
    return { state, command: null };
  }
  return {
    state: clearMonitorPrompt(state, input.threadId, input.promptId),
    command: {
      kind: "prompt.answer",
      payload: {
        threadId: input.threadId,
        promptId: input.promptId,
        choiceId: choice.choiceId,
        value: choice.providerValue,
      },
    },
  };
}

export function applyProductShellPromptState(
  state: ProductShellState,
  prompt: AgentChatPromptState | null,
): ProductShellState {
  return {
    ...state,
    agentChat: applyAgentChatBackendEvent(state.agentChat, {
      kind: "prompt.changed",
      payload: { prompt },
    }),
    appChrome: applyAppChromeBackendEvent(state.appChrome, {
      kind: "prompt.changed",
      payload: { prompt },
    }),
  };
}

function clearMonitorPrompt(
  state: ProductShellState,
  threadId: string,
  promptId: string,
): ProductShellState {
  const clearChatPrompt = <T extends { promptState: AgentChatPromptState | null }>(chat: T): T =>
    chat.promptState?.promptId === promptId ? { ...chat, promptState: null } : chat;
  const snapshot = state.runtimeSnapshotsByThreadId[threadId];
  const runtimeSnapshotsByThreadId = snapshot === undefined || snapshot.prompt?.promptId !== promptId
    ? state.runtimeSnapshotsByThreadId
    : {
        ...state.runtimeSnapshotsByThreadId,
        [threadId]: clearSnapshotPrompt(snapshot),
      };
  return {
    ...state,
    agentChat: state.agentChat.thread?.threadId === threadId ? clearChatPrompt(state.agentChat) : state.agentChat,
    agentChatByThreadId: state.agentChatByThreadId[threadId] === undefined
      ? state.agentChatByThreadId
      : {
          ...state.agentChatByThreadId,
          [threadId]: clearChatPrompt(state.agentChatByThreadId[threadId]),
        },
    runtimeSnapshotsByThreadId,
  };
}

function clearSnapshotPrompt<T extends { state: string; pendingPromptKind?: unknown; prompt?: unknown }>(
  snapshot: T,
): T & { state: "running" } {
  const next = { ...snapshot, state: "running" as const };
  delete next.pendingPromptKind;
  delete next.prompt;
  return next;
}

export function updateProductShellComposerDraft(
  state: ProductShellState,
  draft: string,
): ProductShellState {
  return {
    ...state,
    agentChat: updateComposerDraft(state.agentChat, draft).state,
  };
}

// Attaches a content reference (a code selection, terminal output, browser
// snapshot, quoted message) to the composer as a removable chip — used by the
// workbench/session "Add to chat" affordances.
export function addProductShellComposerContextChip(
  state: ProductShellState,
  chip: AgentChatContextChip,
): ProductShellState {
  return {
    ...state,
    agentChat: addComposerContextChip(state.agentChat, chip).state,
  };
}

export function removeProductShellComposerContextChip(
  state: ProductShellState,
  chipId: string,
): ProductShellState {
  return {
    ...state,
    agentChat: removeComposerContextChip(state.agentChat, chipId).state,
  };
}

export function setProductShellComposerContextChipComment(
  state: ProductShellState,
  chipId: string,
  comment: string,
): ProductShellState {
  return {
    ...state,
    agentChat: setComposerContextChipComment(state.agentChat, chipId, comment).state,
  };
}

export function sendProductShellComposerDraft(
  state: ProductShellState,
): ProductShellState {
  return submitProductShellComposerDraft(state).state;
}

export function addProductShellComposerAttachment(
  state: ProductShellState,
  attachment: AgentChatComposerAttachment,
): ProductShellState {
  return {
    ...state,
    agentChat: addComposerAttachment(state.agentChat, attachment).state,
  };
}

export function removeProductShellComposerAttachment(
  state: ProductShellState,
  attachmentId: string,
): ProductShellState {
  return {
    ...state,
    agentChat: removeComposerAttachment(state.agentChat, attachmentId).state,
  };
}

export function submitProductShellComposerDraft(
  state: ProductShellState,
): ProductShellUpdateResult {
  // What counts as sendable — typed text, a pasted image, OR an attached content
  // chip (a "block") — is decided once, in submitComposer: any one alone is a valid
  // input. It returns the SAME state reference for a truly-empty composer, which the
  // `result.state === state.agentChat` no-op branch below handles. (Re-checking only
  // draft+attachments here used to silently drop a block-only send.)
  const result = submitComposer(state.agentChat);
  if (result.state === state.agentChat) {
    return { state, command: result.command };
  }

  let agentChatState = result.state;
  let command = result.command;
  // Start the Composer's Draft Thread IN PLACE: reuse its id so the live Workbench it
  // already owns (a Terminal PTY / Editor / Diff / Browser opened pre-send) carries into the
  // started Thread instead of spawning a fresh one. The optimistic thread is rebound to the
  // draft id too, so the rail + focus point at the same thread. See composer-draft-thread.md.
  const draftThreadId = state.draftThreadId;
  const startedFromDraft = draftThreadId !== null && command !== null && command.kind === "thread.start";
  const draftWorkbenchOpen =
    draftThreadId === null ? false : state.workbenchOpenByThreadId[draftThreadId] ?? state.workbenchOpen;
  if (draftThreadId !== null && command !== null && command.kind === "thread.start") {
    command = { ...command, payload: { ...command.payload, threadId: draftThreadId } };
    if (agentChatState.thread !== null && agentChatState.thread !== undefined) {
      agentChatState = { ...agentChatState, thread: { ...agentChatState.thread, threadId: draftThreadId } };
    }
  }

  let nextState: ProductShellState = {
    ...state,
    agentChat: agentChatState,
    // The draft (if any) is now being started in place — drop the renderer's draft binding.
    draftThreadId: null,
  };

  // Optimistic new thread: submit just opened a brand-new thread (the agent chat now has a
  // thread that wasn't the active one). Reflect it in the rail + focus immediately so the
  // thread opens instantly and re-clicks can't duplicate it. Also runs when starting a Draft
  // Thread in place (activeThreadId already equals it), to add it to the rail + clear drafts.
  const startedThread = command?.kind === "thread.start" ? agentChatState.thread : null;
  if (startedThread !== null && (startedFromDraft || state.activeThreadId !== startedThread.threadId)) {
    const shellThread = toProductShellThreadFromSummary(startedThread);
    const threads = [shellThread, ...state.threads];
    nextState = {
      ...nextState,
      activeThreadId: startedThread.threadId,
      threads,
      projects: projectsFromThreads(threads),
      startPageFiles: [],
      startPagePendingNavigation: null,
      draftActiveWorkbenchPaneId: null,
      // Start-page untitled buffers don't carry into the started thread.
      untitledFiles: [],
      untitledSaveAsPaneId: null,
      workbenchOpen: startedFromDraft ? draftWorkbenchOpen : false,
    };
  }

  return { state: nextState, command };
}

export function interruptProductShellRuntime(
  state: ProductShellState,
): ProductShellUpdateResult {
  const result = interruptComposer(state.agentChat);
  if (result.state === state.agentChat) {
    return { state, command: result.command };
  }
  // A plain interrupt (no queued follow-up) settles to idle — clear the rail running
  // dot too. A queue-consuming stop keeps running (the queued message runs next), so
  // leave the dot on.
  const settledToIdle = result.state.runtimeState === "idle";
  const threads =
    settledToIdle && state.activeThreadId
      ? state.threads.map((thread) =>
          thread.threadId === state.activeThreadId
            ? { ...thread, running: false, attention: false }
            : thread,
        )
      : state.threads;
  return {
    state: { ...state, agentChat: result.state, threads },
    command: result.command,
  };
}

export function runProductShellQueuedInputNow(
  state: ProductShellState,
  index: number,
): ProductShellUpdateResult {
  const queued = state.agentChat.queuedInputs[index];
  const threadId = state.agentChat.thread?.threadId;
  if (queued === undefined || threadId === undefined) {
    return { state, command: null };
  }
  const nextQueue = [...state.agentChat.queuedInputs];
  if (index > 0) {
    nextQueue.splice(index, 1);
    nextQueue.unshift(queued);
  }
  return {
    state: {
      ...state,
      agentChat: {
        ...state.agentChat,
        queuedInputs: nextQueue,
      },
    },
    command: {
      kind: "composer.runQueuedInputNow",
      payload: {
        threadId,
        index,
      },
    },
  };
}

// Edit the queued (not-yet-sent) message: pull its text back into the Composer
// for editing and discard the backend's queued pendingInput. The user re-sends to
// re-queue the corrected message. This reuses the Composer instead of an inline
// editor, keeping the model simple. Spec: docs_v2/specs/composer-message-edit.md.
export function editProductShellQueuedInput(
  state: ProductShellState,
  index: number,
): ProductShellUpdateResult {
  const queued = state.agentChat.queuedInputs[index];
  if (queued === undefined) {
    return { state, command: null };
  }
  // Discard that queued message (blank edit at its index), then load its text into
  // the draft so it can be edited and re-sent.
  const discarded = editQueuedInput(state.agentChat, index, "");
  const withDraft = updateComposerDraft(discarded.state, queued);
  return {
    state: { ...state, agentChat: withDraft.state },
    command: discarded.command,
  };
}

// Discard a queued message at `index` outright (the Delete control). Unlike
// edit, it does NOT pull the text back into the composer.
export function removeProductShellQueuedInput(
  state: ProductShellState,
  index: number,
): ProductShellUpdateResult {
  if (state.agentChat.queuedInputs[index] === undefined) {
    return { state, command: null };
  }
  const discarded = editQueuedInput(state.agentChat, index, "");
  return {
    state: { ...state, agentChat: discarded.state },
    command: discarded.command,
  };
}
