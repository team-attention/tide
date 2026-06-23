# Spec: Composer Agent Runtime Source

## Status

Implemented, revised 2026-06-20: Tide v2 supports the three provider CLI agents only:
`codex`, `claude`, and `opencode`.

The earlier direct Tide-owned API Agent path was removed. API keys can still belong to a
provider's own CLI setup path, such as opencode vendor auth, but Tide does not create a
separate OpenAI/API-backed Agent Runtime from a generic API key.

## Scope

This spec defines how the Composer Agent chip maps to Agent Binding and model/permission
menus now that all selectable Agents are Provider CLI Agents.

It covers:

- One visible Agent chip.
- Provider CLI Agent Binding.
- Provider-native Model and Permission menu routing.
- Provider CLI readiness/setup copy.
- Rejection of legacy direct API Agent bindings at the Shared Contract boundary.

It does not cover provider account storage or a Tide-owned direct API runtime.

## Decisions

### D1. One visible Agent chip, three provider CLI agents

The Composer shows one Agent chip with these selectable identities:

| Visible option | Agent id | Runtime source |
|----------------|----------|----------------|
| Codex CLI | `codex` | `provider_cli` |
| Claude Code | `claude` | `provider_cli` |
| opencode | `opencode` | `provider_cli` |

The Agent menu must not offer a Tide-owned OpenAI/API Agent.

### D2. Agent Binding stores provider CLI source only

Current Shared Contract shape:

```ts
type ProviderCliAgentId = "codex" | "claude" | "opencode";
type AgentId = ProviderCliAgentId;

interface AgentRuntimeSourceDto {
  kind: "provider_cli";
  integrationId: ProviderCliAgentId;
}

interface AgentBindingDto {
  agentId: AgentId;
  runtimeSource?: AgentRuntimeSourceDto;
  providerSessionRef?: ProviderSessionRefDto;
}
```

`runtimeSource` may be omitted only for legacy provider CLI compatibility. When present,
it must name the same provider CLI as `agentId`.

### D3. Model and permission menus are provider-native

The Model and Permission chips share visual components, but their data comes from the
selected provider CLI integration:

| Agent | Model source | Permission source |
|-------|--------------|-------------------|
| Codex | Codex launch/session config | Codex approval/sandbox policy |
| Claude | Claude launch/session config | Claude permission mode |
| opencode | opencode vendor/model catalog | opencode mode/config |

The UI must not normalize provider-native model ids into one cross-provider enum.

### D4. API keys are not an Agent Runtime Source

API keys can appear only where the selected provider CLI owns them. The concrete current
case is opencode vendor auth: Tide writes the credential to opencode's own server/config
path and continues to run the opencode CLI runtime.

Tide does not infer a separate direct API Agent from `OPENAI_API_KEY`, Codex auth, or any
other provider credential.

### D5. Legacy direct API Agent bindings are rejected

Shared Contracts reject unknown Agent ids and non-provider runtime source objects before
they reach Backend services. This keeps removed runtime branches from silently reappearing
as edge cases.

## Flow

### UC-1: Select Provider CLI Agent

1. User opens the Agent chip.
2. User chooses Codex, Claude, or opencode.
3. Desktop stores a provider CLI Agent Binding.
4. Model and Permission chips render data for that selected provider.
5. Send creates/starts the Thread through Provider CLI readiness and runtime ports.

### UC-2: opencode Vendor Auth

1. User selects opencode.
2. User connects a vendor key through the opencode on-ramp.
3. Backend sends the key to opencode's own auth endpoint/config path.
4. The selected runtime remains the opencode provider CLI.

## Invariants

1. The Agent chip has one visible selected value.
2. Only `codex`, `claude`, and `opencode` are valid Agent ids.
3. Runtime source is provider CLI only.
4. A started Thread locks Agent Binding.
5. Provider setup copy names the selected provider CLI path.
6. Direct API Agent bindings are rejected at the contract boundary.

## Tests

| Rule | Test expectation |
|------|------------------|
| Provider CLI source | `Agent Binding preserves provider CLI runtime sources` round-trips provider CLI source data. |
| Legacy API source rejected | `thread_start_rejects_openai_api_and_tide_api_runtime_source` rejects removed API runtime shapes. |
| Agent identity allowlist | `isProductShellAgentIdentity accepts the four provider CLI agents, rejects undefined/unknown` preserves the four-agent set. |
| Agent chip stays singular | `agent_chip_renders_one_visible_value_for_provider_cli_sources` renders one selected Agent chip. |
| Model routes by provider CLI | `model_chip_routes_menu_data_by_provider_cli_agent` chooses menu data from the selected provider. |
| opencode auth stays provider-owned | `provider.opencodeConnectApiKey` writes vendor credentials through opencode, not a Tide API runtime. |

## Implementation Notes

- Keep provider CLI integrations separate and provider-native.
- Keep API-key setup out of generic Agent Runtime Source selection.
- Do not add a router that switches between provider CLI and Tide-owned API runtime ports.
