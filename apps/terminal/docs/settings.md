# Settings

Tide settings are available from `Cmd+,` and are persisted in
`settings.json` under the platform config directory.

## Settings Modal

The modal currently exposes four sections:

| Section | What it controls |
| --- | --- |
| Keybindings | Visible global actions and their hotkeys. Conflicting hotkeys are swapped instead of saved as placeholder bindings. |
| Worktree | New-worktree base directory pattern and files copied into new worktrees. |
| Terminal | Scrollback history size and OSC 52 clipboard-read policy. |
| Appearance | Theme mode and built-in palette. |

## Appearance Settings

| UI label | JSON key | Default | Notes |
| --- | --- | --- | --- |
| Mode | `appearance.theme` | `dark` | Accepted values: `dark`, `light`. |
| Palette | `appearance.palette` | `tide` | Built-in palettes: `tide`, `graphite`, `sage`. Each palette has dark and light variants. |

Example:

```json
{
  "appearance": {
    "theme": "dark",
    "palette": "graphite"
  }
}
```

## Terminal Settings

| UI label | JSON key | Default | Notes |
| --- | --- | --- | --- |
| Scrollback lines | `terminal.scrollback_lines` | `10000` | `0` disables retained history. Values are clamped at `200000`. Existing terminals are updated when settings are applied. |
| OSC 52 read | `terminal.osc52_read` | `false` | Clipboard writes are supported separately. Reads are blocked by default and only allowed when this is enabled. |

Example:

```json
{
  "terminal": {
    "scrollback_lines": 20000,
    "osc52_read": false
  }
}
```

## Current Gaps

- Font size is persisted, but the modal does not yet expose the full font
  surface.
- Cursor, shell, audible or visual bell, title policy, and SSH or remote
  defaults still need first-class settings.
