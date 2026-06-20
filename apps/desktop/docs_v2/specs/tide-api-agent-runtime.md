# Spec: Direct API Agent Runtime

## Status

Removed, superseded 2026-06-20.

Tide v2 no longer ships a Tide-owned direct API Agent runtime. The current product surface
supports four provider CLI Agents: Codex, Claude, Gemini, and opencode.

## Decision

The removed path used a separate Tide-owned OpenAI/API runtime, provider-account readiness,
and runtime/readiness routers. That created a second Agent lifecycle beside provider CLIs
and expanded the edge-case surface around first-turn delivery, prompt handling, MCP tools,
model menus, and setup states.

Current behavior:

- Agent Binding accepts provider CLI identities only.
- Backend live wiring passes Thread runtime calls directly to the provider CLI runtime port.
- Provider readiness is provider CLI readiness only.
- Provider CLI first prompts are delivered through the provider launch path.
- opencode vendor API keys are provider-owned opencode credentials, not a separate Tide
  Agent runtime.
- Legacy direct API Agent bindings are rejected by Shared Contracts.

## Removed Code Paths

- Direct API runtime port.
- Runtime/readiness router between provider CLI and direct API runtime.
- Fake OpenAI smoke server options.
- API-agent-specific smoke tests.
- Direct API Agent UI rows and model-source branches.

## Current Tests

| Rule | Test |
|------|------|
| Live Backend does not wire the removed runtime | `live_backend_does_not_wire_openai_api_agent_runtime` |
| Contracts reject removed API agent shape | `thread_start_rejects_openai_api_and_tide_api_runtime_source` |
| Provider smoke is provider CLI only | `provider_smoke_is_limited_to_provider_cli_agents` |
| Electron smoke is provider CLI only | `electron_runtime_smoke_is_limited_to_provider_cli_agents` |
