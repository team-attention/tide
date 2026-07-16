# Product

## Register

product

## Users

Software developers who use local coding agents while reading, editing,
reviewing, and verifying work in a desktop application. They move frequently
between a Thread, Agent Chat, and visible Workbench surfaces, often through
keyboard-first workflows, and need the current file, selection, save state, and
execution context to remain obvious.

## Product Purpose

Tide is a local, open desktop workbench for agent-assisted coding. It keeps the
conversation narrative primary and opens Editor, Diff, Browser, FileTree, and
Terminal surfaces only when the active Thread needs direct inspection or work.
Success means users can move from an agent result to reading, editing,
reviewing, and verification without losing context or switching mental models.

## Brand Personality

Calm, precise, restrained. Tide should feel like a dependable desktop
instrument: dense enough for expert work, quiet enough for sustained reading,
and explicit about state without becoming a dashboard.

## Anti-references

- A browser page with unrelated panes attached.
- A terminal multiplexer presented as the default product surface.
- A project-first IDE that makes navigation chrome more important than the
  active Thread.
- A status dashboard crowded with global queues, badges, and permanent logs.
- Generic card-heavy SaaS UI, decorative gradients, glass surfaces, or motion
  that does not communicate state.
- Editing modes that unexpectedly replace the working surface, lose selection,
  or hide whether the underlying file has changed.

## Design Principles

1. Preserve continuity across reading, editing, reviewing, and asking an agent.
2. Keep tools scoped to the active Thread, Pane, file, or selection.
3. Prefer dense legibility and clear hierarchy over decorative chrome.
4. Preserve source fidelity and make dirty, saving, conflict, and read-only
   states explicit.
5. Use familiar desktop interaction patterns and make keyboard and pointer
   paths equivalent.

## Accessibility & Inclusion

- Preserve browser-native and CodeMirror behavior for Korean IME, selection,
  copy, paste, and undo.
- Provide visible keyboard focus and semantic labels for icon-only and mode
  controls.
- Maintain readable contrast in both light and dark themes and never encode an
  important state through color alone.
- Keep text zoomable and avoid motion that is required to understand a state
  transition; honor reduced-motion preferences when motion is used.
- Preserve logical focus, selection, and reading position when a surface
  changes presentation mode.
