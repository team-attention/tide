# Spec: Direct API Agent Tool Calls

## Status

Removed, superseded 2026-06-20.

Tide MCP tools are exposed to provider CLI Agents through the provider-attached MCP
bootstrap and the Backend Tide MCP socket/stdio bridge. Tide no longer maps those tools
into a separate Tide-owned direct API Agent runtime.

## Current Behavior

- Provider CLI Agents list and call Tide tools through the Tide MCP Tool Surface.
- Tool authorization is scoped to the provider runtime session and active Thread.
- Workbench mutations are Thread-owned and emitted through Backend Workbench events.
- There is no direct API Agent function-tool loop in Backend runtime wiring.

## Current Tests

| Rule | Test |
|------|------|
| Provider CLI runtime can call MCP tools | `mcp_tool_calls_accept_provider_cli_runtime_session` |
| Socket bridge exposes tools to provider stdio clients | `tide_mcp_stdio_socket_round_trip_lets_an_agent_observe_the_thread` |
| Agents can mutate Workbench through MCP | `tide_mcp_stdio_socket_round_trip_lets_an_agent_operate_the_workbench` |
