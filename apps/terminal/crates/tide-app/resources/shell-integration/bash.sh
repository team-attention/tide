# Tide shell integration for bash.
# Source this from ~/.bash_profile or ~/.bashrc inside Tide Terminal.

if [ -n "${__TIDE_TERMINAL_WRAPPER_DIR:-}" ] && [ -d "$__TIDE_TERMINAL_WRAPPER_DIR" ]; then
    _tide_path_without_wrapper=""
    _tide_old_ifs=$IFS
    IFS=:
    for _tide_path_part in $PATH; do
        if [ "$_tide_path_part" = "$__TIDE_TERMINAL_WRAPPER_DIR" ]; then
            continue
        fi
        if [ -z "$_tide_path_without_wrapper" ]; then
            _tide_path_without_wrapper=$_tide_path_part
        else
            _tide_path_without_wrapper=$_tide_path_without_wrapper:$_tide_path_part
        fi
    done
    IFS=$_tide_old_ifs

    if [ -n "$_tide_path_without_wrapper" ]; then
        PATH=$__TIDE_TERMINAL_WRAPPER_DIR:$_tide_path_without_wrapper
    else
        PATH=$__TIDE_TERMINAL_WRAPPER_DIR
    fi
    export PATH

    unset _tide_path_without_wrapper _tide_old_ifs _tide_path_part
fi
