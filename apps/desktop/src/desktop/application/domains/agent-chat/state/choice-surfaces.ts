import type { AgentChatAgentId, AgentChatAgentRuntimeSource, AgentChatChoiceSurfaceRowView, AgentChatChoiceSurfaceView, AgentChatCommandOption, AgentChatProjectOption, AgentChatProviderModelOption, AgentChatShellState, AgentChatShellUpdateResult, AgentChatThreadScope } from "./types.ts";
import { activeComposerTrigger, selectComposerAgent, setComposerActiveSurface } from "./composer.ts";
import { CODEX_MODELS, PERMISSION_OPTIONS, REASONING_LEVELS, cliModelOptionsForAgent, defaultModelValueForAgent, defaultPermissionForAgent, defaultReasoningValueForAgent, formatAgentLabel, isAgentAvailable, isAgentAvailabilityKnown, isAgentComingSoon, normalizePermissionValue, permissionConfigForAgent, runtimeSourceForBinding } from "./agent-vocab.ts";
import { branchMenuRows, defaultBranchName, worktreeForBranch, worktreeMenuRows } from "./branch-environment-menu-rows.ts";
import { launchOptionsForState, setComposerNewWorktreeIntent, updateComposerLaunchOptions, updateComposerScope } from "./launch-options.ts";
import { buildOpencodeConnectSurface, isOpencodeUsable } from "./opencode-onramp.ts";
import { buildOpencodeModelProviderSurface } from "./opencode-model-provider.ts";
import { opencodeAuthTerminalCommand, selectOpencodeModelProviderSurfaceRow } from "./opencode-model-provider-selection.ts";
import { providerReadinessTerminalCommandData } from "./provider-readiness-terminal-command.ts";
import { basenameOf } from "./path-labels.ts";
import { row } from "./choice-row.ts";
import { commandRowsFromCapabilities } from "./capability-command-rows.ts";
import { invokeComposerCapabilityRow } from "./capability-invocation.ts";
import { fileMentionRows } from "./file-mention-rows.ts";
import { capabilityMenuRows, hasCapabilityMenuRows, selectCapabilityMenuRow } from "./capability-menu.ts";

const CODEX_LOCAL_SLASH_COMMANDS: AgentChatCommandOption[] = [
  { name: "compact", description: "Summarize the conversation to free context", trigger: "/", source: "builtin" },
];

export function selectAgentChatChoiceSurfaceRow(
  state: AgentChatShellState,
  surfaceKind: AgentChatChoiceSurfaceView["surfaceKind"],
  rowId: string,
  activeThreadId?: string,
): AgentChatShellUpdateResult {
  if (surfaceKind === "prompt_state" && state.promptState) {
    const choice = state.promptState.choices?.find((candidate) => candidate.choiceId === rowId);
    return {
      state: {
        ...state,
        promptState: null,
      },
      command: {
        kind: "prompt.answer",
        payload: {
          threadId: state.promptState.threadId,
          promptId: state.promptState.promptId,
          choiceId: choice?.choiceId ?? rowId,
          value: choice?.providerValue,
        },
      },
    };
  }

  if (surfaceKind === "provider_readiness") {
    // The non-blocking update nudge: run the in-place CLI update through a
    // provider-readiness Terminal Pane using the resolved executable's native
    // updater, then retry_preflight. Spec: provider-cli-executable-resolution.md.
    if (rowId === "update_available:terminal") {
      const terminalAction = state.providerReadiness?.update?.terminalAction;
      const threadId = state.thread?.threadId ?? activeThreadId;
      if (terminalAction === undefined || threadId === undefined) {
        return { state, command: null };
      }
      return {
        state,
        command: {
          kind: "workbench.command",
          payload: {
            threadId,
            command: "open_terminal",
            data: providerReadinessTerminalCommandData("update_available", terminalAction),
          },
        },
      };
    }
    // The directory-trust blocker offers a direct "Trust this folder" action that
    // writes the provider's trust config (no terminal). See workspace-trust-grant.
    if (rowId === "directory_trust_required:trust") {
      const threadId = state.thread?.threadId ?? activeThreadId;
      // Ignore re-clicks while a trust grant is already in flight.
      if (threadId === undefined || state.providerReadinessActionPending) {
        return { state, command: null };
      }
      return {
        state: { ...state, providerReadinessActionPending: true },
        command: {
          kind: "provider.trustWorkspace",
          payload: { threadId },
        },
      };
    }
    const blocker = state.providerReadiness?.blockers.find(
      (candidate) => `${candidate.kind}:terminal` === rowId,
    );
    // Readiness can block before the agent-chat thread is hydrated, so fall back
    // to the active thread id the shell provides — otherwise the provider action
    // row is dead.
    const threadId = state.thread?.threadId ?? activeThreadId;
    if (blocker?.terminalAction === undefined || threadId === undefined) {
      return { state, command: null };
    }
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId,
          command: "open_terminal",
          data: providerReadinessTerminalCommandData(blocker.kind, blocker.terminalAction),
        },
      },
    };
  }

  if (state.composer.activeSurface !== surfaceKind) {
    return { state, command: null };
  }
  const activeSurface = createActiveComposerSurface(state);
  if (!activeSurface?.rows.some((row) => row.rowId === rowId)) {
    return { state, command: null };
  }

  switch (surfaceKind) {
    case "agent_menu": {
      const agentId = composerAgentIdForRow(rowId);
      if (agentId === null || isAgentComingSoon(agentId)) {
        return { state, command: null };
      }
      return selectComposerAgent(state, agentId);
    }
    case "model_menu": {
      const reasoning = reasoningForRow(rowId);
      if (reasoning !== undefined) {
        return updateComposerLaunchOptions(state, { reasoning });
      }
      const model = modelForRow(rowId);
      return model ? updateComposerLaunchOptions(state, { model }) : { state, command: null };
    }
    case "opencode_model_provider": {
      return selectOpencodeModelProviderSurfaceRow(state, rowId, activeThreadId);
    }
    case "opencode_connect": {
      if (rowId === "back-to-models") {
        return setComposerActiveSurface(state, "model_menu");
      }
      if (rowId === "use-free-model") {
        // Use opencode's own default (a Zen free model — no sign-in) and close.
        const updated = updateComposerLaunchOptions(state, { model: "opencode default" });
        return {
          state: { ...updated.state, composer: { ...updated.state.composer, activeSurface: null } },
          command: updated.command,
        };
      }
      // connect-vendor:<id> / all-providers → drive opencode's OWN `auth login`
      // in a provider-readiness Terminal Pane. opencode shows the right method
      // (browser/key) per vendor; Tide stores no credentials. Needs a thread to
      // host the terminal (active or current).
      const vendorId = rowId.startsWith("connect-vendor:")
        ? rowId.slice("connect-vendor:".length)
        : undefined;
      if (vendorId === undefined && rowId !== "all-providers") {
        return { state, command: null };
      }
      return opencodeAuthTerminalCommand(state, vendorId, activeThreadId);
    }
    case "permission_menu": {
      const permission = permissionForRow(rowId);
      return permission ? updateComposerLaunchOptions(state, { permission }) : { state, command: null };
    }
    case "project_menu": {
      const scope = scopeForProjectRow(rowId, state);
      return scope ? updateComposerScope(state, scope) : { state, command: null };
    }
    case "worktree_menu": {
      return selectComposerEnvironmentRow(state, rowId);
    }
    case "branch_menu": {
      if (rowId === "create-branch") {
        const baseBranch = String(
          launchOptionsForState(state)?.branch ??
            defaultBranchName(state.availableBranches ?? [], "main"),
        );
        return setComposerNewWorktreeIntent(state, { name: "", baseBranch });
      }
      const branch = branchForRow(rowId);
      return branch ? selectComposerBranch(state, branch) : { state, command: null };
    }
    case "command_suggestions": {
      // Selecting a command/skill row ("command:/name" or "command:$name") or a file
      // row ("file:<relativePath>") splices the token into the draft and closes.
      if (rowId.startsWith("command:")) {
        return spliceComposerTriggerToken(state, rowId.slice("command:".length));
      }
      if (rowId.startsWith("capability:")) {
        return invokeComposerCapabilityRow(
          state,
          rowId.slice("capability:".length),
          activeThreadId,
        );
      }
      if (rowId.startsWith("file:")) {
        return spliceComposerTriggerToken(state, `@${rowId.slice("file:".length)}`);
      }
      return setComposerActiveSurface(state, null);
    }
    case "composer_options":
      if (rowId === "agent-capabilities") {
        return setComposerActiveSurface(state, "capability_menu");
      }
      return setComposerActiveSurface(state, null);
    case "capability_menu":
      if (rowId.startsWith("capability-menu:")) {
        return selectCapabilityMenuRow(state, rowId.slice("capability-menu:".length), activeThreadId);
      }
      return setComposerActiveSurface(state, null);
  }
}

function spliceComposerTriggerToken(state: AgentChatShellState, token: string): AgentChatShellUpdateResult {
  const active = activeComposerTrigger(state.composer.draft);
  const prefix = active ? state.composer.draft.slice(0, active.tokenStart) : state.composer.draft;
  return {
    state: {
      ...state,
      composer: { ...state.composer, draft: `${prefix}${token} `, activeSurface: null },
    },
    command: null,
  };
}

export function createActiveComposerSurface(
  state: AgentChatShellState,
): AgentChatChoiceSurfaceView | null {
  const surfaceKind = state.composer.activeSurface;
  if (!surfaceKind) {
    return null;
  }

  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  const agentLabel = formatAgentLabel(binding.agentId);
  const launchOptions = launchOptionsForState(state);
  const selectedModel = String(
    launchOptions?.model ?? defaultModelValueForAgent(binding.agentId),
  );

  switch (surfaceKind) {
    case "agent_menu":
      return {
        surfaceKind,
        title: "Agent",
        sourceLabel: "Agent Binding",
        // Provider-CLI agents are listed; ones whose CLI is not detected on the local
        // system are shown DISABLED (greyed), never removed.
        rows: [
          agentMenuRow("codex", "Codex CLI", binding.agentId, state),
          agentMenuRow("claude", "Claude Code", binding.agentId, state),
          agentMenuRow("opencode", "opencode", binding.agentId, state),
        ],
      };
    case "model_menu":
      if (binding.agentId === "opencode") {
        const catalog = state.availableProviderCatalogs?.opencode;
        return buildOpencodeModelProviderSurface(
          selectedModel,
          String(launchOptionsForState(state)?.reasoning ?? "high"),
          state.composer.opencodeModelProvider,
          catalog,
        );
      }
      return {
        surfaceKind,
        title: "Model",
        sourceLabel: agentLabel,
        rows:
          binding.agentId === "codex"
              ? codexModelMenuRows(state, selectedModel)
              : binding.agentId === "claude"
                ? [
                    ...cliModelMenuRows("claude", agentLabel, selectedModel),
                    // The Claude Code app's "Effort" control → `--effort`.
                    row("effort-section", "Effort", "thinking effort", "source", "source"),
                    ...effortRows(
                      String(launchOptionsForState(state)?.reasoning ?? "high"),
                      ["low", "medium", "high", "xhigh", "max"],
                    ),
                  ]
                : binding.agentId === "opencode"
                  ? []
                  : cliModelMenuRows(binding.agentId, agentLabel, selectedModel),
      };
    case "opencode_model_provider":
      {
        const catalog = state.availableProviderCatalogs?.opencode;
      return buildOpencodeModelProviderSurface(
        selectedModel,
        String(launchOptionsForState(state)?.reasoning ?? "high"),
        state.composer.opencodeModelProvider,
        catalog,
      );
      }
    case "opencode_connect":
      // Compatibility surface for older opencode connect entry points. The model
      // chip now opens the provider-first opencode_model_provider surface.
      {
        const catalog = state.availableProviderCatalogs?.opencode;
        return buildOpencodeConnectSurface(isOpencodeUsable(catalog), catalog);
      }
    case "permission_menu":
      return {
        surfaceKind,
        title: `${agentLabel} Permission`,
        sourceLabel: agentLabel,
        rows: permissionRowsForAgent(
          binding.agentId,
          String(launchOptionsForState(state)?.permission ?? defaultPermissionForAgent(binding.agentId)),
        ),
      };
    case "project_menu":
      return {
        surfaceKind,
        title: "Project",
        sourceLabel: "Execution Context",
        rows: projectMenuRows(state),
      };
    case "worktree_menu":
      return {
        surfaceKind,
        title: "Environment",
        sourceLabel: "Execution Context",
        rows: worktreeMenuRows(state),
      };
    case "branch_menu":
      return {
        surfaceKind,
        title: "Branch",
        sourceLabel: "Execution Context",
        rows: branchMenuRows(state),
      };
    case "composer_options":
      return {
        surfaceKind,
        title: "Composer menu",
        sourceLabel: agentLabel,
        rows: [
          ...(hasCapabilityMenuRows(state) ? [row("agent-capabilities", "Agent capabilities", "Session, model, MCP, and tools", agentLabel, "agent")] : []),
          row("files-images", "Files and images", "Attach an image", undefined, "attach"),
          row("current-selection", "Current file or selection", "coming soon", undefined, "file", false, false, true),
          row("context", "Browser, Diff, Terminal, or FileTree context", "coming soon", undefined, "panel", false, false, true),
        ],
      };
    case "capability_menu":
      return {
        surfaceKind,
        title: "Agent capabilities",
        sourceLabel: agentLabel,
        rows: capabilityMenuRows(state, agentLabel),
      };
    case "command_suggestions": {
      const active = activeComposerTrigger(state.composer.draft);
      const trigger = active?.trigger ?? "/";
      const query = (active?.query ?? "").trim().toLowerCase();
      if (trigger === "@") {
        return {
          surfaceKind,
          title: "Files",
          sourceLabel: "Execution Context",
          rows: fileMentionRows(state, query),
        };
      }
      const capabilityRows =
        trigger === "/" || trigger === "$"
          ? commandRowsFromCapabilities(state, trigger, query, agentLabel)
          : [];
      if (capabilityRows.length > 0) {
        return {
          surfaceKind,
          title: trigger === "$" ? "Skills" : "Commands",
          sourceLabel: agentLabel,
          rows: capabilityRows,
        };
      }
      const seenCommandNames = new Set<string>();
      const availableCommands = state.availableCommands ?? [];
      const commands = [
        ...(trigger === "/" && binding.agentId === "codex" ? CODEX_LOCAL_SLASH_COMMANDS : []),
        ...(trigger === "/" && !availableCommands.some((command) => command.trigger === "/" && command.name.toLowerCase() === "goal")
          ? [{ name: "goal", description: "Set the thread goal", trigger: "/" as const, source: "builtin" as const }]
          : []),
        ...availableCommands,
      ].filter((command) => {
        if (command.trigger !== trigger) {
          return false;
        }
        if (query.length > 0 && !command.name.toLowerCase().includes(query)) {
          return false;
        }
        const key = command.name.toLowerCase();
        if (seenCommandNames.has(key)) {
          return false;
        }
        seenCommandNames.add(key);
        return true;
      });
      return {
        surfaceKind,
        title: trigger === "$" ? "Skills" : "Commands",
        sourceLabel: agentLabel,
        rows: commands.map((command) =>
          row(`command:${command.trigger}${command.name}`, `${command.trigger}${command.name}`, command.description, agentLabel),
        ),
      };
    }
  }
}

function permissionRowsForAgent(agentId: string, currentValue: string): AgentChatChoiceSurfaceRowView[] {
  const config = permissionConfigForAgent(agentId);
  const normalized = normalizePermissionValue(agentId, currentValue);
  return config.options.map((option) => {
    const selected = option.value === normalized;
    const icon = selected ? "check" : option.danger ? "!" : "";
    return row(option.id, option.label, option.detail, undefined, icon, selected, option.danger ?? false);
  });
}

// One provider-CLI agent row: always selectable (so a not-installed agent can be picked to
// start its install / sign-in handoff), labelled "Not installed" until its CLI is detected.
// Only coming-soon rows are disabled. Never removed.
function agentMenuRow(
  agentId: string,
  label: string,
  selectedAgentId: string,
  state: AgentChatShellState,
): AgentChatChoiceSurfaceRowView {
  const selected = selectedAgentId === agentId;
  const comingSoon = isAgentComingSoon(agentId);
  const available = isAgentAvailable(agentId, state.availableProviderInventory);
  const known = isAgentAvailabilityKnown(state.availableProviderInventory);
  // Until local detection arrives (known=false) show a neutral "Checking…" rather than a
  // misleading "Agent Integration"; once known, an undetected provider reads "Not installed"
  // so the row says WHY selecting it will offer install/sign-in. (Detection is fast + decoupled
  // from opencode's catalog, so this window is sub-perceptible.) Spec: provider-cli-setup-handoff.
  const detail = comingSoon
    ? "Coming soon"
    : !known
      ? "Checking…"
      : !available
        ? "Not installed"
        : "Agent Integration";
  return row(
    agentId,
    label,
    detail,
    undefined,
    selected ? "check" : `identity:${agentId}`,
    selected,
    false,
    comingSoon,
  );
}

function composerAgentIdForRow(
  rowId: string,
): AgentChatAgentId | null {
  switch (rowId) {
    case "codex":
      return "codex";
    case "claude":
      return "claude";
    case "opencode":
      return "opencode";
    default:
      return null;
  }
}

function modelForRow(rowId: string): string | undefined {
  // CLI model rows carry their provider-native value as `model:<value>`.
  if (rowId.startsWith("model:")) {
    return rowId.slice("model:".length);
  }
  switch (rowId) {
    case "codex-model":
      return defaultModelValueForAgent("codex");
    case "claude-default":
      return "Claude default";
    default:
      return undefined;
  }
}

// Pretty vendor label for an opencode `provider/model` vendor segment.
function vendorLabel(vendor: string): string {
  const map: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    opencode: "OpenCode Zen",
    moonshotai: "Moonshot",
    alibaba: "Qwen / Alibaba",
    "github-copilot": "GitHub Copilot",
    openrouter: "OpenRouter",
    deepseek: "DeepSeek",
  };
  return map[vendor] ?? vendor.replace(/(^|[-_/])([a-z])/g, (_m, sep, ch) => (sep ? " " : "") + ch.toUpperCase()).trim();
}

function cliModelMenuRows(
  agentId: string,
  agentLabel: string,
  selectedModel: string,
): AgentChatChoiceSurfaceRowView[] {
  void agentLabel;
  // No noisy fallback detail (matches the provider apps' clean model lists): a
  // model shows its own detail (e.g. "Legacy") or nothing. Multi-vendor agents
  // (opencode) carry a `vendor` per model → emit a section header per vendor so
  // the long cross-vendor list stays legible.
  const options = cliModelOptionsForAgent(agentId);
  const rows: AgentChatChoiceSurfaceRowView[] = [];
  let lastVendor: string | undefined;
  for (const option of options) {
    if (option.vendor !== undefined && option.vendor !== lastVendor) {
      lastVendor = option.vendor;
      rows.push(row(`vendor:${option.vendor}`, vendorLabel(option.vendor), undefined, "source", "source"));
    }
    rows.push(
      row(
        `model:${option.value}`,
        option.label,
        option.detail,
        undefined,
        option.value === selectedModel ? "check" : "",
        option.value === selectedModel,
      ),
    );
  }
  return rows;
}

function effortRows(current: string, levels: string[]): AgentChatChoiceSurfaceRowView[] {
  return levels.map((level) =>
    row(
      `reasoning-${level}`,
      REASONING_LEVELS[level].label,
      REASONING_LEVELS[level].detail,
      undefined,
      current === level ? "check" : "",
      current === level,
    ),
  );
}

function reasoningForRow(rowId: string): "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  switch (rowId) {
    case "reasoning-low":
      return "low";
    case "reasoning-medium":
      return "medium";
    case "reasoning-high":
      return "high";
    case "reasoning-xhigh":
      return "xhigh";
    case "reasoning-max":
      return "max";
    default:
      return undefined;
  }
}

// Codex uses the local runtime catalog when available, with a conservative fallback
// list while the provider catalog request is still loading or failed.
function codexModelMenuRows(
  state: AgentChatShellState,
  selectedModel: string,
): AgentChatChoiceSurfaceRowView[] {
  const reasoning = String(
    launchOptionsForState(state)?.reasoning ??
      defaultReasoningValueForAgent("codex", selectedModel),
  );
  const reasoningLevels = selectedModel.startsWith("gpt-5.6-")
    ? ["low", "medium", "high", "xhigh", "max"]
    : ["low", "medium", "high", "xhigh"];
  const rows: AgentChatChoiceSurfaceRowView[] = [
    row("model-section", "Model", "Codex Agent Integration", "source", "source"),
  ];
  for (const model of codexModelOptionsForState(state)) {
    rows.push(
      row(
        `model:${model.value}`,
        model.label,
        undefined,
        undefined,
        model.value === selectedModel ? "check" : "",
        model.value === selectedModel,
      ),
    );
  }
  rows.push(
    row("reasoning-section", "Reasoning effort", "model_reasoning_effort", "source", "source"),
    ...effortRows(reasoning, reasoningLevels),
  );
  return rows;
}

function codexModelOptionsForState(state: AgentChatShellState): AgentChatProviderModelOption[] {
  const catalog = state.availableProviderCatalogs?.codex;
  return catalog?.status === "ready" && catalog.models.length > 0
    ? catalog.models
    : CODEX_MODELS;
}

function permissionForRow(rowId: string): string | undefined {
  for (const config of Object.values(PERMISSION_OPTIONS)) {
    const option = config.options.find((candidate) => candidate.id === rowId);
    if (option) {
      return option.value;
    }
  }
  return undefined;
}

// The real projects the Project menu lists: those injected from the product
// shell, plus the composer's current project if not already among them (so the
// active scope is always selectable). No hardcoded project list.
function projectOptionsForState(state: AgentChatShellState): AgentChatProjectOption[] {
  const options = [...(state.availableProjects ?? [])];
  const scope = state.thread?.scope ?? state.composer.startOptions.scope;
  if (scope?.kind === "project" && !options.some((option) => option.projectId === scope.projectId)) {
    options.unshift({ projectId: scope.projectId, name: scope.projectId, cwd: scope.cwd });
  }
  return options;
}

function projectMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const scope = state.thread?.scope ?? state.composer.startOptions.scope;
  const activeProjectId = scope?.kind === "project" ? scope.projectId : undefined;
  const projectRows = projectOptionsForState(state).map((project) => {
    const selected = project.projectId === activeProjectId;
    return row(
      `project:${project.projectId}`,
      project.name,
      selected ? "current" : project.cwd,
      undefined,
      selected ? "check" : "folder",
      selected,
    );
  });
  return [
    ...projectRows,
    row("scratch", "Scratch", "scratch workspace", undefined, "scratch", scope?.kind === "scratch"),
    // Single registration action — opens the native directory picker (Codex flow).
    row("open-folder", "Open folder", "add a project directory", undefined, "folder-plus"),
  ];
}

function scopeForProjectRow(
  rowId: string,
  state: AgentChatShellState,
): AgentChatThreadScope | null {
  if (rowId === "scratch") {
    return { kind: "scratch", scratchCwd: "Scratch" };
  }
  if (rowId.startsWith("project:")) {
    const projectId = rowId.slice("project:".length);
    const project = projectOptionsForState(state).find((option) => option.projectId === projectId);
    return project ? { kind: "project", projectId: project.projectId, cwd: project.cwd } : null;
  }
  // create-project / use-existing-folder are folder-picker actions, wired later.
  return null;
}

function selectComposerEnvironmentRow(
  state: AgentChatShellState,
  rowId: string,
): AgentChatShellUpdateResult {
  if (rowId === "new-worktree") {
    const baseBranch = String(
      launchOptionsForState(state)?.branch ??
        defaultBranchName(state.availableBranches ?? [], "main"),
    );
    return setComposerNewWorktreeIntent(state, { name: "", baseBranch });
  }
  if (rowId === "worktree:existing-unavailable") {
    return { state, command: null };
  }
  if (rowId === "worktree:current") {
    const currentWorktree = state.availableWorktrees?.find((entry) => entry.current);
    if (currentWorktree !== undefined) {
      const scoped = updateComposerScope(state, {
        kind: "project",
        projectId: currentProjectId(state) ?? basenameOf(currentWorktree.path),
        cwd: currentWorktree.path,
      }).state;
      return updateComposerLaunchOptions(scoped, {
        worktree: "current folder",
      });
    }
    return updateComposerLaunchOptions(state, { worktree: "current folder" });
  }
  if (rowId.startsWith("worktree:")) {
    const path = rowId.slice("worktree:".length);
    const worktree = state.availableWorktrees?.find((entry) => entry.path === path);
    const scoped = updateComposerScope(state, {
      kind: "project",
      projectId: currentProjectId(state) ?? basenameOf(path),
      cwd: path,
    }).state;
    return updateComposerLaunchOptions(scoped, {
      worktree: path,
      ...(worktree?.branch ? { branch: worktree.branch } : {}),
    });
  }
  return { state, command: null };
}

function selectComposerBranch(
  state: AgentChatShellState,
  branch: string,
): AgentChatShellUpdateResult {
  const launchOptions = launchOptionsForState(state);
  const selectedWorktree =
    typeof launchOptions?.worktree === "string"
      ? (state.availableWorktrees ?? []).find((entry) => entry.path === launchOptions.worktree)
      : undefined;
  if (selectedWorktree !== undefined && selectedWorktree.branch !== branch) {
    return selectLocalEnvironmentForBranch(state, branch);
  }
  return updateComposerLaunchOptions(state, { branch });
}

function selectLocalEnvironmentForBranch(
  state: AgentChatShellState,
  branch: string,
): AgentChatShellUpdateResult {
  const currentWorktree = state.availableWorktrees?.find((entry) => entry.current);
  if (currentWorktree === undefined) {
    return updateComposerLaunchOptions(state, { branch, worktree: "current folder" });
  }
  const scoped = updateComposerScope(state, {
    kind: "project",
    projectId: currentProjectId(state) ?? basenameOf(currentWorktree.path),
    cwd: currentWorktree.path,
  }).state;
  return updateComposerLaunchOptions(scoped, {
    branch,
    worktree: "current folder",
  });
}

function currentProjectId(state: AgentChatShellState): string | null {
  const scope = state.thread?.scope ?? state.composer.startOptions.scope;
  return scope?.kind === "project" ? scope.projectId : null;
}

function branchForRow(rowId: string): string | undefined {
  // "create-branch" is a create affordance, wired later.
  return rowId.startsWith("branch:") ? rowId.slice("branch:".length) : undefined;
}
