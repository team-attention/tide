# Spec: Tide API Agent Runtime

## Scope

This spec implements the first Tide API Agent runtime path for the `openai_api` Agent.

It covers:

- OpenAI Provider Account readiness through an API key source owned by Backend.
- Tide API Agent runtime start, resume, input send, and stop through the shared Agent Runtime Port.
- OpenAI Responses API request construction for one Composer input.
- Raw Agent Frame projection for API responses without launching a Provider CLI hidden PTY.
- Runtime/readiness routing between Provider CLI Agents and Tide API Agents.

It does not cover:

- Encrypted Provider Account storage.
- Provider Account setup UI.
- Streaming delta rendering.
- Tool execution by OpenAI API models; see `docs_v2/specs/tide-api-agent-tool-calls.md`.
- Model catalog discovery.
- Multi-turn server-side conversation state.

## Evidence

- `docs_v2/master-plan.md` says OpenAI API uses a Tide API Agent Runtime Source and that API key setup is Provider Account readiness, not a Provider CLI `vendor_api_key` branch.
- `docs_v2/specs/composer-agent-runtime-source.md` says OpenAI API is a Tide API Agent, uses Provider Account readiness and Tide-owned API runtime, and does not launch a Provider CLI hidden PTY.
- `src/shared/contracts/agent.ts` and `src/backend/application/domains/thread/thread.ts` define `openai_api` with `runtimeSource.kind = "tide_api"` and `provider = "openai"`.
- `src/backend/adapters/outbound/agent-runtime/agent-integration-agent-runtime-port.ts` currently rejects Tide API Agents in the Provider CLI runtime port and returns a Provider Account blocker from the Provider CLI readiness adapter.
- `src/backend/application/services/thread-runtime-service.ts` owns Thread lifecycle and calls `ProviderReadinessPort.check`, `AgentRuntimePort.start`, and `AgentRuntimePort.writeInput` without knowing provider transport details.
- `src/backend/application/domains/agent-session/raw-agent-frame.ts` already supports `structured_batch` Raw Agent Frames with JSON payloads.
- `src/backend/application/services/fixture-agent-session-reader.ts` converts a JSON payload with `type = "message"` into an `agent_message` Agent Session Block.
- OpenAI docs show the Responses API accepts `model` and `input`, returns `output_text`, and curl examples send `Authorization: Bearer $OPENAI_API_KEY` to `https://api.openai.com/v1/responses`.

## Decisions

### D1. Tide API readiness is separate from Provider CLI readiness

Provider CLI readiness remains owned by Provider CLI Agent Integrations.

`openai_api` readiness is owned by the Tide API Agent path and checks for an OpenAI Provider Account API key.

For the first implementation, Backend reads:

- `OPENAI_API_KEY` as the required Provider Account credential.
- `OPENAI_BASE_URL` as an optional API base URL.
- `OPENAI_MODEL` as an optional default model id.

Missing `OPENAI_API_KEY` returns `provider_account_required`.

### D2. Runtime routing is explicit

The shared `AgentRuntimePort` stays the service boundary.

A runtime router dispatches:

- Provider CLI Agent Binding to the Provider CLI runtime port.
- Tide API Agent Binding to the Tide API runtime port.

The same split applies to Provider Readiness.

### D3. OpenAI API output becomes structured Raw Agent Frame

The OpenAI runtime does not emit PTY transcript frames.

When the Responses API returns text, Backend appends a Raw Agent Frame:

- `source = "structured_batch"`
- `payloadKind = "json"`
- `payload.type = "message"`
- `payload.role = "agent"`
- `payload.body = response output text`

The existing Agent Session Reader then renders the frame as an Agent Session Block.

### D4. Model value sent to OpenAI is an API model id

The Tide API runtime sends the model id from Launch Options when present.

If Launch Options do not include a model, it uses the Provider Account default model. If that is absent, it uses `gpt-5.5`, matching the current OpenAI text generation example.

The Runtime does not borrow Codex CLI model state.

### D5. First API runtime is single-turn per Composer input

For this slice, each Composer input creates one Responses API request.

Multi-turn server-side state, previous response id chaining, and streaming deltas stay out of scope until the first real API-backed Thread path is stable.

### D6. Smoke checks must verify API Agent output

The live Provider and Electron smoke scripts must not treat `openai_api` as a label-only route check.

When an OpenAI Provider Account is available, or when the smoke is explicitly launched with a fake OpenAI endpoint, the smoke must verify that an Agent Session Block contains the requested token. The fake endpoint exists only for local deterministic verification of Tide's Backend/Desktop wiring; production readiness still depends on a real Provider Account.

### D7. API Agent output is pushed, not only hydrated

OpenAI API responses arrive during `AgentRuntimePort.writeInput`. The live Backend must await structured Raw Agent Frame projection so Desktop receives `agentSessionBlock.upserted` through the Backend push channel. A later `thread.hydrate` may still confirm durable state, but it is not the primary UI update path.

## Domain Model

```ts
interface OpenAiProviderAccount {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

interface OpenAiResponseClient {
  createResponse(input: {
    account: OpenAiProviderAccount;
    model: string;
    input: string;
  }): Promise<{
    responseId?: string;
    outputText: string;
    raw: unknown;
  }>;
}
```

## Flow

### UC-1: Missing OpenAI Provider Account

1. User selects OpenAI API.
2. User sends a Composer draft.
3. Backend routes readiness to Tide API readiness.
4. Tide API readiness cannot read `OPENAI_API_KEY`.
5. Backend returns `provider_account_required` and preserves pending input.

### UC-2: Start OpenAI API Thread

1. User selects OpenAI API.
2. User sends a Composer draft with an API model id in Launch Options.
3. Backend routes readiness to Tide API readiness.
4. Backend routes runtime start to Tide API runtime.
5. Backend records the local user block.
6. Tide API runtime sends the Composer input to OpenAI Responses API.
7. Runtime emits a structured Raw Agent Frame for the response text.
8. Agent Session Reader projects the frame into an `agent_message` block.
9. Live Backend pushes the projected Agent Session Block to Desktop.

### UC-3: Provider CLI Agents Still Use Provider CLI Runtime

1. User selects Codex CLI, Claude Code, or Antigravity CLI.
2. Backend routes readiness and runtime calls to the existing Provider CLI adapters.
3. Tide API runtime is not called.

## Invariants

1. `openai_api` never launches a Provider CLI hidden PTY.
2. Provider CLI Agent Integrations do not gain an API-key runtime branch for OpenAI API.
3. Provider Account readiness belongs to Backend, not Desktop UI state.
4. OpenAI API output is represented as structured Raw Agent Frames, not PTY Transcript frames.
5. The Thread Runtime Service stays transport-agnostic behind `AgentRuntimePort` and `ProviderReadinessPort`.
6. The model sent to OpenAI is an API model id, not a Codex CLI model label.
7. OpenAI API Agent output must be visible through the live event push channel without requiring a manual hydrate first.

## Tests

| Rule | Test |
|------|------|
| Missing API key blocks OpenAI API only through Provider Account readiness | `openai_provider_account_readiness_requires_api_key` |
| Runtime router sends Tide API Agent starts to Tide API runtime | `agent_runtime_router_dispatches_openai_api_to_tide_api_runtime` |
| Readiness router sends Provider CLI agents to Provider CLI readiness | `provider_readiness_router_keeps_codex_on_provider_cli_readiness` |
| OpenAI runtime sends Responses API request and emits structured message frame | `openai_api_runtime_sends_response_request_and_emits_structured_message_frame` |
| OpenAI response parsing reads `output_text` and falls back to output message content | `openai_response_client_extracts_output_text_and_message_content` |
| Provider smoke can verify OpenAI API output without external network | `provider_smoke_supports_fake_openai_output_verification` |
| Electron smoke can verify OpenAI API output without external network | `electron_runtime_smoke_supports_fake_openai_output_verification` |
| Live Backend awaits structured frame projection for push events | `live_backend_awaits_tide_api_structured_frame_projection_for_push_events` |

## Implementation Notes

- Keep OpenAI API transport in `src/backend/adapters/outbound/agent-runtime`.
- Keep environment variable reads in Backend infrastructure wiring and tests, not Desktop.
- Keep `fetch` injectable so tests never call the network.
- Keep emitted payloads compatible with the existing `FixtureAgentSessionReader` message payload shape.
