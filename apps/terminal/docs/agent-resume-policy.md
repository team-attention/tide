# Agent Resume Policy

Tide restores the workbench, not live agent processes.

After launch or crash recovery, Tide may restore Workspace layout, Terminal cwd,
Terminal Context Surface state, side-surface preferences, and the last restore
event visible through `task_monitor`. Tide does not checkpoint child processes,
terminal scrollback, provider conversations, or provider-owned session state.

Wrapped Agents should read `task_monitor.agent_resume_policy` from
`tide_observe_workspace` before assuming a restored Workspace still has a live
agent process.

## Provider Matrix

| Provider | Wrapper command | Tide restore behavior | Resume behavior |
| --- | --- | --- | --- |
| Claude Code | `claude` | Restores Workspace layout and Terminal cwd only. | Tide does not invoke provider resume. Relaunch explicitly, then use provider-native resume only if the user or agent chooses it. |
| Codex | `codex` | Restores Workspace layout and Terminal cwd only. | Tide does not invoke provider resume. Relaunch explicitly, then use provider-native resume only if the user or agent chooses it. |
| Gemini | `gemini` | Restores Workspace layout and Terminal cwd only. | Tide does not invoke provider resume. Relaunch explicitly, then use provider-native resume only if the user or agent chooses it. |
| Antigravity | `agy` | Restores Workspace layout and Terminal cwd only. | Tide does not invoke provider resume. Relaunch explicitly, then use provider-native resume only if the user or agent chooses it. |
| opencode | `opencode` | Restores Workspace layout and Terminal cwd only. | Tide does not invoke provider resume. Relaunch explicitly, then use provider-native resume only if the user or agent chooses it. |

## MCP Contract

`task_monitor.agent_resume_policy` exposes this policy as structured data:

- `automatic_agent_process_resume=false`
- `provider_resume_invoked_by_tide=false`
- `default_resume_mode=explicit_provider_cli_only`
- `session_restore_scope.live_child_processes=false`
- `session_restore_scope.terminal_scrollback=false`
- `session_restore_scope.provider_conversations=false`

This keeps Tide provider-neutral while avoiding a false promise that a restored
Terminal Pane still contains a resumable live agent.
