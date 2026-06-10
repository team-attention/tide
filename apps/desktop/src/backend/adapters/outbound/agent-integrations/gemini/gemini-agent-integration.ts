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
            // Same setup affordance as claude/codex: open the CLI in a Tide
            // terminal so the user can sign in, then retry preflight.
            setup: {
              command: executablePath,
              args: [],
              cwd,
              expectedCompletion: "retry_preflight",
            },
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
    // STRUCTURED TRANSPORT: ACP (the Agent Client Protocol) over plain stdio.
    // The approval mode is an ACP session mode (set via session/set_mode by the
    // client); the session id is GENERATED by gemini (session/new result) — it
    // cannot be minted, so the binding is recorded from the protocol response.
    const args = ["--acp", ...geminiModelArgs(input.launchOptions)];

    return {
      command: input.executablePath,
      args,
      env: {
        // Workspace trust is a Tide product decision (a thread only starts in a
        // Tide-opened project). ACP surfaces no trust prompt and an untrusted
        // cwd SILENTLY skips MCP servers and locks privileged modes
        // (source-verified) — this override is gemini's supported escape hatch.
        GEMINI_CLI_TRUST_WORKSPACE: "true",
      },
      cwd: input.cwd,
      transport: "gemini_acp",
      protocolParams: {
        cwd: input.cwd,
        modeId: geminiAcpModeId(input.launchOptions),
      },
      expectedSignalSources: expectedSignalSources.map((source) => ({ ...source })),
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

// Map Tide's permission option to gemini's ACP session mode (session/new
// returns availableModes default/autoEdit/yolo/plan; set via session/set_mode).
// Mirrors claude/codex: the un-opted default PROMPTS for tool approval (the
// session/request_permission round-trip), it does not silently auto-approve.
function geminiAcpModeId(launchOptions: Record<string, unknown> | undefined): string {
  const permission = stringValue(launchOptions?.permission);
  if (permission === "plan") {
    return "plan";
  }
  if (permission === "acceptEdits" || permission === "auto" || permission === "auto_edit") {
    return "autoEdit";
  }
  if (permission === "bypass" || permission === "dontAsk" || permission === "yolo") {
    return "yolo";
  }
  return "default";
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
