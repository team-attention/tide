# Tide shell integration for bash.
# Source this from ~/.bash_profile or ~/.bashrc inside Tide Terminal.

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
