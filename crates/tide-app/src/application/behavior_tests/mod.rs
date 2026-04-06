//! Behavioral tests — living documentation of what the system does.
//!
//! Each test name reads as a natural language sentence describing a system behavior.
//! Organized by feature domain so tests serve as a browsable specification.

mod agent_coworking_context;
mod agent_gateway;
mod browser_pane_ux;
mod browser_pane_fallbacks;
mod cli_workspace_routing;
mod diff_auto_refresh;
mod dock_behavior;
mod dock_global_behavior;
mod dock_placeholder_behavior;
mod editor_behavior;
mod editor_file_watch_sync;
mod file_tree_modified_highlight;
mod file_tree_scroll;
mod focus_management;
mod git_switcher_behavior;
mod global_actions;
mod ime_behavior;
mod keyboard_routing;
mod launcher_behavior;
mod live_preview_tests;
mod lsp_completion;
mod markdown_workspace_behavior;
mod modal_behavior;
mod modifier_keybinding;
mod pane_lifecycle;
mod preview_scroll;
mod render_cache_behavior;
mod search_behavior;
mod session_behavior;
mod soft_wrap_behavior;
mod stage_tab_group;
mod terminal_context;
mod text_input_routing;
mod theme_behavior;
mod titlebar_toggle_behavior;
mod workspace_behavior;
