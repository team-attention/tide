# Project Local Configuration

Tide Terminal looks for project-local Workspace and Action recipes at:

```text
.tide/workspace.json
```

Discovery starts from the caller or focused Terminal cwd and walks upward until
it finds the file. If no Terminal cwd is available, Tide falls back to the app
process cwd.

## Schema

```json
{
  "workspaces": [
    {
      "name": "Dev",
      "cwd": ".",
      "command": "npm run dev",
      "agent": "codex"
    }
  ],
  "actions": [
    {
      "name": "test",
      "description": "Run focused tests",
      "command": "cargo test -p tide-app tide_mcp_runtime",
      "cwd": "apps/terminal"
    }
  ]
}
```

## Runtime Contract

`tide_observe_workspace` exposes the discovered file as `project_config` with:

- `state`: `loaded`, `not_found`, or `invalid`
- `root` and `path` when a config file is found
- `workspace_count`, `action_count`, `workspaces`, and `actions`
- `execution.automatic = false`

Tide does not run project actions implicitly. A human or wrapped agent can read
the action recipe, inspect the Terminal state, and then explicitly send the
command through the Terminal, for example with `tide_send_keys`.

## Current Boundary

Project config is a visible workbench contract first. It does not yet create
Workspaces automatically, bind custom buttons, or prompt for action execution.
Those behaviors should build on this file format without changing the safety
rule that project actions require explicit Terminal input.
