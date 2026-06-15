import type { ProductShellAgentIdentity, ProductShellState } from "./types.ts";
import { archiveProductShellWorktreeChats, preserveActiveAgentChat } from "./thread-list.ts";
import { createAppChromeState } from "../../app-chrome/app-chrome-state.ts";
import { createAgentChatShellState, defaultModelValueForAgent, defaultPermissionForAgent, resolveStartAgentId } from "../../agent-chat/agent-chat.ts";
import type { AgentChatAgentBinding, AgentChatShellState, AgentChatThreadScope } from "../../agent-chat/agent-chat.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

// Starts a new Thread pre-scoped to Scratch (Tide-managed working dir).
export function startNewProductShellScratchThread(state: ProductShellState): ProductShellState {
  return {
    ...state,
    // Preserve the thread we're leaving so its in-progress composer (draft +
    // attachments) survives if the user returns to it.
    agentChatByThreadId: preserveActiveAgentChat(state, ""),
    activeThreadId: null,
    workbenchOpen: false,
    fileTreeOpen: false,
    leftRailMenu: null,
    archiveConfirmThreadId: null,
    renamingThreadId: null,
    agentChat: createStartAgentChatState({ kind: "scratch", scratchCwd: "Scratch" }),
    appChrome: createAppChromeState(),
    fileTree: null,
    startPageFiles: [],
    startPagePendingNavigation: null,
    editorDrafts: {},
  };
}

export function startNewProductShellThread(
  state: ProductShellState,
  projectId?: string,
): ProductShellState {
  // Starting from a Project Row pre-scopes the Start Composer to that Project's
  // cwd, so the resulting Thread groups under the same Project Row (UC-6b). Search
  // BOTH registered projects (added via the folder picker, may have no threads yet)
  // and thread-derived projects — otherwise a freshly-added project isn't found and
  // the composer falls back to the default scope instead of the chosen directory.
  const project = projectId
    ? [...state.registeredProjects, ...state.projects].find(
        (candidate) => candidate.projectId === projectId,
      )
    : undefined;
  const scope: AgentChatThreadScope = project
    ? { kind: "project", projectId: project.projectId, cwd: project.cwd }
    : defaultStartScope(state);
  return {
    ...state,
    // Preserve the thread we're leaving so its in-progress composer (draft +
    // attachments) survives if the user returns to it.
    agentChatByThreadId: preserveActiveAgentChat(state, ""),
    activeThreadId: null,
    workbenchOpen: false,
    fileTreeOpen: false,
    leftRailMenu: null,
    archiveConfirmThreadId: null,
    renamingThreadId: null,
    agentChat: createStartAgentChatState(scope),
    appChrome: createAppChromeState(),
    fileTree: null,
    startPageFiles: [],
    startPagePendingNavigation: null,
    editorDrafts: {},
    editorPickerFilter: null,
  };
}

// If a state transition just dropped the active Thread (activeThreadId went
// non-null → null because it was archived/deleted), reset the chat to a fresh Start
// Composer so the removed Thread's transcript doesn't linger on screen — the chat
// column renders state.agentChat directly, so detaching via activeThreadId alone
// isn't enough. No-op when focus was already null or is unchanged (e.g. a background
// Thread was archived), so it never steals focus from the Thread you're viewing.
export function refocusStartComposerIfActiveDropped(
  previous: ProductShellState,
  next: ProductShellState,
): ProductShellState {
  const activeDropped = previous.activeThreadId !== null && next.activeThreadId === null;
  return activeDropped ? startNewProductShellThread(next) : next;
}

// Deleting a worktree archives every Thread that lived in it. If the Thread on
// screen was one of them it's gone now — navigate to the Start Composer instead of
// leaving its dead transcript visible. When the viewed Thread lived elsewhere, focus
// is left untouched.
export function deleteWorktreeAndRefocus(
  state: ProductShellState,
  cwd: string,
): {
  state: ProductShellState;
  commands: { kind: "thread.archive"; payload: { threadId: string; archived: boolean } }[];
} {
  const archived = archiveProductShellWorktreeChats(state, cwd);
  return {
    state: refocusStartComposerIfActiveDropped(state, archived.state),
    commands: archived.commands,
  };
}

// A new Thread with no chosen Project scopes to the user's first REAL project (a
// real, already-trusted cwd) — never a hardcoded placeholder path, which would put
// the Agent in a non-existent directory and trip provider directory-trust. Falls
// back to Scratch only when there are no projects yet.
function defaultStartScope(state: ProductShellState): AgentChatThreadScope {
  // Prefer a thread-derived project (recently used); else a registered one (added
  // but not yet started in), so a brand-new project scopes a default New Thread too.
  const project = state.projects[0] ?? state.registeredProjects[0];
  return project !== undefined
    ? { kind: "project", projectId: project.projectId, cwd: project.cwd }
    : { kind: "scratch", scratchCwd: "Scratch" };
}

// The user's most-recently-used Start Composer agent + model/permission/reasoning,
// so a new thread defaults to their last choice instead of always codex/gpt-5.5.
// Set by the Desktop adapter from persisted storage; null = historical defaults.
// Module-level (not in ProductShellState) so it survives full New-Thread resets.
export interface PreferredStartComposer {
  agentId: ProductShellAgentIdentity;
  model?: string;
  permission?: string;
  reasoning?: string;
}

let preferredStartComposer: PreferredStartComposer | null = null;

export function setPreferredStartComposer(defaults: PreferredStartComposer | null): void {
  preferredStartComposer = defaults;
}

export function createStartAgentChatState(scope?: AgentChatThreadScope): AgentChatShellState {
  const pref = preferredStartComposer;
  const agentId = resolveStartAgentId(pref?.agentId);
  // Only carry the persisted model/permission/reasoning when the resolved agent is the
  // one the user actually picked. If we fell back (their last agent is hidden or not
  // installed), use the resolved agent's own defaults instead of another agent's.
  const carryPref = pref?.agentId === agentId;
  return createAgentChatShellState({
    startOptions: {
      agentBinding: agentBindingForShellAgent(agentId),
      scope: scope ?? { kind: "scratch", scratchCwd: "Scratch" },
      launchOptions: {
        model: carryPref ? pref?.model ?? defaultModelValueForAgent(agentId) : defaultModelValueForAgent(agentId),
        permission: carryPref ? pref?.permission ?? defaultPermissionForAgent(agentId) : defaultPermissionForAgent(agentId),
        worktree: "current folder",
        branch: "main",
        ...(carryPref && pref?.reasoning !== undefined ? { reasoning: pref.reasoning } : {}),
      },
    },
  });
}

export function normalizeAgentId(agentId: string): ProductShellAgentIdentity {
  if (
    agentId === "claude" ||
    agentId === "gemini" ||
    agentId === "opencode" ||
    agentId === "openai_api"
  ) {
    return agentId;
  }
  return "codex";
}

export function agentBindingForShellAgent(agentId: ProductShellAgentIdentity): AgentChatAgentBinding {
  if (agentId === "openai_api") {
    return {
      agentId,
      runtimeSource: { kind: "tide_api", provider: "openai" },
    };
  }
  return {
    agentId,
    runtimeSource: { kind: "provider_cli", integrationId: agentId },
  };
}

export function cloneLaunchOptions(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return launchOptions === undefined ? undefined : { ...launchOptions };
}
