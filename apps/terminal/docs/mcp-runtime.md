# Tide MCP Runtime

Tide MCP Runtime is the provider-neutral contract that lets wrapped agents work
inside the same visible Workspace as the human. It is not a hidden automation
layer: tools operate on Tide surfaces that the user can see or inspect.

For concrete tool-use flows, see [Agent Tool Guidance](agent-tool-guidance.md).

## Surfaces

| Surface | Contract |
| --- | --- |
| Stage | Primary live Terminal area. |
| Terminal Context Surface | Support surface owned by a Stage Terminal for related Editor, Browser, Diff, Terminal, or Launcher Panes. |
| FileTree View | Filesystem view, not a Pane. |
| Workspace rail | Task navigation surface. |

## Core Tool Groups

| Tool group | Purpose |
| --- | --- |
| Observe | `tide_observe_workspace` reports runtime, surfaces, Pane membership, geometry, Browser Pane visual fit and review history, Terminal Context Surface mode/count/focus, Context Artifact delivery summary, Workspace-scoped `agent_lifecycle` and notification state, a root `task_monitor.attention_panel` summary, provider-specific `task_monitor.agent_resume_policy`, project-local `.tide/workspace.json` Workspace and Action recipes, last useful wrapped-agent, Browser, Diff, terminal-exit, or restore event, and tool-selection guidance. `tide_observe_terminal` reports the caller Terminal's live visible screen, cursor, cwd, shell state, scrollback position, selection, URL ranges, and OSC 8 hyperlinks. `tide_find_in_terminal` searches the caller Terminal's scrollback and visible output with bounded results. `tide_find_in_editor` searches owned Editor Pane buffers with file, mode, cursor, match, context, and truncation metadata. |
| Editor Pane Edits | `tide_replace_in_editor` applies bounded literal replacements inside owned Editor Pane buffers, defaulting to the first match and reporting dirty state, cursor, replacements, and truncation metadata. |
| Panes | `tide_list_panes`, pane open/close/focus tools, and layout actions operate within the caller Terminal's workbench boundary. |
| Browser Pane Runtime | `tide_open_browser`, `tide_browser_observe`, and `tide_browser_action` keep browser work visible and stateful. |
| Selection Capture | `tide_capture_selection` reads explicit Pane selections from Terminal, Editor, Diff, Browser, and Render Browser surfaces. |
| Context Artifacts | `tide_create_context_artifact`, list/read/pin/remove/send tools make selected context explicit and Workspace-local. List/read/send results include delivery history so Browser, Editor, Terminal, and Diff review comments remain inspectable after handoff. |

## Agent Rules

- First call `tide_observe_workspace` when orientation, Pane membership, Browser
  targets, task state, wrapped-agent lifecycle, unread attention panel state,
  agent resume policy, project-local Action recipes, notification routing,
  Context Artifact delivery status, or layout guidance is needed.
- Use `tide_observe_terminal` before sending keys when the agent needs to inspect
  command output, cursor position, current cwd, scrollback offset, links, or the
  current explicit Terminal selection.
- Use `tide_find_in_terminal` for older output, errors, test failures, and
  command results that are no longer visible.
- Use `tide_capture_pane`, `tide_find_in_editor`, and
  `tide_replace_in_editor` for task-local Editor Pane reading, search, and
  focused edits before asking the user to paste file contents.
- Prefer Tide Browser Pane Runtime for visible browser review. When Tide must
  hand off to an external browser, read `panes[].external_runtime` or
  `tide_browser_observe.external_runtime` so the fallback remains explicit.
- Use Context Artifacts for explicit paired-agent delivery. Tide does not inject
  ambient Browser Pane prompts into agents.
- Caller-scoped tools must preserve the caller Terminal's workbench boundary.
- Opening support panes should use the caller Terminal Context Surface instead
  of splitting new Stage Terminals for side tasks.

## Product Proof

Run the headless workbench diagnostic:

```bash
cargo run -p tide-app -- compatibility workbench
```

The diagnostic verifies MCP tool exposure, workspace and terminal observation,
wrapped-agent lifecycle, notification state, the Workspace attention panel,
agent resume policy, Browser Runtime Router fallback visibility, Terminal and
Editor search, bounded Editor replacement, caller-scoped Pane listing, Browser
Pane placement, project-local configuration exposure, and Context Artifact
creation, delivery history, list, and read round-trips.
