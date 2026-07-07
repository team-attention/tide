import { DEFAULT_PRODUCT_SHELL_LIST_SETTINGS, DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS } from "./types.ts";
import type { CreateProductShellStateInput, ProductShellProject, ProductShellState, ProductShellThread } from "./types.ts";
import { workbenchPane } from "./workbench.ts";
import type { AgentChatThreadScope } from "../../agent-chat/agent-chat.ts";
import { createStartAgentChatState } from "./start.ts";
import { createAppChromeState } from "../../app-chrome/app-chrome-state.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

export const shellTimestamp = "2026-05-28T00:00:00.000Z";

const initialProjects: ProductShellProject[] = [
  { projectId: "tide", name: "tide", cwd: "/Users/you/Workspace/tide" },
  { projectId: "slice", name: "slice", cwd: "/Users/you/Workspace/slice" },
];

const initialThreads: ProductShellThread[] = [
  {
    threadId: "thread-master-plan",
    title: "v2 master plan implementation",
    agentId: "codex",
    time: "now",
    scope: { kind: "project", projectId: "tide", cwd: "/Users/you/Workspace/tide" },
    workbenchPanes: [
      workbenchPane("pane-thread-master-plan-diff", "diff", "Master plan diff"),
    ],
    pinned: true,
  },
  {
    threadId: "thread-workbench",
    title: "Workbench MCP surface",
    agentId: "codex",
    time: "14m",
    scope: { kind: "project", projectId: "tide", cwd: "/Users/you/Workspace/tide" },
    workbenchPanes: [
      workbenchPane("pane-thread-workbench-browser", "browser", "Browser preview"),
      workbenchPane("pane-thread-workbench-diff", "diff", "Review diff"),
    ],
  },
  {
    threadId: "thread-persistence",
    title: "Thread persistence cache",
    agentId: "claude",
    time: "1h",
    scope: { kind: "project", projectId: "tide", cwd: "/Users/you/Workspace/tide" },
    workbenchPanes: [
      workbenchPane("pane-thread-persistence-editor", "editor", "Thread metadata"),
    ],
  },
  {
    threadId: "thread-visual",
    title: "Desktop shell visual pass",
    agentId: "opencode",
    time: "2h",
    scope: { kind: "project", projectId: "slice", cwd: "/Users/you/Workspace/slice" },
    workbenchPanes: [
      workbenchPane("pane-thread-visual-browser", "browser", "Visual preview"),
    ],
    attention: true,
  },
  {
    threadId: "thread-sketch",
    title: "Explore a compact composer",
    agentId: "codex",
    time: "yesterday",
    scope: { kind: "scratch", scratchCwd: "Scratch" },
    workbenchPanes: [],
  },
];

export function createProductShellState(
  input: CreateProductShellStateInput = {},
): ProductShellState {
  const includeFixtureData = input.includeFixtureData ?? true;
  const startProjects = includeFixtureData ? initialProjects : [];
  const startScope: AgentChatThreadScope =
    startProjects[0] !== undefined
      ? { kind: "project", projectId: startProjects[0].projectId, cwd: startProjects[0].cwd }
      : { kind: "scratch", scratchCwd: "Scratch" };
  return {
    activeThreadId: null,
    leftRailOpen: true,
    workbenchOpen: false,
    workbenchOpenByThreadId: {},
    workbenchFullscreen: false,
    workbenchLayoutMode: "stacked",
    workbenchLayoutTree: null,
    fileTreeOpen: false,
    leftRailMenu: null,
    archiveConfirmThreadId: null,
    renamingThreadId: null,
    searchQuery: "",
    searchActive: false,
    collapsedProjectIds: [],
    expandedFolderPaths: [],
    projects: includeFixtureData ? initialProjects : [],
    registeredProjects: [],
    gitBranches: [],
    gitWorktrees: [],
    providerCommands: [],
    providerCapabilities: [],
    providerInventory: null,
    providerCatalogs: {},
    composerFileMentions: null,
    pinnedProjectIds: [],
    pinnedItemOrder: input.pinnedItemOrder ?? [],
    projectOrder: input.projectOrder ?? [],
    renamingProjectId: null,
    creatingWorktreeForProjectId: null,
    threads: includeFixtureData ? initialThreads : [],
    // Fixture/dev data is "already loaded"; a real cold boot waits for thread.listed.
    threadsLoaded: includeFixtureData,
    editorPickerFilter: null,
    agentChat: createStartAgentChatState(startScope),
    agentChatByThreadId: {},
    providerUsage: [],
    appChrome: createAppChromeState(),
    fileTree: null,
    startPageFiles: [],
    startPagePendingNavigation: null,
    contentSearch: null,
    dismissedEditorReferenceKeys: {},
    editorDrafts: {},
    nextLocalThreadNumber: 1,
    listSettings: input.listSettings ?? { ...DEFAULT_PRODUCT_SHELL_LIST_SETTINGS },
    worktreeSettings: input.worktreeSettings ?? { ...DEFAULT_PRODUCT_SHELL_WORKTREE_SETTINGS },
    settingsOpen: false,
    draftActiveWorkbenchPaneId: null,
    draftThreadId: null,
    untitledFiles: [],
    untitledSequence: 0,
    untitledSaveAsPaneId: null,
    fileTreeEdit: null,
    fileTreeMenu: null,
    fileTreeDeleteTarget: null,
    fileTreeNotice: null,
  };
}
