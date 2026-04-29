# Input Routing

**Role**: Resolves keyboard/mouse events into domain commands (GlobalAction or RouteToPane).
Knows nothing about Pane content — only which Pane is focused and what keys were pressed.

`crates/tide-app/src/domain/input/`

## Aggregate: Router

```rust
Router {
    focused: Option<PaneId>,            // Currently focused pane
    hovered: Option<PaneId>,            // Mouse hover target
    dragging_border: bool,              // Border drag in progress
    border_threshold: f32,              // Hit-test threshold (default 4.0px)
    keybinding_map: Option<KeybindingMap>, // User-customizable keybindings
}
```

### InputEvent → Action Flow

```
InputEvent
    │
    ├── KeyPress { key, modifiers }
    │     │
    │     ├── Has Cmd, or Ctrl+Shift fallback? → match hotkey table
    │     │     ├── Found → Action::GlobalAction(action)
    │     │     └── Not found → Action::RouteToPane(focused)
    │     │
    │     └── No command modifier → Action::RouteToPane(focused)
    │
    ├── MouseClick { position, button }
    │     ├── Near split border? → Action::DragBorder
    │     └── On a pane? → Action::RouteToPane(pane_at_position)
    │
    ├── MouseDrag { position }
    │     ├── Dragging border? → Action::DragBorder(position)
    │     └── Otherwise → Action::RouteToPane(pane_under_cursor)
    │
    ├── MouseScroll { delta, position }
    │     └── Action::RouteToPane(pane_at_position)
    │
    └── MouseMove / Resize → Action::None
```

## Value Object: Hotkey

```rust
Hotkey {
    key: Key,       // Base key
    shift: bool,    // Shift modifier
    ctrl: bool,     // Ctrl modifier
    meta: bool,     // Cmd modifier (macOS primary)
    alt: bool,      // Alt modifier
}
```

**Matching**: Character keys are case-insensitive. All modifiers must match exactly.

## Value Object: KeybindingMap

```rust
KeybindingMap {
    bindings: Vec<(Hotkey, GlobalAction)>,
}
```

- 37 default bindings hardcoded
- `with_overrides(user_bindings)` layers user customization on top
- `lookup(key, modifiers)` → first match wins

## Command: GlobalAction (41 enum variants)

### Pane Operations
| Action | Default Binding | Description |
|--------|----------------|-------------|
| `SplitHorizontal` | Cmd+Shift+T | Split the current FocusArea into top/bottom panes |
| `SplitVertical` | Cmd+Shift+Backslash | Split the current FocusArea into left/right panes |
| `ClosePane` | Cmd+W | Close focused pane |
| `ToggleStacked` | Cmd+Enter | Toggle stacked mode for the current FocusArea |
| `DockToggleStacked` | Cmd+Ctrl+Enter | Toggle Dock stacked mode without permanently changing FocusArea |
| `Navigate(Direction)` | Cmd+HJKL | Move focus within the current FocusArea |
| `DockNavigate(Direction)` | Cmd+Shift+HJKL | Move focus within Dock without changing FocusArea |
| `TabPrev` / `TabNext` | None by default | Cycle stacked panes in the current FocusArea |
| `DockTabPrev` / `DockTabNext` | None by default | Cycle Dock tabs without changing FocusArea |
| `NewTab` | Cmd+T | New Stage Terminal split, or Dock Launcher when Dock is focused |
| `DockNewTab` | None by default | New Dock Launcher without permanently changing FocusArea |
| `DockSplitHorizontal` | None by default | Split Dock into top/bottom panes |
| `DockSplitVertical` | None by default | Split Dock into left/right panes |
| `NewFile` | — | New empty editor |

### Global UI
| Action | Default Binding | Description |
|--------|----------------|-------------|
| `FocusArea(Slot)` | None by default | Positional FocusArea action for user overrides |
| `FileFinder` | Cmd+Shift+O | Open file finder modal |
| `Find` | Cmd+F | Search in pane |
| `Paste` / `Copy` | Cmd+V / Cmd+C | Clipboard |
| `OpenConfig` | Cmd+, | Settings page |
| `ToggleTheme` | Cmd+Shift+D | Dark/light mode |
| `FontSizeUp/Down/Reset` | Cmd+=/Cmd+-/Cmd+0 | Font size |
| `ToggleFullscreen` | Cmd+Ctrl+F | Fullscreen |
| `NewWindow` | Cmd+N | New window |
| `OpenBrowser` | Cmd+Shift+B | Browser Pane |
| `BrowserReload` | Cmd+R | Reload Browser Pane |
| `ScrollHalfPageUp/Down` | Cmd+U / Cmd+D | Half-page scroll |
| `ToggleDock` | Cmd+Backslash | Show/hide or focus Dock |
| `ToggleDockPin` | None by default | Legacy no-op retained for settings compatibility |
| `ToggleLivePreview` | None by default | Toggle LivePreviewMode for Markdown Pane |

### Workspace
| Action | Default Binding | Description |
|--------|----------------|-------------|
| `WorkspacePrev/Next` | Cmd+[ / Cmd+] | Cycle workspaces |
| `NewWorkspace` | Cmd+Shift+N | Create workspace |
| `CloseWorkspace` | Cmd+Shift+W | Close workspace |

### Side Surfaces
| Action | Default Binding | Description |
|--------|----------------|-------------|
| `ToggleFileTree` | Cmd+B | Show/hide FileTree View |
| `ToggleWorkspaceSidebar` | Cmd+E | Show/hide Workspace rail |

### Retired Action Keys

`BrowserBack`, `BrowserForward`, and `ToggleZoom` are no longer `GlobalAction`
variants. Settings migration drops those keys with `from_action_key() -> None`.

## Command: Action (routing decision)

```rust
enum Action {
    GlobalAction(GlobalAction),     // System-wide command
    RouteToPane(PaneId),            // Send input to specific pane
    DragBorder(Vec2),               // Split border being dragged
    None,                           // No action
}
```
