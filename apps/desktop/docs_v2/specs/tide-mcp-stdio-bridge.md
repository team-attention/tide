# Spec: Tide MCP Stdio Bridge

## Scope

This spec makes Tide MCP Tool Surface reachable from provider-owned MCP stdio processes.

Included:

- JSON-RPC handling for MCP `initialize`, `tools/list`, and `tools/call`.
- Provider-visible tool responses that wrap Tide MCP tool output as MCP content.
- Runtime session identity from Tide runtime env.
- A Backend inbound adapter that can be used by a stdio entrypoint or socket bridge.

Out of scope:

- Browser page-map action tools.
- Packaging a final user-facing `tide` CLI binary.
- Multiple concurrent MCP transports beyond line-delimited JSON-RPC used by the current v1 bridge reference.

## Evidence

- `docs_v2/implementation/electron-node-architecture-decisions.md` says Backend owns Tide MCP Tool Surface handling and has an inbound `tide-mcp-server` adapter.
- `docs_v2/implementation/concrete-design-backlog.md` chooses Tide-owned MCP tools attached to the same provider CLI session.
- `docs_v2/specs/tide-mcp-workbench-observe-open-browser.md` says the MCP server should be a Backend inbound adapter.
- `src/backend/infrastructure/node/provider/provider-bootstrap-artifacts.ts` owns provider MCP config generation for Claude and Antigravity and Codex launch options for Tide MCP.
- `src/backend/adapters/inbound/tide-mcp-tool-surface/tide-mcp-tool-surface-adapter.ts` currently exposes an in-process adapter only.
- `src/backend/infrastructure/node/entrypoints/backend-entrypoint.ts` is the Backend entrypoint shared by Electron `MessagePort` mode and the MCP stdio mode.
- `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs` is the v1 reference for a line-delimited JSON-RPC MCP stdio bridge.

## Decisions

### D1. MCP protocol adapter is Backend inbound

The JSON-RPC adapter lives under `src/backend/adapters/inbound/tide-mcp-server/`.

It depends on the Backend service-facing Tide MCP Tool Surface adapter, not Desktop, Shared Contracts, or provider-specific integrations.

### D2. First bridge handles the stable MCP methods

The first bridge supports:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

Unknown methods return JSON-RPC `-32601`.

### D3. Tool errors are MCP tool results

When Backend rejects a tool call because of Thread/session/tool/input rules, the MCP response is a successful JSON-RPC response with:

- `isError: true`
- text content containing a bounded structured error

Malformed JSON-RPC or missing tool names use JSON-RPC errors.

### D4. Session identity comes from runtime env

The provider MCP process must have:

- `TIDE_RUNTIME_ID`
- `TIDE_AGENT_ID`
- optionally `TIDE_THREAD_ID`

This preserves the same Agent Runtime session identity; MCP tool calls do not create another Agent Runtime.

### D5. Provider configs launch a Tide MCP stdio wrapper

Provider-native MCP config files must point to the generated `tide-mcp-stdio` wrapper, not to the general Tide app executable with loose arguments.

The wrapper launches the Backend entrypoint in node mode with `mcp`, while provider configs carry the active `TIDE_SOCKET` env so the provider-owned stdio process can call the live Backend socket bridge.

## Contracts

### Runtime env

```ts
interface TideMcpRuntimeEnv {
  TIDE_RUNTIME_ID?: string;
  TIDE_AGENT_ID?: string;
  TIDE_THREAD_ID?: string;
}
```

### MCP tool response

```ts
{
  content: [{ type: "text"; text: string }];
  structuredContent?: unknown;
  isError?: boolean;
}
```

## Flow

### UC-1: Initialize

1. Provider sends `initialize`.
2. Tide returns protocol metadata, tool capabilities, server info, and instructions.

### UC-2: List tools

1. Provider sends `tools/list`.
2. Tide returns the current bounded Tide MCP tool definitions from Backend.

### UC-3: Call tool

1. Provider sends `tools/call` with a tool name and arguments.
2. Tide resolves Runtime session identity from env.
3. Tide calls Backend Tide MCP Tool Surface.
4. Tide returns bounded content and structured output.

## Invariants

- MCP calls must include Runtime session identity before Backend tool routing.
- MCP server code must not import Desktop modules.
- MCP server code must not create or resume Agent Runtime.
- Tool list comes from Backend service state, not duplicated literals.

## Tests

| Behavior | Test |
|----------|------|
| Initialize returns MCP capabilities | `mcp_initialize_returns_tide_server_capabilities` |
| tools/list reads service definitions | `mcp_tools_list_returns_backend_tool_definitions` |
| tools/call forwards runtime session and returns structured output | `mcp_tools_call_routes_to_thread_runtime_service` |
| Backend service error becomes MCP tool error result | `mcp_tools_call_service_error_returns_tool_error_content` |
| Missing runtime env rejects tool calls before service routing | `mcp_tools_call_without_runtime_env_returns_json_rpc_error` |
| Backend entrypoint reaches MCP mode without loading Electron parentPort | `backend_entrypoint_mcp_mode_reaches_stdio_bridge_without_electron_parent_port` |
| Socket bridge forwards JSON-RPC requests to a live adapter | `mcp_socket_request_handler_routes_tools_call_to_adapter` |
| Stdio entrypoint requires the live Backend socket | `mcp_stdio_entrypoint_requires_tide_socket` |
| Provider bootstrap creates wrapper-backed MCP configs | `provider_bootstrap_artifacts_create_provider_native_files` |
| A broken client connection does not crash the Backend | `tide_mcp_socket_server_survives_a_broken_client_connection` |
| Agent observes the thread end-to-end over stdio+socket | `tide_mcp_stdio_socket_round_trip_lets_an_agent_observe_the_thread` |
| Agent operates the Workbench end-to-end over stdio+socket | `tide_mcp_stdio_socket_round_trip_lets_an_agent_operate_the_workbench` |

## Implementation Notes

- Keep line-delimited JSON-RPC framing in a small runner so later packaging can choose the final executable wrapper without changing the Backend adapter.
- Keep socket or process-supervisor details outside the domain service.
