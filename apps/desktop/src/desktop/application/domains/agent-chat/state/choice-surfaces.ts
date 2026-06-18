import type { AgentChatAgentId, AgentChatAgentRuntimeSource, AgentChatChoiceSurfaceRowView, AgentChatChoiceSurfaceView, AgentChatProjectOption, AgentChatShellState, AgentChatShellUpdateResult, AgentChatThreadScope, AgentChatWorktreeOption } from "./types.ts";
import { activeComposerTrigger, providerSetupCommandPayload, selectComposerAgent, setComposerActiveSurface } from "./composer.ts";
import { CODEX_MODELS, PERMISSION_OPTIONS, REASONING_LEVELS, cliModelOptionsForAgent, defaultModelValueForAgent, defaultPermissionForAgent, formatAgentLabel, isAgentAvailable, isAgentAvailabilityKnown, isAgentComingSoon, normalizePermissionValue, permissionConfigForAgent, runtimeSourceForBinding } from "./agent-vocab.ts";
import { launchOptionsForState, setComposerNewWorktreeIntent, updateComposerLaunchOptions, updateComposerScope } from "./launch-options.ts";
import { buildOpencodeConnectSurface, getOpencodeEnvironment, isOpencodeUsable } from "./opencode-onramp.ts";
import { basenameOf } from "./path-labels.ts";
import { row } from "./choice-row.ts";
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
    // The non-blocking update nudge: run the in-place CLI update through the same
    // Provider Setup Surface terminal handoff used for install (npm install -g
    // <pkg>@latest, retry_preflight). Spec: version-management.md (Lane 2).
    if (rowId === "update_available:setup") {
      const setup = state.providerReadiness?.update?.setup;
      const threadId = state.thread?.threadId ?? activeThreadId;
      if (setup === undefined || threadId === undefined) {
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
              blockerKind: "update_available",
              setup: providerSetupCommandPayload(setup),
            },
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
      // Coming-soon / unknown rows are no-ops. A not-installed agent IS selectable now:
      // the handler ensures a Draft Thread + runs provider.checkReadiness so its install /
      // sign-in card surfaces immediately. Spec: provider-cli-setup-handoff.md.
      if (agentId === null || isAgentComingSoon(agentId)) {
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

// One provider-CLI agent row: always selectable (so a not-installed agent can be picked to
// start its install / sign-in handoff), labelled "Not installed" until its CLI is detected.
// Only coming-soon rows are disabled. Never removed.
function agentMenuRow(
  agentId: string,
  label: string,
  selectedAgentId: string,
): AgentChatChoiceSurfaceRowView {
  const selected = selectedAgentId === agentId;
  const comingSoon = isAgentComingSoon(agentId);
  const available = isAgentAvailable(agentId);
  const known = isAgentAvailabilityKnown();
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

// Execution environment options for a selected branch. Keep this menu to the three
// start modes users can act on: local folder, create a new worktree branch, or use
// the existing worktree bound to the selected branch when one exists.
function worktreeMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const selected = String(launchOptionsForState(state)?.worktree ?? "current folder");
  const worktrees = state.availableWorktrees ?? [];
  const selectedBranch = String(
    launchOptionsForState(state)?.branch ??
      defaultBranchName(state.availableBranches ?? [], "main"),
  );
  const currentWorktree = worktrees.find((entry) => entry.current);
  const currentSelected = selected === "current folder" || selected === currentWorktree?.path || worktrees.length === 0;
  const existing = worktreeForBranch(worktrees, selectedBranch);
  const existingIsLocal = existing !== undefined && (existing.current || existing.path === currentWorktree?.path);
  const existingRow = existing !== undefined && !existingIsLocal
    ? row(
        `worktree:${existing.path}`,
        "Existing worktree",
        existing.branch ?? basenameOf(existing.path),
        undefined,
        "folder",
        selected === existing.path,
      )
    : row(
        "worktree:existing-unavailable",
        "Existing worktree",
        `No directory for ${selectedBranch}`,
        undefined,
        "folder",
        false,
        false,
        true,
      );
  const rows: AgentChatChoiceSurfaceRowView[] = [
    row(
      "worktree:current",
      "Local",
      "current folder",
      undefined,
      "folder",
      currentSelected,
    ),
    row(
      "new-worktree",
      "New worktree",
      `from ${selectedBranch}`,
      undefined,
      "plus",
      selected === "new",
    ),
    existingRow,
  ];
  return rows;
}

// Real git branches with the creation affordance and the default branch pinned at
// the top. Branch rows intentionally avoid management actions and noisy local/remote
// metadata; this menu only chooses the base branch for the thread.
function branchMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const selected = String(launchOptionsForState(state)?.branch ?? "main");
  const branches = state.availableBranches ?? [];
  const defaultBranch = defaultBranchName(branches, selected);
  const rows: AgentChatChoiceSurfaceRowView[] = [
    row(
      "create-branch",
      "New branch",
      `from ${selected}`,
      undefined,
      "plus",
      launchOptionsForState(state)?.worktree === "new",
    ),
    row(
      `branch:${defaultBranch}`,
      "Home",
      defaultBranch,
      undefined,
      selected === defaultBranch ? "check" : "branch",
      selected === defaultBranch,
    ),
  ];
  const ordered = branchRowsAfterPinned(branches, selected, defaultBranch);
  if (!branches.some((branch) => branch.name === selected) && selected !== defaultBranch) {
    rows.push(row(`branch:${selected}`, selected, undefined, undefined, "check", true));
  }
  for (const branch of ordered) {
    const isSelected = branch.name === selected;
    rows.push(
      row(
        `branch:${branch.name}`,
        branch.name,
        undefined,
        undefined,
        isSelected ? "check" : "branch",
        isSelected,
      ),
    );
  }
  return rows;
}

function defaultBranchName(
  branches: Array<{ name: string; kind: "local" | "remote"; current: boolean }>,
  fallback: string,
): string {
  for (const candidate of ["main", "master", "trunk"]) {
    if (branches.some((branch) => branch.name === candidate)) {
      return candidate;
    }
  }
  const current = branches.find((branch) => branch.current && branch.kind === "local");
  return current?.name ?? fallback;
}

function branchRowsAfterPinned(
  branches: Array<{ name: string; kind: "local" | "remote"; current: boolean }>,
  selected: string,
  defaultBranch: string,
): Array<{ name: string; kind: "local" | "remote"; current: boolean }> {
  return [...branches]
    .filter((branch) => branch.name !== defaultBranch)
    .sort((a, b) => {
      if (a.name === selected) return -1;
      if (b.name === selected) return 1;
      const kind = Number(a.kind === "remote") - Number(b.kind === "remote");
      return kind !== 0 ? kind : a.name.localeCompare(b.name);
    });
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

function worktreeForBranch(
  worktrees: AgentChatWorktreeOption[],
  branch: string,
): AgentChatWorktreeOption | undefined {
  return worktrees.find((entry) => entry.branch === branch);
}

function currentProjectId(state: AgentChatShellState): string | null {
  const scope = state.thread?.scope ?? state.composer.startOptions.scope;
  return scope?.kind === "project" ? scope.projectId : null;
}

function branchForRow(rowId: string): string | undefined {
  // "create-branch" is a create affordance, wired later.
  return rowId.startsWith("branch:") ? rowId.slice("branch:".length) : undefined;
}
