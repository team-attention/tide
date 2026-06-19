# Tide shell integration for fish.
# Source this from ~/.config/fish/config.fish inside Tide Terminal.

if set -q __TIDE_TERMINAL_WRAPPER_DIR; and test -d "$__TIDE_TERMINAL_WRAPPER_DIR"
    set -l _tide_path_without_wrapper
    for _tide_path_part in $PATH
        if test "$_tide_path_part" != "$__TIDE_TERMINAL_WRAPPER_DIR"
            set -a _tide_path_without_wrapper "$_tide_path_part"
        end
    end
    set -gx PATH "$__TIDE_TERMINAL_WRAPPER_DIR" $_tide_path_without_wrapper
end
