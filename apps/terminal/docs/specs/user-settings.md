# User Settings

## Goal

Persist user-level preferences outside session state so window appearance and
terminal policy survive restarts.

## Storage

Settings are stored as JSON at the platform config path:

- macOS: `~/Library/Application Support/tide-terminal/settings.json`
- Linux: `~/.config/tide-terminal/settings.json`

Missing or partially populated files are accepted. Unknown fields are ignored by
serde, and missing fields fall back to defaults.

## Schema

```json
{
  "appearance": {
    "font_family": "Menlo",
    "font_size": 14.0,
    "theme": "dark"
  },
  "terminal": {
    "osc52_read": false
  }
}
```

## Appearance

- `appearance.font_family` selects the primary monospace family used by the GPU
  text renderer. Empty values are ignored.
- `appearance.font_size` is clamped to the supported terminal range of 8-32 px.
- `appearance.theme` accepts `"dark"` or `"light"` and is applied to terminal,
  editor, browser render panes, and chrome colors.

## Terminal Policy

- `terminal.osc52_read` controls whether terminals may answer OSC 52 clipboard
  read requests.
- The default is `false` so remote programs cannot read the system clipboard
  unless the user explicitly opts in.
- OSC 52 clipboard writes are independent from this read policy.

## Propagation

Settings are applied when the app starts and when a settings reload broadcast is
received. Existing terminal panes receive updated theme and OSC 52 read policy,
and pending font settings are replayed when the renderer becomes available.
