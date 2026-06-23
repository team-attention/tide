import type { ProductShellAgentIdentity, ProductShellState } from "./types.ts";
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
    untitledFiles: [],
    untitledSaveAsPaneId: null,
    fileTreeEdit: null,
    fileTreeMenu: null,
    fileTreeDeleteTarget: null,
    fileTreeNotice: null,
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
    untitledFiles: [],
    untitledSaveAsPaneId: null,
    fileTreeEdit: null,
    fileTreeMenu: null,
    fileTreeDeleteTarget: null,
    fileTreeNotice: null,
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

// The thread the active chat surface actually DISPLAYS. Normally this is activeThreadId,
// but a thread.listed can transiently null activeThreadId while the chat still shows a
// thread (the listed set momentarily omitted it during a restore/refresh; nulling it does
// not reset agentChat). Anything that means "the thread on screen" must key off what the
// surface DISPLAYS, not the bookkeeping field — else a thread's live state is stranded or
// dropped while activeThreadId is null. The Start Composer shows no thread
// (agentChat.thread === null) → undefined.
export function activeSurfaceThreadId(state: ProductShellState): string | undefined {
  return state.activeThreadId ?? state.agentChat.thread?.threadId ?? undefined;
}

// Stash the currently active thread's agent-chat state into the per-thread map so it
// is preserved when we switch away (and can be restored intact on return). Lives here
// (not in thread-list) so start.ts has no back-import into thread-list — keeping the
// start ↔ thread-list dependency one-directional (thread-list → start).
export function preserveActiveAgentChat(
  state: ProductShellState,
  nextThreadId: string,
): Record<string, AgentChatShellState> {
  // Preserve under the thread the chat actually DISPLAYS (see activeSurfaceThreadId): the
  // live surface state must be captured on switch-away even when activeThreadId was
  // transiently nulled, otherwise it is lost and the thread re-opens to a skeleton.
  const surfaceThreadId = activeSurfaceThreadId(state);
  if (surfaceThreadId === undefined || surfaceThreadId === nextThreadId) {
    return state.agentChatByThreadId;
  }
  return { ...state.agentChatByThreadId, [surfaceThreadId]: state.agentChat };
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
  worktree?: string;
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
  const worktree = carryPref ? preferredWorktreeForScope(pref?.worktree, scope) : "current folder";
  return createAgentChatShellState({
    startOptions: {
      agentBinding: agentBindingForShellAgent(agentId),
      scope: scope ?? { kind: "scratch", scratchCwd: "Scratch" },
      launchOptions: {
        model: carryPref ? pref?.model ?? defaultModelValueForAgent(agentId) : defaultModelValueForAgent(agentId),
        permission: carryPref ? pref?.permission ?? defaultPermissionForAgent(agentId) : defaultPermissionForAgent(agentId),
        worktree,
        branch: "main",
        ...(carryPref && pref?.reasoning !== undefined ? { reasoning: pref.reasoning } : {}),
      },
    },
  });
}

function preferredWorktreeForScope(
  value: string | undefined,
  scope: AgentChatThreadScope | undefined,
): string {
  if (value !== "new") {
    return "current folder";
  }
  return scope?.kind === "project" ? "new" : "current folder";
}

// Capture the Start Composer preference to remember from the current shell state —
// the inverse of createStartAgentChatState (which restores it). Returns null when
// there's nothing to capture: a thread is focused (not the Start Composer), or the
// agent isn't a known one — so a focused thread's agent or a garbage value is never
// persisted. Pure on purpose: this is the persistence DECISION (where the
// opencode/gemini drop bug lived), unit-tested without mounting the React effect
// that calls it.
export function preferredStartComposerFromState(
  state: ProductShellState,
): PreferredStartComposer | null {
  // "On the start Composer" = the chat has no thread (composer.mode === "start"). NOT
  // activeThreadId === null: the Composer's Draft Thread makes activeThreadId non-null
  // while the user is still composing, but agentChat.thread stays null until Send. Gating
  // on agentChat.thread keeps the agent/model preference persisting through a draft.
  // See docs_v2/specs/composer-draft-thread.md.
  if (state.agentChat.thread !== null) {
    return null;
  }
  const startOptions = state.agentChat.composer.startOptions;
  const agentId = startOptions.agentBinding.agentId;
  if (!isProductShellAgentIdentity(agentId)) {
    return null;
  }
  const launch = startOptions.launchOptions ?? {};
  return {
    agentId,
    model: typeof launch.model === "string" ? launch.model : undefined,
    permission: typeof launch.permission === "string" ? launch.permission : undefined,
    reasoning: typeof launch.reasoning === "string" ? launch.reasoning : undefined,
    worktree: preferredWorktreeForPersistence(launch.worktree),
  };
}

function preferredWorktreeForPersistence(value: unknown): "current folder" | "new" | undefined {
  if (value === "new") {
    return "new";
  }
  if (typeof value === "string") {
    return "current folder";
  }
  return undefined;
}

// The four provider-CLI agent identities the Start Composer can launch. Single source of
// truth for "is this a known agent" guards (preference persistence) so they can't
// drift into a stale subset — the bug that silently dropped opencode/gemini from
// the remembered Start Composer default.
const PRODUCT_SHELL_AGENT_IDENTITIES: ReadonlySet<string> = new Set<ProductShellAgentIdentity>([
  "codex",
  "claude",
  "gemini",
  "opencode",
]);

export function isProductShellAgentIdentity(
  value: string | undefined,
): value is ProductShellAgentIdentity {
  return value !== undefined && PRODUCT_SHELL_AGENT_IDENTITIES.has(value);
}

export function normalizeAgentId(agentId: string): ProductShellAgentIdentity {
  // Reuse the predicate as the single source of truth for valid agents; anything
  // else (legacy/unknown id) coerces to codex.
  return isProductShellAgentIdentity(agentId) ? agentId : "codex";
}

export function agentBindingForShellAgent(agentId: ProductShellAgentIdentity): AgentChatAgentBinding {
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
