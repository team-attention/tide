# Tide shell integration, loaded through a temporary ZDOTDIR.

typeset -g _tide_terminal_integration_dir="${TIDE_TERMINAL_SHELL_INTEGRATION_DIR:-$ZDOTDIR}"
typeset -g _tide_terminal_nonce="${__TIDE_TERMINAL_SHELL_NONCE:-}"
unset TIDE_TERMINAL_SHELL_INTEGRATION_DIR __TIDE_TERMINAL_SHELL_NONCE

# Restore the user's startup-file directory before zprofile/zshrc/zlogin run.
if [[ -n "${__TIDE_TERMINAL_ORIG_ZDOTDIR:-}" ]]; then
    export ZDOTDIR="$__TIDE_TERMINAL_ORIG_ZDOTDIR"
    unset __TIDE_TERMINAL_ORIG_ZDOTDIR
else
    unset ZDOTDIR
fi

# Source the user's real .zshenv exactly once; zsh loads the remaining startup
# files itself from the restored ZDOTDIR.
if [[ -f "${ZDOTDIR:-$HOME}/.zshenv" ]]; then
    source "${ZDOTDIR:-$HOME}/.zshenv"
fi

if [[ -n "$_tide_terminal_nonce" && -z "${_tide_terminal_shell_active:-}" ]]; then
    typeset -g _tide_terminal_shell_active=1

    _tide_terminal_percent_encode() {
        local input="$1" output="" char hex
        local LC_ALL=C
        local index
        for ((index = 1; index <= ${#input}; index++)); do
            char="${input[index]}"
            case "$char" in
                [A-Za-z0-9.~_/-]) output+="$char" ;;
                *)
                    printf -v hex '%02X' "'$char"
                    output+="%$hex"
                    ;;
            esac
        done
        print -rn -- "$output"
    }

    _tide_terminal_emit_boundary() {
        printf '\033]133;%s;tide_nonce=%s\033\\' "$1" "$_tide_terminal_nonce"
    }

    _tide_terminal_emit_finished() {
        printf '\033]133;D;%s;tide_nonce=%s\033\\' "$1" "$_tide_terminal_nonce"
    }

    _tide_terminal_emit_cwd() {
        local encoded hostname
        encoded="$(_tide_terminal_percent_encode "$PWD")"
        hostname=${HOST:-$(hostname 2>/dev/null)}
        printf '\033]7;file://%s%s?tide_nonce=%s\033\\' "${hostname:-localhost}" "$encoded" "$_tide_terminal_nonce"
    }

    _tide_terminal_precmd() {
        local command_status=$?
        _tide_terminal_emit_finished "$command_status"
        _tide_terminal_emit_cwd
        _tide_terminal_emit_boundary A
        return "$command_status"
    }

    _tide_terminal_preexec() {
        local command_status=$?
        _tide_terminal_emit_boundary C
        return "$command_status"
    }

    _tide_terminal_chpwd() {
        local command_status=$?
        _tide_terminal_emit_cwd
        return "$command_status"
    }

    _tide_terminal_line_init() {
        local command_status=$?
        _tide_terminal_emit_boundary B
        return "$command_status"
    }

    _tide_terminal_install_hooks() {
        local command_status=$?
        add-zsh-hook -d precmd _tide_terminal_install_hooks
        add-zsh-hook precmd _tide_terminal_precmd
        add-zsh-hook preexec _tide_terminal_preexec
        add-zsh-hook chpwd _tide_terminal_chpwd
        autoload -Uz add-zle-hook-widget
        add-zle-hook-widget line-init _tide_terminal_line_init

        if [[ -n "${__TIDE_TERMINAL_WRAPPER_DIR:-}" && -d "$__TIDE_TERMINAL_WRAPPER_DIR" ]]; then
            local -a path_parts=("${(@s/:/)PATH}")
            path_parts=("${(@)path_parts:#$__TIDE_TERMINAL_WRAPPER_DIR}")
            PATH="${__TIDE_TERMINAL_WRAPPER_DIR}:${(j/:/)path_parts}"
            export PATH
        fi

        _tide_terminal_emit_finished "$command_status"
        _tide_terminal_emit_cwd
        _tide_terminal_emit_boundary A
        return "$command_status"
    }

    autoload -Uz add-zsh-hook
    add-zsh-hook precmd _tide_terminal_install_hooks
fi
