// The single birthplace of declarative agent knowledge. Adding (or re-adding) an
// agent means one entry here plus its backend integration factory in
// backend/.../agent-integrations/registry.ts — not edits scattered across the UI,
// the runtime port, and infra. Everything that is "per-agent data" (display name,
// monogram, session-ref kind, permission modes, availability) is derived from this
// table; nothing else may hardcode an agent-id list or a `=== "claude"` branch.
//
// See docs_v2/implementation/codebase-issues-and-remediation-plan.md (Phase 1).
import type { AgentId, ProviderCliAgentId, ProviderSessionRefDto } from "./contracts/agent.ts";

export interface AgentPermissionMode {
  id: string;
  value: string;
  label: string;
  detail: string;
  danger?: boolean;
}

export interface AgentPermissionConfig {
  default: string;
  options: AgentPermissionMode[];
  // Raw permission values from threads created before the friendly modes existed,
  // mapped to the closest current mode so the chip + selected row still make sense.
  // Data, not control flow — replaces the per-agent branches in normalizePermissionValue.
  legacyValueMap?: Record<string, string>;
}

export interface AgentDescriptor {
  id: AgentId;
  // Human-facing name shown on chips, menus, and icons (e.g. "Claude Code").
  displayName: string;
  // Two-letter badge (Codex/Claude both start with C, so each gets a distinct code).
  monogram: string;
  // True for provider-CLI agents (codex/claude/gemini/opencode).
  isProviderCli: boolean;
  // The provider session reference kind, for provider-CLI agents only.
  sessionRefKind?: ProviderSessionRefDto["kind"];
  // Shown in the composer menu but not yet wired for real use (disabled + label).
  comingSoon?: boolean;
  permission: AgentPermissionConfig;
}

export const AGENT_DESCRIPTORS: Record<AgentId, AgentDescriptor> = {
  codex: {
    id: "codex",
    displayName: "Codex CLI",
    monogram: "Co",
    isProviderCli: true,
    sessionRefKind: "codex_rollout",
    permission: {
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
  },
  claude: {
    id: "claude",
    displayName: "Claude Code",
    monogram: "Cl",
    isProviderCli: true,
    sessionRefKind: "claude_transcript",
    permission: {
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
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini CLI",
    monogram: "Ge",
    isProviderCli: true,
    sessionRefKind: "gemini_session",
    permission: {
      default: "default",
      options: [
        { id: "gemini-ask", value: "default", label: "Ask permissions", detail: "Approve tools manually" },
        { id: "gemini-edit", value: "auto_edit", label: "Auto edits", detail: "Auto-approve edits only" },
        { id: "gemini-plan", value: "plan", label: "Plan mode", detail: "Read-only planning" },
        { id: "gemini-yolo", value: "yolo", label: "Bypass permissions", detail: "Skip all approvals", danger: true },
      ],
    },
  },
  opencode: {
    id: "opencode",
    displayName: "opencode",
    monogram: "Oc",
    isProviderCli: true,
    sessionRefKind: "opencode_session",
    permission: {
      default: "build",
      options: [
        { id: "opencode-build", value: "build", label: "Build", detail: "Runs tools per opencode config" },
        { id: "opencode-plan", value: "plan", label: "Plan", detail: "Read-only, no edits" },
      ],
      legacyValueMap: { default: "build", auto_edit: "build", yolo: "build" },
    },
  },
};

// All provider-CLI agent ids, derived from the table (never hand-listed elsewhere).
export const PROVIDER_CLI_AGENT_IDS: ProviderCliAgentId[] = Object.values(AGENT_DESCRIPTORS)
  .filter((descriptor): descriptor is AgentDescriptor & { id: ProviderCliAgentId } => descriptor.isProviderCli)
  .map((descriptor) => descriptor.id);

export function isProviderCliAgentId(agentId: string): agentId is ProviderCliAgentId {
  return (PROVIDER_CLI_AGENT_IDS as string[]).includes(agentId);
}

export function agentDescriptor(agentId: string): AgentDescriptor | undefined {
  return (AGENT_DESCRIPTORS as Record<string, AgentDescriptor | undefined>)[agentId];
}

// The provider session ref kind for a provider-CLI agent (codex_rollout, etc.).
export function sessionRefKindForAgent(agentId: ProviderCliAgentId): ProviderSessionRefDto["kind"] {
  const kind = AGENT_DESCRIPTORS[agentId].sessionRefKind;
  if (kind === undefined) {
    throw new Error(`Provider-CLI agent ${agentId} has no sessionRefKind in its descriptor.`);
  }
  return kind;
}
