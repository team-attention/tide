import type { ProviderCapability } from "../../../../application/domains/native-agent/provider-capability.ts";

export function codexBaseCapabilityRegistry(): ProviderCapability[] {
  return [
    methodCapability("codex:compact", "session_action", "session", "Compact", "thread/compact/start"),
    methodCapability("codex:goal:set", "session_action", "session", "Goal", "thread/goal/set"),
    methodCapability("codex:goal:get", "session_action", "session", "Goal status", "thread/goal/get"),
    methodCapability("codex:goal:clear", "session_action", "session", "Clear goal", "thread/goal/clear"),
    methodCapability("codex:fork", "session_action", "session", "Fork", "thread/fork"),
    methodCapability("codex:review", "prompt_command", "commands", "Code review", "review/start", "/"),
    methodCapability("codex:model:list", "config_control", "model", "Model", "model/list"),
    methodCapability("codex:model:update", "config_control", "model", "Set model", "thread/settings/update"),
    methodCapability("codex:permission:list", "permission_control", "permission", "Permission profile", "permissionProfile/list"),
    methodCapability("codex:permission:update", "permission_control", "permission", "Set permission profile", "thread/settings/update"),
    methodCapability("codex:mcp:status", "mcp_surface", "mcp", "MCP status", "mcpServerStatus/list"),
    methodCapability("codex:mcp:reload", "mcp_surface", "mcp", "Reload MCP", "config/mcpServer/reload"),
    methodCapability("codex:skills:list", "skill", "skills", "Skills", "skills/list", "$"),
    {
      capabilityId: "codex:skills:invoke",
      provider: "codex",
      source: "manual_audit",
      kind: "skill",
      trigger: "$",
      label: "Invoke skill",
      description: "Disabled until a runtime fixture proves the native skill send path.",
      group: "skills",
      invoke: { kind: "unsupported", reason: "Skill selection send path requires runtime fixture evidence." },
      available: false,
    },
    {
      capabilityId: "codex:cloud",
      provider: "codex",
      source: "manual_audit",
      kind: "session_action",
      label: "Cloud",
      group: "session",
      invoke: { kind: "tide_surface", surface: "cloud_run" },
      available: false,
    },
  ];
}

function methodCapability(
  capabilityId: string,
  kind: ProviderCapability["kind"],
  group: ProviderCapability["group"],
  label: string,
  method: string,
  trigger?: "/" | "$",
): ProviderCapability {
  return {
    capabilityId,
    provider: "codex",
    source: "generated_schema",
    kind,
    trigger,
    label,
    group,
    invoke: { kind: "provider_method", method },
    available: true,
  };
}
