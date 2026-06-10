import { randomUUID } from "node:crypto";

import type {
  AgentTurnOutcome,
  AgentIntegrationCapabilities,
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentIntegrationReadinessBlocker,
  AgentPromptSignalInput,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderHistoryConnector,
  ProviderLaunchPlan,
  ProviderSetupSurfaceAction,
  ProviderSignalSource,
  RuntimeReadinessGate,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import type {
  PromptChoice,
  PromptKind,
  PromptState,
  ThreadScope,
} from "../../../../application/domains/thread/thread.ts";
import {
  codexApprovalPromptSignature,
  encodeCodexMenuNavigation,
  parseCodexApprovalPrompt,
  PTY_CANCEL_TOKEN,
} from "../../../../application/services/provider-tui-parsers.ts";
import {
  claudeProjectDirName,
  createClaudeHistoryConnector,
} from "./claude-history-connector.ts";

export interface ClaudeProviderState {
  authenticated: boolean;
  onboardingComplete: boolean;
  trustedCwds: string[];
  hookBootstrapReady: boolean;
}

export type ClaudeExecutableResolver = (
  command: "claude",
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
  // Used to compute the plan-time transcript path for a minted session id
  // (~/.claude/projects/<munged-cwd>/<session-id>.jsonl).
  homeDir?: string;
  // Mints the per-runtime session id passed via `--session-id`, so the thread's
  // session binding is deterministic at launch. Injectable for tests.
  mintSessionId?: () => string;
}

const claudeCapabilities: AgentIntegrationCapabilities = {
  supportsHiddenPty: true,
  supportsResume: true,
  supportsTideMcp: true,
  supportsHooks: true,
  supportsReadableHistory: true,
  requiresTerminalKeyProtocol: true,
};

const expectedSignalSources: ProviderSignalSource[] = [
  {
    kind: "pty_transcript",
    description: "Captured hidden PTY input and output.",
  },
  {
    kind: "provider_hook",
    description:
      "Claude UserPromptSubmit, PermissionRequest, PreToolUse, Elicitation, Notification, and Stop hooks.",
  },
  {
    kind: "provider_history",
    description: "Claude transcript JSONL under provider-owned project history.",
  },
  {
    kind: "tide_mcp",
    description: "Tide MCP Tool Surface attached to the same Claude session.",
  },
];

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
  private readonly homeDir: string | undefined;
  private readonly mintSessionId: () => string;
  private readonly historyConnector = createClaudeHistoryConnector();

  constructor(input: CreateClaudeAgentIntegrationInput) {
    this.resolveExecutable = input.resolveExecutable;
    this.readProviderState = input.readProviderState;
    this.mcpConfigPath = input.mcpConfigPath;
    this.settingsPath = input.settingsPath;
    this.tideContextPrompt = input.tideContextPrompt;
    this.defaultCwd = input.defaultCwd ?? ".";
    this.homeDir = input.homeDir;
    this.mintSessionId = input.mintSessionId ?? (() => randomUUID());
  }

  async preflight(
    input: AgentIntegrationPreflightInput,
  ): Promise<AgentIntegrationPreflightResult> {
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    const executablePath = await this.resolveExecutable("claude");
    if (executablePath === undefined) {
      return {
        agentId: "claude",
        ready: false,
        blockers: [
          {
            kind: "not_installed",
            scope: "provider",
            message: "Claude Code executable was not found.",
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
    const setup = claudeSetupAction(executablePath, cwd);
    const blockers: AgentIntegrationReadinessBlocker[] = [];

    if (!providerState.authenticated) {
      blockers.push({
        kind: "not_authenticated",
        scope: "provider",
        message:
          "Claude Code authentication is required before starting a Thread.",
        setup,
      });
    }
    if (!providerState.onboardingComplete) {
      blockers.push({
        kind: "onboarding_required",
        scope: "provider",
        message:
          "Claude Code onboarding must be completed before starting a Thread.",
        setup,
      });
    }
    if (!providerState.trustedCwds.includes(cwd)) {
      blockers.push({
        kind: "directory_trust_required",
        scope: "execution_context",
        message:
          "Claude Code workspace trust is required for this Execution Context.",
        setup,
      });
    }
    if (!providerState.hookBootstrapReady) {
      blockers.push({
        kind: "hook_bootstrap_required",
        scope: "integration",
        message: "Tide Claude Code hook/bootstrap setup is required.",
        setup,
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

  initialTurnReadiness(): RuntimeReadinessGate {
    // Claude registers MCP tools before running the turn and reliably accepts the
    // first prompt at launch (positional argv), so it does not need the gated
    // post-launch handoff that codex requires.
    return { kind: "immediate" };
  }

  turnEndFromHook(eventName: string, _payload: unknown): AgentTurnOutcome | null {
    // Claude's turn-end is the runtime-keyed `agent-idle` Stop hook: ONLY a signal to
    // settle the turn — it carries no content. Empirically the transcript receives the
    // assistant answer ~0.3s BEFORE this hook fires, so the history reader is the SOLE
    // content source and renders every segment (intro text, tools, the reply). Returning
    // an empty outcome settles the turn without producing a second copy of the answer —
    // which is why there is no answer dedup anywhere. (We intentionally do NOT read
    // last_assistant_message here; doing so created the duplicate this design removes.)
    if (eventName !== "agent-idle") {
      return null;
    }
    return {};
  }

  history(): ProviderHistoryConnector {
    return this.historyConnector;
  }

  turnEndFromHistory(): AgentTurnOutcome | null {
    // Claude's settle signal is the agent-idle hook (above); the transcript supplies the
    // content via the history reader, so there is no separate history-driven outcome.
    return null;
  }

  detectPromptState(input: AgentPromptSignalInput): PromptState | null {
    // Claude's shell-command / tool permission is an interactive boxed menu in the
    // hidden PTY (the Notification hook only signals "needs input" without the
    // Allow/Deny choices). Scrape that frame — same vertical arrow-nav menu as codex
    // — so the turn can't hang on an unseen "Do you want to proceed?" prompt.
    if (input.source === "pty_transcript") {
      return detectClaudeTuiApprovalPrompt(input.threadId, input.text);
    }
    if (input.source !== "provider_hook" || !isRecord(input.payload)) {
      return null;
    }

    // Tide normalizes every claude hook (PermissionRequest, PreToolUse, Elicitation,
    // Notification) to the single signal event `agent-needs-input`, so the REAL hook is
    // in the payload's `hook_event_name`. Branch on that — keying off `input.eventName`
    // (always "agent-needs-input") matched nothing, so claude's permission prompts were
    // never surfaced and the turn hung "Working" forever waiting on an unseen box.
    const hookEvent = stringValue(input.payload.hook_event_name) ?? input.eventName;

    if (hookEvent === "PermissionRequest") {
      return this.detectPermissionPrompt(input);
    }
    if (hookEvent === "PreToolUse") {
      return this.detectAskUserQuestion(input);
    }
    if (hookEvent === "Elicitation") {
      return this.detectElicitation(input);
    }

    return null;
  }

  private detectPermissionPrompt(input: AgentPromptSignalInput): PromptState | null {
    if (!isRecord(input.payload)) {
      return null;
    }
    const toolInput = isRecord(input.payload.tool_input)
      ? input.payload.tool_input
      : undefined;
    const toolName = stringValue(input.payload.tool_name);
    const message =
      stringValue(toolInput?.description) ??
      stringValue(toolInput?.command) ??
      (toolName === undefined
        ? undefined
        : `Claude Code permission required for ${toolName}.`);

    if (message === undefined) {
      return null;
    }

    return {
      promptId: claudePromptId(input.payload, "permission", message),
      threadId: input.threadId,
      agentId: "claude",
      kind: "approval",
      message,
      // claude shows the actual Allow/Deny box in the hidden PTY. Drive it from here:
      // Allow = Enter on the default option (claude defaults to allow); Deny = Esc, which
      // cancels the box regardless of its option count. Routed by the runtime port's
      // prompt_answer path. This unblocks tools (WebSearch/WebFetch/…) whose box the PTY
      // scraper doesn't recognize, instead of hanging on an unseen prompt.
      choices: [
        {
          choiceId: "claude-perm-allow",
          label: "Allow",
          providerValue: encodeCodexMenuNavigation(0),
        },
        {
          choiceId: "claude-perm-deny",
          label: "Deny",
          providerValue: PTY_CANCEL_TOKEN,
        },
      ],
      defaultChoiceId: "claude-perm-allow",
      source: "provider_hook",
    };
  }

  private detectAskUserQuestion(
    input: AgentPromptSignalInput,
  ): PromptState | null {
    if (!isRecord(input.payload)) {
      return null;
    }
    if (stringValue(input.payload.tool_name) !== "AskUserQuestion") {
      return null;
    }
    const toolInput = isRecord(input.payload.tool_input)
      ? input.payload.tool_input
      : undefined;
    const message = questionMessage(toolInput?.questions);
    if (message === undefined) {
      return null;
    }

    return {
      promptId: claudePromptId(input.payload, "question", message),
      threadId: input.threadId,
      agentId: "claude",
      kind: "question",
      message,
      source: "provider_hook",
    };
  }

  private detectElicitation(input: AgentPromptSignalInput): PromptState | null {
    if (!isRecord(input.payload)) {
      return null;
    }
    const message = stringValue(input.payload.message);
    if (message === undefined) {
      return null;
    }

    return {
      promptId: claudePromptId(input.payload, "elicitation", message),
      threadId: input.threadId,
      agentId: "claude",
      kind: "question",
      message,
      source: "provider_hook",
    };
  }

  private claudeLaunchPlan(input: {
    executablePath: string;
    cwd: string;
    resumeRef?: string;
    launchOptions?: Record<string, unknown>;
    initialPrompt?: string;
    sessionId?: string;
  }): ProviderLaunchPlan {
    const args = [
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

    // Claude delivers its first message as a positional [prompt] at launch. Unlike
    // codex it registers its MCP tools before running the turn, so the launch-time
    // prompt is reliable and avoids the finicky TUI-typing path. Its readiness gate
    // is therefore `immediate`. See agent-turn-handoff-readiness.md.
    if (input.initialPrompt !== undefined && input.initialPrompt.length > 0) {
      args.push(input.initialPrompt);
    }

    return {
      command: input.executablePath,
      args,
      env: {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
      cwd: input.cwd,
      inputTiming: {
        startupDelayMs: 5000,
        preSubmitDelayMs: 350,
      },
      // Claude's TUI negotiates the extended (CSI-u) keyboard protocol on the
      // hidden PTY, so plain "\r" does not submit; Enter is "\x1b[13u".
      submitKeySequence: "\x1b[13u",
      expectedSignalSources: expectedSignalSources.map((source) => ({
        ...source,
      })),
      ...(input.sessionId !== undefined
        ? {
            providerSessionRef: {
              agentId: "claude" as const,
              kind: "claude_transcript" as const,
              value: input.sessionId,
              // The transcript path is fully determined by cwd + session id, so the
              // binding is recorded before claude even creates the file.
              ...(this.homeDir !== undefined
                ? {
                    transcriptPath: `${this.homeDir}/.claude/projects/${claudeProjectDirName(input.cwd)}/${input.sessionId}.jsonl`,
                  }
                : {}),
            },
          }
        : {}),
    };
  }
}

function claudeSetupAction(
  executablePath: string,
  cwd: string,
): ProviderSetupSurfaceAction {
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

function claudeLaunchOptionArgs(
  launchOptions: Record<string, unknown> | undefined,
): string[] {
  const args: string[] = [];
  const model = stringValue(launchOptions?.model);
  if (model !== undefined && model !== "Claude default") {
    args.push("--model", model);
  }

  const permission = stringValue(launchOptions?.permission);
  if (
    permission === "acceptEdits" ||
    permission === "auto" ||
    permission === "bypassPermissions" ||
    permission === "default" ||
    permission === "dontAsk" ||
    permission === "plan"
  ) {
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

function questionMessage(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const question of value) {
    const text =
      stringValue(question) ??
      (isRecord(question)
        ? stringValue(question.text) ?? stringValue(question.question)
        : undefined);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function claudePromptId(
  payload: Record<string, unknown>,
  kind: string,
  message: string,
): string {
  return (
    stringValue(payload.call_id) ??
    stringValue(payload.tool_use_id) ??
    stringValue(payload.elicitation_id) ??
    `claude-${kind}-${message}`
  );
}

// Scrape claude's interactive permission/choice box from the hidden PTY and
// normalize it to a PromptState. Claude's box is the same vertical arrow-nav menu
// as codex ("Do you want to proceed? ❯1. Yes  2. …  3. No", footer "Esc to
// cancel · …"), so it reuses the codex TUI parser + menu-navigation encoding; the
// user's choice is replayed as ArrowDown/Up + Enter on the PTY.
function detectClaudeTuiApprovalPrompt(
  threadId: string,
  text: string | undefined,
): PromptState | null {
  if (text === undefined) {
    return null;
  }
  const parsed = parseCodexApprovalPrompt(text);
  if (parsed === null) {
    return null;
  }
  const choices: PromptChoice[] = parsed.options.map((option, position) => ({
    choiceId: `claude-opt-${option.index}`,
    label: option.label,
    providerValue: encodeCodexMenuNavigation(position - parsed.defaultIndex),
  }));
  const kind: PromptKind = /\b(proceed|trust|allow|permission)\b/i.test(parsed.question)
    ? "approval"
    : "choice";
  return {
    promptId: `claude:${codexApprovalPromptSignature(parsed)}`,
    threadId,
    agentId: "claude",
    kind,
    message: parsed.question,
    choices,
    defaultChoiceId: choices[parsed.defaultIndex]?.choiceId,
    source: "pty",
  };
}
