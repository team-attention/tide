# Spec: Workbench Editor Code Navigation

## Scope

This slice adds the first code-navigation path for Workbench Editor Panes:
go-to-definition from an opened Editor Pane.

It covers:

- A Backend-owned code intelligence port for Thread-root-scoped navigation.
- A `workbench.command` named `go_to_definition`.
- Opening or revealing the target Editor Pane through Backend file reads.
- Carrying a navigation target on Editor Pane refs so Desktop can move the
  visible editor cursor.
- A TypeScript/JavaScript implementation backed by the TypeScript language
  service.

It does not cover:

- Full Language Server Protocol process lifecycle.
- Completion, hover, diagnostics, rename, or project-wide symbol UI.
- Reference result lists.
- Monaco or CodeMirror adoption.

This is deliberately a step toward the requested IDE-grade Editor Pane rather
than a claim that the full LSP surface is complete.

## Evidence

- `docs_v2/master-plan.md` says Workbench can contain Editor Panes for editing
  and direct work beside Agent Chat.
- `docs_v2/specs/workbench-editor-pane-editing.md` explicitly excludes LSP,
  symbols, go-to-reference, rename, and diagnostics, and says those require the
  editable Editor Pane, stable file identity, and save path first.
- `src/backend/application/domains/workbench/workbench.ts` currently stores
  Editor Pane file identity, text, revision, and truncation.
- `src/shared/contracts/commands.ts` already exposes generic
  `workbench.command` payloads for Thread-scoped Workbench actions.
- `package.json` includes `typescript`, which can provide a concrete
  TypeScript/JavaScript navigation backend while the LSP protocol process layer
  is still a later slice.

## Decisions

### D1. Backend owns navigation

Desktop sends the active Editor Pane, cursor line, and cursor character.
Backend resolves the target through a code intelligence port. Desktop never
reads project files directly for navigation.

### D2. Navigation is Thread-root scoped

Code intelligence must resolve both source and target files under the active
Thread root. A result outside the Thread root is treated as not found.

### D3. Go-to-definition opens an Editor Pane

If the definition target is in another file, Backend opens or reveals an Editor
Pane for that file. If the target is in the same file, Backend reveals the same
Pane.

### D4. Editor Pane refs carry a navigation target

The target Editor Pane ref may carry:

```ts
{
  navigationTarget?: {
    line: number;
    character: number;
    length?: number;
    label?: string;
    sourcePaneId?: string;
  };
}
```

Line and character are zero-based, matching LSP position conventions.

## Domain Model

```ts
interface WorkspaceCodeLocation {
  root: string;
  path: string;
  relativePath: string;
  line: number;
  character: number;
  length?: number;
  label?: string;
}

interface WorkspaceCodeIntelligencePort {
  findDefinition(input: {
    root: string;
    path: string;
    line: number;
    character: number;
  }): Promise<WorkspaceCodeDefinitionResult>;
}
```

## Contracts

### Workbench command

```ts
{
  kind: "workbench.command",
  payload: {
    threadId: string;
    command: "go_to_definition";
    targetPaneId: string;
    data: {
      line: number;
      character: number;
    };
  };
}
```

### Workbench Pane ref

Editor refs can include `navigationTarget`.

## Flow

### UC-1: Go to definition from Editor Pane

1. User places the cursor in an editable Editor Pane.
2. User invokes Go to definition.
3. Desktop emits `workbench.command go_to_definition` with cursor line and
   character.
4. Backend validates Thread, Editor Pane, Thread root, and cursor position.
5. Backend asks `WorkspaceCodeIntelligencePort.findDefinition`.
6. Backend opens or reveals the target Editor Pane.
7. Backend stores `navigationTarget` on the target Editor Pane.
8. Desktop receives `workbench.changed` and moves the visible editor cursor.

Business Rules:

- BR-1: Navigation never reads files from Desktop.
- BR-2: Navigation never targets files outside the Thread root.
- BR-3: Definition not found returns a structured service error without
  mutating Workbench state.
- BR-4: Successful navigation preserves Workbench focus.

## Invariants

1. Backend owns all filesystem and code intelligence access.
2. Navigation cannot cross the Thread root.
3. Navigation target positions are zero-based.
4. Navigation reuses Editor Pane opening and deduplication behavior.

## Tests

| Rule | Test |
|------|------|
| Backend go-to-definition opens target Editor Pane | `go_to_definition_opens_target_editor_pane_with_navigation_target` |
| Definition not found does not mutate Workbench | `go_to_definition_without_result_returns_not_found_without_workbench_mutation` |
| Desktop emits cursor-based command | `product_shell_go_to_definition_emits_cursor_position_command` |
| Shared contract carries navigation target | `workbench_editor_pane_contract_carries_navigation_target` |

## Implementation Notes

- The first live adapter supports TypeScript and JavaScript files through the
  TypeScript language service.
- A later slice can replace or complement this adapter with a process-backed
  LSP manager while keeping the same Backend port contract.
