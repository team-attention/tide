# Tide shell integration for Bash, sourced by Tide's login shim after the
# user's normal startup file.

if [ -n "${__TIDE_TERMINAL_WRAPPER_DIR:-}" ] && [ -d "$__TIDE_TERMINAL_WRAPPER_DIR" ]; then
    _tide_path_without_wrapper=":$PATH:"
    _tide_path_without_wrapper="${_tide_path_without_wrapper//:$__TIDE_TERMINAL_WRAPPER_DIR:/:}"
    _tide_path_without_wrapper="${_tide_path_without_wrapper#:}"
    _tide_path_without_wrapper="${_tide_path_without_wrapper%:}"

    if [ -n "$_tide_path_without_wrapper" ]; then
        PATH="$__TIDE_TERMINAL_WRAPPER_DIR:$_tide_path_without_wrapper"
    else
        PATH="$__TIDE_TERMINAL_WRAPPER_DIR"
    fi
    export PATH

    unset _tide_path_without_wrapper
fi

if [ -n "${_tide_terminal_nonce:-}" ] && [ -z "${_tide_terminal_shell_active:-}" ]; then
    _tide_terminal_shell_active=1

    _tide_terminal_percent_encode() {
        local input=$1 output= char= hex= index LC_ALL=C
        for ((index = 0; index < ${#input}; index++)); do
            char=${input:index:1}
            case "$char" in
                [A-Za-z0-9.~_/-]) output=$output$char ;;
                *)
                    printf -v hex '%02X' "$(( $(printf '%d' "'$char") & 255 ))"
                    output=$output%$hex
                    ;;
            esac
        done
        printf '%s' "$output"
    }

    _tide_terminal_emit_boundary() {
        printf '\033]133;%s;tide_nonce=%s\033\\' "$1" "$_tide_terminal_nonce"
    }

    _tide_terminal_emit_finished() {
        printf '\033]133;D;%s;tide_nonce=%s\033\\' "$1" "$_tide_terminal_nonce"
    }

    _tide_terminal_emit_cwd() {
        local encoded hostname
        encoded=$(_tide_terminal_percent_encode "$PWD")
        hostname=${HOSTNAME:-$(hostname 2>/dev/null)}
        printf '\033]7;file://%s%s?tide_nonce=%s\033\\' "${hostname:-localhost}" "$encoded" "$_tide_terminal_nonce"
        _tide_terminal_last_cwd=$PWD
    }

    _tide_terminal_at_prompt=0
    _tide_terminal_last_cwd=$PWD
    _tide_terminal_command_status=0

    _tide_terminal_debug() {
        local command_status=$1
        if [ "$PWD" != "$_tide_terminal_last_cwd" ]; then
            _tide_terminal_emit_cwd
        fi
        case "$2" in
            _tide_terminal_prompt_dispatch*)
                _tide_terminal_command_status=$command_status
                ;;
            _tide_terminal_*) ;;
            *)
                if [ "$_tide_terminal_at_prompt" = 1 ]; then
                    _tide_terminal_at_prompt=0
                    _tide_terminal_emit_boundary C
                fi
                ;;
        esac
        return "$command_status"
    }

    _tide_terminal_user_debug=
    if [ -n "$_tide_terminal_debug_spec" ]; then
        _tide_terminal_debug_quoted=${_tide_terminal_debug_spec#trap -- }
        _tide_terminal_debug_quoted=${_tide_terminal_debug_quoted% DEBUG}
        eval "_tide_terminal_user_debug=$_tide_terminal_debug_quoted"
    fi

    _tide_terminal_debug_action='_tide_terminal_debug "$?" "$BASH_COMMAND"; '
    if [ -n "$_tide_terminal_user_debug" ]; then
        _tide_terminal_debug_action=$_tide_terminal_debug_action$_tide_terminal_user_debug
    else
        _tide_terminal_debug_action=$_tide_terminal_debug_action:
    fi
    _tide_terminal_prompt_is_array=0
    _tide_terminal_prompt_declaration=$(declare -p PROMPT_COMMAND 2>/dev/null || true)
    case "$_tide_terminal_prompt_declaration" in
        "declare -a"*)
            _tide_terminal_prompt_is_array=1
            _tide_terminal_user_prompt_commands=("${PROMPT_COMMAND[@]}")
            ;;
        *) _tide_terminal_user_prompt_command=${PROMPT_COMMAND-} ;;
    esac

    _tide_terminal_finish_prompt() {
        local command_status=$1
        _tide_terminal_emit_finished "$command_status"
        _tide_terminal_emit_cwd
        _tide_terminal_emit_boundary A
        _tide_terminal_emit_boundary B
        _tide_terminal_at_prompt=1
        return "$command_status"
    }

    _tide_terminal_prompt_dispatch_scalar() {
        eval -- "$_tide_terminal_user_prompt_command"
        _tide_terminal_finish_prompt "$_tide_terminal_command_status"
    }

    _tide_terminal_prompt_dispatch_array() {
        local prompt_status=$?
        _tide_terminal_at_prompt=0
        local prompt_command
        for prompt_command in "${_tide_terminal_user_prompt_commands[@]}"; do
            (exit "$prompt_status")
            eval -- "$prompt_command"
            prompt_status=$?
        done
        _tide_terminal_finish_prompt "$_tide_terminal_command_status"
    }

    if [ "$_tide_terminal_prompt_is_array" = 1 ]; then
        PROMPT_COMMAND=_tide_terminal_prompt_dispatch_array
    else
        PROMPT_COMMAND=_tide_terminal_prompt_dispatch_scalar
    fi
fi
