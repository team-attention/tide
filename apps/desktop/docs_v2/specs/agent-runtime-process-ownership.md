# Spec: Agent Runtime Process Ownership

## Status

Implemented. This spec started from `origin/main` and replaced the abandoned
process-bound socket hotfix direction. The implemented slice makes Backend
ownership explicit, projects Tide MCP directly into provider launch shapes, and
prevents inherited Tide owner env from crossing app/backend/runtime boundaries.

## Summary

Tide should own agent runtime connectivity through the same visible process
tree the user expects:

```text
Tide desktop app process
  -> Tide Backend owner process
     -> provider runtime process
        -> provider-owned Tide MCP stdio bridge
           -> MCP endpoint owned by that exact Backend owner process
```

The rule is simple: the process that launches an agent runtime must provide all
Tide-owned connection resources for that runtime. A runtime must not discover
its Tide owner through global files, inherited `TIDE_*` environment variables,
or socket paths that can be overwritten by another app instance.

Tide should launch each provider runtime through a Backend-owned launch plan and
project the Tide MCP bridge into that provider's native shape. The important
property is owned child-process connectivity: the owner chooses the transport and
passes it deliberately instead of relying on ambient discovery.

## Why The Socket Hotfix Is Not Enough

A process-bound socket path reduces one collision, but it does not define who is
allowed to create, pass, inherit, or trust that socket. The real bug class is
ownership leakage:

```text
Tide App A
  -> Backend A
     -> Agent A
        -> shell command inherits Tide-owned env
           -> starts Tide App B / demo app
              -> Backend B trusts inherited connection state
                 -> new agents can talk to Backend A
```

Any fix centered only on socket naming remains fragile because:

- `TIDE_SOCKET` can still be inherited by nested app launches.
- `TIDE_BIN` and `TIDE_MCP_ENTRYPOINT` can still point at a different install or
  worktree than the app that is currently running.
- A global wrapper such as `~/.tide/agent-bootstrap/tide-mcp-stdio` can still be
  rewritten by another app or backend instance.
- Provider runtime environment is also the environment arbitrary agent-run shell
  commands inherit.

The durable fix is to make ownership explicit in the launch plan and to prevent
ambient state from crossing app/backend/runtime boundaries.

## Tide Main Baseline

On `origin/main`, the relevant current shape is:

- Electron Main launches the Backend utility process with `...process.env`,
  `TIDE_APP_DATA_ROOT`, and `TIDE_BIN`.
- Backend computes or accepts `tideSocket` from process env.
- Backend writes `~/.tide/agent-bootstrap/tide-mcp-stdio`.
- Codex and opencode receive that global wrapper as their Tide MCP command.
- Claude receives a generated MCP config that also points at that wrapper.
- Provider runtime env resolution starts from Backend env plus launch-plan env.

That means app ownership, backend ownership, provider runtime env, and MCP bridge
env are not cleanly separated.

## Goals

1. Make agent runtime ownership explicit from Desktop App to Backend to provider
   runtime to MCP bridge.
2. Remove global mutable Tide MCP wrapper usage from new provider launches.
3. Prevent provider runtimes and agent-run shell commands from inheriting Tide
   app/backend ownership environment.
4. Ensure every provider receives Tide MCP through the same provider-neutral
   resource model, projected provider-specifically.
5. Make nested dev/demo Tide launches safe by default.
6. Preserve structured provider transports: Codex app-server, Claude
   stream-json, and opencode ACP.
7. Keep provider auth, history, config, and transcripts user/provider-owned.

## Non-Goals

- Do not reintroduce a Tide-owned direct API agent runtime.
- Do not add a generic "any CLI provider" adapter.
- Do not use a stable global socket to reconnect old provider processes to a
  new Backend by accident.
- Do not mutate or clean user-owned provider homes, auth files, histories, or
  transcripts.
- Do not preserve compatibility with new launches that depend on the global
  `~/.tide/agent-bootstrap/tide-mcp-stdio` wrapper.

## Terms

| Term | Meaning |
|------|---------|
| App instance | One Tide desktop app process tree, with one app data root and one user-visible app surface. |
| Backend owner | The Backend utility process owned by an app instance. It owns Tide runtime state and Tide MCP endpoint creation. |
| Agent runtime | One provider runtime process started for a Tide thread/runtime id. |
| Provider runtime env | Env passed to the provider runtime process. Agent-run shell commands inherit this env. |
| MCP bridge env | Env passed only to the provider-owned Tide MCP stdio subprocess. |
| Tide MCP endpoint | Backend-owned internal endpoint used by the MCP bridge to reach Tide tools. |
| MCP bridge projection | Provider-neutral command/args/env describing how to start Tide MCP over stdio. |
| Provider projection | Provider adapter conversion from Tide resources into provider-native launch shape. |

## Core Invariants

### I1. One runtime has one owning Backend

Every `runtimeId` is owned by exactly one live Backend owner process. That
Backend creates the Tide resources needed by the runtime and tears them down
when the runtime or Backend ends.

### I2. Backend ownership is not read from ambient MCP env

`TIDE_SOCKET`, `TIDE_RUNTIME_ID`, `TIDE_AGENT_ID`, and `TIDE_THREAD_ID` are
child-runtime or MCP bridge values. A new Backend process must not treat them as
inputs that define its owner identity or MCP route.

### I3. Provider runtime env and MCP bridge env are separate

Provider runtime env is inherited by arbitrary commands the model runs. It must
not contain Tide app/backend ownership values.

MCP bridge env is narrow and Tide-owned. It may contain connection values such
as `TIDE_SOCKET`, `TIDE_RUNTIME_ID`, and `TIDE_AGENT_ID` because it belongs only
to the MCP subprocess, not to the provider runtime's general command
environment.

### I4. No global mutable wrapper for new launches

New Codex and opencode launches must receive the Tide MCP command directly in
their provider-native config/protocol/argv projection.

Claude may still require a generated MCP config file, but that file must be
scoped to the app/backend/runtime owner. It must not point at a global wrapper
that another app instance can rewrite.

### I5. Provider adapters project, but do not own, Tide resources

The Backend plans Tide-owned resources once. Provider adapters translate those
resources into provider-native launch shapes.

Codex, Claude, and opencode remain different integrations. The shared contract
is the ownership/resource model, not a generic CLI abstraction.

## Environment Policy

| Env class | Examples | Allowed recipient |
|-----------|----------|-------------------|
| App/backend ownership env | `TIDE_APP_DATA_ROOT`, `TIDE_BIN`, `TIDE_MCP_ENTRYPOINT` | Tide app and Backend owner only |
| Provider runtime env | `PATH`, `HOME`, `SHELL`, `SSH_AUTH_SOCK`, provider auth env, `CODEX_HOME` | Provider runtime process |
| Runtime identity tags | `TIDE_THREAD_ID`, `TIDE_RUNTIME_ID`, `TIDE_AGENT_ID` | Provider runtime only if explicitly allowlisted |
| MCP bridge env | `TIDE_SOCKET`, `TIDE_THREAD_ID`, `TIDE_RUNTIME_ID`, `TIDE_AGENT_ID`, `ELECTRON_RUN_AS_NODE` | Tide MCP bridge subprocess only |
| Test harness env | `TIDE_ELECTRON_SMOKE_COMMAND`, temporary app data overrides | Test process and explicitly launched test app only |

The provider runtime env sanitizer must strip Tide app/backend ownership env
from both inherited process env and launch-plan env. Launch plans may re-add
only allowlisted runtime identity tags.

## Contracts

### Backend owner identity

```ts
interface BackendOwnerIdentity {
  appDataRoot: string;
  backendInstanceId: string;
  tideCommand: string;
  tideMcpEntrypoint: string;
}
```

This identity is created by the app/backend owner path. It is not derived from
provider runtime env or MCP bridge env.

### Tide MCP endpoint

```ts
interface TideMcpEndpoint {
  kind: "unix_socket";
  owner: BackendOwnerIdentity;
  socketPath: string;
}
```

The first implementation can keep a Unix socket because the existing MCP stdio
bridge already forwards JSON-RPC lines to a Backend socket. The socket path is
an implementation detail of the Backend owner. The invariant is that it is
created by the owner and passed explicitly to child bridges.

### MCP bridge projection

```ts
interface TideMcpBridgeProjection {
  serverName: "tide";
  command: string;
  args: string[];
  env: {
    ELECTRON_RUN_AS_NODE?: "1";
    TIDE_SOCKET: string;
    TIDE_RUNTIME_ID: string;
    TIDE_AGENT_ID: ProviderCliAgentId;
    TIDE_THREAD_ID?: string;
  };
}
```

This is the provider-neutral representation of "attach Tide tools to this
runtime". It is planned by Tide core and consumed by provider adapters.

### Agent resource plan

This spec narrows the `Agent Resource Model` around runtime ownership:

```ts
interface AgentRuntimeOwnershipPlan {
  threadId: string;
  runtimeId: string;
  agentId: ProviderCliAgentId;
  cwd: string;
  backendOwner: BackendOwnerIdentity;
  mcpEndpoint: TideMcpEndpoint;
  mcpBridge: TideMcpBridgeProjection;
  providerRuntimeEnv: Record<string, string>;
}
```

Provider adapters receive this plan, then produce `ProviderLaunchPlan`:

```ts
interface AgentIntegrationPort {
  buildStartPlan(
    input: AgentStartPlanInput,
    ownership: AgentRuntimeOwnershipPlan,
  ): Promise<ProviderLaunchPlan>;

  buildResumePlan(
    input: AgentResumePlanInput,
    ownership: AgentRuntimeOwnershipPlan,
  ): Promise<ProviderLaunchPlan>;
}
```

`preflight` may inspect provider readiness, but it must not construct a launch
plan through a path that bypasses ownership planning.

## Provider Projection

| Provider | Runtime transport | Tide MCP projection |
|----------|-------------------|---------------------|
| Codex | `codex app-server` structured stdio | Adapter converts `TideMcpBridgeProjection` to `-c mcp_servers.tide.*` config overrides. No global wrapper. |
| Claude | `claude --print --input-format stream-json --output-format stream-json` | Adapter writes owner-scoped MCP config and settings, or uses a direct CLI config path if supported. Config points at direct `command/args/env`. |
| opencode | `opencode acp` | Adapter converts the bridge projection to opencode/ACP-native MCP config. No global wrapper. |
| Future provider | Provider-selected | Must implement projection from the same `TideMcpBridgeProjection`; no ambient lookup. |

## Required Flow

### App starts Backend

1. Electron Main computes app data root from app state or explicit test harness
   input.
2. Electron Main sanitizes inherited `TIDE_*` values before launching Backend.
3. Electron Main passes only backend-owned inputs needed by the Backend owner.
4. Backend creates a fresh `backendInstanceId`.
5. Backend creates its own Tide MCP endpoint.
6. Backend does not accept inherited `TIDE_SOCKET` as its endpoint.

### Backend starts or resumes provider runtime

1. Runtime orchestration creates `runtimeId`.
2. Resource planner builds `AgentRuntimeOwnershipPlan`.
3. Planner creates `TideMcpBridgeProjection` for that runtime.
4. Provider adapter converts the ownership plan into provider-native launch
   shape.
5. Runtime port launches the provider with sanitized provider runtime env.
6. Provider starts its own MCP subprocess from provider-native config.
7. MCP subprocess connects to the Backend-owned endpoint from its bridge env.

### Agent launches a nested Tide app

1. Agent-run shell command inherits provider runtime env only.
2. That env does not include production `TIDE_SOCKET`, `TIDE_BIN`, or
   `TIDE_APP_DATA_ROOT`.
3. Nested dev/demo app starts with its own app data root or fails the
   single-instance lock unless the test harness explicitly opts in.
4. Nested app creates its own Backend owner and its own MCP endpoint.

## Implementation Plan

This plan is implemented for the current Codex, Claude, and opencode structured
runtime paths.

### Phase 0: Reset the branch and document the target

Start from `origin/main`, not from the socket hotfix branch. Add this spec and
wire it into the specs README. Do not include the abandoned socket-isolation
code in the PR history.

### Phase 1: Pin current failure modes with tests

Add failing tests before implementation:

- Electron Main does not forward inherited provider/MCP env to Backend.
- Backend ignores ambient `TIDE_SOCKET` when selecting its MCP endpoint.
- Provider runtime env strips Tide app/backend ownership values.
- MCP bridge env still receives the endpoint and runtime identity.
- Codex, Claude, and opencode launch plans all receive Tide MCP from the same
  ownership plan.
- `TIDE_APP_DATA_ROOT` alone does not disable single-instance locking.

### Phase 2: Introduce ownership planning

Add a small ownership/resource planner near runtime orchestration. It should:

- create `BackendOwnerIdentity`;
- create a Backend-owned `TideMcpEndpoint`;
- create `TideMcpBridgeProjection`;
- sanitize provider runtime env;
- hand the ownership plan to provider adapters.

Do not move provider-specific args or protocol params into the planner.

### Phase 3: Sanitize process boundaries

Update Electron Main to launch Backend with explicit backend env instead of
`...process.env`. Strip inherited provider/MCP values before the Backend starts.

Update provider runtime env resolution so Tide ownership values are stripped
after merging shell env and launch-plan env. Keep a small allowlist for runtime
identity tags.

### Phase 4: Remove global wrapper dependency from new launches

Replace `~/.tide/agent-bootstrap/tide-mcp-stdio` usage for new Codex and
opencode launches with direct bridge projection.

For Claude, generate owner-scoped MCP config under app data or backend/runtime
scope. The config may still use a Tide command plus entrypoint, but it must not
go through a global mutable wrapper.

### Phase 5: Make Backend MCP endpoint owner-created only

Backend must always create its MCP endpoint from owner state. It must not use
ambient `TIDE_SOCKET` as a fallback.

The current socket bridge can remain as the internal transport if it is owned
and passed explicitly. This phase is not about replacing the transport; it is
about replacing discovery and ownership.

### Phase 6: Remove launch-plan bypasses

Ensure readiness/preflight cannot produce a provider launch plan that bypasses
the ownership planner. Readiness may report provider state and blockers, but
runtime start/resume must build launch plans through the ownership path.

### Phase 7: Cleanup and migration

Stop writing the global wrapper for new launches. Treat existing global wrapper
files as legacy artifacts and avoid deleting them automatically unless a later
cleanup spec proves they are Tide-owned and safe to remove.

Keep provider histories and session refs readable. Resuming a provider session
creates a fresh provider runtime with a fresh Tide MCP ownership plan.

## Tests

| Behavior | Test name |
|----------|-----------|
| Main strips inherited MCP/provider env before Backend launch | `electron_main_strips_inherited_agent_env_for_backend` |
| Backend endpoint ignores ambient `TIDE_SOCKET` | `live_backend_ignores_ambient_tide_socket_for_owned_mcp_route` |
| Provider runtime env strips Tide ownership values | `agent_runtime_port_applies_cwd_runtime_environment_to_all_structured_spawns` |
| Provider runtime env preserves user/provider env | `agent_runtime_port_applies_cwd_runtime_environment_to_all_structured_spawns` |
| MCP bridge env receives endpoint and runtime identity | `codex_build_start_plan_returns_app_server_plan_with_tide_mcp_config`; `opencode start plan carries the chosen config as ACP configOptions` |
| Codex projects shared bridge without global wrapper | `codex_build_start_plan_returns_app_server_plan_with_tide_mcp_config` |
| Claude config is owner-scoped | `provider_bootstrap_artifacts_create_only_the_mcp_surface` |
| opencode projects shared bridge without global wrapper | `opencode start plan carries the chosen config as ACP configOptions` |
| Preflight cannot bypass ownership planning | `codex_ready_preflight_does_not_build_launch_plan`; `claude_ready_preflight_does_not_build_launch_plan`; `opencode preflight reports not_installed and not_authenticated` |
| Nested app launch does not reuse parent app owner env | `electron_main_strips_inherited_agent_env_for_backend`; `electron_main_requires_explicit_multi_instance_flag` |

## Validation

Completed validation:

- targeted unit tests for process env, ownership planning, and provider
  projections;
- `npm run typecheck`;
- desktop test suite via `npm test`.

Provider smoke checks and a manual nested-demo check remain useful follow-up
validation when local provider credentials and CLIs are available.

## Open Questions

1. Should the internal MCP endpoint remain a Unix socket, or should Backend use a
   child-process stdio bridge more directly for some providers?
2. Should Claude keep a generated MCP config file indefinitely, or should Tide
   prefer launch-time config if Claude exposes a stable path?
3. Should `TIDE_THREAD_ID` be present in provider runtime env, or only in MCP
   bridge env and internal runtime tracking?
4. How should packaged app, dev app, and automated verification agree on app
   data root isolation without making normal nested app launches unsafe?

These questions should not block the ownership refactor. The required decision
for this slice is that no runtime may discover its Tide owner from ambient or
global mutable state.
