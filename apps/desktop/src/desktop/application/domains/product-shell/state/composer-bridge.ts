import type { ProductShellState, ProductShellUpdateResult } from "./types.ts";
import { addComposerAttachment, addComposerContextChip, answerPromptText, applyAgentChatBackendEvent, editQueuedInput, interruptComposer, removeComposerAttachment, removeComposerContextChip, resolveComposerNewWorktreeIntent, selectAgentChatChoiceSurfaceRow, setComposerActiveSurface, setComposerContextChipComment, setComposerFolderScope, setComposerNewWorktreeIntent, submitComposer, updateComposerDraft } from "../../agent-chat/agent-chat.ts";
import type { AgentChatChoiceSurfaceView, AgentChatCommandOption, AgentChatComposerAttachment, AgentChatComposerSurfaceKind, AgentChatContextChip, AgentChatPromptState } from "../../agent-chat/agent-chat.ts";
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
    },
    command: result.command,
  };
}

export function answerProductShellPromptText(
  state: ProductShellState,
  value: string,
): ProductShellUpdateResult {
  const result = answerPromptText(agentChatWithProjects(state), value);
  return { state: { ...state, agentChat: result.state }, command: result.command };
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
  const input = state.agentChat.composer.draft.trim();
  // A message with no text but with pasted images is still a valid send.
  if (input.length === 0 && state.agentChat.composer.attachments.length === 0) {
    return { state, command: null };
  }

  const result = submitComposer(state.agentChat);
  if (result.state === state.agentChat) {
    return { state, command: result.command };
  }

  let nextState: ProductShellState = { ...state, agentChat: result.state };

  // Optimistic new thread: submit just opened a brand-new thread (the agent chat
  // now has a thread that wasn't the active one). Reflect it in the rail + focus
  // immediately so the thread opens instantly and re-clicks can't duplicate it.
  const startedThread = result.command?.kind === "thread.start" ? result.state.thread : null;
  let command = result.command;
  if (startedThread !== null && state.activeThreadId !== startedThread.threadId) {
    // Adopt the panes the user opened on the composer (New Thread) screen: hand the
    // draft Browser Panes to the new Thread so it OWNS them (seeded via thread.start,
    // race-free). The start-page editor still belongs to the New Thread page and is
    // dropped (its unsaved draft must not be silently lost by a re-open).
    // Only Browser drafts are adopted by the new Thread. A composer git Changes draft is
    // renderer-only (no URL); the started thread owns its own backend Changes pane via the
    // badge, so the draft is dropped rather than mis-adopted as an empty Browser Pane.
    const initialWorkbenchPanes = state.draftWorkbenchPanes
      .filter((pane) => pane.kind === "browser")
      .map((pane) => ({
        kind: "browser" as const,
        url: pane.url,
        title: pane.title,
      }));
    const shellThread = toProductShellThreadFromSummary(startedThread);
    const threads = [shellThread, ...state.threads];
    nextState = {
      ...nextState,
      activeThreadId: startedThread.threadId,
      threads,
      projects: projectsFromThreads(threads),
      startPageFiles: [],
      startPagePendingNavigation: null,
      // The drafts are handed off; keep the Workbench open only if we adopted panes.
      draftWorkbenchPanes: [],
      draftActiveWorkbenchPaneId: null,
      // Start-page untitled buffers don't carry into the started thread.
      untitledFiles: [],
      untitledSaveAsPaneId: null,
      workbenchOpen: initialWorkbenchPanes.length > 0,
    };
    if (command !== null && command.kind === "thread.start" && initialWorkbenchPanes.length > 0) {
      command = { ...command, payload: { ...command.payload, initialWorkbenchPanes } };
    }
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

// Discard a queued message at `index` outright (the 삭제 / delete control). Unlike
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
