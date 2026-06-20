# Agent Tool Guidance

Tide MCP Runtime tools are for shared workbench behavior, not hidden
automation. A wrapped agent should use them to inspect the same Terminal,
Editor, Browser, Diff, and Context surfaces the human can see.

These examples use MCP tool names and argument shapes. The caller Terminal
boundary is supplied by Tide's wrapper, so examples omit internal routing fields.

## Default Rule

Observe before acting.

Use `tide_observe_workspace` when the agent needs task orientation, Pane
membership, unread task attention, Browser targets, Context Artifact delivery
state, or layout guidance. Use the Pane-specific observe/search tools before
sending keys, clicking, or editing.

```json
{
  "name": "tide_observe_workspace",
  "arguments": { "detail": "compact" }
}
```

The result tells the agent which Workspace it is in, which Panes belong to the
caller Terminal's workbench boundary, which wrapped-agent lifecycle or
notification state is pending in `task_monitor.workspaces[].agent_lifecycle`,
which unread/running items are summarized in `task_monitor.attention_panel`,
how restored provider processes should be handled in
`task_monitor.agent_resume_policy`, what Context Artifacts exist, and whether
the next action should be layout correction before Browser work.

## Inspect Terminal Output

Use the live Terminal observation before deciding whether to send more input.

```json
{
  "name": "tide_observe_terminal",
  "arguments": {}
}
```

If the relevant output has scrolled away, search the caller Terminal's scrollback
instead of asking the user to paste logs.

```json
{
  "name": "tide_find_in_terminal",
  "arguments": {
    "query": "error:",
    "max_matches": 10
  }
}
```

Use Terminal keys only after the visible state or search result justifies the
next command.

## Verify In A Browser Pane

For local previews, docs pages, file-backed previews, and public unauthenticated
pages, use Tide Browser Pane Runtime first.

```json
{
  "name": "tide_open_browser",
  "arguments": {
    "url": "http://localhost:5173"
  }
}
```

Then observe the visible Browser Pane. Use `detail=compact` for routine loops
and `detail=full` only when full snapshot text or geometry is needed.

```json
{
  "name": "tide_browser_observe",
  "arguments": {
    "pane_id": 42,
    "detail": "compact"
  }
}
```

If the observation returns `visual_fit.tool_selection.next_tool`, follow that
layout guidance before clicking or typing. When Page Map elements are available,
prefer `target_ref` over guessed coordinates.

```json
{
  "name": "tide_browser_action",
  "arguments": {
    "pane_id": 42,
    "action": "click",
    "target_ref": "g12:button:submit"
  }
}
```

After the final observation for user-requested Browser work, finish the Browser
Operation so visible operation chrome clears.

```json
{
  "name": "tide_browser_operation",
  "arguments": {
    "pane_id": 42,
    "action": "finish"
  }
}
```

Use external browser runtimes only when Tide Browser Pane Runtime cannot
represent the target, the user explicitly asks for another browser, or the task
requires browser profile/credential behavior Tide does not yet claim. After a
handoff, re-observe the Browser Pane; `external_runtime` records the explicit
fallback reason and URL while the Tide Browser Pane remains inspectable.

## Read And Edit An Editor Pane

Use Editor Pane tools for task-local files opened in Tide. Search first.

```json
{
  "name": "tide_find_in_editor",
  "arguments": {
    "pane_id": 77,
    "query": "deprecatedName",
    "context_lines": 2
  }
}
```

Apply focused replacements only after the result identifies the intended owned
Editor Pane buffer. Tide defaults to one replacement so the agent does not make
broad edits by accident.

```json
{
  "name": "tide_replace_in_editor",
  "arguments": {
    "pane_id": 77,
    "query": "deprecatedName",
    "replacement": "currentName",
    "max_replacements": 1
  }
}
```

For broader refactors, the agent should explain the intended scope, use bounded
limits, and re-observe or search again after replacement.

## Use Context Artifacts For Human Feedback

Context Artifacts are explicit review records. They can include a human comment,
a captured selection, source metadata, pin state, and delivery history.

List them before assuming there is no human feedback.

```json
{
  "name": "tide_list_context_artifacts",
  "arguments": {}
}
```

Read a specific Artifact when the task monitor reports pending or delivered
context.

```json
{
  "name": "tide_read_context_artifact",
  "arguments": {
    "artifact_id": 5
  }
}
```

When the agent has created or received a relevant selection/comment, deliver it
through the paired-agent handoff instead of copying it into hidden prompt state.

```json
{
  "name": "tide_send_context_artifact",
  "arguments": {
    "artifact_id": 5
  }
}
```

Delivery updates `delivered`, `delivery_count`, `deliveries`, and
`last_delivery` in later list/read results. The Workspace task monitor and
Workspace rail summarize this state so the human and the agent can tell whether
feedback is still pending or already sent.

## Avoid

- Do not ask the user to paste visible Terminal, Editor, Browser, or Diff
  content before trying the relevant Tide observe, find, or capture tool.
- Do not open extra Stage Terminals for side context; use the caller Terminal's
  Terminal Context Surface.
- Do not use Browser eval for clicks, typing, form submission, or layout
  workarounds. Use `tide_browser_action` and layout guidance.
- Do not treat Context Artifacts as ambient hidden prompt state. List, read, and
  send them explicitly.
