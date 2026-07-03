# Spec: Agent Resource Model

## Status

Drafted. Baseline assumes the Gemini-removal work is already merged.

This spec defines the post-Gemini provider resource model for the Desktop v2
Backend. The supported-provider list is:

- `codex`
- `claude`
- `opencode`

## Summary

Tide should share one resource, tool, runtime, and session model across supported
Provider CLI Agents. Provider-native launch mechanics stay inside provider
adapters.

The boundary is:

- Tide core owns resource planning, lifecycle tracking, cleanup policy,
  diagnostics, runtime identity, and the Tide MCP Tool Surface.
- Provider adapters own the provider-native transport, arguments, protocol
  parameters, provider config files, permission modes, model flags, and session
  reference details.

Do not build one generic CLI adapter. Codex, Claude, and opencode are different
provider integrations behind one Tide contract.

## Baseline

1. Gemini has been removed from the supported product surface.
2. Shared contracts no longer expose `gemini` as a `ProviderCliAgentId`.
3. Live Backend no longer wires `createGeminiAgentIntegration`.
4. Remaining Gemini references in older docs/tests are stale historical material
   unless a current spec explicitly revalidates them. This spec's cleanup phase
   covers removing or archiving those references.
5. The `acp` runtime client remains only because opencode uses ACP. Do not
   describe ACP as a general future-agent extension point in this slice.

## Current Problems

The current code already has good separation between `AgentIntegrationPort` and
provider-specific integrations, but resource ownership is still implicit:

- `provider-bootstrap-artifacts.ts` creates Tide MCP bootstrap files directly.
- `live-backend.ts` repeats `tideMcp` wiring across integrations.
- Generated files, process env, MCP server bindings, provider config paths, and
  cleanup expectations are not represented as first-class Tide resources.
- Diagnostics can say a provider is blocked, but they do not describe which
  Tide-owned resource failed or which resource is attached to a runtime.
- Provider-specific implementation details can leak upward because the common
  concept is "bootstrap artifacts" instead of "resources required by this
  runtime".

## Goals

1. Represent Tide-owned agent integration resources with a provider-neutral
   contract.
2. Keep provider-native details inside `codex`, `claude`, and `opencode`
   adapters.
3. Let the Backend explain and diagnose the resources attached to a runtime.
4. Give cleanup code clear ownership and lifecycle rules.
5. Remove repeated MCP/bootstrap wiring from `live-backend.ts`.
6. Preserve the structured runtime direction: provider protocol events are the
   active runtime source, not hidden PTY scraping or provider hook polling.
7. Keep opencode ACP support as an opencode adapter implementation detail.

## Non-Goals

- Do not create a direct Tide-owned API Agent runtime.
- Do not reintroduce hidden-PTY prompt scraping for active provider runtimes.
- Do not make Codex, Claude, and opencode look like one generic CLI.
- Do not delete user-owned provider auth, history, transcripts, or config during
  automatic cleanup.
- Do not define support for new ACP-compatible providers.
- Do not migrate Terminal v1 wrapper scripts in this slice.

## Terms

| Term | Meaning |
|------|---------|
| Agent Resource | A Tide-owned or Tide-tracked resource needed to prepare, launch, attach tools to, observe, or clean up a provider runtime. |
| Resource Plan | The set of resources needed for one provider runtime start/resume attempt. |
| Resource Registry | Backend-owned tracking of generated, live, and cleanup-relevant resources. |
| Provider Adapter | Provider-specific implementation behind `AgentIntegrationPort`. |
| Tide MCP Tool Surface | The provider-visible MCP server exposing Tide-owned Workbench, Browser, Thread, file, and context tools. |
| Provider-native Resource | A provider-owned file, protocol setting, transcript, auth state, or session record that Tide may read or reference but must not own. |

## Core Decisions

### D1. Supported providers are explicit

In the post-Gemini baseline, the supported Provider CLI Agent ids are:

```ts
type ProviderCliAgentId = "codex" | "claude" | "opencode";
```

Unknown providers are rejected by readiness/runtime ports. There is no generic
fallback adapter.

### D2. Runtime transports are provider-selected

The shared runtime contract may still contain a small transport union:

```ts
type RuntimeTransport =
  | "codex_app_server"
  | "claude_stream_json"
  | "acp";
```

`acp` is present because opencode uses it. The opencode adapter decides how ACP
is launched, configured, and resumed. Product docs should not present ACP as an
open-ended provider family for this work.

### D3. Tide resources are provider-neutral

The shared resource contract describes Tide concerns, not provider config file
formats.

Examples:

- `mcp_bridge`
- `mcp_server_binding`
- `runtime_identity_env`
- `provider_config_projection`
- `permission_policy`
- `provider_session_ref`
- `process`
- `log`
- `cache`
- `bootstrap_file`

A Claude MCP config file and Codex `-c mcp_servers...` overrides are different
provider projections of the same Tide MCP server binding.

### D4. Provider adapters project resources into launch plans

Tide core may plan a resource such as "attach the Tide MCP server to this
runtime". The selected provider adapter decides whether that becomes:

- command-line config overrides,
- a generated provider config file,
- protocol params,
- environment variables,
- or no-op because that provider does not support the resource.

### D5. Resource planning happens before launch-plan construction

Resource planning is a Tide-core concern. Provider adapters project an existing
resource plan into provider-native launch shape; they do not own shared Tide
resource planning.

The resource planner contract should sit beside runtime orchestration:

```ts
interface AgentResourcePlanner {
  planStart(input: AgentStartPlanInput): AgentResourcePlan;
  planResume(input: AgentResumePlanInput): AgentResourcePlan;
  ensure(plan: AgentResourcePlan): Promise<AgentResourcePlan>;
}
```

An updated `AgentIntegrationPort` shape may accept an already-planned resource
set:

```ts
interface AgentIntegrationPort {
  preflight(input: AgentIntegrationPreflightInput): Promise<AgentIntegrationPreflightResult>;
  buildStartPlan(input: AgentStartPlanInput, resources: AgentResourcePlan): Promise<ProviderLaunchPlan>;
  buildResumePlan(input: AgentResumePlanInput, resources: AgentResourcePlan): Promise<ProviderLaunchPlan>;
}
```

This may be introduced incrementally. The first implementation may create the
resource plan in the runtime port and pass it to existing adapter internals.
Adapters may add provider-native projection resources, but they should not plan
shared Tide resources such as the MCP bridge or runtime identity.

The current `AgentIntegrationPreflightResult.launchPlan` path must not remain as
a second launch-plan construction path that bypasses resource planning. During
migration, either remove/deprecate preflight launch plans, or require any
preflight launch plan to be built from an ensured `AgentResourcePlan`.

### D6. Resource registry is Tide-owned

The Backend owns a `ResourceRegistry` for generated and live resources. It should
start in memory and only persist records that are useful after a process restart.

Persisted records should be limited to stable generated artifacts and diagnostic
metadata. Live process handles, open sockets, and runtime leases are rebuilt from
actual process state.

### D7. Cleanup policy is attached to each resource

Cleanup should follow resource policy, not provider name.

Automatic cleanup is allowed for Tide-owned temporary files, dead process
records, stale sockets, and runtime-scoped generated files. Automatic cleanup is
not allowed for user-owned provider homes, auth tokens, transcripts, histories,
or project config.

### D8. Provider-owned history remains provider-owned

Tide may store a `ProviderSessionRef` and read bounded provider history through
the provider history connector, but provider history files are not Tide-owned
resources.

They may be represented as `provider_session_ref` or `provider_history_ref` for
diagnostics, but cleanup policy must be `manual` or `never`.

### D9. Runtime identity is common

Every provider runtime receives Tide identity through a common resource:

- Thread id
- Runtime id
- Agent id
- Tide socket
- Optional pane/window ids where applicable

The provider adapter decides which identity fields must be inherited through
process env, embedded into MCP server env, or passed through protocol params.

### D10. Readiness reports resource blockers

Provider readiness should distinguish:

- provider blockers: missing CLI, authentication, provider onboarding,
  directory trust;
- integration blockers: missing or invalid Tide MCP bridge, unwritable
  bootstrap root, failed generated config, incompatible provider version.

Process spawn failure, transport handshake failure, and MCP `tools/list` timeout
are runtime failures, not readiness blockers. They should be recorded as
resource-scoped runtime diagnostics after launch begins.

Readiness UI may still group provider and integration blockers for users, but
the Backend diagnostic object should preserve the distinction between preflight
blockers and post-spawn runtime failures.

### D11. Terminal v1 wrappers are reference material only

The Terminal v1 wrapper scripts prove useful provider-specific injection
patterns. Desktop v2 should not re-adopt their hook/spool/PTY-scrape runtime
model. Any wrapper-era behavior used by Desktop v2 must be translated into the
structured runtime and resource model.

### D12. Existing bootstrap helpers migrate behind the resource planner

`provider-bootstrap-artifacts.ts` should become an implementation detail of a
resource planner or be replaced by one. Its current deterministic path helpers
are still useful, but callers should ask for Tide resources, not individual
provider bootstrap paths.

## Resource Contract

### AgentResourceKind

```ts
type AgentResourceKind =
  | "mcp_bridge"
  | "mcp_server_binding"
  | "context_injection"
  | "permission_policy"
  | "runtime_identity_env"
  | "provider_config_projection"
  | "provider_session_ref"
  | "provider_history_ref"
  | "process"
  | "socket"
  | "log"
  | "cache"
  | "bootstrap_file"
  | "diagnostic";
```

### ResourceScope

```ts
type ResourceScope =
  | "user"
  | "workspace"
  | "thread"
  | "runtime"
  | "process";
```

Scope definitions:

| Scope | Meaning | Typical cleanup |
|-------|---------|-----------------|
| `user` | Shared across all Tide workspaces for the current OS user. | Manual or versioned overwrite only. |
| `workspace` | Bound to one project/workspace root. | On workspace removal only when Tide owns it. |
| `thread` | Bound to one Tide Thread. | On thread delete/archive cleanup if safe. |
| `runtime` | Bound to one Agent Runtime instance. | On runtime stop or crash cleanup. |
| `process` | Bound to one spawned provider or helper process. | On process exit. |

### CleanupPolicy

```ts
type CleanupPolicy =
  | "on_process_exit"
  | "on_runtime_stop"
  | "on_workspace_close"
  | "on_disable"
  | "ttl"
  | "manual"
  | "never";
```

Rules:

1. `manual` or `never` for provider-owned auth, history, transcripts, and user
   config.
2. `on_runtime_stop` for runtime-scoped temp files and generated per-runtime
   provider config.
3. `on_process_exit` for process handles and pid/sentinel records.
4. `ttl` for logs and diagnostics that are useful for recent debugging but
   should not grow without bound.
5. `on_disable` only for Tide-owned generated resources. It must not delete
   provider-owned state.

### AgentResource

```ts
interface AgentResource {
  id: string;
  agentId: ProviderCliAgentId;
  kind: AgentResourceKind;
  scope: ResourceScope;
  owner: "tide" | "provider" | "user";
  status: "planned" | "ensured" | "active" | "released" | "failed";
  paths?: string[];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  redactedEnv?: Record<string, string>;
  sensitiveEnvKeys?: string[];
  version?: string;
  hash?: string;
  runtimeId?: string;
  threadId?: string;
  providerSessionRef?: {
    kind: string;
    value: string;
    transcriptPath?: string;
    logPath?: string;
  };
  cleanup: CleanupPolicy;
  failure?: {
    code: string;
    message: string;
  };
}
```

### AgentResourcePlan

```ts
interface AgentResourcePlan {
  agentId: ProviderCliAgentId;
  threadId: string;
  runtimeId: string;
  cwd: string;
  resources: AgentResource[];
}
```

The plan is append-only during preparation. Runtime code may update resource
status but should not mutate provider-specific meaning into shared fields.

Resource diagnostics must never expose secrets. `env` is allowed only for
Tide-owned identity values such as `TIDE_THREAD_ID`, `TIDE_RUNTIME_ID`,
`TIDE_AGENT_ID`, and `TIDE_SOCKET`. Any provider token, API key, auth path, or
unknown inherited environment value must be omitted or represented through
`redactedEnv` plus `sensitiveEnvKeys`.

## Required Resource Kinds

### mcp_bridge

Represents the Tide-owned executable or command that serves Tide MCP over stdio.

Expected current implementation:

- direct command/args/env projection for `<tide> <backend-entrypoint> mcp`;
- invokes the Desktop Backend MCP entrypoint under `ELECTRON_RUN_AS_NODE`;
- generated provider config, when needed, is scoped under Tide app data instead
  of a mutable shared user-scope wrapper.

### mcp_server_binding

Represents the intention to attach the Tide MCP server to a provider runtime.

Fields:

- bridge command/path;
- server name, currently `tide`;
- server env containing Tide socket/runtime identity;
- required tool-surface readiness behavior if applicable.

Provider projection:

| Provider | Projection |
|----------|------------|
| Codex | Provider adapter maps into app-server/config overrides. |
| Claude | Provider adapter maps into generated MCP config path and launch args. |
| opencode | Provider adapter maps into ACP params or opencode config as required by current implementation. |

### context_injection

Represents Tide instructions exposed to a provider, if that provider needs them.

This resource is optional. Structured Desktop runtime should prefer MCP tool
descriptions and tool-list behavior over broad ambient prompt injection. If a
provider still needs context injection, the provider adapter owns projection.

Cleanup must only apply to Tide-generated context files.

### permission_policy

Represents Tide-side or provider-side permissions selected for this runtime.

Examples:

- Tide MCP server preallow for Claude.
- Provider permission mode from Thread Launch Options.
- Codex approval/sandbox policy.
- opencode mode/config.

The shared resource records the selected policy and whether it is provider-owned
or Tide-owned. The adapter maps it into protocol params, env, config, or argv.

### runtime_identity_env

Represents common Tide runtime identity:

- `TIDE_THREAD_ID`
- `TIDE_RUNTIME_ID`
- `TIDE_AGENT_ID`
- `TIDE_SOCKET`

Provider-specific variations such as pane/window ids are optional and should be
added only when the runtime surface requires them.

### provider_config_projection

Represents a generated provider-facing file or protocol/config fragment derived
from Tide resources.

This is where a Claude MCP config file or settings file can be tracked without
making the shared model Claude-specific.

### provider_session_ref

Represents the provider-native session reference assigned or discovered for the
runtime.

This resource can point to provider-owned transcript/log paths, but those paths
remain provider-owned.

### provider_history_ref

Represents provider-owned history or transcript locations that Tide may read
through a bounded provider history connector.

This is a diagnostic/reference resource only. Cleanup policy must be `manual` or
`never`.

### process

Represents the live provider process or helper process.

The runtime port owns process lifecycle. The provider adapter owns process
command shape.

### diagnostic

Represents recent evidence for debugging:

- generated resource paths;
- provider preflight blockers;
- tool-surface handshake result;
- transport handshake result;
- spawn failure;
- cleanup failure.

Diagnostic resources may have `ttl` cleanup.

## Provider Adapter Responsibilities

### Codex adapter

Owns:

- `codex_app_server` transport;
- Codex app-server protocol params;
- approval/sandbox/model mapping;
- Codex provider state and session reference parsing;
- mapping `mcp_server_binding` into Codex-native config/protocol shape.

Does not own:

- Tide MCP bridge generation;
- shared runtime identity shape;
- global cleanup policy.

### Claude adapter

Owns:

- `claude_stream_json` transport;
- Claude stream-json flags;
- Claude permission-prompt protocol behavior;
- session id mint/resume behavior;
- Claude MCP/settings projection;
- Claude provider state and transcript lookup.

Does not own:

- Tide MCP bridge generation;
- Tide resource registry;
- cleanup of provider transcripts or user Claude config.

### opencode adapter

Owns:

- `acp` transport;
- opencode launch/resume/session behavior;
- opencode vendor/model config;
- mapping Tide MCP binding into opencode ACP/config shape;
- opencode permission/mode behavior.

Does not own:

- claims about ACP as a future-provider system;
- Tide MCP bridge generation;
- global resource cleanup policy.

## Backend Flow

### UC-1: Start a ready provider runtime

1. Thread Runtime Service receives a start request.
2. Provider Readiness checks selected adapter preflight.
3. Resource Planner creates an `AgentResourcePlan` for the selected agent,
   thread, runtime, cwd, and launch options.
4. Resource Registry records planned resources.
5. Resource Planner ensures shared Tide resources, such as `mcp_bridge`.
6. Selected provider adapter projects the planned resources into a
   `ProviderLaunchPlan`.
7. Runtime port spawns the provider process using that launch plan.
8. Runtime port records `process` and active runtime resources.
9. Structured provider events drive session blocks, prompts, usage, and
   completion.
10. Runtime stop/crash releases process/runtime resources according to policy.

### UC-2: Provider readiness is blocked

1. Preflight returns provider or integration blockers.
2. Resource Planner may still verify global generated resources if needed for
   diagnosis, but it must not spawn provider processes.
3. Readiness result includes provider/integration blocker category and resource
   failure evidence.
4. Pending Composer input remains queued by existing readiness behavior.

### UC-3: Resume a provider session

1. Thread has a provider session ref.
2. Resource Planner creates a new runtime-scoped plan with the existing session
   ref resource.
3. Provider adapter builds a resume launch plan from provider-native session ref.
4. Runtime port starts/resumes provider process.
5. Resource Registry binds new runtime id to existing provider session ref.

### UC-4: Runtime cleanup

1. Runtime exits, crashes, or is stopped.
2. Process resources transition to `released`.
3. Runtime-scoped temp/generated resources follow `on_runtime_stop`.
4. User/provider-owned resources remain untouched.
5. Diagnostic records are retained subject to `ttl`.

## Resource Registry

### Initial Implementation

Start with a Backend in-memory registry:

```ts
interface AgentResourceRegistry {
  recordPlan(plan: AgentResourcePlan): void;
  markEnsured(resourceId: string): void;
  markActive(resourceId: string): void;
  markReleased(resourceId: string): void;
  markFailed(resourceId: string, failure: { code: string; message: string }): void;
  resourcesForRuntime(runtimeId: string): AgentResource[];
  resourcesForThread(threadId: string): AgentResource[];
}
```

Persist only if needed for:

- stable generated bootstrap artifact version/hash;
- recent diagnostic records;
- cleanup of generated files after Backend restart.

Do not persist process handles. Reconstruct live state from runtime service and
OS process observation where needed.

### Diagnostics

Backend diagnostic output should be able to answer:

1. Which Tide MCP bridge command was attached?
2. Which provider projection was created?
3. Which Tide-owned env values identify the runtime?
4. Which provider session ref is bound?
5. Did the MCP tools/list handshake complete?
6. Which resource failed, and in which phase?
7. Which resources were cleaned up after runtime stop?
8. Which env keys were redacted from diagnostics?

## Migration Plan

### Phase 0: Confirm post-Gemini baseline

Required before implementation:

- `ProviderCliAgentId` excludes `gemini`;
- Gemini descriptor and integration wiring removed;
- remaining Gemini docs/test references inventoried as stale historical
  material, not implementation guidance;
- opencode remains wired through `acp`.

### Phase 1: Add resource contracts with no behavior change

- Add domain/application types for `AgentResource`, `AgentResourcePlan`, and
  `AgentResourceRegistry`.
- Add unit tests for shape, scope, and cleanup rules.
- Wrap current bootstrap values into resource records without changing launch
  behavior.

### Phase 2: Introduce Resource Planner

- Move shared Tide MCP bridge planning out of `live-backend.ts`.
- Keep provider-specific projection inside adapters.
- Keep `provider-bootstrap-artifacts.ts` as an infra helper behind the planner.
- Do not add `planResources` to provider adapters; adapters consume a plan and
  project it into provider-native launch shape.
- Remove/deprecate `AgentIntegrationPreflightResult.launchPlan`, or rebuild that
  path so it also consumes an ensured `AgentResourcePlan`.

### Phase 3: Adapter projection

- Codex adapter consumes `mcp_server_binding` and `permission_policy` resources.
- Claude adapter consumes `mcp_server_binding`, `provider_config_projection`,
  and `permission_policy` resources.
- opencode adapter consumes `mcp_server_binding` and `permission_policy`
  resources through its ACP/config path.

### Phase 4: Registry-backed diagnostics

- Expose resource diagnostics to Backend logs and internal debug output.
- Add test coverage for failed bridge creation, missing writable bootstrap root,
  and provider projection failure.

### Phase 5: Cleanup policy

- Add runtime-stop cleanup for runtime-scoped Tide-owned generated resources.
- Add TTL cleanup for diagnostics/log metadata if persisted.
- Confirm user/provider-owned paths are never deleted automatically.

### Phase 6: Dead code cleanup

- Remove unused bootstrap helpers and stale provider-specific branches.
- Remove docs language that implies Gemini support or future ACP provider
  expansion.

## Invariants

1. Tide core never launches an unknown provider through a generic CLI path.
2. Tide core never writes provider-owned user config except through explicit
   Tide-owned generated projection files.
3. Provider adapters are the only layer that knows provider-native config,
   protocol, permission, and session mechanics.
4. The Tide MCP bridge is planned once as a Tide resource and projected by
   adapters.
5. Runtime identity is common even when projection differs.
6. Provider transcripts, history, auth, and global provider config are never
   automatically deleted.
7. `acp` is present only as opencode's current runtime transport.
8. Structured provider events remain the source of active runtime state.
9. Resource cleanup never changes Thread history or provider session references.
10. Resource diagnostics are available without exposing secrets or auth tokens.
11. Provider readiness blockers are preflight/integration blockers; process,
    transport, and MCP handshake failures are runtime diagnostics.

## Tests

| Area | Test expectation |
|------|------------------|
| Supported providers | Shared contracts and descriptors include only `codex`, `claude`, and `opencode`. |
| No generic fallback | Unknown provider id is rejected by readiness and runtime ports. |
| Resource planning | Starting each supported provider creates an `AgentResourcePlan` with common MCP and runtime identity resources. |
| Provider projection | Codex, Claude, and opencode adapters map the same `mcp_server_binding` resource into provider-native launch plans. |
| Planner boundary | Shared Tide resources are planned outside provider adapters. |
| Registry lifecycle | Planned resources become ensured/active/released/failed through runtime phases. |
| Cleanup safety | Provider-owned auth/config/history resources are never scheduled for automatic deletion. |
| Diagnostics | Failed bridge creation or provider projection yields a resource-scoped integration blocker. |
| Runtime failures | Process spawn, transport handshake, and MCP handshake failures become runtime diagnostics, not preflight readiness blockers. |
| Secret redaction | Diagnostics expose only Tide identity env values and redact inherited/provider env values. |
| opencode ACP boundary | `acp` transport is reachable only through the opencode adapter in supported-provider tests. |
| No Gemini dependency | Resource planner and live backend compile without Gemini integration imports. |

## Acceptance Criteria

Implementation is complete when:

1. `live-backend.ts` does not repeat Tide MCP bridge wiring per provider.
2. Each supported adapter receives a resource plan and projects it into its
   provider-native launch plan.
3. Resource diagnostics can identify MCP bridge, provider projection, runtime
   identity, process, and provider session ref for a running runtime.
4. Runtime stop releases Tide-owned runtime/process resources.
5. No automatic cleanup touches provider-owned auth, config, transcript, or
   history paths.
6. Tests prove Codex, Claude, and opencode use the shared resource model without
   a generic CLI fallback.
7. Diagnostics redact provider/user env values while retaining Tide runtime
   identity.

## Relationship To Existing Specs

- `provider-bootstrap-artifacts.md` becomes an implementation detail of this
  model after Gemini removal.
- `structured-agent-runtime.md` remains authoritative for provider protocol
  behavior.
- `backend-agent-runtime-port-wiring.md` remains authoritative for runtime
  service wiring.
- `tide-mcp-stdio-bridge.md` remains authoritative for the MCP stdio bridge
  protocol. This spec tracks it as an agent resource.

## Open Questions

1. Should resource diagnostics be visible only in logs/tests, or should Product
   Shell expose a compact "integration details" view?
2. Should generated bootstrap files carry a schema/version file to support
   deterministic cleanup after Backend restart?
3. Should `ResourceRegistry` live in the application layer as a service, or in
   infrastructure with an application port?
4. Which diagnostics should be persisted, and what TTL should apply?
