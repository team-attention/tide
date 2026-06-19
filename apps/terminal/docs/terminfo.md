# TERM and Terminfo Strategy

Tide Terminal currently uses a conservative compatibility identity:

| Environment | Value |
| --- | --- |
| `TERM` | `xterm-256color` |
| `COLORTERM` | `truecolor` |

This is intentional. Tide should be usable by common shells, CLIs, and TUIs
without requiring users to install a Tide-specific terminfo entry on every
machine they SSH into or every container they open.

For the broader remote-workflow contract, see
[SSH and Remote Workflow](ssh-remote.md).

## Current Contract

- Tide advertises `TERM=xterm-256color`.
- Tide advertises truecolor support with `COLORTERM=truecolor`.
- Tide does not currently ship or require a Tide-specific terminfo entry.
- Tide should only claim protocol behavior that is implemented, documented, and
  covered by compatibility tests.

## Why Not `TERM=tide` Yet?

A custom `TERM` value is useful only if the terminfo entry is installed wherever
programs run. That becomes fragile across SSH, containers, tmux, dev shells, and
agent-launched processes. Until Tide has a larger compatibility suite and a
clear remote distribution story, the safer product choice is to stay compatible
with the common `xterm-256color` baseline and document Tide-specific extensions
separately.

## Future Gate For Custom Terminfo

Tide can revisit a custom terminfo entry after these are true:

- Compatibility checks cover real TUI apps and terminal protocol fixtures.
- SSH and remote-workspace behavior is defined.
- Install/update flows can distribute the terminfo entry reliably.
- The custom entry provides user-visible value beyond the current conservative
  baseline.
