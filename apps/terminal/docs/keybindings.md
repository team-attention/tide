# Keybindings

Tide Terminal stores keybinding overrides in:

```text
~/Library/Application Support/tide-terminal/settings.json
```

Settings → Keybindings lists every action accepted by `GlobalAction::from_action_key`,
including actions with no default key. Type to search, click a row (or press Enter)
and press a modified key combination. Escape cancels recording. Close Settings
to save and apply changes. Each row offers Reset; Reset all restores all defaults.
Cmd+Backspace resets the selected row; Cmd+Shift+Backspace resets all rows.

## Override Format

```json
{
  "keybindings": [
    {
      "action": "NewWorkspace",
      "key": "N",
      "shift": true,
      "ctrl": false,
      "meta": true,
      "alt": false
    }
  ]
}
```

On macOS, `meta` means Command.

Supported `key` values are:

- A single character, such as `T`, `\`, `,`, `+`, or `0`.
- `Enter`, `Escape`, `Backspace`, `Tab`, `Up`, `Down`, `Left`, `Right`,
  `Delete`, `Home`, `End`, `PageUp`, and `PageDown`.

Conflict rule: an override replaces the binding for the same action and removes
any earlier binding using the same hotkey. In manually-edited JSON, later
overrides win. In Settings, a conflicting key is rejected with the owning action name. Neither
binding changes. Default aliases also participate in conflict detection.

Removed action keys are silently ignored: `ToggleLivePreview`,
`SplitHorizontalHere`, `SplitVerticalHere`, `ToggleZoom`, `BrowserBack`, and
`BrowserForward`.

## Default Bindings

| Action key | Label | Default binding |
| --- | --- | --- |
| `NewTab` | New Tab | `Cmd+T` |
| `SplitHorizontal` | Split Horizontal | `Cmd+Shift+T` |
| `ToggleDock` | Toggle Dock | `Cmd+\` |
| `ClosePane` | Close Pane | `Cmd+W` |
| `CloseWorkspace` | Close Workspace | `Cmd+Shift+W` |
| `Paste` | Paste | `Cmd+V` |
| `Copy` | Copy | `Cmd+C` |
| `ToggleFullscreen` | Toggle Fullscreen | `Ctrl+Cmd+F` |
| `Find` | Find | `Cmd+F` |
| `ToggleStacked` | Toggle Stacked | `Cmd+Enter` |
| `DockToggleStacked` | Dock Toggle Stacked | `Ctrl+Cmd+Enter` |
| `WorkspacePrev` | Workspace Prev | `Cmd+[` |
| `WorkspaceNext` | Workspace Next | `Cmd+]` |
| `NavigateLeft` | Navigate Left | `Cmd+H` |
| `NavigateDown` | Navigate Down | `Cmd+J` |
| `NavigateUp` | Navigate Up | `Cmd+K` |
| `NavigateRight` | Navigate Right | `Cmd+L` |
| `DockNavigateLeft` | Dock Navigate Left | `Cmd+Shift+H` |
| `DockNavigateDown` | Dock Navigate Down | `Cmd+Shift+J` |
| `DockNavigateUp` | Dock Navigate Up | `Cmd+Shift+K` |
| `DockNavigateRight` | Dock Navigate Right | `Cmd+Shift+L` |
| `FileFinder` | File Finder | `Cmd+Shift+O` |
| `NewWindow` | New Window | `Cmd+N` |
| `NewWorkspace` | New Workspace | `Cmd+Shift+N` |
| `FontSizeUp` | Font Size Up | `Cmd++`, `Cmd+=` |
| `FontSizeDown` | Font Size Down | `Cmd+-` |
| `FontSizeReset` | Font Size Reset | `Cmd+0` |
| `OpenConfig` | Open Config | `Cmd+,` |
| `ToggleFileTree` | Toggle File Tree | `Cmd+B` |
| `ToggleWorkspaceSidebar` | Toggle Workspace Sidebar | `Cmd+E` |
| `OpenBrowser` | Open Browser | `Cmd+Shift+B` |
| `BrowserReload` | Browser Reload | `Cmd+R` |
| `ScrollHalfPageUp` | Scroll Half Page Up | `Cmd+U` |
| `ScrollHalfPageDown` | Scroll Half Page Down | `Cmd+D` |

## Accepted Action Keys

These action keys are accepted by the settings parser. "Settings UI" means the
action currently appears in the in-app keybindings editor.

| Action key | Label | Settings UI | Default |
| --- | --- | --- | --- |
| `SplitVertical` | Split Vertical | Yes | None |
| `SplitHorizontal` | Split Horizontal | Yes | `Cmd+Shift+T` |
| `ClosePane` | Close Pane | Yes | `Cmd+W` |
| `FocusSlot1` | Focus Slot 1 | Yes | None |
| `FocusSlot2` | Focus Slot 2 | Yes | None |
| `FocusSlot3` | Focus Slot 3 | Yes | None |
| `FocusSlot4` | Focus Slot 4 | Yes | None |
| `NavigateUp` | Navigate Up | Yes | `Cmd+K` |
| `NavigateDown` | Navigate Down | Yes | `Cmd+J` |
| `NavigateLeft` | Navigate Left | Yes | `Cmd+H` |
| `NavigateRight` | Navigate Right | Yes | `Cmd+L` |
| `DockNavigateUp` | Dock Navigate Up | Yes | `Cmd+Shift+K` |
| `DockNavigateDown` | Dock Navigate Down | Yes | `Cmd+Shift+J` |
| `DockNavigateLeft` | Dock Navigate Left | Yes | `Cmd+Shift+H` |
| `DockNavigateRight` | Dock Navigate Right | Yes | `Cmd+Shift+L` |
| `DockSplitVertical` | Dock Split Vertical | Yes | None |
| `DockSplitHorizontal` | Dock Split Horizontal | Yes | None |
| `DockNewTab` | Dock New Tab | Yes | None |
| `DockTabPrev` | Dock Tab Prev | Yes | None |
| `DockTabNext` | Dock Tab Next | Yes | None |
| `TabPrev` | Tab Prev | Yes | None |
| `TabNext` | Tab Next | Yes | None |
| `NewTab` | New Tab | Yes | `Cmd+T` |
| `FileFinder` | File Finder | Yes | `Cmd+Shift+O` |
| `Paste` | Paste | Yes | `Cmd+V` |
| `Copy` | Copy | Yes | `Cmd+C` |
| `ToggleFullscreen` | Toggle Fullscreen | Yes | `Ctrl+Cmd+F` |
| `Find` | Find | Yes | `Cmd+F` |
| `ToggleTheme` | Toggle Theme | Yes | None |
| `FontSizeUp` | Font Size Up | Yes | `Cmd++`, `Cmd+=` |
| `FontSizeDown` | Font Size Down | Yes | `Cmd+-` |
| `FontSizeReset` | Font Size Reset | Yes | `Cmd+0` |
| `NewWindow` | New Window | Yes | `Cmd+N` |
| `NewFile` | New File | Yes | None |
| `OpenConfig` | Open Config | Yes | `Cmd+,` |
| `OpenBrowser` | Open Browser | Yes | `Cmd+Shift+B` |
| `BrowserReload` | Browser Reload | Yes | `Cmd+R` |
| `ScrollHalfPageUp` | Scroll Half Page Up | Yes | `Cmd+U` |
| `ScrollHalfPageDown` | Scroll Half Page Down | Yes | `Cmd+D` |
| `WorkspacePrev` | Workspace Prev | Yes | `Cmd+[` |
| `WorkspaceNext` | Workspace Next | Yes | `Cmd+]` |
| `NewWorkspace` | New Workspace | Yes | `Cmd+Shift+N` |
| `CloseWorkspace` | Close Workspace | Yes | `Cmd+Shift+W` |
| `ToggleFileTree` | Toggle File Tree | Yes | `Cmd+B` |
| `ToggleDock` | Toggle Dock | Yes | `Cmd+\` |
| `ToggleWorkspaceSidebar` | Toggle Workspace Sidebar | Yes | `Cmd+E` |
| `ToggleStacked` | Toggle Stacked | Yes | `Cmd+Enter` |
| `DockToggleStacked` | Dock Toggle Stacked | Yes | `Ctrl+Cmd+Enter` |
| `ToggleDockPin` | Toggle Dock Pin | Yes | None |

## Product Gaps

- The settings UI should make hotkey swaps visible when a recorded shortcut
  conflicts with another action.
- Unbound but accepted actions should either become first-class or be removed
  from the parser.
- The README should link this page instead of duplicating the full action list.
