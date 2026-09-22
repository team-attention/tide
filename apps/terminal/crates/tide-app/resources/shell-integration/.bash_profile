# Tide Bash login shim. HOME points here only long enough for Bash to select
# this file; restore the user's HOME before loading their startup file.

_tide_terminal_integration_dir="${TIDE_TERMINAL_SHELL_INTEGRATION_DIR:-$HOME}"
_tide_terminal_nonce="${__TIDE_TERMINAL_SHELL_NONCE:-}"
unset TIDE_TERMINAL_SHELL_INTEGRATION_DIR __TIDE_TERMINAL_SHELL_NONCE

if [ -n "${__TIDE_TERMINAL_ORIG_HOME:-}" ]; then
    HOME="$__TIDE_TERMINAL_ORIG_HOME"
    export HOME
    HISTFILE="$HOME/.bash_history"
    unset __TIDE_TERMINAL_ORIG_HOME
fi

_tide_terminal_install() {
    local startup_status=$1

    if [ -n "$_tide_terminal_nonce" ] && [ -f "$_tide_terminal_integration_dir/bash.sh" ]; then
        eval -- "$(<"$_tide_terminal_integration_dir/bash.sh")"
    fi

    return "$startup_status"
}

_tide_terminal_cleanup() {
    local startup_status=$1
    unset _tide_terminal_profile _tide_terminal_startup_status
    unset _tide_terminal_debug_spec _tide_terminal_debug_quoted
    unset _tide_terminal_debug_action _tide_terminal_user_debug
    unset _tide_terminal_prompt_declaration _tide_terminal_bootstrap
    unset -f _tide_terminal_install
    unset -f _tide_terminal_cleanup
    return "$startup_status"
}

_tide_terminal_profile=
for _tide_terminal_candidate in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    if [ -f "$_tide_terminal_candidate" ]; then
        _tide_terminal_profile=$_tide_terminal_candidate
        break
    fi
done
unset _tide_terminal_candidate

if [ -n "$_tide_terminal_profile" ]; then
    . "$_tide_terminal_profile"
else
    :
fi

_tide_terminal_startup_status=$?
_tide_terminal_debug_spec=$(trap -p DEBUG)
_tide_terminal_install "$_tide_terminal_startup_status"
_tide_terminal_bootstrap=1 trap "$_tide_terminal_debug_action" DEBUG
_tide_terminal_cleanup "$_tide_terminal_startup_status"
