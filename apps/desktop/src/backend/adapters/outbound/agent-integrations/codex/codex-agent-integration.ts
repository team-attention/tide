import type {
  AgentIntegrationCapabilities,
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentIntegrationReadinessBlocker,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderLaunchPlan,
  ProviderReadinessTerminalAction,
  SessionConfigUpdateInput,
  SessionConfigUpdatePlan,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import type {
  ThreadScope,
} from "../../../../application/domains/thread/thread.ts";
import { npmInstallReadinessTerminalAction } from "../shared/provider-cli-commands.ts";

export interface CodexProviderState {
  authenticated: boolean;
  onboardingComplete: boolean;
  trustedCwds: string[];
  hookBootstrapReady: boolean;
  codexHome?: string;
}

export type CodexExecutableResolver = (
  command: "codex" | "npm",
) => Promise<string | undefined> | string | undefined;

export type CodexProviderStateReader = (input: {
  cwd: string;
  executablePath: string;
  launchOptions?: Record<string, unknown>;
}) => Promise<CodexProviderState> | CodexProviderState;

export type CodexWorkspaceWritableRootsResolver = (input: {
  cwd: string;
  launchOptions?: Record<string, unknown>;
}) => Promise<string[]> | string[];

export interface CodexTideMcpConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface CreateCodexAgentIntegrationInput {
  resolveExecutable: CodexExecutableResolver;
  readProviderState: CodexProviderStateReader;
  resolveWorkspaceWritableRoots?: CodexWorkspaceWritableRootsResolver;
  tideMcp?: CodexTideMcpConfig;
  defaultCwd?: string;
}

const codexCapabilities: AgentIntegrationCapabilities = {
  supportsResume: true,
  supportsTideMcp: true,
  supportsHooks: true,
  supportsReadableHistory: true,
  // codex app-server exposes turn/steer — new input is injected into the active
  // turn (expectedTurnId precondition) instead of queued until it ends.
  supportsTurnSteer: true,
};

export function createCodexAgentIntegration(
  input: CreateCodexAgentIntegrationInput,
): AgentIntegrationPort {
  return new CodexAgentIntegration(input);
}

class CodexAgentIntegration implements AgentIntegrationPort {
  private readonly resolveExecutable: CodexExecutableResolver;
  private readonly readProviderState: CodexProviderStateReader;
  private readonly resolveWorkspaceWritableRoots?: CodexWorkspaceWritableRootsResolver;
  private readonly tideMcp?: CodexTideMcpConfig;
  private readonly defaultCwd: string;

  constructor(input: CreateCodexAgentIntegrationInput) {
    this.resolveExecutable = input.resolveExecutable;
    this.readProviderState = input.readProviderState;
    this.resolveWorkspaceWritableRoots = input.resolveWorkspaceWritableRoots;
    this.tideMcp = cloneTideMcpConfig(input.tideMcp);
    this.defaultCwd = input.defaultCwd ?? ".";
  }

  async preflight(
    input: AgentIntegrationPreflightInput,
  ): Promise<AgentIntegrationPreflightResult> {
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    const executablePath = await this.resolveExecutable("codex");
    if (executablePath === undefined) {
      const npmPath = (await this.resolveExecutable("npm")) ?? "npm";
      return {
        agentId: "codex",
        ready: false,
        blockers: [
          {
            kind: "not_installed",
            scope: "provider",
            message: "Codex CLI executable was not found.",
            terminalAction: npmInstallReadinessTerminalAction({ npmPath, agentId: "codex", cwd }),
          },
        ],
        capabilities: codexCapabilities,
      };
    }

    const providerState = await this.readProviderState({
      cwd,
      executablePath,
      launchOptions: input.launchOptions,
    });
    const terminalAction = codexReadinessTerminalAction(executablePath, cwd);
    const hookTerminalAction = codexReadinessTerminalAction(executablePath, cwd);
    const blockers: AgentIntegrationReadinessBlocker[] = [];

    if (!providerState.authenticated) {
      blockers.push({
        kind: "not_authenticated" as const,
        scope: "provider" as const,
        message: "Codex authentication is required before starting a Thread.",
        terminalAction,
      });
    }
    if (!providerState.onboardingComplete) {
      blockers.push({
        kind: "onboarding_required" as const,
        scope: "provider" as const,
        message: "Codex onboarding must be completed before starting a Thread.",
        terminalAction,
      });
    }
    if (!providerState.trustedCwds.includes(cwd)) {
      blockers.push({
        kind: "directory_trust_required" as const,
        scope: "execution_context" as const,
        message: "Codex Directory Trust is required for this Execution Context.",
        terminalAction,
      });
    }
    if (!providerState.hookBootstrapReady) {
      blockers.push({
        kind: "hook_bootstrap_required" as const,
        scope: "integration" as const,
        message: "Tide Codex MCP bootstrap is required.",
        terminalAction: hookTerminalAction,
      });
    }

    if (blockers.length > 0) {
      return {
        agentId: "codex",
        ready: false,
        blockers,
        capabilities: codexCapabilities,
      };
    }

    return {
      agentId: "codex",
      ready: true,
      blockers: [],
      capabilities: codexCapabilities,
    };
  }

  async buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("codex")) ?? "codex";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);

    return await this.codexLaunchPlan({
      executablePath,
      cwd,
      resumeRef: undefined,
      launchOptions: input.launchOptions,
      initialPrompt: input.initialPrompt,
      runtimeId: input.runtimeId,
    });
  }

  async buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("codex")) ?? "codex";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);

    return await this.codexLaunchPlan({
      executablePath,
      cwd,
      resumeRef: input.providerSessionRef.value,
      launchOptions: input.launchOptions,
      runtimeId: input.runtimeId,
    });
  }

  // Mid-thread Launch Options change. Model + reasoning effort apply LIVE as
  // turn/start overrides ("for this turn and subsequent turns", codex-cli 0.136
  // bindings). A permission change maps to sandbox + approvalPolicy; the
  // per-turn `sandboxPolicy` is a structured object Tide cannot safely
  // construct, so it restarts instead — thread/resume accepts the same simple
  // sandbox/approvalPolicy values the start path already maps.
  buildSessionConfigUpdate(input: SessionConfigUpdateInput): SessionConfigUpdatePlan {
    const params: Record<string, unknown> = {};
    for (const key of input.changedKeys) {
      if (key === "model") {
        const model = stringValue(input.launchOptions.model);
        if (model === undefined) {
          return { kind: "restart" };
        }
        params.model = model;
        continue;
      }
      if (key === "reasoning") {
        const reasoning = stringValue(input.launchOptions.reasoning);
        if (
          reasoning !== "low" &&
          reasoning !== "medium" &&
          reasoning !== "high" &&
          reasoning !== "xhigh"
        ) {
          return { kind: "restart" };
        }
        params.effort = reasoning;
        continue;
      }
      return { kind: "restart" };
    }
    return { kind: "live", protocolParams: params };
  }

  private async codexLaunchPlan(input: {
    executablePath: string;
    cwd: string;
    resumeRef?: string;
    launchOptions?: Record<string, unknown>;
    initialPrompt?: string;
    runtimeId?: string;
  }): Promise<ProviderLaunchPlan> {
    // codex spawns its MCP server with ONLY the config-declared env (it does not
    // inherit codex's own process env, unlike claude). So the Tide MCP bridge's
    // session identity (TIDE_RUNTIME_ID/TIDE_AGENT_ID) MUST be embedded in the
    // codex MCP server config env here, or every Tide tool call fails session
    // resolution and codex hangs "Working" with no result.
    const tideMcp =
      this.tideMcp === undefined || input.runtimeId === undefined
        ? this.tideMcp
        : {
            ...this.tideMcp,
            env: {
              ...this.tideMcp.env,
              TIDE_RUNTIME_ID: input.runtimeId,
              TIDE_AGENT_ID: "codex",
            },
          };
    const env: Record<string, string> = {};
    const workspaceWritableRoots = await this.codexWorkspaceWritableRoots(input.cwd, input.launchOptions);
    // STRUCTURED TRANSPORT: the app-server protocol over plain stdio — the same
    // protocol the Codex IDE extension speaks. Session parameters (cwd,
    // approvalPolicy, sandbox, model, reasoning effort) ride thread/start via
    // protocolParams; Tide MCP config rides `-c` overrides (verified: app-server
    // accepts the global -c flag). No TUI: no hook-trust box, no startup delays.
    // Approvals arrive as server-initiated JSON-RPC requests and the model does
    // not proceed until the decision result is written back.
    const reasoning = stringValue(input.launchOptions?.reasoning);
    const args = [
      "app-server",
      ...(reasoning === "low" || reasoning === "medium" || reasoning === "high" || reasoning === "xhigh"
        ? ["-c", `model_reasoning_effort=${codexConfigString(reasoning)}`]
        : []),
      ...codexPermissionConfigArgs(input.launchOptions, workspaceWritableRoots),
      ...codexConfigArgs(tideMcp),
    ];

    return {
      command: input.executablePath,
      args,
      env,
      cwd: input.cwd,
      transport: "codex_app_server",
      protocolParams: codexThreadStartParams(input.launchOptions),
    };
  }

  private async codexWorkspaceWritableRoots(
    cwd: string,
    launchOptions: Record<string, unknown> | undefined,
  ): Promise<string[]> {
    if (this.resolveWorkspaceWritableRoots === undefined) {
      return [];
    }
    try {
      return dedupeStrings(
        (await this.resolveWorkspaceWritableRoots({ cwd, launchOptions }))
          .filter((root) => root.length > 0),
      );
    } catch {
      return [];
    }
  }
}

// Maps a parsed codex TUI approval/choice box into a normalized PromptState. Each
// option becomes a choice whose providerValue is a codex-menu navigation token
// (`codex-menu:<steps>`, signed offset from the cursor's default row) that the runtime
// port replays as ArrowDown/ArrowUp + Enter. defaultChoiceId is the cursor option, so
// v2 highlights codex's own default. promptId is the content signature so the same box
// re-rendered across PTY chunks dedupes to one surfaced prompt.

function codexReadinessTerminalAction(
  executablePath: string,
  cwd: string,
): ProviderReadinessTerminalAction {
  return {
    command: executablePath,
    args: ["--no-alt-screen"],
    cwd,
    expectedCompletion: "retry_preflight",
  };
}

function codexConfigArgs(tideMcp: CodexTideMcpConfig | undefined): string[] {
  const config = [
    // Stream the model's reasoning summary so Tide can show codex's thinking
    // (without this, reasoning items arrive empty — verified live).
    "model_reasoning_summary=detailed",
  ];

  if (tideMcp !== undefined) {
    config.push(`mcp_servers.tide.command=${codexConfigString(tideMcp.command)}`);
    config.push(
      `mcp_servers.tide.args=[${tideMcp.args.map(codexConfigString).join(",")}]`,
    );
    // Tide's own MCP tools are first-party and trusted (we inject this server), so
    // auto-approve all of them — no per-tool permission prompt. Other (user/3rd-party)
    // MCP servers keep codex's native approval flow, so behavior matches using codex
    // in a plain terminal. See agent-turn-handoff-readiness.md.
    config.push(`mcp_servers.tide.default_tools_approval_mode=${codexConfigString("approve")}`);
    for (const [key, value] of Object.entries(tideMcp.env ?? {}).sort()) {
      config.push(
        `mcp_servers.tide.env.${key}=${codexConfigString(value)}`,
      );
    }
  }

  return config.flatMap((entry) => ["-c", entry]);
}

function codexConfigString(value: string): string {
  return JSON.stringify(value);
}

function codexPermissionConfigArgs(
  launchOptions: Record<string, unknown> | undefined,
  workspaceWritableRoots: string[],
): string[] {
  const permission = stringValue(launchOptions?.permission);
  const config: string[] = [];
  if (codexPermissionUsesWorkspaceNetwork(permission)) {
    config.push("sandbox_workspace_write.network_access=true");
  }
  if (codexPermissionUsesWorkspaceSandbox(permission) && workspaceWritableRoots.length > 0) {
    config.push(
      `sandbox_workspace_write.writable_roots=[${workspaceWritableRoots.map(codexConfigString).join(",")}]`,
    );
  }
  return config.flatMap((entry) => ["-c", entry]);
}

function codexPermissionUsesWorkspaceNetwork(permission: string | undefined): boolean {
  return codexPermissionUsesWorkspaceSandbox(permission);
}

function codexPermissionUsesWorkspaceSandbox(permission: string | undefined): boolean {
  return (
    // Friendly "Ask for approval" expands to workspace-write + on-request in
    // thread/start. Codex's workspace sandbox defaults network_access to false,
    // so carry the same network override as legacy workspace modes or internet
    // tools/MCP connectors fail as policy-denied DNS/network errors.
    permission === "ask-for-approval" ||
    // Raw values persisted by older threads are normalized by the UI; preserve
    // compatible launch behavior in the provider plan too.
    permission === "workspace-write" ||
    permission === "on-failure"
  );
}

export const CODEX_GRANULAR_APPROVAL_POLICY: Record<string, unknown> = Object.freeze({
  granular: Object.freeze({
    sandbox_approval: true,
    rules: true,
    skill_approval: true,
    request_permissions: true,
    mcp_elicitations: true,
  }),
});

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

// thread/start parameters for the app-server transport: the SAME approval/
// sandbox expansion the TUI flags used, expressed as protocol values
// (bindings: ThreadStartParams.approvalPolicy / sandbox / model).
function codexThreadStartParams(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> {
  // Codex app-server supports thread-level developerInstructions, which is the
  // structured equivalent of Claude's Tide append-system-prompt context.
  const params: Record<string, unknown> = {
    developerInstructions: tideCodexContextPrompt(),
  };
  const model = stringValue(launchOptions?.model);
  if (model !== undefined) {
    params.model = model;
  }
  const permission = stringValue(launchOptions?.permission);
  if (permission === "ask-for-approval") {
    params.sandbox = "workspace-write";
    params.approvalPolicy = "on-request";
  } else if (permission === "approve-for-me") {
    // Codex's macOS seatbelt workspace sandbox denies GUI process registration
    // with LaunchServices/WindowServer, which makes Electron abort before app JS
    // starts. Tide's automatic mode should match the user's terminal process
    // environment while keeping Codex's granular approval policy distinct from
    // the explicit "Full access" mode's never-ask behavior. Codex app-server
    // 0.144 replaced the previous `on-failure` policy with `granular`.
    params.sandbox = "danger-full-access";
    params.approvalPolicy = CODEX_GRANULAR_APPROVAL_POLICY;
  } else if (permission === "full-access" || permission === "dangerously-bypass-approvals-and-sandbox") {
    params.sandbox = "danger-full-access";
    params.approvalPolicy = "never";
  } else if (
    permission === "read-only" ||
    permission === "workspace-write" ||
    permission === "danger-full-access"
  ) {
    params.sandbox = permission;
  } else if (
    permission === "untrusted" ||
    permission === "on-request" ||
    permission === "never"
  ) {
    params.approvalPolicy = permission;
  } else if (permission === "on-failure") {
    // Legacy raw value persisted by older Tide/Codex sessions.
    params.approvalPolicy = CODEX_GRANULAR_APPROVAL_POLICY;
  }
  return params;
}

export function tideCodexContextPrompt(): string {
  return [
    "You are running inside Tide. Tide exposes first-party MCP tools that control",
    "Tide-owned UI panes, including the Browser Pane. Prefer these tools for",
    "opening, observing, and operating pages inside Tide instead of shell commands,",
    "external browsers, or separate browser runtimes.",
    "",
    "Browser work inside Tide should use this loop:",
    "- mcp__tide__tide_open_browser opens or navigates a Tide Browser Pane.",
    "- mcp__tide__tide_observe_browser reads the current pane; use it before acting.",
    "- mcp__tide__tide_act_browser clicks, types, drags, scrolls, or presses keys.",
    "- Re-observe after actions when the next decision depends on page state.",
    "",
    "Use tide_observe_browser mode=both unless you only need text. Its image is the",
    "rendered page and its interactiveElements list is the preferred source for",
    "click_element. For visual-only controls, use screenshot coordinates with",
    "click_at, drag, scroll, key, or type. Coordinates come from the latest",
    "observe image; pass the current pane revision to actions, and re-observe if a",
    "revision is stale.",
    "",
    "The Tide Browser Pane may be hosted in the background even when no side panel is",
    "visibly open. Treat that as a live browser surface: observe it, act on it, and",
    "avoid reopening pages just because the pane is not visible.",
  ].join("\n");
}

function cwdFromScope(scope: ThreadScope | undefined, fallback: string): string {
  if (scope === undefined) {
    return fallback;
  }
  return scope.kind === "project" ? scope.cwd : scope.scratchCwd;
}

function cloneTideMcpConfig(
  input: CodexTideMcpConfig | undefined,
): CodexTideMcpConfig | undefined {
  if (input === undefined) {
    return undefined;
  }
  return {
    command: input.command,
    args: [...input.args],
    env: input.env === undefined ? undefined : { ...input.env },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
