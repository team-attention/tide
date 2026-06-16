import type { AgentChatAgentId, AgentChatAgentRuntimeSource, AgentChatChoiceSurfaceRowView, AgentChatChoiceSurfaceView, AgentChatProjectOption, AgentChatShellState, AgentChatShellUpdateResult, AgentChatThreadScope } from "./types.ts";
import { activeComposerTrigger, providerSetupCommandPayload, selectComposerAgent, setComposerActiveSurface } from "./composer.ts";
import { CODEX_MODELS, PERMISSION_OPTIONS, REASONING_LEVELS, cliModelOptionsForAgent, defaultModelValueForAgent, defaultPermissionForAgent, formatAgentLabel, isAgentAvailable, isAgentComingSoon, normalizePermissionValue, permissionConfigForAgent, runtimeSourceForBinding } from "./agent-vocab.ts";
import { launchOptionsForState, updateComposerLaunchOptions, updateComposerScope } from "./launch-options.ts";
import { buildOpencodeConnectSurface, getOpencodeEnvironment, isOpencodeUsable } from "./opencode-onramp.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

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
        // Keep the composer draft: the answer is the chosen option, not what the user
        // was typing — clearing it would lose an in-progress follow-up (spec).
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
      (candidate) => `${candidate.kind}:setup` === rowId,
    );
    // Readiness can block before the agent-chat thread is hydrated, so fall back
    // to the active thread id the shell provides — otherwise "Open provider
    // setup" is a dead row.
    const threadId = state.thread?.threadId ?? activeThreadId;
    if (blocker?.setup === undefined || threadId === undefined) {
      return { state, command: null };
    }
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId,
          command: "open_provider_setup_surface",
          data: {
            blockerKind: blocker.kind,
            setup: providerSetupCommandPayload(blocker.setup),
          },
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
      // Selecting a disabled (undetected or coming-soon) agent is a no-op.
      if (agentId === null || !isAgentAvailable(agentId) || isAgentComingSoon(agentId)) {
        return { state, command: null };
      }
      return selectComposerAgent(state, agentId);
    }
    case "model_menu": {
      // "Add a vendor…" (opencode) switches to the on-ramp panel.
      if (rowId === "add-vendor") {
        return setComposerActiveSurface(state, "opencode_connect");
      }
      const reasoning = reasoningForRow(rowId);
      if (reasoning !== undefined) {
        return updateComposerLaunchOptions(state, { reasoning });
      }
      const model = modelForRow(rowId, runtimeSourceForBinding(state.composer.startOptions.agentBinding).kind);
      return model ? updateComposerLaunchOptions(state, { model }) : { state, command: null };
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
      // connect-vendor:<id> / all-providers → drive opencode's OWN `auth login` in the
      // Provider Setup Surface (the same verbatim-command path the readiness blocker
      // uses). opencode shows the right method (browser/key) per vendor; Tide stores
      // no credentials. Needs a thread to host the surface (active or current).
      const vendorId = rowId.startsWith("connect-vendor:")
        ? rowId.slice("connect-vendor:".length)
        : undefined;
      if (vendorId === undefined && rowId !== "all-providers") {
        return { state, command: null };
      }
      const environment = getOpencodeEnvironment();
      const threadId = state.thread?.threadId ?? activeThreadId;
      const scope = state.thread?.scope ?? state.composer.startOptions.scope;
      const cwd =
        scope === undefined ? undefined : scope.kind === "project" ? scope.cwd : scope.scratchCwd;
      if (environment?.executablePath === undefined || threadId === undefined || cwd === undefined) {
        return { state, command: null };
      }
      return {
        state: setComposerActiveSurface(state, null).state,
        command: {
          kind: "workbench.command",
          payload: {
            threadId,
            command: "open_provider_setup_surface",
            data: {
              blockerKind: "not_authenticated",
              setup: {
                command: environment.executablePath,
                args: vendorId !== undefined ? ["auth", "login", "-p", vendorId] : ["auth", "login"],
                cwd,
                expectedCompletion: "retry_preflight",
              },
            },
          },
        },
      };
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
      const worktree = worktreeForRow(rowId);
      return worktree ? updateComposerLaunchOptions(state, { worktree }) : { state, command: null };
    }
    case "branch_menu": {
      const branch = branchForRow(rowId);
      return branch ? updateComposerLaunchOptions(state, { branch }) : { state, command: null };
    }
    case "command_suggestions": {
      // Selecting a command/skill row (rowId "command:/name" or "command:$name")
      // inserts the token into the draft and closes the surface.
      if (rowId.startsWith("command:")) {
        const token = rowId.slice("command:".length);
        // Replace only the in-progress trigger token, preserving any text typed
        // before it (e.g. "explain /go" + pick "/goal" → "explain /goal ").
        const active = activeComposerTrigger(state.composer.draft);
        const prefix = active ? state.composer.draft.slice(0, active.tokenStart) : "";
        return {
          state: {
            ...state,
            composer: { ...state.composer, draft: `${prefix}${token} `, activeSurface: null },
          },
          command: null,
        };
      }
      return setComposerActiveSurface(state, null);
    }
    case "composer_options":
      return setComposerActiveSurface(state, null);
  }
}

export function createActiveComposerSurface(
  state: AgentChatShellState,
): AgentChatChoiceSurfaceView | null {
  const surfaceKind = state.composer.activeSurface;
  if (!surfaceKind) {
    return null;
  }

  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  const source = runtimeSourceForBinding(binding);
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
        // Tide API Agents / OpenAI API are hidden for now (provider-CLI only).
        // The openai_api binding + runtime still exist; they're just not offered here.
        // Provider-CLI agents are listed; ones whose CLI is not detected on the local
        // system are shown DISABLED (greyed), never removed.
        rows: [
          agentMenuRow("codex", "Codex CLI", binding.agentId),
          agentMenuRow("claude", "Claude Code", binding.agentId),
          agentMenuRow("gemini", "Gemini CLI", binding.agentId),
          agentMenuRow("opencode", "opencode", binding.agentId),
        ],
      };
    case "model_menu":
      return {
        surfaceKind,
        title: "Model",
        sourceLabel: agentLabel,
        rows:
          source.kind === "tide_api"
            ? [
                row("gpt-55-high", "gpt-5.5", "OpenAI Provider Account", undefined, "check", selectedModel === "gpt-5.5"),
              ]
            : binding.agentId === "codex"
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
                  ? [
                      ...cliModelMenuRows("opencode", agentLabel, selectedModel),
                      // Even when opencode is usable, let the user sign in to another
                      // vendor — opens the on-ramp panel in "manage" mode.
                      row("add-vendor", "Add a vendor…", "sign in to another provider", undefined, "plus"),
                    ]
                  : cliModelMenuRows(binding.agentId, agentLabel, selectedModel),
      };
    case "opencode_connect":
      // The rich "Connect a model" panel (Zen card + vendor grid). manageMode = opencode
      // is already usable (opened via "Add a vendor…"), so it offers "back to models".
      return buildOpencodeConnectSurface(isOpencodeUsable());
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
        title: "Worktree",
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
          row("files-images", "Files and images", "Attach an image", undefined, "attach"),
          // Context-attach features are not wired yet — shown disabled, not as
          // silent no-ops. (selected=false, danger=false, disabled=true)
          row("current-selection", "Current file or selection", "coming soon", undefined, "file", false, false, true),
          row("context", "Browser, Diff, Terminal, or FileTree context", "coming soon", undefined, "panel", false, false, true),
        ],
      };
    case "command_suggestions": {
      // Real provider commands/skills for the active cwd+agent (discovered from
      // provider files, injected by the product shell), filtered by what the
      // user has typed after the leading / or $.
      const active = activeComposerTrigger(state.composer.draft);
      const trigger = active?.trigger ?? "/";
      const query = (active?.query ?? "").trim().toLowerCase();
      // The menu mirrors the agent's FULL real command set (the same list the
      // provider CLI itself exposes), on the Start Composer and in a thread alike —
      // no Tide-curated subset. Dedupe by name (some agents, e.g. gemini, report a
      // command once per subcommand). See live-provider-command-mirroring.md.
      const seenCommandNames = new Set<string>();
      const commands = (state.availableCommands ?? []).filter((command) => {
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
        rows:
          commands.length === 0
            ? [row("no-commands", `No ${trigger === "$" ? "skills" : "commands"} found`, "for this directory", agentLabel)]
            : commands.map((command) =>
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

// One provider-CLI agent row: enabled+selectable when its CLI is detected, otherwise
// shown disabled (greyed) — never removed.
function agentMenuRow(
  agentId: string,
  label: string,
  selectedAgentId: string,
): AgentChatChoiceSurfaceRowView {
  const selected = selectedAgentId === agentId;
  const comingSoon = isAgentComingSoon(agentId);
  const available = isAgentAvailable(agentId);
  // An undetected provider reads "Not installed" (it was wrongly "Agent
  // Integration") so the disabled row says WHY it can't be picked.
  const detail = comingSoon ? "Coming soon" : !available ? "Not installed" : "Agent Integration";
  return row(
    agentId,
    label,
    detail,
    undefined,
    selected ? "check" : `identity:${agentId}`,
    selected,
    false,
    comingSoon || !available,
  );
}

function row(
  rowId: string,
  label: string,
  detail?: string,
  meta?: string,
  icon = "",
  selected = false,
  danger = false,
  disabled = false,
): AgentChatChoiceSurfaceRowView {
  return { rowId, label, detail, meta, icon, selected, danger, disabled };
}

function composerAgentIdForRow(
  rowId: string,
): AgentChatAgentId | null {
  switch (rowId) {
    case "codex":
      return "codex";
    case "claude":
      return "claude";
    case "gemini":
      return "gemini";
    case "opencode":
      return "opencode";
    case "openai-api":
      return "openai_api";
    default:
      return null;
  }
}

function modelForRow(
  rowId: string,
  sourceKind: AgentChatAgentRuntimeSource["kind"] = "provider_cli",
): string | undefined {
  // CLI model rows carry their provider-native value as `model:<value>`.
  if (rowId.startsWith("model:")) {
    return rowId.slice("model:".length);
  }
  switch (rowId) {
    case "gpt-55-high":
    case "codex-model":
      return "gpt-5.5";
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

// Codex has no enumerable model list (free-form `--model`); the real tuning knob
// is reasoning effort. Surface the active model plus the three effort levels.
function codexModelMenuRows(
  state: AgentChatShellState,
  selectedModel: string,
): AgentChatChoiceSurfaceRowView[] {
  const reasoning = String(launchOptionsForState(state)?.reasoning ?? "medium");
  const rows: AgentChatChoiceSurfaceRowView[] = [
    row("model-section", "Model", "Codex Agent Integration", "source", "source"),
  ];
  for (const model of CODEX_MODELS) {
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
    ...effortRows(reasoning, ["low", "medium", "high", "xhigh"]),
  );
  return rows;
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

// Real worktrees for the active scope: "current folder" (the main worktree)
// plus any additional git worktrees, then a "new worktree" affordance. Falls
// back to just "current folder" for Scratch / non-git scopes.
function worktreeMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const selected = String(launchOptionsForState(state)?.worktree ?? "current folder");
  const worktrees = state.availableWorktrees ?? [];
  const rows: AgentChatChoiceSurfaceRowView[] = [
    row("worktree:current", "current folder", "main worktree", undefined, "folder", selected === "current folder"),
  ];
  for (const worktree of worktrees.filter((entry) => !entry.current)) {
    const label = worktree.branch ?? basenameOf(worktree.path);
    const entry = row(`worktree:${worktree.path}`, label, worktree.path, undefined, "folder", selected === worktree.path);
    // A trailing trash affordance opens the delete dialog (Desktop adapter
    // special-cases the `delete-worktree:` rowId). See
    // docs_v2/specs/worktree-branch-deletion.md.
    entry.action = { rowId: `delete-worktree:${worktree.path}`, label: `Delete worktree ${label}`, icon: "trash" };
    rows.push(entry);
  }
  // Selecting this opens an inline name input (handled in the Desktop adapter):
  // it creates a git worktree off the current scope and re-scopes the composer.
  rows.push(row("new-worktree", "New worktree", "create a git worktree", undefined, "folder-plus"));
  return rows;
}

// Real git branches (local before remote, current marked); falls back to just
// the current launch value when no git data is available.
function branchMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const selected = String(launchOptionsForState(state)?.branch ?? "main");
  const branches = state.availableBranches ?? [];
  // A branch checked out in a worktree can't be deleted with `git branch -d` (git
  // refuses a branch checked out anywhere), so those get no trash — same for the
  // current branch and remote rows. See branchDeletableFromPicker.
  const worktreeBranches = new Set(
    (state.availableWorktrees ?? [])
      .map((entry) => entry.branch)
      .filter((name): name is string => name !== null),
  );
  const rows: AgentChatChoiceSurfaceRowView[] = [];
  if (branches.length === 0) {
    rows.push(row(`branch:${selected}`, selected, "current", undefined, "check", true));
  } else {
    const ordered = [...branches].sort((a, b) => Number(a.kind === "remote") - Number(b.kind === "remote"));
    for (const branch of ordered) {
      const isSelected = branch.name === selected;
      const entry = row(
        `branch:${branch.name}`,
        branch.name,
        branch.current ? "current" : branch.kind,
        undefined,
        isSelected ? "check" : "branch",
        isSelected,
      );
      // Safe-to-delete only: a trailing trash opens the branch-delete dialog (the
      // Desktop adapter special-cases the `delete-branch:` rowId). See
      // docs_v2/specs/branch-deletion-from-picker.md.
      if (branchDeletableFromPicker(branch, worktreeBranches)) {
        entry.action = { rowId: `delete-branch:${branch.name}`, label: `Delete branch ${branch.name}`, icon: "trash" };
      }
      rows.push(entry);
    }
  }
  // Creating a branch from the Composer isn't wired yet — show it disabled.
  rows.push(row("create-branch", "Create new branch", "new worktree + branch", undefined, "plus"));
  return rows;
}

// A branch is safe to delete from the picker only when git would actually let us:
// it's local (not a remote ref), not the checked-out branch, and not checked out
// in any worktree. See docs_v2/specs/branch-deletion-from-picker.md.
export function branchDeletableFromPicker(
  branch: { name: string; kind: "local" | "remote"; current: boolean },
  worktreeBranches: ReadonlySet<string>,
): boolean {
  return branch.kind === "local" && !branch.current && !worktreeBranches.has(branch.name);
}

export function basenameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
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

function worktreeForRow(rowId: string): string | undefined {
  if (rowId === "worktree:current") {
    return "current folder";
  }
  if (rowId.startsWith("worktree:")) {
    return rowId.slice("worktree:".length);
  }
  // "new-worktree" is a create affordance, wired later.
  return undefined;
}

function branchForRow(rowId: string): string | undefined {
  // "create-branch" is a create affordance, wired later.
  return rowId.startsWith("branch:") ? rowId.slice("branch:".length) : undefined;
}
