# Spec: Tide MCP Code Navigation Tool

## Scope

This spec exposes the first Workbench Editor code-navigation action through the
Tide MCP Tool Surface.

It covers:

- Adding `tide_go_to_definition` to the Agent-visible MCP tool list.
- Resolving a definition from an existing Editor Pane and cursor position.
- Opening or revealing the target Editor Pane through the same Backend-owned
  code-intelligence path used by Product Shell.
- Returning a bounded tool result that includes the target Editor Pane and
  navigation target.

It does not implement reference search, rename, diagnostics, hover, browser
automation, or a full language-server lifecycle.

## Evidence

- `docs_v2/master-plan.md` says Agents should observe and operate Tide-owned
  Workbench surfaces through Tide MCP tools.
- `docs_v2/specs/workbench-editor-code-navigation.md` defines the Backend-owned
  `go_to_definition` Workbench command and `WorkspaceCodeIntelligencePort`.
- `docs_v2/specs/tide-mcp-file-workbench-tools.md` already exposes visible
  Editor Pane opening through `tide_open_file`.
- `src/backend/application/services/thread-runtime-service.ts` already routes
  MCP tool calls through the owning Thread and validates the MCP Session before
  mutating Workbench state.

## Decisions

### D1. MCP uses Editor Pane identity

`tide_go_to_definition` targets an existing Editor Pane by `paneId` plus
zero-based `line` and `character`. The Agent should call `tide_open_file` first
when it only has a file path.

### D2. Backend owns code intelligence

The MCP tool calls the same Backend code-intelligence port as Product Shell. The
Agent does not inspect files directly to infer a definition target.

### D3. Tool output returns the visible target

On success, the tool returns the opened or revealed Editor Pane, the target
location, and the source Pane id. This gives the Agent a stable Pane reference
for follow-up `tide_observe_workbench` or `tide_open_file` calls.

## Contracts

Add to the Tide MCP tool names:

```ts
"tide_go_to_definition"
```

Tool input:

```ts
interface TideGoToDefinitionInput {
  paneId: string;
  line: number;
  character: number;
}
```

Tool output:

```ts
interface TideGoToDefinitionOutput {
  kind: "go_to_definition";
  threadId: string;
  pane: WorkbenchPaneSnapshotRef & { kind: "editor" };
  sourcePaneId: string;
  target: {
    line: number;
    character: number;
    length?: number;
    label?: string;
  };
}
```

## Flow

### UC-1: Agent navigates to a definition

1. Agent observes Workbench and finds an Editor Pane id.
2. Agent calls `tide_go_to_definition` with pane id, line, and character.
3. Backend validates the MCP Session and Editor Pane ownership.
4. Backend resolves the definition through `WorkspaceCodeIntelligencePort`.
5. Backend opens or reveals the target Editor Pane.
6. Backend stores `navigationTarget` on the target Editor Pane.
7. Backend returns the target Editor Pane ref and navigation target.

### UC-2: Definition is not available

1. Agent calls `tide_go_to_definition`.
2. Backend cannot resolve a definition.
3. Backend returns a structured tool error.
4. Workbench Pane state is not mutated.

## Invariants

1. MCP code navigation never creates a second Agent Runtime.
2. The tool only acts on the owning Thread's Workbench.
3. Missing or non-Editor targets return `workbench_target_not_found`.
4. Missing definitions return `workspace_code_definition_not_found`.
5. Successful navigation opens or reveals exactly one target Editor Pane.

## Tests

| Rule | Test expectation |
|------|------------------|
| Tool list includes code navigation | `tide_mcp_tool_surface_lists_bounded_workbench_tools` |
| Agent navigation opens target Editor Pane | `mcp_go_to_definition_opens_target_editor_pane` |
| Missing definition does not mutate Workbench | `mcp_go_to_definition_without_result_returns_structured_error` |
| Provider bootstrap mentions the tool | `provider_bootstrap_artifacts_create_provider_native_files` |

## Implementation Notes

- Reuse the existing `go_to_definition` Workbench command behavior inside
  `ThreadRuntimeService`; keep the MCP output shape small and explicit.
- Keep provider-specific bootstrap text descriptive instead of mapping provider
  values into Tide-owned terminology.
