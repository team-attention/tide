# Tide shell integration — injected via ZDOTDIR hijack.
# Restores user's real ZDOTDIR, registers PATH hook, then sources user's .zshenv.

# Restore original ZDOTDIR first so subsequent dotfiles load from user's dir.
if [[ -n "${__TIDE_TERMINAL_ORIG_ZDOTDIR:-}" ]]; then
    export ZDOTDIR="$__TIDE_TERMINAL_ORIG_ZDOTDIR"
    unset __TIDE_TERMINAL_ORIG_ZDOTDIR
else
    unset ZDOTDIR
fi

# Register the PATH fix hook BEFORE sourcing user files, so even if
# the user's .zshenv errors out, the hook is already installed.
# Runs ONCE on the first prompt — after all init files (zprofile, zshrc,
# zlogin) have finished, so path_helper can't undo it.
if [[ -n "${__TIDE_TERMINAL_WRAPPER_DIR:-}" ]]; then
    _tide_fix_path() {
        if [[ -d "$__TIDE_TERMINAL_WRAPPER_DIR" ]]; then
            # Remove any existing wrapper dir entries, then prepend
            local -a parts=("${(@s/:/)PATH}")
            parts=("${(@)parts:#$__TIDE_TERMINAL_WRAPPER_DIR}")
            PATH="${__TIDE_TERMINAL_WRAPPER_DIR}:${(j/:/)parts}"
        fi
        # Self-remove: only needs to run once
        add-zsh-hook -d precmd _tide_fix_path
    }
    autoload -Uz add-zsh-hook
    add-zsh-hook precmd _tide_fix_path
fi

# Source user's real .zshenv (if it exists)
if [[ -f "${ZDOTDIR:-$HOME}/.zshenv" ]]; then
    source "${ZDOTDIR:-$HOME}/.zshenv"
fi
