# Spec: Composer Agent Runtime Source

## Scope

This spec defines how the Composer Agent chip can stay visually singular while the selected Agent maps to different runtime sources.

It covers:

- Agent chip choices for Provider CLI Agents and Tide API Agents.
- Agent Runtime Source as part of Agent Binding.
- Model Chip source routing.
- Provider Account setup for API-backed Agents.
- Figma design expectations for the Agent menu and selected-state examples.

It does not implement direct API calls, provider account storage, provider-specific model discovery, or final naming for every future API-backed Agent.

## Evidence

- `docs_v2/master-plan.md` says the Start Composer visible controls become the Thread's initial Agent Binding, Execution Context, and Launch Options.
- `docs_v2/master-plan.md` says Start Composer values are applied before the hidden Agent Runtime starts through provider-native CLI flags, config files, environment variables, or Agent Integration launch parameters.
- `docs_v2/master-plan.md` says Model Chip values are provider-native and are not normalized into one cross-provider list.
- `docs_v2/master-plan.md` says Launch Options and In-Session Commands are related but separate sources.
- `docs_v2/master-plan.md` says Codex CLI, Claude Code, and Antigravity CLI use provider-specific Agent Integrations.
- `docs_v2/specs/provider-integration-bootstrap.md` says Codex, Claude, and Antigravity each get a provider-specific Agent Integration, and the shared Agent Integration contract does not erase provider-specific launch, resume, readiness, prompt, history, or hook details.
- `docs_v2/specs/shared-contracts.md` says provider-native values that users see remain provider-native strings.
- `src/shared/contracts/agent.ts` defines source-aware Agent Binding DTOs with Provider CLI Agent ids and the `openai_api` Tide API Agent id.
- User decision on 2026-05-28: Composer may still show one Agent chip with `Codex CLI`, `Claude Code`, `Antigravity CLI`, and `OpenAI API` or `Tide Agent / OpenAI`, but `Codex CLI > Model` and `OpenAI API > Model` must not share the same internal source.
- Figma file `Thirdcommit`, frame `1357:2`, currently records the per-agent Composer selected-state board and already distinguishes provider-specific menus from generic dropdowns.

## Decisions

### D1. One visible Agent chip, multiple runtime sources

The Composer shows one Agent chip.

The Agent menu can list both Provider CLI Agents and Tide API Agents, but each option carries an Agent Runtime Source.

Initial groups:

| Visible option | Agent Runtime Source | Runtime owner |
|----------------|----------------------|---------------|
| Codex CLI | `provider_cli` | Codex Agent Integration |
| Claude Code | `provider_cli` | Claude Agent Integration |
| Antigravity CLI | `provider_cli` | Antigravity Agent Integration |
| OpenAI API | `tide_api` | Tide API Agent runtime for OpenAI |

`OpenAI API` is the current design label. `Tide Agent / OpenAI` remains an allowed future product label if the UI needs to emphasize Tide-hosted behavior.

### D2. Agent Binding stores the runtime source

Agent Binding is not just `agentId`.

It includes:

- selected Agent identity.
- Agent Runtime Source.
- optional provider identity for API-backed Agents.
- optional provider-owned Raw Agent Session reference for Provider CLI Agents.

A started Thread locks the full Agent Binding. Changing from Codex CLI to OpenAI API means starting or forking a different Thread.

### D3. Provider CLI Agents keep hidden PTY semantics

Codex CLI, Claude Code, and Antigravity CLI remain Provider CLI Agents.

They use:

- Agent Integration preflight.
- hidden PTY runtime transport.
- Provider Signals.
- provider-owned Raw Agent Session history.
- provider-native permission and model commands when supported.

An API key is not an alternate Agent Runtime Source branch inside those Provider CLI Agents unless a provider's own CLI explicitly supports and owns that behavior.

### D4. Tide API Agents use Provider Account semantics

OpenAI API is a Tide API Agent.

It uses:

- Provider Account readiness, such as an OpenAI API key.
- Tide-owned API runtime.
- Tide-owned request and response streaming.
- Tide-owned model discovery or configured model list.
- Tide-owned tool permission policy when the API Agent can operate Tide tools.

It does not launch a provider CLI hidden PTY and does not produce a provider CLI Raw Agent Session.

### D5. Model Chip component is shared, Model Source is not

The Model Chip uses the same visual component in all Composer states.

The Model Source changes by Agent Runtime Source:

| Selected Agent | Model Source |
|----------------|--------------|
| Codex CLI | Codex Agent Integration launch options and provider-native model command |
| Claude Code | Claude Agent Integration launch options and provider-native model command |
| Antigravity CLI | Antigravity Agent Integration capability when proven |
| OpenAI API | Tide API Agent OpenAI Provider Account and model catalog |

The UI must not imply that `GPT-5.5 High` selected through Codex CLI and `GPT-5.5 High` selected through OpenAI API are the same control path.

The visible Model Chip label may be product-polished, but the value sent in
`launchOptions.model` must be the provider-native model id for the selected
Model Source. For Codex CLI, the current default visible label `GPT-5.5 High`
maps to the Codex-native launch value `gpt-5.5`.

### D6. Readiness copy must name the right setup source

Provider CLI setup copy says provider CLI, hidden PTY, hooks, Directory Trust, or provider-native setup only when that source is active.

Tide API Agent setup copy says Provider Account, API key, model availability, or API quota only when that source is active.

### D7. The Agent menu can group without becoming a setup form

The Agent menu may visually group choices:

- Provider CLI
- Tide API

Rows stay menu rows, not large setup cards. Setup happens after selection if readiness is incomplete.

## Out Of Scope

- Provider account encryption.
- OpenAI API transport implementation.
- Model catalog fetching.
- Billing or rate-limit UI.
- Cross-provider model normalization.
- A generic "bring your own API" runtime.

## Domain Model

### Agent Runtime Source

```ts
type AgentRuntimeSource =
  | {
      kind: "provider_cli";
      integrationId: "codex" | "claude" | "antigravity";
    }
  | {
      kind: "tide_api";
      provider: "openai";
      accountId?: string;
    };
```

### Agent Binding

```ts
interface AgentBinding {
  agentId: string;
  runtimeSource: AgentRuntimeSource;
  providerSessionRef?: ProviderSessionRef;
}
```

### Model Source

```ts
type ModelSource =
  | {
      kind: "agent_integration";
      agentId: "codex" | "claude" | "antigravity";
      launchOptionKey?: string;
      inSessionCommand?: string;
    }
  | {
      kind: "provider_account";
      provider: "openai";
      accountId?: string;
    };
```

## Contracts

Shared Contracts represent the runtime source as part of Agent Binding instead of treating `openai_api` as just another Provider CLI value.

Current shape:

```ts
type AgentId = "codex" | "claude" | "antigravity" | "openai_api";

interface AgentBindingDto {
  agentId: AgentId;
  runtimeSource?: AgentRuntimeSourceDto;
  providerSessionRef?: ProviderSessionRefDto;
}

type AgentRuntimeSourceDto =
  | { kind: "provider_cli"; integrationId: "codex" | "claude" | "antigravity" }
  | { kind: "tide_api"; provider: "openai"; accountId?: string };
```

Provider CLI Agent Binding can omit `runtimeSource` only for legacy contract compatibility. `openai_api` must include `runtimeSource.kind = "tide_api"`.

Composer view state should expose one visible Agent chip value plus enough source metadata to render the correct model menu.

## Flow

### UC-1: Select Provider CLI Agent

1. User opens the Agent chip.
2. User chooses `Codex CLI`.
3. Desktop stores an Agent Binding with `runtimeSource.kind = "provider_cli"`.
4. Model Chip opens Codex model choices from Codex Agent Integration.
5. First send runs Provider CLI preflight before hidden PTY launch.

### UC-2: Select Tide API Agent

1. User opens the Agent chip.
2. User chooses `OpenAI API`.
3. Desktop stores an Agent Binding with `runtimeSource.kind = "tide_api"` and `provider = "openai"`.
4. Model Chip opens OpenAI model choices from Tide API Agent model source.
5. First send checks Provider Account readiness before API runtime send.

### UC-3: API key missing

1. User selects `OpenAI API`.
2. User sends a draft.
3. Backend reports Provider Account readiness blocker.
4. Composer preserves the draft and shows setup action for the OpenAI Provider Account.
5. After setup, Tide re-checks readiness and sends through the Tide API runtime.

### UC-4: Existing Thread opens

1. User opens an existing Thread.
2. Desktop reads the full Agent Binding.
3. Agent chip shows one selected Agent label.
4. Model Chip and Composer Options use the saved Agent Runtime Source.

## Invariants

1. The Agent chip has one visible selected value.
2. Agent Runtime Source is part of Agent Binding.
3. Provider CLI Agents do not gain a `vendor_api_key` runtime branch just because an API-backed Agent exists.
4. Tide API Agents do not launch hidden PTY sessions.
5. Model Chip visual treatment is shared, but Model Source is source-specific.
6. Launch Option values remain provider-native strings even when visible chip labels are polished.
7. A started Thread locks Agent Binding including Agent Runtime Source.
8. Readiness copy names the active source and does not mention hidden PTY for a Tide API Agent.

## Tests

| Rule | Test expectation |
|------|------------------|
| Agent menu preserves one chip | `agent_menu_selection_updates_one_visible_agent_chip` selects each option without rendering separate runtime chips. |
| Provider CLI source | `selecting_codex_cli_sets_provider_cli_runtime_source` stores `runtimeSource.kind = "provider_cli"` and `integrationId = "codex"`. |
| Tide API source | `selecting_openai_api_sets_tide_api_runtime_source` stores `runtimeSource.kind = "tide_api"` and `provider = "openai"`. |
| Product Shell command contract | `product_shell_start_command_uses_contract_runtime_source_shape` validates the emitted Start Composer command against Shared Contracts. |
| Model source split | `model_chip_uses_agent_runtime_source_specific_model_source` routes Codex CLI model choices to Agent Integration and OpenAI API model choices to Provider Account model metadata. |
| Model label/value split | `sending_start_composer_from_product_shell_uses_provider_native_model_value` verifies Product Shell sends a provider-native Codex model id while rendering the polished chip label. |
| No fake API branch under CLI | `provider_cli_agent_binding_does_not_accept_vendor_api_key_runtime_branch` rejects `vendor_api_key` as a Codex CLI runtime branch. |
| API readiness copy | `openai_api_readiness_mentions_provider_account_not_hidden_pty` verifies API setup copy does not mention hidden PTY, Directory Trust, or provider CLI hooks. |
| Binding locked | `follow_up_thread_keeps_agent_runtime_source_locked` rejects follow-up input that tries to change the Agent Runtime Source. |

## Implementation Notes

- Update Shared Contracts before implementing OpenAI API as a real selectable Agent.
- Keep Provider CLI Agent Integration code separate from Tide API Agent runtime code.
- Keep Composer chip components source-agnostic and feed them source-specific menu data.
- Keep Provider Account storage and API credential handling out of Desktop UI state.
- Do not infer OpenAI API support from Codex CLI support. They are separate runtime sources even if both can show OpenAI model names.
