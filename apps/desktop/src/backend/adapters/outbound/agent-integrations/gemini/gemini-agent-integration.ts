import { randomUUID } from "node:crypto";

import type {
  AgentTurnOutcome,
  AgentIntegrationCapabilities,
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentPromptSignalInput,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderHistoryConnector,
  ProviderLaunchPlan,
  ProviderSignalSource,
  RuntimeReadinessGate,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import type { PromptState, ThreadScope } from "../../../../application/domains/thread/thread.ts";
import {
  encodeCodexMenuNavigation,
  PTY_CANCEL_TOKEN,
} from "../../../../application/services/provider-tui-parsers.ts";
import { geminiTurnOutcomeFromSession } from "./gemini-session-turn-detection.ts";
import {
  createGeminiHistoryConnector,
  type GeminiSessionFileLocator,
} from "./gemini-history-connector.ts";
import {
  recordField,
  stringField,
  unknownRecord,
} from "../shared/provider-record-json.ts";

export interface GeminiProviderState {
  authenticated: boolean;
}

export type GeminiExecutableResolver = (
  command: "gemini",
) => Promise<string | undefined> | string | undefined;

export type GeminiProviderStateReader = (input: {
  cwd: string;
  executablePath: string;
}) => Promise<GeminiProviderState> | GeminiProviderState;

export interface CreateGeminiAgentIntegrationInput {
  resolveExecutable: GeminiExecutableResolver;
  readProviderState: GeminiProviderStateReader;
  defaultCwd?: string;
  // Tide-owned gemini settings file carrying the Tide hook registrations
  // (AfterAgent/Notification/...). Injected via GEMINI_CLI_SYSTEM_SETTINGS_PATH so
  // the user's own ~/.gemini/settings.json is never touched.
  hookSettingsPath?: string;
  // Locates the on-disk session file for a minted session id (infra-injected).
  locateSessionFile?: GeminiSessionFileLocator;
  // Mints the per-runtime session id passed via `--session-id`, so the thread's
  // session binding is deterministic at launch. Injectable for tests.
  mintSessionId?: () => string;
}

const geminiCapabilities: AgentIntegrationCapabilities = {
  supportsHiddenPty: true,
  supportsResume: true,
  supportsTideMcp: false,
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
      "Gemini SessionStart, BeforeAgent, Notification, and AfterAgent hooks (Tide system settings).",
  },
  {
    kind: "provider_history",
    description:
      "Gemini session JSONL (user/gemini records) under ~/.gemini/tmp/<cwd>/chats.",
  },
];

export function createGeminiAgentIntegration(
  input: CreateGeminiAgentIntegrationInput,
): AgentIntegrationPort {
  return new GeminiAgentIntegration(input);
}

class GeminiAgentIntegration implements AgentIntegrationPort {
  private readonly resolveExecutable: GeminiExecutableResolver;
  private readonly readProviderState: GeminiProviderStateReader;
  private readonly defaultCwd: string;
  private readonly hookSettingsPath: string | undefined;
  private readonly mintSessionId: () => string;
  private readonly historyConnector: ProviderHistoryConnector;

  constructor(input: CreateGeminiAgentIntegrationInput) {
    this.resolveExecutable = input.resolveExecutable;
    this.readProviderState = input.readProviderState;
    this.defaultCwd = input.defaultCwd ?? ".";
    this.hookSettingsPath = input.hookSettingsPath;
    this.mintSessionId = input.mintSessionId ?? (() => randomUUID());
    this.historyConnector = createGeminiHistoryConnector({
      locateSessionFile: input.locateSessionFile ?? (() => undefined),
    });
  }

  history(): ProviderHistoryConnector {
    return this.historyConnector;
  }

  async preflight(
    input: AgentIntegrationPreflightInput,
  ): Promise<AgentIntegrationPreflightResult> {
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    const executablePath = await this.resolveExecutable("gemini");
    if (executablePath === undefined) {
      return {
        agentId: "gemini",
        ready: false,
        blockers: [
          {
            kind: "not_installed",
            scope: "provider",
            message: "Gemini CLI executable was not found.",
          },
        ],
        capabilities: geminiCapabilities,
      };
    }

    const providerState = await this.readProviderState({ cwd, executablePath });
    if (!providerState.authenticated) {
      return {
        agentId: "gemini",
        ready: false,
        blockers: [
          {
            kind: "not_authenticated",
            scope: "provider",
            message:
              "Gemini CLI sign-in is required before starting a Thread (run `gemini` and sign in).",
          },
        ],
        capabilities: geminiCapabilities,
      };
    }

    return {
      agentId: "gemini",
      ready: true,
      blockers: [],
      capabilities: geminiCapabilities,
      launchPlan: this.geminiLaunchPlan({ executablePath, cwd, launchOptions: input.launchOptions }),
    };
  }

  async buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("gemini")) ?? "gemini";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    // Mint the session id and pass it via --session-id so this thread's session
    // binding is deterministic at launch — never discovered by file recency.
    const sessionId = this.mintSessionId();
    return this.geminiLaunchPlan({
      executablePath,
      cwd,
      launchOptions: input.launchOptions,
      initialPrompt: input.initialPrompt,
      sessionId,
    });
  }

  async buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan> {
    const executablePath = (await this.resolveExecutable("gemini")) ?? "gemini";
    const cwd = cwdFromScope(input.scope, this.defaultCwd);
    return this.geminiLaunchPlan({
      executablePath,
      cwd,
      launchOptions: input.launchOptions,
      resumeRef: input.providerSessionRef.value,
    });
  }

  initialTurnReadiness(): RuntimeReadinessGate {
    // Gemini takes its first prompt at launch via `-i <prompt>` (positional-style),
    // like claude/antigravity, so it does not need the gated post-launch handoff.
    return { kind: "immediate" };
  }

  turnEndFromHook(eventName: string, payload: unknown): AgentTurnOutcome | null {
    // Gemini's turn-end is the AfterAgent hook (fires exactly once per turn after
    // the final response). Tide registers it via the Tide-owned system settings and
    // spools it as `agent-idle`. SETTLE-ONLY: content renders via the session
    // history reader; the hook's prompt_response is deliberately not ingested.
    if (eventName !== "agent-idle") {
      return null;
    }
    const record = unknownRecord(payload);
    if (record !== undefined && stringField(record, "hook_event_name") !== undefined) {
      // Spooled gemini hooks carry the real hook name in the payload.
      if (stringField(record, "hook_event_name") !== "AfterAgent") {
        return null;
      }
    }
    return {};
  }

  turnEndFromHistory(
    sessionTailText: string,
    expectedUserMessage: string | undefined,
  ): AgentTurnOutcome | null {
    // Adapter-internal fallback behind the AfterAgent hook: a session record that
    // is final-answer-shaped (content, no toolCalls) settles the turn if the hook
    // never arrives. Settle-only; the reader owns content.
    return geminiTurnOutcomeFromSession(sessionTailText, expectedUserMessage);
  }

  detectPromptState(input: AgentPromptSignalInput): PromptState | null {
    if (input.source !== "provider_hook") {
      return null;
    }
    const payload = unknownRecord(input.payload);
    if (payload === undefined) {
      return null;
    }
    // Gemini announces a pending tool approval via the Notification hook
    // (notification_type: "ToolPermission"). The actual Allow/Deny box renders in
    // the hidden PTY; drive it from here exactly like claude's permission box:
    // Allow = Enter on the focused option, Deny = Esc.
    if (stringField(payload, "hook_event_name") !== "Notification") {
      return null;
    }
    if (stringField(payload, "notification_type") !== "ToolPermission") {
      return null;
    }
    const details = recordField(payload, "details");
    const toolName = stringField(details ?? {}, "tool_name") ?? stringField(details ?? {}, "toolName");
    const message =
      stringField(payload, "message") ??
      (toolName === undefined
        ? "Gemini needs permission to run a tool."
        : `Gemini needs permission to run ${toolName}.`);
    return {
      promptId: geminiPromptId(payload, message),
      threadId: input.threadId,
      agentId: "gemini",
      kind: "approval",
      message,
      choices: [
        {
          choiceId: "gemini-perm-allow",
          label: "Allow",
          providerValue: encodeCodexMenuNavigation(0),
        },
        {
          choiceId: "gemini-perm-deny",
          label: "Deny",
          providerValue: PTY_CANCEL_TOKEN,
        },
      ],
      defaultChoiceId: "gemini-perm-allow",
      source: "provider_hook",
    };
  }

  private geminiLaunchPlan(input: {
    executablePath: string;
    cwd: string;
    launchOptions?: Record<string, unknown>;
    initialPrompt?: string;
    resumeRef?: string;
    sessionId?: string;
  }): ProviderLaunchPlan {
    const args = [
      ...geminiApprovalArgs(input.launchOptions),
      ...geminiModelArgs(input.launchOptions),
      // Workspace trust is a Tide product decision (a thread only starts in a
      // Tide-opened project); Tide pre-trusts claude/codex by writing their trust
      // config, and --skip-trust is gemini's supported equivalent.
      "--skip-trust",
      ...(input.resumeRef !== undefined ? ["--resume", input.resumeRef] : []),
      ...(input.sessionId !== undefined ? ["--session-id", input.sessionId] : []),
      // Deliver the first user message via --prompt-interactive so the session runs
      // the turn immediately and stays interactive for follow-ups.
      ...(input.initialPrompt !== undefined && input.initialPrompt.length > 0
        ? ["--prompt-interactive", input.initialPrompt]
        : []),
    ];

    return {
      command: input.executablePath,
      args,
      env: {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        // Tide's hook registrations ride the system-settings layer, which gemini
        // trusts without a consent prompt and which never touches the user's own
        // ~/.gemini/settings.json.
        ...(this.hookSettingsPath !== undefined
          ? { GEMINI_CLI_SYSTEM_SETTINGS_PATH: this.hookSettingsPath }
          : {}),
      },
      cwd: input.cwd,
      inputTiming: {
        startupDelayMs: 5000,
        preSubmitDelayMs: 350,
      },
      expectedSignalSources: expectedSignalSources.map((source) => ({ ...source })),
      ...(input.sessionId !== undefined
        ? {
            providerSessionRef: {
              agentId: "gemini" as const,
              kind: "gemini_session" as const,
              value: input.sessionId,
              // The session file name embeds a timestamp, so the path is resolved by
              // the history connector (by session id) once gemini creates the file.
            },
          }
        : {}),
    };
  }
}

function cwdFromScope(scope: ThreadScope | undefined, fallback: string): string {
  if (scope === undefined) {
    return fallback;
  }
  return scope.kind === "project" ? scope.cwd : scope.scratchCwd;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function geminiPromptId(payload: Record<string, unknown>, message: string): string {
  const stamp = stringField(payload, "timestamp") ?? "";
  let hash = 5381;
  const text = `${stamp}:${message}`;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `gemini-prompt:${(hash >>> 0).toString(36)}`;
}

function geminiApprovalArgs(launchOptions: Record<string, unknown> | undefined): string[] {
  const permission = stringValue(launchOptions?.permission);
  // Map Tide's permission option to gemini's --approval-mode, mirroring
  // claude/codex: the un-opted default PROMPTS for tool approval (surfaced via the
  // Notification hook), it does not silently auto-approve.
  if (permission === "plan") {
    return ["--approval-mode", "plan"];
  }
  if (permission === "acceptEdits" || permission === "auto" || permission === "auto_edit") {
    return ["--approval-mode", "auto_edit"];
  }
  if (permission === "bypass" || permission === "dontAsk" || permission === "yolo") {
    return ["--yolo"];
  }
  return ["--approval-mode", "default"];
}

function geminiModelArgs(launchOptions: Record<string, unknown> | undefined): string[] {
  const model = stringValue(launchOptions?.model);
  // Only forward a concrete gemini model id (e.g. "gemini-3-flash"). The sentinel
  // "Gemini default" and any leaked non-gemini model (e.g. "gpt-5.5") must NOT be
  // passed to `gemini --model` (that fails the turn) — omit the flag and let gemini
  // use its own default.
  if (
    model !== undefined &&
    model !== "Gemini default" &&
    model.toLowerCase().startsWith("gemini")
  ) {
    return ["--model", model];
  }
  return [];
}
