# Spec: Tide API Agent Tool Calls

## Scope

This spec extends the `openai_api` Tide API Agent Runtime so it can call Tide-owned tools during a Thread turn.

It covers:

- Exposing the first Tide MCP Tool Surface slice as OpenAI Responses function tools.
- Executing OpenAI `function_call` output through Backend's Tide MCP tool handler.
- Returning `function_call_output` items to OpenAI so the Agent can continue the turn.
- Recording tool calls and tool results as structured Raw Agent Frames.
- Rendering structured tool frames as Agent Session Blocks.
- Bounding tool-call loops so one turn cannot run forever.

It does not cover:

- Browser click/type/screenshot tools.
- Diff, Editor, FileTree, or Terminal tool groups.
- Streaming tool-call deltas.
- OpenAI hosted MCP tools.
- Encrypted Provider Account storage.

## Evidence

- `docs_v2/glossary.md` defines Tide API Agent, Tide MCP Tool Surface, Raw Agent Frame, and Agent Session Block.
- `docs_v2/specs/tide-api-agent-runtime.md` defines the `openai_api` Tide API Agent runtime and structured Raw Agent Frame path.
- `docs_v2/specs/tide-mcp-workbench-observe-open-browser.md` defines the first Tide MCP Tool Surface tools: `tide_observe_thread`, `tide_observe_workbench`, `tide_open_browser`, and `tide_observe_browser`.
- `src/backend/application/services/thread-runtime-service.ts` already owns `listTideMcpTools()` and `handleTideMcpToolCall()`.
- `docs_v2/implementation/agent-session-rendering.md` lists `tool_call` and `tool_result` Agent Session Block kinds for structured tool/action output.
- OpenAI function-calling docs say Responses requests declare function tools in `tools`, model responses can include `function_call` output items with `call_id`, `name`, and JSON `arguments`, applications execute the tool, then send `function_call_output` back to the model.
- OpenAI function-calling docs say reasoning items returned with tool calls must be passed back with tool outputs for reasoning models.

## Decisions

### D1. Tide API Agents reuse Tide-owned tool contracts

The first API-backed Agent does not get a second tool system.

`openai_api` receives OpenAI function tool definitions derived from Backend's existing Tide MCP Tool Surface definitions, then executes selected tools through `ThreadRuntimeService.handleTideMcpToolCall()`.

### D2. Tool execution is still Thread-scoped

The OpenAI runtime passes the active Agent Runtime handle as the Tide MCP session identity:

- `runtimeId`
- `agentId = openai_api`
- `threadId`

Backend must still validate that the session matches the active Thread runtime before mutating Workbench state.

### D3. Function tools use non-strict schemas for this slice

The first Tide MCP schemas contain optional fields.

OpenAI Responses may normalize function schemas toward strict mode unless told otherwise, so this slice sends `strict: false` for generated function tool definitions.

### D4. Tool calls and tool results are user-visible session evidence

When OpenAI requests a tool call, Tide appends a structured Raw Agent Frame:

- `payload.type = "tool_call"`
- `payload.toolName`
- `payload.callId`
- `payload.arguments`

When Tide finishes the tool call, Tide appends another structured Raw Agent Frame:

- `payload.type = "tool_result"`
- `payload.toolName`
- `payload.callId`
- `payload.ok`
- `payload.output` or `payload.error`

The Agent Session Reader maps these known payloads to `tool_call` and `tool_result` blocks.

### D5. Tool outputs are returned as JSON strings

The OpenAI runtime returns each Tide tool result as a `function_call_output` item whose `output` is a JSON string.

Success shape:

```json
{ "ok": true, "output": { "...": "..." } }
```

Failure shape:

```json
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

### D6. Tool loop is bounded

The OpenAI runtime supports multiple tool rounds in one Composer turn, but stops after a small configured maximum.

When the model still asks for tools after the maximum round count, Tide emits a failed structured message frame explaining that the tool-call limit was reached.

## Domain Model

```ts
interface OpenAiFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
}

interface OpenAiFunctionCall {
  callId: string;
  name: string;
  argumentsJson: string;
  raw: Record<string, unknown>;
}

interface OpenAiToolExecutorInput {
  session: {
    runtimeId: string;
    agentId: "openai_api";
    threadId: string;
  };
  toolName: string;
  input?: Record<string, unknown>;
}
```

## Flow

### UC-1: Start API Agent turn with Tide tools

1. User sends Composer input to an `openai_api` Thread.
2. OpenAI runtime sends a Responses request with the Composer input and Tide function tools.
3. OpenAI returns a final text answer without tool calls.
4. Tide records the final text as a structured message frame.

### UC-2: Execute a Tide tool call

1. User sends Composer input to an `openai_api` Thread.
2. OpenAI returns one or more function calls.
3. Tide records a `tool_call` frame for each call.
4. Tide executes each call through the Tide MCP Tool Surface service path.
5. Tide records a `tool_result` frame for each result.
6. Tide sends the tool outputs back to OpenAI.
7. OpenAI returns a final text answer.
8. Tide records the final text as a structured message frame.

### UC-3: Stop runaway tool loops

1. OpenAI continues returning tool calls after Tide has completed the configured maximum tool rounds.
2. Tide does not execute another tool call.
3. Tide records a failed structured message frame saying the tool-call limit was reached.

## Invariants

1. `openai_api` never launches a Provider CLI hidden PTY to execute Tide tools.
2. Tide tools remain Backend-owned and Thread-scoped.
3. Function tool definitions are derived from `listTideMcpTools()`.
4. Every executed tool call produces both `tool_call` and `tool_result` Raw Agent Frames.
5. Tool result payloads preserve structured success or error output for raw fallback.
6. Reasoning items and function call items from a tool-call response are passed back with `function_call_output`.
7. The tool loop stops after the configured maximum.

## Tests

| Rule | Test |
|------|------|
| Function tools are derived from Tide MCP tool definitions | `openai_function_tools_are_built_from_tide_tool_definitions` |
| Responses client sends tools and parses function calls | `openai_response_client_sends_tools_and_parses_function_calls` |
| Runtime executes a Tide tool call and continues with function output | `openai_api_runtime_executes_tide_tool_call_and_emits_tool_frames` |
| Runtime stops after bounded tool rounds | `openai_api_runtime_stops_after_configured_tool_rounds` |
| Structured tool frames render as tool blocks | `structured_tool_events_render_as_tool_blocks` |

## Implementation Notes

- Keep OpenAI API transport in `src/backend/adapters/outbound/agent-runtime`.
- Keep Thread-scoped tool execution in `ThreadRuntimeService`.
- Keep the function-tool conversion small and testable.
- Preserve unknown OpenAI output as raw response data on the Response result, but only emit known message/tool frames in this slice.
