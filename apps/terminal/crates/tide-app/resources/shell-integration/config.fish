# Tide shell integration for fish, sourced by the launch init command after
# the user's normal configuration.

if set -q __TIDE_TERMINAL_WRAPPER_DIR; and test -d "$__TIDE_TERMINAL_WRAPPER_DIR"
    set -l _tide_path_without_wrapper
    for _tide_path_part in $PATH
        if test "$_tide_path_part" != "$__TIDE_TERMINAL_WRAPPER_DIR"
            set -a _tide_path_without_wrapper "$_tide_path_part"
        end
    end
    set -gx PATH "$__TIDE_TERMINAL_WRAPPER_DIR" $_tide_path_without_wrapper
end

if set -q __tide_terminal_nonce; and not set -q __tide_terminal_shell_active
    set -g __tide_terminal_shell_active 1
    set -g __tide_terminal_last_cwd "$PWD"
    set -g __tide_terminal_finish_emitted 0

    function __tide_terminal_emit_boundary
        printf '\e]133;%s;tide_nonce=%s\e\\' "$argv[1]" "$__tide_terminal_nonce"
    end

    function __tide_terminal_emit_finished
        printf '\e]133;D;%s;tide_nonce=%s\e\\' "$argv[1]" "$__tide_terminal_nonce"
    end

    function __tide_terminal_emit_cwd
        set -l encoded (string escape --style=url "$PWD")
        printf '\e]7;file://%s%s?tide_nonce=%s\e\\' "$hostname" "$encoded" "$__tide_terminal_nonce"
        set -g __tide_terminal_last_cwd "$PWD"
    end

    function __tide_terminal_preexec --on-event fish_preexec
        set -l command_status $status
        __tide_terminal_emit_boundary C
        set -g __tide_terminal_finish_emitted 0
        return $command_status
    end

    function __tide_terminal_postexec --on-event fish_postexec
        set -l command_status $status
        __tide_terminal_emit_finished $command_status
        set -g __tide_terminal_finish_emitted 1
        return $command_status
    end

    function __tide_terminal_pwd_changed --on-variable PWD
        set -l command_status $status
        if test "$PWD" != "$__tide_terminal_last_cwd"
            __tide_terminal_emit_cwd
        end
        return $command_status
    end

    if functions -q fish_prompt
        functions -c fish_prompt __tide_terminal_user_fish_prompt
    else
        function __tide_terminal_user_fish_prompt
            printf '> '
        end
    end

    function fish_prompt
        set -l command_status $status
        if test "$__tide_terminal_finish_emitted" = 0
            __tide_terminal_emit_finished $command_status
            set -g __tide_terminal_finish_emitted 1
        end
        __tide_terminal_emit_cwd
        __tide_terminal_emit_boundary A
        __tide_terminal_user_fish_prompt
        __tide_terminal_emit_boundary B
        return $command_status
    end
end
