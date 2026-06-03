# Tide Editor Design Contract

## Purpose

This file is the design contract for Tide editor polish work.
It exists to make UI decisions reusable by specs, tests, and code.
It is not a moodboard.

This contract applies first to the existing editor surfaces already present in Tide:

- `crates/tide-app/src/adapter/outward/view/header.rs`
- `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs`
- `crates/tide-app/src/theme.rs`
- `crates/tide-app/src/domain/pane/editor_rendering.rs`
- `crates/tide-app/src/adapter/outward/view/grid.rs`

It must stay consistent with the phased editor direction in `docs/specs/editor-solidity.md`.

## Product Intent

Tide should feel like a serious writing and coding tool, not a debug surface.

The editor must communicate three things immediately:

1. Which Pane is active.
2. Which mode the active Editor Pane is in.
3. Whether the file state needs attention.

The visual character should be calm, dense, and deliberate.
The target is closer to a premium desktop editor than a browser-style app shell.

## Visual Direction

Use these adjectives when making tradeoffs:

- quiet
- precise
- editorial
- desktop-native
- low-glare
- high-signal

Avoid these outcomes:

- toy-like badges
- high-chroma status noise
- flat undifferentiated chrome
- oversized rounded-pill UI
- mode ambiguity

## Design Tokens

These tokens are the source of truth for editor polish work.
They are design targets; later code should map the existing theme to these roles.

### Color Roles

Base neutrals:

- `bg.app = deep charcoal with slight blue bias`
- `bg.chrome = one step lighter than app background`
- `bg.chrome.active = two steps lighter than app background`
- `bg.editor = darkest reading surface in the active Pane`
- `bg.editor.subtle = alternate surface for gutters and inactive chrome`

Text roles:

- `text.primary = high-contrast neutral for active titles and body text`
- `text.secondary = muted neutral for inactive titles and metadata`
- `text.tertiary = low-emphasis neutral for chrome separators and hints`

State roles:

- `state.accent = restrained cool accent used for active focus and selected items`
- `state.success = muted green, never neon`
- `state.warning = muted amber, never saturated yellow`
- `state.danger = muted red, never bright scarlet`

Editor roles:

- `editor.current_line = subtle raised contrast, visible but not glowing`
- `editor.gutter = quieter than text body, clearer than background`
- `editor.indent_guide = faint structural line, visible only on inspection`
- `editor.selection = opaque enough to read as intentional, never pastel haze`
- `editor.focus_ring = crisp accent ring reserved for keyboard-relevant affordances`

### Typography

Interface text:

- Use one consistent UI face already supported by Tide.
- Header and tab labels should read as interface metadata, not body copy.
- Badge text must be short, uppercase or small-caps in feel, and visually subordinate to file title.

Editor text:

- Preserve current editor font behavior.
- Any readability tuning should increase contrast hierarchy, not change code layout semantics.

Type scale:

- `title = strongest chrome label`
- `meta = one step smaller than title`
- `badge = same size or slightly smaller than meta`

### Spacing

Use a compact 4px grid.

- `space.1 = 4`
- `space.2 = 8`
- `space.3 = 12`
- `space.4 = 16`
- `space.5 = 20`

Chrome rules:

- Header horizontal padding must feel denser than a web app top bar.
- Badge gaps should be tighter than title-to-badge separation.
- Tab chrome should prioritize alignment consistency over loose breathing room.

### Radius

- `radius.sm = 4`
- `radius.md = 6`

Rules:

- Do not use large pill radii for editor badges.
- Use square-ish geometry with light rounding.
- Inactive chrome should feel machined, not bubbly.

### Shadows and Contrast

- Use shadows sparingly.
- Prefer layered contrast over soft floating cards.
- If elevation is needed, use one restrained shadow token for overlays only.

## Editor Chrome Rules

### Header

The Pane header is a control strip, not a decorative banner.

Rules:

- File title is primary.
- Mode and file-state badges are secondary.
- Close and utility actions are tertiary unless hovered or focused.
- The active Pane must be distinguishable even in peripheral vision.
- Inactive Pane headers must recede without becoming unreadable.

Priority order when space is constrained:

1. file title
2. destructive or attention state
3. mode state
4. secondary metadata

That means a narrow header must preserve title legibility before showing optional chrome.

### Tab Chrome

Rules:

- Active tab contrast must be obvious from the whole bar, not only from text weight.
- Inactive tabs must group into the background.
- Tab chrome must align visually with Pane headers.
- Tabs should not look like browser tabs.

### Badges

Badges are status chips, not buttons unless they are explicitly interactive.

Rules:

- Keep badge text short.
- Use color sparingly; most badges should read through contrast and border treatment first.
- Interactive badges must have hover, focus, and pressed differentiation.
- State color is reserved for real state, not decoration.

## Mode Affordances

The active Editor Pane must expose mode clearly at a glance.

Rules:

- Authoring mode must feel editable.
- Preview mode must feel read-oriented.
- Live preview or plain mode labels must be explicit, not implied by styling alone.
- Mode changes must not rely on memory of a shortcut.

Required cues:

- active mode badge in header chrome
- visible active line treatment in authoring mode
- calmer reading surface in preview mode

## Readability Rules

Readability work must stay inside the existing architecture.

Rules:

- Improve hierarchy with contrast, spacing, and emphasis before adding new features.
- The current line should be visible without becoming a bright stripe.
- Gutter information should be easy to parse but quieter than document text.
- Indent guides should support structure, not dominate it.
- Prose authoring should feel calmer than code editing while preserving the same layout model.

## Interaction Rules

These rules are normative.

### MUST

- Keyboard-reachable interactive chrome must have a visible focus state.
- Click targets in header chrome must remain visually aligned with hit zones.
- Interactive targets must remain usable at compact desktop sizes.
- Mode badges that change behavior must read as interactive on hover and focus.
- State changes must appear in the active Pane immediately.

### SHOULD

- Interactive targets should be at least `24x24` logical pixels where space allows.
- The active Pane should remain identifiable even when the pointer is elsewhere.
- Hover should clarify affordance, not repaint the whole header.
- Focus treatment should be crisper than hover treatment.

### NEVER

- Never encode meaning with color alone.
- Never hide all mode information when width becomes tight.
- Never let decorative chrome compete with file title.
- Never use glow-heavy focus effects.
- Never make header chrome depend on pixel-perfect pointer placement.

## Component Targets

### Editor Header

Target outcome:

- active title reads first
- mode reads second
- file state reads third
- optional actions read last

### Tab Bar

Target outcome:

- active tab recognizable from shape and contrast alone
- inactive tabs quiet but legible
- no browser-tab visual language

### Editor Surface

Target outcome:

- current line readable
- gutter quieter than content
- selection and focus states clearly different
- prose and code both feel intentional

## Validation Checklist

Any spec or code change using this file should be testable against these questions:

1. Can a user identify the active Pane in under a second?
2. Can a user identify authoring versus preview mode without typing?
3. Does narrow width preserve title and critical state before optional chrome?
4. Are keyboard focus states visible on interactive header elements?
5. Do hover and click targets still match the rendered chrome?
6. Did readability improve without changing editor semantics?

## Non-Goals For This Slice

This design contract does not yet cover:

- outline navigation
- backlinks
- graph views
- properties editing
- large-scale layout redesign outside editor chrome

