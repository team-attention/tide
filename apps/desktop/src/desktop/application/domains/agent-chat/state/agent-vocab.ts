import type { AgentChatAgentBinding, AgentChatAgentId, AgentChatAgentRuntimeSource } from "./types.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

// Codex models, read from the installed codex binary (matches the Codex app
// picker). codex's --model is free-form, so "Custom model id..." stays too.
export const CODEX_MODELS: CliModelOption[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark" },
  { value: "gpt-5.2", label: "GPT-5.2" },
];

export function codexModelLabel(model: string): string {
  return CODEX_MODELS.find((m) => m.value === model)?.label ?? model;
}

export function formatAgentLabel(agentId: string): string {
  switch (agentId) {
    case "codex":
      return "Codex CLI";
    case "claude":
      return "Claude Code";
    case "gemini":
      return "Gemini CLI";
    case "opencode":
      return "opencode";
    case "openai_api":
      return "OpenAI API";
    default:
      return agentId;
  }
}

// Permission/approval modes, presented to match each provider's own app rather
// than exposing raw CLI flags: Codex mirrors the Codex app's 3 approval modes,
// Claude mirrors the Claude app's mode list, gemini/opencode use the same friendly
// shape. `value` is what flows to the Agent Integration (which maps it to the
// provider's real flags); `label`/`detail` are the human presentation.
// Permission presentation is the desktop layer's own vocabulary (this domain is
// deliberately isolated from shared/contracts). Each agent's config carries a
// `legacyValueMap`: raw permission values from threads created before the friendly
// modes, mapped to the closest current mode — DATA, not the per-agent `=== "codex"`
// branches this replaced.
interface PermissionOption {
  id: string;
  value: string;
  label: string;
  detail: string;
  danger?: boolean;
}

interface PermissionConfig {
  default: string;
  options: PermissionOption[];
  legacyValueMap?: Record<string, string>;
}

export const PERMISSION_OPTIONS: Record<string, PermissionConfig> = {
  codex: {
    default: "approve-for-me",
    options: [
      { id: "codex-ask", value: "ask-for-approval", label: "Ask for approval", detail: "Edits & internet need approval" },
      { id: "codex-auto", value: "approve-for-me", label: "Approve for me", detail: "Only unsafe actions ask" },
      { id: "codex-full", value: "full-access", label: "Full access", detail: "Unrestricted files & internet", danger: true },
    ],
    legacyValueMap: {
      "read-only": "ask-for-approval",
      untrusted: "ask-for-approval",
      "on-request": "ask-for-approval",
      "workspace-write": "approve-for-me",
      "on-failure": "approve-for-me",
      "danger-full-access": "full-access",
      never: "full-access",
      "dangerously-bypass-approvals-and-sandbox": "full-access",
    },
  },
  claude: {
    default: "default",
    options: [
      { id: "claude-ask", value: "default", label: "Ask permissions", detail: "Approve edits & tools" },
      { id: "claude-accept", value: "acceptEdits", label: "Accept edits", detail: "Auto-approve file edits" },
      { id: "claude-plan", value: "plan", label: "Plan mode", detail: "Plan without editing" },
      { id: "claude-auto", value: "auto", label: "Auto mode", detail: "Run autonomously" },
      { id: "claude-bypass", value: "bypassPermissions", label: "Bypass permissions", detail: "Skip all approvals", danger: true },
    ],
    legacyValueMap: { dontAsk: "acceptEdits" },
  },
  gemini: {
    default: "default",
    options: [
      { id: "gemini-ask", value: "default", label: "Ask permissions", detail: "Approve tools manually" },
      { id: "gemini-edit", value: "auto_edit", label: "Auto edits", detail: "Auto-approve edits only" },
      { id: "gemini-plan", value: "plan", label: "Plan mode", detail: "Read-only planning" },
      { id: "gemini-yolo", value: "yolo", label: "Bypass permissions", detail: "Skip all approvals", danger: true },
    ],
  },
  // opencode's ACP session exposes exactly two modes (`session/new` configOptions
  // category "mode": build | plan) — NOT the four gemini-style modes. Build runs
  // tools per opencode's own permission config; Plan is read-only. The Agent
  // Integration maps these to the ACP `modeId`.
  opencode: {
    default: "build",
    options: [
      { id: "opencode-build", value: "build", label: "Build", detail: "Runs tools per opencode config" },
      { id: "opencode-plan", value: "plan", label: "Plan", detail: "Read-only, no edits" },
    ],
    // Threads created while opencode borrowed gemini's modes map onto build/plan.
    legacyValueMap: { default: "build", auto_edit: "build", yolo: "build" },
  },
  openai_api: {
    default: "Auto-review",
    options: [
      { id: "tide-auto-review", value: "Auto-review", label: "Auto-review", detail: "Tide tool policy" },
      { id: "tide-ask-first", value: "Ask before tools", label: "Ask before tools", detail: "Tide tool policy" },
      { id: "tide-read-only", value: "Read-only", label: "Read-only", detail: "Tide workspace policy" },
    ],
  },
};

export function permissionConfigForAgent(agentId: string): PermissionConfig {
  return PERMISSION_OPTIONS[agentId] ?? PERMISSION_OPTIONS.codex;
}

export function normalizePermissionValue(agentId: string, value: string): string {
  const config = permissionConfigForAgent(agentId);
  if (config.options.some((option) => option.value === value)) {
    return value;
  }
  return config.legacyValueMap?.[value] ?? value;
}

// Provider-CLI agents the backend detected on the local system. `null` = not yet
// reported (treat all as available so the menu never flashes all-disabled at startup).
// Set by the Desktop adapter from the thread.listed event. Module-level so it survives
// New-Thread state resets.
let availableProviderAgents: readonly string[] | null = null;

export function setAvailableProviderAgents(agents: readonly string[] | null): void {
  availableProviderAgents = agents;
}

export function isAgentAvailable(agentId: string): boolean {
  return availableProviderAgents === null || availableProviderAgents.includes(agentId);
}

// Agents shown in the composer menu but not yet wired for real use — rendered
// disabled with a "Coming soon" hint, never selectable or chosen as the start
// default. (opencode is now fully wired: ACP runtime + model/vendor/effort
// selection from its own catalog — see opencode-model-vendor-selection.md.)
const COMING_SOON_AGENTS: ReadonlySet<string> = new Set([]);

export function isAgentComingSoon(agentId: string): boolean {
  return COMING_SOON_AGENTS.has(agentId);
}

// Provider-CLI agents offered in the composer menu.
const OFFERED_PROVIDER_AGENTS = ["codex", "claude", "gemini", "opencode"] as const;

// Pick the agent a new thread should default to. Honors the user's last choice only if
// it is still offered AND detected locally — so a persisted hidden/uninstalled agent
// never resurfaces as the default. Falls back to the first detected offered agent,
// then codex.
export function resolveStartAgentId(preferred: string | undefined): AgentChatAgentId {
  if (
    preferred !== undefined &&
    (OFFERED_PROVIDER_AGENTS as readonly string[]).includes(preferred) &&
    isAgentAvailable(preferred) &&
    !isAgentComingSoon(preferred)
  ) {
    return preferred as AgentChatAgentId;
  }
  const firstAvailable = OFFERED_PROVIDER_AGENTS.find(
    (agentId) => isAgentAvailable(agentId) && !isAgentComingSoon(agentId),
  );
  return (firstAvailable ?? "codex") as AgentChatAgentId;
}

interface CliModelOption {
  value: string;
  label: string;
  detail?: string;
  // Multi-vendor router models (opencode) carry their vendor for grouping in the
  // model menu; single-vendor agents (claude/codex/gemini) leave it undefined.
  vendor?: string;
}

// Provider-reported model catalogs, keyed by agent id. opencode ships its authed
// list on thread.listed (`opencode models`); gemini/opencode also self-report over
// ACP at session start (agentRuntime.modelCatalogChanged). When present, the catalog
// drives the menu instead of the hand-curated static list. Module-level so it
// survives New-Thread state resets, mirroring availableProviderAgents.
const providerModelCatalogs = new Map<string, CliModelOption[]>();

export function setProviderModelCatalog(agentId: string, models: CliModelOption[] | null): void {
  if (models !== null && models.length > 0) {
    providerModelCatalogs.set(agentId, models);
  } else {
    providerModelCatalogs.delete(agentId);
  }
}

// opencode-specific alias kept for the thread.listed wiring.
export function setOpencodeModelCatalog(models: CliModelOption[] | null): void {
  setProviderModelCatalog("opencode", models);
}

// A maintained, provider-native model list per CLI agent (models change rarely).
// Claude values are the real `--model` aliases (verified via `/model`); "Claude
// default" passes no --model (uses the CLI's own default).
export function cliModelOptionsForAgent(agentId: string): CliModelOption[] {
  switch (agentId) {
    case "claude":
      // Mirrors the Claude Code app's model list. "Claude default" passes no
      // --model (the CLI's own default, currently Opus 4.8); the rest pass an
      // explicit `--model` id.
      return [
        { value: "Claude default", label: "Default", detail: "Opus 4.8" },
        { value: "claude-fable-5", label: "Fable 5" },
        { value: "claude-opus-4-8", label: "Opus 4.8" },
        { value: "claude-opus-4-8[1m]", label: "Opus 4.8 (1M context)" },
        { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
        { value: "claude-haiku-4-5", label: "Haiku 4.5" },
        { value: "claude-opus-4-7", label: "Opus 4.7", detail: "Legacy" },
        { value: "claude-opus-4-7[1m]", label: "Opus 4.7 (1M context)", detail: "Legacy" },
        { value: "claude-opus-4-6", label: "Opus 4.6", detail: "Legacy" },
      ];
    case "gemini": {
      // Once a session is live, gemini self-reports its models over ACP and the
      // catalog overrides the static list (the live current model + exact set). At
      // compose time (no session) the curated list is used — corrected to the real
      // `-preview` ids gemini requires (the prior `gemini-3-pro` etc. were DRIFTED).
      const catalog = providerModelCatalogs.get("gemini");
      if (catalog !== undefined) {
        return [{ value: "Gemini default", label: "Default", detail: "gemini picks" }, ...catalog];
      }
      return [
        { value: "Gemini default", label: "Default", detail: "gemini-3-flash-preview" },
        { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
        { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
        { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", detail: "Legacy" },
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", detail: "Legacy" },
      ];
    }
    case "opencode": {
      // opencode is a multi-vendor router: the real model list is whatever the
      // user has authed (`opencode auth login`), enumerated by the backend and
      // cached in opencodeModelCatalog. "opencode default" first = honor opencode's
      // own configured default (no explicit set). Falls back to default-only until
      // the catalog arrives (older backend / not yet enumerated).
      const fallback = { value: "opencode default", label: "Default", detail: "opencode config" };
      const catalog = providerModelCatalogs.get("opencode");
      return catalog === undefined ? [fallback] : [fallback, ...catalog];
    }
    default:
      return [];
  }
}

// Reasoning/thinking effort levels, shared by codex (`model_reasoning_effort`)
// and claude (`--effort`). Codex offers low–xhigh; claude adds "max".
export const REASONING_LEVELS: Record<string, { label: string; detail: string }> = {
  low: { label: "Low", detail: "fastest, least thorough" },
  medium: { label: "Medium", detail: "balanced" },
  high: { label: "High", detail: "slower, more thorough" },
  xhigh: { label: "Extra High", detail: "slowest, most thorough" },
  max: { label: "Max", detail: "maximum effort" },
};

export function runtimeSourceForBinding(binding: AgentChatAgentBinding): AgentChatAgentRuntimeSource {
  return binding.runtimeSource ?? runtimeSourceForAgent(binding.agentId);
}

export function runtimeSourceForAgent(agentId: string): AgentChatAgentRuntimeSource {
  if (agentId === "openai_api") {
    return {
      kind: "tide_api",
      provider: "openai",
    };
  }

  const providerAgent =
    agentId === "claude" || agentId === "gemini" || agentId === "opencode"
      ? agentId
      : "codex";
  return {
    kind: "provider_cli",
    integrationId: providerAgent,
  };
}

export function defaultModelValueForAgent(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "Claude default";
    case "gemini":
      return "Gemini default";
    case "opencode":
      return "opencode default";
    case "openai_api":
      return "gpt-5.5";
    default:
      return "gpt-5.5";
  }
}

function defaultModelLabelForAgent(agentId: string): string {
  return modelLabelForAgent(agentId, defaultModelValueForAgent(agentId));
}

export function modelLabelForAgent(agentId: string, model: string): string {
  // Show the friendly label for a known CLI model (e.g. "sonnet" -> "Sonnet").
  const option = cliModelOptionsForAgent(agentId).find((candidate) => candidate.value === model);
  if (option !== undefined) {
    return option.label;
  }
  return model;
}

function modelRowIdForAgent(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "claude-default";
    default:
      return "gpt-55-high";
  }
}

export function defaultPermissionForAgent(agentId: string): string {
  return permissionConfigForAgent(agentId).default;
}

// The friendly label for a permission value (handles legacy raw values too), used
// for the composer permission chip.
export function permissionLabelForValue(agentId: string, value: string): string {
  const config = permissionConfigForAgent(agentId);
  const normalized = normalizePermissionValue(agentId, value);
  return config.options.find((option) => option.value === normalized)?.label ?? value;
}
