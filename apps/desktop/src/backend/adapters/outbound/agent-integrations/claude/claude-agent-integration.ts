import { randomUUID } from "node:crypto";

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

export interface ClaudeProviderState {
  authenticated: boolean;
  onboardingComplete: boolean;
  trustedCwds: string[];
  hookBootstrapReady: boolean;
}

export type ClaudeExecutableResolver = (
  command: "claude" | "npm",
) => Promise<string | undefined> | string | undefined;

export type ClaudeProviderStateReader = (input: {
  cwd: string;
  executablePath: string;
  launchOptions?: Record<string, unknown>;
}) => Promise<ClaudeProviderState> | ClaudeProviderState;

export interface CreateClaudeAgentIntegrationInput {
  resolveExecutable: ClaudeExecutableResolver;
  readProviderState: ClaudeProviderStateReader;
  mcpConfigPath: string;
  settingsPath: string;
  tideContextPrompt: string;
  defaultCwd?: string;
  // Locates the on-disk transcript for a minted session id (infra-injected).
  // The path is NOT computed from the cwd: claude munges its OWN getcwd (the
  // canonical kernel path), which can differ from Tide's spelling via symlinks
  // (/var -> /private/var) or casing — a guessed path silently reads nothing.
  locateSessionFile?: (sessionId: string) => string | undefined;
  // Mints the per-runtime session id passed via `--session-id`, so the thread's
  // session binding is deterministic at launch. Injectable for tests.
  mintSessionId?: () => string;
}

const claudeCapabilities: AgentIntegrationCapabilities = {
  supportsResume: true,
  supportsTideMcp: true,
  supportsHooks: true,
  supportsReadableHistory: true,
  // The stream-json control protocol has no mid-turn input injection — a
  // second user message during a turn queues until the turn ends.
  supportsTurnSteer: false,
};

export function createClaudeAgentIntegration(
  input: CreateClaudeAgentIntegrationInput,
): AgentIntegrationPort {
  return new ClaudeAgentIntegration(input);
}

class ClaudeAgentIntegration implements AgentIntegrationPort {
  private readonly resolveExecutable: ClaudeExecutableResolver;
  private readonly readProviderState: ClaudeProviderStateReader;
  private readonly mcpConfigPath: string;
  private readonly settingsPath: string;
  private readonly tideContextPrompt: string;
  private readonly defaultCwd: string;
  private readonly mintSessionId: () => string;

  constructor(input: CreateClaudeAgentIntegrationInput) {
    this.resolveExecutable = input.resolveExecutable;
    this.readProviderState = input.readProviderState;
    this.mcpConfigPath = input.mcpConfigPath;
    this.settingsPath = input.settingsPath;
    this.tideContextPrompt = input.tideContextPrompt;
    this.defaultCwd = input.defaultCwd ?? ".";
    this.mintSessionId = input.mintSessionId ?? (() => randomUUID());
  }

  async preflight(
    input: AgentIntegrationPreflightInput,
  ): Promise<AgentIntegrationPreflightResult> {
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    const executablePath = await this.resolveExecutable("claude");
    if (executablePath === undefined) {
      const npmPath = (await this.resolveExecutable("npm")) ?? "npm";
      return {
        agentId: "claude",
        ready: false,
        blockers: [
          {
            kind: "not_installed",
            scope: "provider",
            message: "Claude Code executable was not found.",
            terminalAction: npmInstallReadinessTerminalAction({ npmPath, agentId: "claude", cwd }),
          },
        ],
        capabilities: claudeCapabilities,
      };
    }

    const providerState = await this.readProviderState({
      cwd,
      executablePath,
      launchOptions: input.launchOptions,
    });
    const terminalAction = claudeReadinessTerminalAction(executablePath, cwd);
    const blockers: AgentIntegrationReadinessBlocker[] = [];

    if (!providerState.authenticated) {
      blockers.push({
        kind: "not_authenticated",
        scope: "provider",
        message:
          "Claude Code authentication is required before starting a Thread.",
        terminalAction,
      });
    }
    if (!providerState.onboardingComplete) {
      blockers.push({
        kind: "onboarding_required",
        scope: "provider",
        message:
          "Claude Code onboarding must be completed before starting a Thread.",
        terminalAction,
      });
    }
    if (!providerState.trustedCwds.includes(cwd)) {
      blockers.push({
        kind: "directory_trust_required",
        scope: "execution_context",
        message:
          "Claude Code workspace trust is required for this Execution Context.",
        terminalAction,
      });
    }
    if (!providerState.hookBootstrapReady) {
      blockers.push({
        kind: "hook_bootstrap_required",
        scope: "integration",
        message: "Tide Claude Code MCP bootstrap is required.",
        terminalAction,
      });
    }

    if (blockers.length > 0) {
      return {
        agentId: "claude",
        ready: false,
        blockers,
        capabilities: claudeCapabilities,
      };
    }

    return {
      agentId: "claude",
      ready: true,
      blockers: [],
      capabilities: claudeCapabilities,
      launchPlan: this.claudeLaunchPlan({
        executablePath,
        cwd,
        resumeRef: undefined,
        launchOptions: input.launchOptions,
      }),
    };
  }

  async buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("claude")) ?? "claude";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);

    // Mint the session id and pass it via --session-id so this thread's session
    // binding is deterministic at launch (transcript path is known before the
    // first poll) — never discovered by file recency.
    const sessionId = this.mintSessionId();
    return this.claudeLaunchPlan({
      executablePath,
      cwd,
      resumeRef: undefined,
      launchOptions: input.launchOptions,
      initialPrompt: input.initialPrompt,
      sessionId,
    });
  }

  async buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("claude")) ?? "claude";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);

    return this.claudeLaunchPlan({
      executablePath,
      cwd,
      resumeRef: input.providerSessionRef.value,
      launchOptions: input.launchOptions,
    });
  }

  // Mid-thread Launch Options change. Model + permission apply LIVE through the
  // stream-json control protocol (set_model / set_permission_mode — the Agent
  // SDK path, verified in claude 2.1.173). Effort is `--effort` argv only, and
  // the "Claude default" model sentinel has no live "unset" — both restart the
  // runtime (claude --resume keeps the conversation).
  buildSessionConfigUpdate(input: SessionConfigUpdateInput): SessionConfigUpdatePlan {
    const params: Record<string, unknown> = {};
    for (const key of input.changedKeys) {
      if (key === "model") {
        const model = stringValue(input.launchOptions.model);
        if (model === undefined || model === "Claude default") {
          return { kind: "restart" };
        }
        params.model = model;
        continue;
      }
      if (key === "permission") {
        const permission = stringValue(input.launchOptions.permission);
        if (permission === undefined || !CLAUDE_PERMISSION_MODES.has(permission)) {
          return { kind: "restart" };
        }
        params.permissionMode = permission;
        continue;
      }
      return { kind: "restart" };
    }
    return { kind: "live", protocolParams: params };
  }

  private claudeLaunchPlan(input: {
    executablePath: string;
    cwd: string;
    resumeRef?: string;
    launchOptions?: Record<string, unknown>;
    initialPrompt?: string;
    sessionId?: string;
  }): ProviderLaunchPlan {
    // STRUCTURED TRANSPORT: the stream-json control protocol over plain stdio —
    // no PTY, no TUI. Evidence-based (live transcripts, claude 2.1.170;
    // the official Agent SDK passes exactly these flags):
    // - --permission-prompt-tool stdio is REQUIRED for can_use_tool permission
    //   requests to arrive; without it tools are silently auto-blocked.
    // - --verbose is required for stream-json output in --print mode.
    // - the workspace-trust dialog does not exist in non-TTY mode by design
    //   (claude --help): Tide's own trust flow remains the gate.
    // - the first user message is written to stdin AFTER the init message by the
    //   structured client (replaces PTY startup delays and readiness gates).
    const args = [
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      // Stream partial message deltas so Tide can render the answer
      // token-by-token (the structured client coalesces them into live updates).
      "--include-partial-messages",
      "--permission-prompt-tool",
      "stdio",
      // Grant the bypass-permissions CAPABILITY (not the mode) up front so the
      // user's mid-thread switch to "Bypass permissions" applies LIVE via the
      // set_permission_mode control request — exactly like the official app's
      // ⇧⌘M. This is the CLI projection of the SDK's `allowDangerouslySkipPermissions`
      // option, and is DECOUPLED from --dangerously-skip-permissions (which would
      // FORCE the start mode to bypassPermissions). The session still starts in
      // whatever --permission-mode says and stays there until the user explicitly
      // picks Bypass (no auto-escalation); org policy (disableBypassPermissionsMode)
      // still wins. Evidence (claude 2.1.179, stdin probe): without this flag a live
      // `set_permission_mode bypassPermissions` is refused with "the session was not
      // launched with --dangerously-skip-permissions"; with it, the live switch
      // succeeds while the start mode is preserved. See
      // docs_v2/specs/claude-bypass-live-capability.md.
      "--allow-dangerously-skip-permissions",
      "--mcp-config",
      this.mcpConfigPath,
      "--settings",
      this.settingsPath,
      "--append-system-prompt",
      this.tideContextPrompt,
      ...claudeLaunchOptionArgs(input.launchOptions),
    ];

    if (input.resumeRef !== undefined) {
      args.push("--resume", input.resumeRef);
    }
    if (input.sessionId !== undefined) {
      args.push("--session-id", input.sessionId);
    }

    return {
      command: input.executablePath,
      args,
      env: {},
      cwd: input.cwd,
      transport: "claude_stream_json",
      ...(input.sessionId !== undefined
        ? {
            providerSessionRef: {
              agentId: "claude" as const,
              kind: "claude_transcript" as const,
              value: input.sessionId,
              // The on-disk transcript path is resolved by the history connector
              // (by session id) once claude creates the file, and confirmed by the
              // hook payload's transcript_path.
            },
          }
        : {}),
    };
  }
}

function claudeReadinessTerminalAction(
  executablePath: string,
  cwd: string,
): ProviderReadinessTerminalAction {
  return {
    command: executablePath,
    args: [],
    cwd,
    expectedCompletion: "retry_preflight",
  };
}

function cwdFromScope(scope: ThreadScope | undefined, fallback: string): string {
  if (scope === undefined) {
    return fallback;
  }
  return scope.kind === "project" ? scope.cwd : scope.scratchCwd;
}

// The values `--permission-mode` (and the set_permission_mode control request)
// accept — claude's own mode names.
const CLAUDE_PERMISSION_MODES: ReadonlySet<string> = new Set([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "default",
  "dontAsk",
  "plan",
]);

function claudeLaunchOptionArgs(
  launchOptions: Record<string, unknown> | undefined,
): string[] {
  const args: string[] = [];
  const model = stringValue(launchOptions?.model);
  if (model !== undefined && model !== "Claude default") {
    args.push("--model", model);
  }

  const permission = stringValue(launchOptions?.permission);
  if (permission !== undefined && CLAUDE_PERMISSION_MODES.has(permission)) {
    args.push("--permission-mode", permission);
  }

  // Thinking effort (the Claude Code app's "Effort" control) maps to `--effort`.
  const effort = stringValue(launchOptions?.reasoning);
  if (
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh" ||
    effort === "max"
  ) {
    args.push("--effort", effort);
  }

  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Relocated from live-backend (audit A5): claude-specific MCP-tool context
// prompt belongs to the claude adapter.
// Claude Code (the claude provider) defers MCP tools and discovers them via
// ToolSearch. A vague prompt made it search for bare names like "tide_open_browser"
// — which don't match the real "mcp__tide__*" names — so it stalled before ever
// opening a Browser Pane. Name the tools exactly and tell it to call them directly.
export function tideClaudeContextPrompt(): string {
  return [
    "You are running inside Tide, a terminal workspace. Tide exposes real, callable MCP",
    'tools (MCP server name "tide") that control the Tide UI. Their exact names are:',
    "- mcp__tide__tide_open_browser — open/navigate a Tide Browser Pane (args: url, title, disposition)",
    "- mcp__tide__tide_observe_browser — read a Browser Pane's content (args: paneId, revision)",
    "- mcp__tide__tide_act_browser — click, drag, scroll, press keys, or type in a Browser Pane (args: paneId, revision, action, selector/text/x/y/toX/toY/deltaX/deltaY/keys)",
    "- mcp__tide__tide_observe_thread / mcp__tide__tide_observe_workbench — read current Thread/Workbench state",
    "- mcp__tide__tide_open_terminal / mcp__tide__tide_run_terminal_command — Terminal Pane",
    "- mcp__tide__tide_read_file / mcp__tide__tide_open_file / mcp__tide__tide_edit_file — files with Editor/Diff Panes",
    "",
    "When the user asks to open, show, browse, or navigate a URL/page/file/Tide surface, call",
    "the matching mcp__tide__ tool DIRECTLY — do not fall back to shell. If these tools appear",
    'as deferred, load them by their exact name (e.g. ToolSearch "select:mcp__tide__tide_open_browser")',
    "and then call them. Open a Browser Pane with mcp__tide__tide_open_browser first, then use",
    "mcp__tide__tide_observe_browser and mcp__tide__tide_act_browser to read and act on it.",
  ].join("\n");
}
