//! Behavioral tests — living documentation of what the system does.
//!
//! Each test name reads as a natural language sentence describing a system behavior.
//! Organized by feature domain so tests serve as a browsable specification.

mod focus_management;
mod modal_behavior;
mod pane_lifecycle;
mod editor_behavior;
mod markdown_workspace_behavior;
mod keyboard_routing;
mod launcher_behavior;
mod theme_behavior;
mod workspace_behavior;
mod search_behavior;
mod ime_behavior;
mod render_cache_behavior;
mod global_actions;
mod text_input_routing;
mod browser_pane_ux;
mod session_behavior;
mod file_tree_modified_highlight;
mod file_tree_scroll;
mod preview_scroll;
mod terminal_context;
mod dock_behavior;
mod dock_placeholder_behavior;
mod titlebar_toggle_behavior;
mod dock_global_behavior;
mod soft_wrap_behavior;
mod lsp_completion;
mod agent_gateway;
mod cli_workspace_routing;
mod diff_auto_refresh;
mod stage_tab_group;
mod modifier_keybinding;
mod live_preview_tests;
mod git_switcher_behavior;
mod editor_file_watch_sync;
