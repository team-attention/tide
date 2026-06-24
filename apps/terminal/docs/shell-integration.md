# Shell Integration

Tide shell integration has one current product job: make wrapped-agent commands
resolve to Tide's bundled wrappers when a user starts an agent from a Terminal
Pane. It is not yet a prompt-mark, command-boundary, or current-directory
tracking system.

## Common Environment

Every Tide Terminal Pane exports the terminal compatibility environment:

```text
TERM=xterm-256color
COLORTERM=truecolor
```

Tide also exports app context for local tool routing:

```text
TIDE_TERMINAL_BIN
TIDE_TERMINAL_INSTANCE_PID
TIDE_TERMINAL_PANE
TIDE_TERMINAL_WINDOW
TIDE_TERMINAL_WORKSPACE
TIDE_TERMINAL_SOCKET
```

When Auto Integration is enabled, new Terminal Panes also receive:

```text
__TIDE_TERMINAL_WRAPPER_DIR
TIDE_TERMINAL_SHELL_INTEGRATION_DIR
```

`__TIDE_TERMINAL_WRAPPER_DIR` contains the bundled wrapper commands for
`claude`, `codex`, `agy`, and `opencode`. The shell integration puts
that directory before the real commands in `PATH`.

## zsh

zsh integration is automatic.

Tide sets `ZDOTDIR` to the bundled shell-integration directory. The bundled
`.zshenv` restores the user's original `ZDOTDIR`, registers a one-shot `precmd`
hook, sources the user's real `.zshenv`, and then prepends the wrapper directory
after zsh startup files have finished.

This avoids macOS `path_helper` undoing Tide's wrapper path.

## bash

bash integration is opt-in. Tide launches login shells, so most bash users
should source the bundled snippet from `~/.bash_profile`.

```bash
if [ -n "${TIDE_TERMINAL_SHELL_INTEGRATION_DIR:-}" ] \
  && [ -r "$TIDE_TERMINAL_SHELL_INTEGRATION_DIR/bash.sh" ]; then
  . "$TIDE_TERMINAL_SHELL_INTEGRATION_DIR/bash.sh"
fi
```

If your login profile already sources `~/.bashrc`, placing the same block there
is also fine.

## fish

fish integration is opt-in. Add this to `~/.config/fish/config.fish`:

```fish
if set -q TIDE_TERMINAL_SHELL_INTEGRATION_DIR; and test -r "$TIDE_TERMINAL_SHELL_INTEGRATION_DIR/config.fish"
    source "$TIDE_TERMINAL_SHELL_INTEGRATION_DIR/config.fish"
end
```

## Current Non-Claims

- Tide does not yet claim OSC 7 current-directory tracking from shell prompts.
- Tide does not yet emit command-boundary prompt marks for shell history or
  command timing.
- bash and fish integration are documented opt-ins, not automatic startup-file
  rewrites.
- nushell and other shells do not yet have bundled snippets.
