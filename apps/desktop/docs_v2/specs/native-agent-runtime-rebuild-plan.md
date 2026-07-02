# Native Agent Runtime Rebuild Plan

Status: implementation plan with core rebuild progress
Date: 2026-07-02
Parent context: `native-agent-runtime-fidelity.md`

This plan turns the native-agent runtime decisions into an implementation
direction. Tide is being rebuilt as a first-class coding-agent host, not as a
compatibility wrapper around older runtime code.

## Non-Negotiables

- Decide from provider executable and runtime protocol evidence, not from UI
  resemblance.
- Implement provider features from the selected executable, generated schema,
  protocol frames, or redacted fixtures before exposing them in UI.
- Tide owns the runtime process for every agent turn.
- Do not attach agent turns to already-running provider-owned processes or
  externally-started servers.
- Do not preserve old runtime code, old contracts, or old tests merely for
  backward compatibility.
- If old code conflicts with the new architecture, delete or replace it.
- If existing persisted Tide data conflicts with the new model, support a clean
  reset/export path instead of preserving old internal shapes.
- Provider-owned logs remain provider-owned; Tide native evidence is for
  projection debugging, replay, and bug reports.
- Public docs, fixtures, tests, and code comments must only contain sanitized
  runtime evidence and implementation contracts.

## Architecture Principle

Tide's center is general, but provider capability is not lowest-common-denominator.

Shared core owns:

- runtime process ownership;
- native runtime event envelopes;
- provider-native reducers;
- semantic block projection;
- capability catalog contracts;
- reduced evidence storage;
- renderer contracts.

Provider adapters own:

- executable discovery and launch args;
- transport details;
- schema/method mapping;
- native event ids and lifecycle correlation;
- command, skill, model, permission, MCP/tool, usage, and activity capability
  mappings;
- provider-specific unsupported states.

The renderer should consume semantic blocks and capability entries. It should
not parse raw provider frames. When a provider has a native structured method or
event, the adapter must preserve it through native evidence and semantic
projection instead of flattening it to prompt text.

## Current Implementation Status

Core rebuild pieces now exist in source:

- native runtime event, state, semantic block, capability, and evidence
  contracts;
- provider reducer/projector pipeline from native events to semantic blocks;
- Codex, Claude, and ACP-family capability registries with explicit invoke
  kinds;
- backend command path for provider capability invocation;
- grouped renderer capability surfaces instead of one flat slash row list;
- reduced native evidence snapshots, opt-in bounded raw frame ring, and
  archive/delete cleanup;
- renderer debug provenance labels for semantic blocks;
- native `parentBlockId` propagation from provider reducer through backend DTOs
  to renderer block views;
- prompt-state native id propagation so live provider approvals can be linked to
  the command, file, or tool block they gate;
- fixture replay that feeds redacted native JSONL events through reducer and
  projector code;
- ACP provider capability projection from initialize results, including the Qwen
  auth-required fixture before session start.

Remaining work is provider fixture completeness and live matrix verification,
not a change to the architecture:

- add deeper provider-specific redacted fixtures for Codex streaming/file-diff
  progress, Claude control/usage/activity edge cases, and ACP command/config/
  permission/tool update variants;
- replace any still-broad structured reducer behavior when those fixtures prove
  provider-specific lifecycle distinctions;
- add authenticated Qwen ACP session/tool fixtures before enabling Qwen as a
  selectable runtime;
- run live Codex, Claude, and opencode matrix checks and compare them with
  fixture replay output.

## Rebase Stability

This plan is meant to survive the upcoming main-branch rebase at the architecture
level. Rebase may change exact module paths, existing file names, or old tests to
delete, but it should not change these decisions:

- Tide-owned runtime process per thread;
- Codex app-server, Claude stream-json, and ACP-family runtime clients;
- native event -> provider reducer -> semantic projection pipeline;
- capability catalog with explicit invoke kinds;
- reduced native evidence by default;
- no compatibility layer for obsolete runtime contracts.

After rebase, reconcile the source module map against the new tree before
coding. Change the plan only if new provider runtime evidence contradicts a
decision here.

## Public Documentation Hygiene

Implementation may require local scratch captures while proving provider
behavior. Those captures do not belong in the repo. Before any doc, fixture,
test, or code comment is committed, reduce the information to one of these
public forms:

- provider executable name and version;
- provider command help relevant to a runtime command;
- generated runtime schema from the selected executable;
- redacted protocol frame or replay fixture;
- Tide launch contract, adapter contract, reducer contract, or renderer
  contract;
- explicit unsupported-feature note backed by executable help or protocol
  evidence.

Do not commit:

- local absolute paths from a developer machine;
- non-runtime application package internals;
- machine-specific process observations;
- unredacted prompts, command output, diffs, credentials, environment values, or
  filesystem paths;
- notes that describe how a local scratch capture was collected when the
  implementation only needs the resulting runtime contract.

## Public Evidence Collected

Runtime-facing evidence captured on 2026-07-02:

| Surface | Evidence | Decision impact |
| --- | --- | --- |
| Codex CLI | `codex-cli 0.141.0` was available from the selected runtime executable. | Usable default executable source. |
| Codex app-server | `codex app-server --help` exposes `stdio://`, `unix://`, `ws://`, schema generation. Generated schema exposes `thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`, `thread/compact/start`, `thread/fork`, `thread/goal/*`, `thread/settings/update`, `skills/list`, `review/start`, `model/list`, `permissionProfile/list`, `mcpServer*`. | Runtime is Tide-spawned app-server. Slash/session actions need a real Codex command registry. |
| Claude Code | `claude 2.1.191`; help exposes `--print`, `--input-format stream-json`, `--output-format stream-json`, `--include-partial-messages`, permissions, model, effort, MCP, plugins, and skills. | Runtime is Tide-spawned stream-json CLI. Preserve stream blocks/control requests. |
| opencode | `opencode 1.17.3`; help exposes `acp`, `serve`, `web`, `models`, `providers/auth`, `agent`, session import/export. | Runtime default remains ACP. |
| opencode ACP live handshake | `initialize` returned `protocolVersion`, `agentCapabilities`, `authMethods`, `agentInfo`; `session/new` returned `sessionId`, `configOptions`; `session/update` emitted `available_commands_update`. | ACP is real enough for session lifecycle, config, commands, and future ACP-family reuse. |
| opencode serve live OpenAPI | Tide-spawned `opencode serve --port 0 --hostname 127.0.0.1` exposed `/doc` with `/api/event`, `/api/session`, `/api/session/{id}/prompt`, permission/question reply, wait, compact, message, provider, config, MCP; prompt schema includes `delivery: "steer" | "queue"`. | Serve is a real opencode-native runtime surface, but not the default runtime because ACP is the common open-agent path. Use serve for support surfaces unless fixtures prove ACP cannot preserve required semantics. |
| Qwen Code | `qwen 0.19.4`; help exposes `--acp`, `qwen serve`, stream-json, `--approval-mode`, MCP config, extensions, channel choices, resume/fork, `--input-file`, `--json-fd`. ACP `initialize` returns `agentInfo`, `authMethods`, and `agentCapabilities`; unauthenticated `session/new` returns an auth-required protocol error. | Treat as ACP-family target first. Do not expose Qwen as selectable until authenticated session/tool fixtures exist. |
| Gemini CLI | no longer in Tide scope | Do not build a Gemini adapter in this rebuild. |
| agy | `agy 1.0.15`; help exposes print/interactive/conversation/model/plugin/sandbox, but ACP support is not strong enough for this rebuild. | Keep deferred until robust ACP or another structured machine protocol is proven. |

Current Tide code evidence:

| Code surface | Evidence | Decision impact |
| --- | --- | --- |
| `ProviderLaunchPlan.transport` | Currently `claude_stream_json | codex_app_server | acp`. | Runtime architecture is already structured-protocol oriented; add new transports only when evidence justifies them. |
| Codex integration | Uses app-server transport and marks `supportsTurnSteer: true`. | Keep Codex-specific active-turn capability, but product default remains queue + interrupt. |
| Claude integration | Uses stream-json transport and marks `supportsTurnSteer: false`. | Keep unified queue + interrupt. Preserve Claude block/control identities. |
| opencode integration | Builds `args: ["acp"]`, `transport: "acp"`, maps model/effort/permission to ACP `session/set_config_option`. | Keep ACP runtime. Generalize adapter shape for Qwen. |
| `AcpClient` | Handles initialize, session/new/load, session/prompt, queued prompts, session/cancel, permission requests, `available_commands_update`, model catalog, config options, tool/thought/message updates. | Promote to ACP-family runtime client with provider extension preservation. |
| `opencode-auth-server.ts` | Spawns Tide-owned `opencode serve` for provider auth API and explicitly says it is not per-thread runtime. | Keep serve as support surface unless runtime fixtures prove otherwise. |

## Final Runtime Decisions

### Process Ownership

Every provider runtime is Tide-spawned and Tide-owned.

Allowed:

- `codex app-server` child owned by Tide.
- `claude --print --input-format stream-json --output-format stream-json` child
  owned by Tide.
- `opencode acp` child owned by Tide.
- Future `qwen --acp` children owned by Tide.
- Tide-owned support processes, such as `opencode serve` for auth/catalog.

Not allowed:

- Attaching agent turns to already-running provider-owned processes or an
  externally-started opencode/Qwen server.
- Building a runtime path that requires a non-runtime companion app.
- Mixing two runtime transports for one live thread.

### Provider Transports

| Provider | Runtime transport | Status |
| --- | --- | --- |
| Codex | `codex_app_server` over stdio/unix/ws, spawned by Tide | Primary |
| Claude Code | `stream_json` over stdio, spawned by Tide | Primary |
| opencode | ACP over stdio, spawned by Tide | Primary |
| Qwen Code | ACP over stdio, spawned by Tide | Planned after authenticated fixtures |
| Gemini CLI | None | Out of scope |
| agy | None | Deferred until robust structured protocol evidence exists |

### opencode ACP vs serve

Default: keep `opencode acp` as runtime.

Reasons:

- It already works with Tide's structured runtime shape.
- It shares a protocol family with Qwen.
- It gives Tide one reusable open-agent adapter instead of an opencode-only HTTP
  runtime branch.
- Live handshake proves session lifecycle, config options, command discovery,
  and updates are available through ACP.

`opencode serve` remains useful for:

- provider auth;
- provider/model/catalog support surfaces;
- evidence fixtures comparing opencode-native semantics against ACP;
- a future explicit opencode-only runtime switch if ACP cannot preserve required
  semantics.

Rule: never use ACP and serve together for one opencode thread.

### Active Input

Product default: queue follow-up input while a turn is running, with interrupt
available to stop the current turn and run queued input.

Provider capability:

- Codex app-server has `turn/steer`; preserve this as Codex capability metadata.
- Do not make Codex steering the default cross-provider behavior.
- If exposed, it should be an explicit "steer active Codex turn" action.

### Native Evidence Retention

Default retention:

- Persist reduced native snapshots per projected block.
- Snapshot includes provider, transport, native ids, method/kind, timestamps,
  status, parent/turn ids, and small redacted summaries.
- Snapshot does not store full command output, full diff, full prompt text, API
  keys, or full raw tool payloads by default.

Debug retention:

- Add a per-thread or env-gated raw frame ring.
- Cap by both count and bytes, for example 2,000 frames or 10 MB per thread.
- TTL defaults to 7 days.
- Thread archive/delete removes Tide-owned raw evidence.
- Export can include raw evidence only when explicitly requested.

Provider logs:

- Codex/Claude/opencode session logs are not Tide's canonical evidence store.
- They remain provider-owned history/resume artifacts.
- Tide may reference them by provider session id or provider log locator but
  should not mutate or normalize them into Tide's own source of truth.

### Semantic Blocks

Use semantic block kinds for shared lifecycles, always with native ids and native
payload reference/snapshot:

- `message`
- `reasoning`
- `plan`
- `command_run`
- `file_change`
- `tool_call`
- `mcp_call`
- `approval_prompt`
- `question_prompt`
- `session_event`
- `config_state`
- `agent_activity`
- `usage`
- `notice`

`usage` and `agent_activity` are first-class runtime state surfaces:

- `usage` is live usage/accounting/quota state when the provider exposes it. It
  should render in transcript-adjacent status areas and can also produce a
  semantic block when a provider emits a discrete usage event.
- `agent_activity` is live subagent/task/worker/team state when the provider
  emits structured lifecycle data. It should render as running/completed/failed
  activity, not as plain assistant prose.

Do not infer cost, token totals, team membership, or subagent lifecycle from
natural-language text. Unknown fields remain unavailable.

Each block must include:

- Tide block id;
- provider;
- transport;
- thread id;
- runtime id;
- turn id when available;
- native item/request/call ids when available;
- lifecycle status;
- ordered timestamps;
- semantic body/summary;
- native snapshot or native evidence reference.

Provider-specific block kinds are allowed only when the semantic lifecycle would
be false.

### Capability Catalog

Build one provider capability catalog, then render it in distinct UI sections.

Catalog entry kinds:

- `prompt_command`
- `skill`
- `session_action`
- `config_control`
- `permission_control`
- `mcp_surface`
- `tool_surface`
- `provider_setup`

Invoke kinds:

- `provider_method`
- `provider_prompt_text`
- `provider_structured_prompt_metadata`
- `provider_config`
- `tide_surface`
- `unsupported`

UI grouping:

- Slash prompt commands are not visually mixed with model/permission controls.
- Skills use their own `$` surface.
- Model/effort/permission controls are capability entries but rendered as
  controls, not prompt commands.
- MCP/tool status and setup surfaces are visible capabilities, not hidden
  generic rows.

### Skills

Skill invocation is provider-owned.

- Codex: use `skills/list` and captured invocation frames to decide whether a
  selection becomes prompt text, structured metadata, or app-server method.
- Claude: use `system/init.skills`, CLI skill behavior, and live stream-json
  frames.
- ACP providers: capture provider command/skill metadata from ACP init/session
  updates. Preserve provider extension fields.

Treat `$skill` as provider-owned. Text insertion is allowed only when evidence
proves that is the provider's real behavior.

## Replacement Architecture

### Layer 1: Evidence Harness

Create repeatable probes before writing provider behavior by hand.

Suggested location:

```text
apps/desktop/docs_v2/evidence/native-agent-runtime/
apps/desktop/src/backend/adapters/outbound/agent-runtime/__fixtures__/
```

Evidence bundle per provider/version:

```text
provider.json              # executable name/version, help hash, redaction manifest
runtime-help.txt           # relevant help output
schema/                    # generated schema when available
handshake.jsonl            # init/session frames
turn-basic.jsonl           # prompt, deltas, completion
turn-tool.jsonl            # tool call/progress/result
turn-permission.jsonl      # permission request/answer
turn-config.jsonl          # model/effort/permission changes
turn-usage.jsonl           # usage/quota/accounting updates
turn-activity.jsonl        # subagent/task/worker/team lifecycle if emitted
turn-interrupt.jsonl       # cancel/interrupt behavior
capabilities.json          # normalized discovered capability catalog
notes.md                   # unsupported behavior and redactions
```

Fixtures should be redacted and small. Raw full captures stay in debug evidence,
not committed by default.

### Layer 2: Runtime Clients

Runtime clients emit native events, not UI blocks.

Clients:

- `CodexAppServerRuntimeClient`
- `ClaudeStreamJsonRuntimeClient`
- `AcpRuntimeClient`

Do not add an `OpencodeServeRuntimeClient` in this rebuild. `opencode serve`
stays a support/evidence surface unless a later fixture proves ACP cannot
preserve required opencode semantics.

Client output:

```ts
type NativeRuntimeEvent = {
  provider: "codex" | "claude" | "opencode" | "qwen";
  transport: "codex_app_server" | "claude_stream_json" | "acp";
  runtimeId: string;
  threadId: string;
  nativeSequence: number;
  receivedAt: string;
  nativeKind: string;
  nativeIds: Record<string, string>;
  payload: unknown;
};
```

### Layer 3: Provider Native Reducers

Each provider family reduces native events into native state.

- Codex reducer tracks `ThreadItem`, turn, request, command, file change, MCP,
  plan, reasoning, approval, and server request lifecycles.
- Claude reducer tracks stream-json message blocks, `tool_use`, `tool_result`,
  `control_request`, permission, questions, partials, usage/accounting events,
  and subagent/task activity.
- ACP reducer tracks session, prompt, tool updates, permission requests,
  commands, configOptions, usage/quota, provider activity extensions, plan,
  message/thought chunks.

Reducers preserve native ids and do not emit renderer-specific components.

### Layer 4: Semantic Projection

Projection maps provider-native state into Tide semantic blocks.

Projection rules:

- Upsert streaming blocks by stable native id.
- Do not collapse request ids into text.
- Keep approval/question prompts linked to the native tool/call they authorize.
- Preserve command/file/MCP progress as in-place updates.
- Record unsupported native events as `notice` or `session_event`, not silent
  drops.

### Layer 5: Capability Registry

Each adapter supplies a provider capability registry.

Codex registry sources:

- generated app-server methods;
- live `skills/list`;
- manual capability audit for provider-local projections.

Claude registry sources:

- stream-json `system/init`;
- CLI help;
- plugin/skill surfaces;
- control request capabilities.

ACP registry sources:

- initialize/session result;
- `available_commands_update`;
- configOptions/model catalog;
- provider extension fields.

### Layer 6: Renderer

Renderer consumes semantic blocks and capabilities.

Renderer must not branch directly on raw provider frame shape except through
provider-specific render extensions stored on the semantic block.

Renderer must treat usage and activity as live runtime state:

- usage appears in status/summary surfaces with the provider's native scope and
  units preserved;
- subagent/task/team activity appears as lifecycle rows with stable native ids,
  parent links, and status transitions;
- unsupported or missing provider fields are hidden or marked unavailable,
  never guessed.

## Implementation-Ready Detail

This section is the minimum detail needed for implementation. If code work
starts before these contracts exist in source, implementation will drift.

### Source Module Map

Create or replace these modules:

| Module | Role |
| --- | --- |
| `apps/desktop/src/backend/application/domains/native-agent/native-runtime-event.ts` | Shared `NativeRuntimeEvent`, ids, evidence snapshot, and redaction types. |
| `apps/desktop/src/backend/application/domains/native-agent/native-runtime-state.ts` | Provider-native state envelopes and reducer output contracts. |
| `apps/desktop/src/backend/application/domains/native-agent/semantic-agent-block.ts` | Provider-neutral semantic block contracts consumed by persistence/renderer. |
| `apps/desktop/src/backend/application/domains/native-agent/provider-capability.ts` | Capability catalog and invoke contracts. |
| `apps/desktop/src/backend/adapters/outbound/agent-runtime/clients/codex-app-server-runtime-client.ts` | Tide-owned Codex app-server transport client. |
| `apps/desktop/src/backend/adapters/outbound/agent-runtime/clients/claude-stream-json-runtime-client.ts` | Tide-owned Claude stream-json transport client. |
| `apps/desktop/src/backend/adapters/outbound/agent-runtime/clients/acp-runtime-client.ts` | ACP-family transport client for opencode/Qwen. |
| `apps/desktop/src/backend/adapters/outbound/agent-runtime/reducers/codex-native-reducer.ts` | Codex native lifecycle reducer. |
| `apps/desktop/src/backend/adapters/outbound/agent-runtime/reducers/claude-native-reducer.ts` | Claude native lifecycle reducer. |
| `apps/desktop/src/backend/adapters/outbound/agent-runtime/reducers/acp-native-reducer.ts` | ACP native lifecycle reducer. |
| `apps/desktop/src/backend/adapters/outbound/agent-runtime/projectors/native-to-semantic-blocks.ts` | Provider-native state to semantic block projection. |
| `apps/desktop/src/backend/adapters/outbound/agent-runtime/evidence/native-evidence-store.ts` | Reduced snapshot storage and debug raw-frame ring. |
| `apps/desktop/src/backend/adapters/outbound/agent-integrations/codex/codex-capability-registry.ts` | Codex app-server/slash/session/skill registry. |
| `apps/desktop/src/backend/adapters/outbound/agent-integrations/claude/claude-capability-registry.ts` | Claude stream-json/help/skill registry. |
| `apps/desktop/src/backend/adapters/outbound/agent-integrations/acp/acp-provider-factory.ts` | Shared ACP adapter factory for opencode/Qwen. |
| `apps/desktop/src/backend/adapters/outbound/agent-integrations/opencode/opencode-acp-profile.ts` | opencode ACP launch/config/profile mapper. |
| `apps/desktop/src/backend/adapters/outbound/agent-integrations/qwen/qwen-acp-profile.ts` | Qwen ACP launch/config/profile mapper. |
| `apps/desktop/scripts/native-agent-evidence/*.mjs` | Repeatable evidence capture scripts. |

Replace or delete these existing modules if they cannot conform:

| Existing module | Action |
| --- | --- |
| `structured-runtime-events.ts` | Replace with native event contracts or keep only as a temporary filename during the rewrite. |
| `agent-integration-agent-runtime-port.ts` | Rewrite around runtime client -> native reducer -> semantic projector pipeline. |
| `runtime-turn-reducer.ts` | Replace generic transcript contracts with semantic block reducer. |
| `thread-runtime-events.ts` | Rewrite to persist semantic blocks and native evidence snapshots. |
| `composer` command discovery paths | Replace curated rows with provider capability catalog entries. |
| Old tests asserting generic `tool_call/tool_result` without native ids | Delete or rewrite. |

### Core Type Contracts

These are the target contracts. Field names can change during implementation,
but no implementation should remove the concepts without new evidence.

```ts
export type NativeProviderId =
  | "codex"
  | "claude"
  | "opencode"
  | "qwen";

export type NativeTransport =
  | "codex_app_server"
  | "claude_stream_json"
  | "acp";

export interface NativeRuntimeEvent {
  eventId: string;
  provider: NativeProviderId;
  transport: NativeTransport;
  runtimeId: string;
  tideThreadId: string;
  providerSessionId?: string;
  nativeSequence: number;
  receivedAt: string;
  nativeKind: string;
  nativeIds: {
    threadId?: string;
    turnId?: string;
    itemId?: string;
    requestId?: string;
    callId?: string;
    messageId?: string;
    blockId?: string;
  };
  payload: unknown;
  redaction: "raw" | "reduced" | "summary_only";
}

export interface NativeEvidenceSnapshot {
  eventId: string;
  provider: NativeProviderId;
  transport: NativeTransport;
  nativeKind: string;
  nativeIds: NativeRuntimeEvent["nativeIds"];
  receivedAt: string;
  summary: string;
  payloadShape: string[];
  redactedFields: string[];
  rawRef?: string;
}

export type NativeLifecycleStatus =
  | "pending"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled";

export interface NativeStatePatch {
  provider: NativeProviderId;
  runtimeId: string;
  providerSessionId?: string;
  affectedNativeIds: NativeRuntimeEvent["nativeIds"][];
  semanticDirtyKeys: string[];
  evidence: NativeEvidenceSnapshot[];
}
```

Semantic blocks:

```ts
export type SemanticAgentBlockKind =
  | "message"
  | "reasoning"
  | "plan"
  | "command_run"
  | "file_change"
  | "tool_call"
  | "mcp_call"
  | "approval_prompt"
  | "question_prompt"
  | "session_event"
  | "config_state"
  | "agent_activity"
  | "usage"
  | "notice";

export interface SemanticAgentBlock {
  blockId: string;
  kind: SemanticAgentBlockKind;
  provider: NativeProviderId;
  transport: NativeTransport;
  tideThreadId: string;
  runtimeId: string;
  providerSessionId?: string;
  nativeIds: NativeRuntimeEvent["nativeIds"];
  parentBlockId?: string;
  status: NativeLifecycleStatus;
  title?: string;
  body?: string;
  data: Record<string, unknown>;
  evidence: NativeEvidenceSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export type UsageScope = "turn" | "thread" | "session" | "provider_account";

export interface UsageBlockData {
  scope: UsageScope;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  quotaRemaining?: number;
  rateLimitResetAt?: string;
  nativeUnits?: Record<string, unknown>;
}

export type AgentActivityStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentActivityBlockData {
  activityKind: "subagent" | "task" | "worker" | "team" | "provider_extension";
  label: string;
  role?: string;
  summary?: string;
  status: AgentActivityStatus;
  parentNativeId?: string;
  startedAt?: string;
  endedAt?: string;
  nativeFields?: Record<string, unknown>;
}
```

Capability catalog:

```ts
export type ProviderCapabilityKind =
  | "prompt_command"
  | "skill"
  | "session_action"
  | "config_control"
  | "permission_control"
  | "mcp_surface"
  | "tool_surface"
  | "provider_setup";

export type ProviderCapabilityInvoke =
  | { kind: "provider_method"; method: string; params?: unknown }
  | { kind: "provider_prompt_text"; text: string }
  | { kind: "provider_structured_prompt_metadata"; metadata: unknown }
  | { kind: "provider_config"; key: string; value?: unknown }
  | { kind: "tide_surface"; surface: string; payload?: unknown }
  | { kind: "unsupported"; reason: string };

export interface ProviderCapability {
  capabilityId: string;
  provider: NativeProviderId;
  source: "live_protocol" | "generated_schema" | "cli_help" | "manual_audit" | "tide_local";
  kind: ProviderCapabilityKind;
  trigger?: "/" | "$";
  label: string;
  description?: string;
  group: "commands" | "skills" | "session" | "model" | "permission" | "mcp" | "tools" | "setup";
  invoke: ProviderCapabilityInvoke;
  nativePayload?: unknown;
  available: boolean;
}
```

### Provider Native Reducer Matrix

Codex reducer:

| Native input | Native identity | Semantic projection |
| --- | --- | --- |
| `thread/started`, `thread/status/changed` | `threadId` | `session_event`, thread status |
| `turn/started`, `turn/completed` | `turnId` | turn lifecycle, usage/notice |
| `item/started`, `item/completed` | `itemId`, `turnId` | creates or completes item-backed block |
| `item/agentMessage/delta` | `itemId` | upsert `message` block |
| `item/reasoning/*` | `itemId` | upsert `reasoning` block |
| `item/plan/delta`, `turn/plan/updated` | `turnId`, `itemId` | upsert `plan` block |
| `item/commandExecution/*`, `command/exec/outputDelta` | `itemId`, process id if present | upsert `command_run` block |
| `item/fileChange/*`, `turn/diff/updated` | `itemId` | upsert `file_change` block |
| `item/mcpToolCall/progress` | `itemId`, tool call id | upsert `mcp_call` block |
| server request approval params | server `requestId`, related item id | `approval_prompt` linked to command/file/tool block |
| `serverRequest/resolved` | server `requestId` | resolve prompt block |
| usage/accounting event if emitted | `turnId` or provider usage id | upsert `usage` state/block |
| task/worker/team activity if emitted | provider activity id | upsert `agent_activity` block |

Claude reducer:

| Native input | Native identity | Semantic projection |
| --- | --- | --- |
| `system/init` | session id when present | capability catalog seed |
| assistant text deltas/partials | message/block index or generated native block id | upsert `message` block |
| thinking/reasoning content | content block id/index | upsert `reasoning` block |
| `tool_use` | tool use id | create/update `tool_call` block |
| `tool_result` | tool use id | complete `tool_call` block or append result |
| `control_request` permission/config | request id/subtype | `approval_prompt`, `question_prompt`, or `config_state` |
| control response/ack | request id | resolve prompt/config state |
| usage/accounting event | message id, request id, or provider usage id | upsert `usage` state/block |
| subagent/task activity | task/subagent id | upsert `agent_activity` block |

ACP reducer:

| Native input | Native identity | Semantic projection |
| --- | --- | --- |
| initialize result | runtime id | capability seed |
| `session/new` / `session/load` result | `sessionId` | provider session binding, config catalog |
| `session/update.agent_message_chunk` | session id + generated stream block id | upsert `message` block |
| `session/update.agent_thought_chunk` | session id + generated stream block id | upsert `reasoning` block |
| `session/update.tool_call` | `toolCallId` | create `tool_call` block |
| `session/update.tool_call_update` | `toolCallId` | update/complete `tool_call` block |
| `session/update.plan` | plan entry ids if present | upsert `plan` block |
| `session/update.available_commands_update` | command names | capability catalog update |
| `session/request_permission` | server request id + `toolCall.toolCallId` | `approval_prompt` linked to tool block |
| `session/set_config_option` result | config id | `config_state` |
| usage/quota updates | session id | `usage` block/state |
| provider task/worker/team extension updates | provider extension id or generated stable native id | upsert `agent_activity` block |

### Projection Invariants

- A streaming native item updates one stable semantic block id.
- A permission or question block must include the provider request id needed to
  answer it.
- A permission linked to a tool/file/command must set `parentBlockId`.
- A provider-native id must never be replaced by a Tide-only generated id when
  the provider supplied one.
- Unknown native events are stored as evidence and surfaced as `session_event`
  in debug mode.
- Renderer display text is derived from semantic fields, not raw frame parsing.
- Usage data must preserve provider native scope and units; Tide may normalize
  display labels but must keep native values in the evidence snapshot.
- Agent activity must use a stable provider activity id when available; if no
  stable id exists, generate a deterministic id from provider session, turn, and
  activity path rather than creating a new row per update.
- Do not display inferred subagents, teams, token counts, or cost estimates
  unless the provider event or Tide-owned accounting code explicitly supplies
  the data.

### Capability Registry Detail

Codex initial registry:

| UI label | Invoke kind | Evidence |
| --- | --- | --- |
| Compact | `provider_method: thread/compact/start` | generated app-server schema |
| Goal | `provider_method: thread/goal/set|get|clear` | generated app-server schema |
| Fork | `provider_method: thread/fork` | generated app-server schema |
| Code review | `provider_method: review/start` | generated app-server schema |
| Model | `provider_method: model/list` + `thread/settings/update` | generated app-server schema |
| Permission profile | `provider_method: permissionProfile/list` + `thread/settings/update` | generated app-server schema |
| MCP status/config | `provider_method: mcpServerStatus/list`, `mcpServer/*`, `config/mcpServer/reload` | generated app-server schema |
| Skills | `provider_method: skills/list`; invocation disabled until fixture proves send path | generated app-server schema + live capture |
| Cloud/Open-in/Fork UI-only actions | `tide_surface` or `unsupported` until capability audit proves invoke path | manual capability audit and runtime evidence required |

Claude initial registry:

| Source | Capability |
| --- | --- |
| `system/init` | slash commands, skills, available tools, model/session metadata when present |
| CLI help | model, effort, permission mode, plugins, MCP config, agents/background flags |
| live control requests | permission/config actions actually accepted mid-session |

ACP initial registry:

| Source | Capability |
| --- | --- |
| initialize result | agent capabilities/auth methods |
| `session/new` result | `configOptions`, model catalog, current config |
| `available_commands_update` | prompt commands |
| permission options | provider-native approval choices |
| provider extension fields | preserved under `nativePayload` |

### Evidence Harness Scripts

Add these scripts; they must write redacted fixtures and a summary.

```text
apps/desktop/scripts/native-agent-evidence/capture-codex-app-server.mjs
apps/desktop/scripts/native-agent-evidence/capture-claude-stream-json.mjs
apps/desktop/scripts/native-agent-evidence/capture-acp-provider.mjs
apps/desktop/scripts/native-agent-evidence/capture-opencode-serve.mjs
apps/desktop/scripts/native-agent-evidence/redact-native-fixture.mjs
apps/desktop/scripts/native-agent-evidence/replay-native-fixture.mjs
```

Expected commands:

```bash
node apps/desktop/scripts/native-agent-evidence/capture-codex-app-server.mjs --codex /path/to/codex --out apps/desktop/docs_v2/evidence/native-agent-runtime/codex/0.142.5
node apps/desktop/scripts/native-agent-evidence/capture-claude-stream-json.mjs --claude /path/to/claude --out apps/desktop/docs_v2/evidence/native-agent-runtime/claude/2.1.191
node apps/desktop/scripts/native-agent-evidence/capture-acp-provider.mjs --provider opencode --command opencode --args acp --out apps/desktop/docs_v2/evidence/native-agent-runtime/opencode/1.17.3
node apps/desktop/scripts/native-agent-evidence/capture-acp-provider.mjs --provider qwen --command qwen --args --acp --out apps/desktop/docs_v2/evidence/native-agent-runtime/qwen/0.19.4
node apps/desktop/scripts/native-agent-evidence/capture-opencode-serve.mjs --command opencode --out apps/desktop/docs_v2/evidence/native-agent-runtime/opencode-serve/1.17.3
```

Fixture replay must feed captured native frames through reducer/projector tests
without launching provider executables.

### Test Plan By Layer

| Layer | Test file pattern | Required assertions |
| --- | --- | --- |
| Evidence redaction | `native-agent-evidence-redaction.test.ts` | prompts, env, command output, diffs, API keys are redacted by default |
| Codex reducer | `codex-native-reducer.test.ts` | item ids, request ids, command/file/MCP progress, server request resolution |
| Claude reducer | `claude-native-reducer.test.ts` | block ids, tool_use/tool_result correlation, control request prompts |
| ACP reducer | `acp-native-reducer.test.ts` | session id, toolCallId, permission request id, command update, configOptions |
| Semantic projector | `native-to-semantic-blocks.test.ts` | stable block ids, parent prompt links, status transitions, evidence snapshots |
| Usage projection | `native-usage-projection.test.ts` | provider scope/units preserved, unavailable fields are not guessed, live usage updates upsert |
| Agent activity projection | `native-agent-activity.test.ts` | subagent/task/team ids are stable, parent links preserved, lifecycle status updates in place |
| Capability registry | `provider-capability-registry.test.ts` | invoke kinds are correct and config controls are not prompt commands |
| Runtime lifecycle | `native-runtime-lifecycle.test.ts` | one owned process per thread, stop cleanup, interrupt behavior |
| Renderer contract | `semantic-agent-block-rendering.test.tsx` | renderer consumes semantic blocks only, no raw provider parsing, usage/activity render from semantic data |
| Live smoke | `native-agent-live-smoke.test.ts` or script | Codex/Claude/opencode start, prompt, permission, usage if emitted, activity if emitted, interrupt |

### Implementation Slices

Work should proceed in these slices. Do not start later slices by filling gaps
with generic substitutes.

1. Evidence scripts and redacted fixture format.
2. Core contracts: native event, semantic block, capability catalog.
3. Fixture replay runner.
4. Codex reducer/projector from generated schema fixtures.
5. Claude reducer/projector from stream-json fixtures.
6. ACP reducer/projector from opencode fixtures.
7. Usage and agent activity projection across providers that emit those events.
8. Runtime port rewrite to route live clients through reducer/projector.
9. Capability catalog backend and composer grouping.
10. Native evidence persistence and debug raw ring.
11. Qwen ACP profile after handshake fixtures.
12. Delete obsolete runtime tests/code paths.
13. Live matrix verification.

### Stop Conditions

Stop and collect more evidence instead of coding around the gap when:

- a provider action can only be represented by sending text, but evidence has not
  proven text is the native invocation path;
- a permission prompt cannot be correlated to a native request id;
- a tool/file/command update lacks stable native identity and would become a
  duplicate block;
- a runtime needs both ACP and HTTP/SSE for the same live thread;
- an old test requires behavior that contradicts provider protocol evidence;
- agy or another local executable lacks a robust structured protocol surface.

## Implementation Plan

### Phase 0: Freeze Decisions In Docs

- Keep `native-agent-runtime-fidelity.md` as the decision record.
- Keep this file as the execution plan.
- Remove stale wording that implies external process attach, companion app dependency,
  terminal scraping, or old-code compatibility.

### Phase 1: Build Evidence Harness

- Add scripts to capture Codex schema/method list from the selected `codex`
  executable.
- Add scripts to capture Claude stream-json init/permission/tool fixtures.
- Add scripts to capture ACP handshake and turn fixtures for opencode.
- Add scripts to capture Qwen ACP handshake fixtures.
- Add opencode serve fixture only for comparison and support-surface mapping.
- Add redaction rules before fixture files can be committed.

Exit criteria:

- Each primary runtime has at least handshake, simple turn, tool, permission,
  config, and interrupt fixture coverage.
- Fixture replay can run without launching provider binaries.

### Phase 2: Replace Runtime Contracts

- Replace runtime event contracts with `NativeRuntimeEvent`, provider-native
  state updates, and semantic block projection contracts.
- Add `transport` values intentionally:
  `codex_app_server`, `claude_stream_json`, `acp`.
- Do not add `http_sse` until opencode serve is chosen as a real runtime.
- Remove old compatibility contracts that only model final transcript text or
  generic `tool_call/tool_result` without native identity.

Exit criteria:

- Runtime clients compile against new event contracts.
- Old tests that assert obsolete event shapes are deleted or rewritten.

### Phase 3: Runtime Clients

- Rebuild Codex client around generated app-server schema.
- Rebuild Claude client around stream-json frames and control requests.
- Promote current `AcpClient` into an ACP-family client with provider extension
  preservation.
- Keep opencode adapter as ACP launch/config mapper.
- Add Qwen adapter skeleton only after ACP handshake fixtures exist; keep
  product selection closed until authenticated session/tool fixtures pass.
- Keep agy absent from selectable structured agents until robust ACP or another
  structured protocol is proven.

Exit criteria:

- Each client can run from fixture replay and live smoke.
- Each client emits native events with provider ids preserved.

### Phase 4: Native Reducers And Semantic Blocks

- Implement Codex native reducer.
- Implement Claude native reducer.
- Implement ACP native reducer.
- Implement semantic block projection with native snapshots.
- Implement prompt/approval/question correlation by native request ids.

Exit criteria:

- Tool calls update in place.
- Permission prompts are linked to the tool/file/command they authorize.
- Reasoning/message streaming keeps stable block identity.
- Usage updates render from provider-native usage events or Tide-owned
  accounting only; missing fields are not guessed.
- Subagent/task/team activity updates in place by stable native id when emitted.
- Unknown native events are surfaced in debug/session events, not dropped.

### Phase 5: Capability Catalog And Composer

- Replace curated slash rows with provider capability catalog entries.
- Implement Codex command registry with app-server method vs Tide surface vs
  unsupported action.
- Implement Claude command/skill registry from stream-json init and CLI evidence.
- Implement ACP command/config registry from session updates and configOptions.
- Render prompt commands, skills, config controls, MCP/tool surfaces, and session
  actions as distinct sections.

Exit criteria:

- `/compact`, model, permission, MCP, review, goal, fork, and skills are not
  fake text rows unless provider evidence says they are text commands.
- Composer sends provider-native method/config/metadata where required.

### Phase 6: Native Evidence Storage

- Store reduced native snapshots by default.
- Add opt-in raw frame ring with count/byte cap and TTL.
- Make archive/delete/export behavior explicit.
- Add a debug viewer that can show native event summaries per block.

Exit criteria:

- A rendering bug can be traced from semantic block to native snapshot.
- Sensitive full payloads are not persisted by default.
- Usage and activity snapshots are reduced but sufficient to replay renderer
  state transitions.

### Phase 7: Delete Conflicting Old Code And Tests

Delete or rewrite anything that enforces the old runtime shape:

- PTY scraping as a first-class provider runtime.
- Hook-only completion logic that substitutes for structured protocol events.
- Generic transcript-only tests that ignore provider native ids.
- Curated command rows that conflict with provider capability discovery.
- Generic behavior that hides unsupported native actions as text input.

Keep only:

- Workbench/readiness PTY surfaces that are explicitly user-visible terminals.
- Provider-owned history readers when used for resume/history reference, not as
  the primary live runtime protocol.
- Tests that validate the new native event/reducer/projection pipeline.

Exit criteria:

- No runtime code path pretends terminal scraping is equivalent to structured
  provider protocol.
- No compatibility adapter exists solely to keep old tests green.

### Phase 8: End-To-End Verification

Run live matrix:

- Codex: start, tool call, patch/file change, command, approval, compact, model,
  goal, fork, usage if emitted, activity if emitted, interrupt, optional steer.
- Claude: start, tool use/result, permission, partials, control request config,
  skills, usage/accounting if emitted, subagent/task activity if emitted,
  interrupt, resume.
- opencode ACP: start, command discovery, tool update, permission, configOptions,
  model/vendor, usage/quota if emitted, provider activity extensions if emitted,
  interrupt, resume.
- Qwen ACP: at minimum handshake, command/config discovery, simple turn,
  permission/tool if auth allows, usage/activity if emitted.

Do not mark a provider complete until the live run and fixture replay agree on
the event lifecycle.

## Delete/Replace Policy

This project is a replacement of the runtime architecture.

- Do not add compatibility wrappers for old internal contracts.
- Do not keep old tests that encode obsolete behavior.
- Do not preserve old UI rows if the provider's real capability model says they
  are wrong.
- If a user-facing persisted object cannot map cleanly to the new model, prefer
  explicit reset/export over hidden compatibility behavior.

## Current Final Direction

- Codex: Tide-owned app-server runtime.
- Claude: Tide-owned stream-json runtime.
- opencode: Tide-owned ACP runtime.
- Qwen: ACP-family adapter after fixtures.
- Gemini: out of scope.
- agy: deferred until robust structured protocol evidence exists.
- opencode serve: support/evidence surface, not default runtime.
- Terminal scraping: degraded/non-primary path only, not a coding-agent runtime
  foundation.
- UI: unified capability catalog, grouped rendering.
- Blocks: semantic block primitives with provider-native ids and snapshots,
  including first-class usage and agent-activity state.
- Storage: reduced native snapshots by default, opt-in bounded raw evidence.
