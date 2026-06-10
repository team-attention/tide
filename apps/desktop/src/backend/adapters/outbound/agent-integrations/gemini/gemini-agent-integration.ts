import { randomUUID } from "node:crypto";

import type {
  AgentIntegrationCapabilities,
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderLaunchPlan,
  ProviderSignalSource,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import type { ThreadScope } from "../../../../application/domains/thread/thread.ts";

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

export interface GeminiTideMcpConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface CreateGeminiAgentIntegrationInput {
  resolveExecutable: GeminiExecutableResolver;
  readProviderState: GeminiProviderStateReader;
  defaultCwd?: string;
  // The Tide MCP Tool Surface, attached to the ACP session via session/new
  // params.mcpServers (the same surface claude/codex get). gemini loads it only
  // in a trusted folder — Tide forces trust via GEMINI_CLI_TRUST_WORKSPACE.
  tideMcp?: GeminiTideMcpConfig;
  // Mints the per-runtime session id. Injectable for tests.
  mintSessionId?: () => string;
}

const geminiCapabilities: AgentIntegrationCapabilities = {
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
  private readonly tideMcp?: GeminiTideMcpConfig;
  private readonly mintSessionId: () => string;

  constructor(input: CreateGeminiAgentIntegrationInput) {
    this.resolveExecutable = input.resolveExecutable;
    this.readProviderState = input.readProviderState;
    this.defaultCwd = input.defaultCwd ?? ".";
    this.tideMcp = input.tideMcp;
    this.mintSessionId = input.mintSessionId ?? (() => randomUUID());
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
      transport: "acp",
      protocolParams: {
        cwd: input.cwd,
        modeId: geminiAcpModeId(input.launchOptions),
        ...(this.tideMcp !== undefined
          ? {
              mcpServers: [
                {
                  name: "tide",
                  command: this.tideMcp.command,
                  args: this.tideMcp.args,
                  env: Object.entries(this.tideMcp.env ?? {}).map(([name, value]) => ({
                    name,
                    value,
                  })),
                },
              ],
            }
          : {}),
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
