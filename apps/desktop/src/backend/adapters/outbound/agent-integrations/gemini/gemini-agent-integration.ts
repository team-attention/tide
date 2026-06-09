import type {
  AgentTurnOutcome,
  AgentIntegrationCapabilities,
  AgentIntegrationPort,
  AgentIntegrationPreflightInput,
  AgentIntegrationPreflightResult,
  AgentPromptSignalInput,
  AgentResumePlanInput,
  AgentStartPlanInput,
  ProviderLaunchPlan,
  ProviderSignalSource,
  RuntimeReadinessGate,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import type { PromptState, ThreadScope } from "../../../../application/domains/thread/thread.ts";
import { geminiTurnOutcomeFromSession } from "./gemini-session-turn-detection.ts";

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
}

const geminiCapabilities: AgentIntegrationCapabilities = {
  supportsHiddenPty: true,
  supportsResume: true,
  supportsTideMcp: false,
  supportsHooks: false,
  supportsReadableHistory: true,
  requiresTerminalKeyProtocol: true,
};

const expectedSignalSources: ProviderSignalSource[] = [
  {
    kind: "pty_transcript",
    description: "Captured hidden PTY input and output.",
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

  constructor(input: CreateGeminiAgentIntegrationInput) {
    this.resolveExecutable = input.resolveExecutable;
    this.readProviderState = input.readProviderState;
    this.defaultCwd = input.defaultCwd ?? ".";
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
    return this.geminiLaunchPlan({
      executablePath,
      cwd,
      launchOptions: input.launchOptions,
      initialPrompt: input.initialPrompt,
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

  turnEndFromHook(): AgentTurnOutcome | null {
    // Gemini hooks do not fire in the prompt-interactive path we use; turn-end is read
    // from the session JSONL (turnEndFromHistory).
    return null;
  }

  turnEndFromHistory(
    sessionTailText: string,
    expectedUserMessage: string | undefined,
  ): AgentTurnOutcome | null {
    return geminiTurnOutcomeFromSession(sessionTailText, expectedUserMessage);
  }

  detectPromptState(_input: AgentPromptSignalInput): PromptState | null {
    return null;
  }

  private geminiLaunchPlan(input: {
    executablePath: string;
    cwd: string;
    launchOptions?: Record<string, unknown>;
    initialPrompt?: string;
    resumeRef?: string;
  }): ProviderLaunchPlan {
    const args = [
      ...geminiApprovalArgs(input.launchOptions),
      ...geminiModelArgs(input.launchOptions),
      "--skip-trust",
      ...(input.resumeRef !== undefined ? ["--resume", input.resumeRef] : []),
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
      },
      cwd: input.cwd,
      inputTiming: {
        startupDelayMs: 5000,
        preSubmitDelayMs: 350,
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

function geminiApprovalArgs(launchOptions: Record<string, unknown> | undefined): string[] {
  const permission = stringValue(launchOptions?.permission);
  // Map Tide's permission option to gemini's --approval-mode. Default to yolo so a
  // headless/interactive turn is not blocked on a tool-approval prompt for v1.
  if (permission === "plan") {
    return ["--approval-mode", "plan"];
  }
  if (permission === "acceptEdits" || permission === "auto" || permission === "auto_edit") {
    return ["--approval-mode", "auto_edit"];
  }
  return ["--yolo"];
}

function geminiModelArgs(launchOptions: Record<string, unknown> | undefined): string[] {
  const model = stringValue(launchOptions?.model);
  // Only forward a gemini model. The composer default may leak a non-gemini model
  // (e.g. "gpt-5.5"); passing that to `gemini --model` fails the turn. When the model
  // is not a gemini one, omit the flag and let gemini use its default.
  if (model !== undefined && model.toLowerCase().startsWith("gemini")) {
    return ["--model", model];
  }
  return [];
}
