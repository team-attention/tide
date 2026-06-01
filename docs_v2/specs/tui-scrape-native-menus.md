# Spec: Scrape Provider TUI Pickers into Native Menus

## Scope
Surface a provider CLI's interactive in-session pickers (model picker, slash
commands) as native Tide menus by scraping the hidden-PTY TUI output. User-chosen
direction over showing a live terminal. In-session only (requires a running PTY);
the pre-start menu keeps a fallback.

## Evidence
- master-plan: model changes in a running Thread use the provider-native
  in-session model command; pickers "can be surfaced in Agent Chat or Composer
  and answered through the same hidden PTY session."
- Hidden PTY is the runtime transport and already negotiates the full TUI
  (alt-screen, CSI-u). The picker content exists ONLY in the live TUI screen
  (not in provider history/hooks).
- Spike: a real `claude` `/model` picker, ANSI-stripped, yields parseable rows
  (Default / Opus✔ / Haiku) — scrape is feasible.

## Decisions
### D1. Scrape, don't render a raw terminal
Parse the PTY TUI output into structured options and render Tide-native menus.
### D2. In-session only, with Esc-cancel safety
Scraping a picker means driving the live PTY (send `/model`), capturing output,
parsing, then sending **Esc** to dismiss without changing anything. No running
session → no scrape (pre-start menu uses a static fallback).
### D3. Per-provider, tolerant parsers
Each parser strips ANSI/CSI then matches stable visible tokens (model names, the
✔ current marker), not fixed columns — resilient to layout shifts. claude first;
codex later (testing codex must avoid auth rotation).

## Contracts (later slices)
- backend: scrape-in-session capability (drive PTY, capture window, parse, cancel).
- event carrying scraped options to the desktop; Model menu populated for a
  running thread.

## Tests
| Rule | Expectation |
|------|-------------|
| D3 | `parseClaudeModelPicker` extracts real models with the current one marked, no fabricated rows. |
| D3 | `stripTerminalSequences` removes ANSI/CSI/OSC, keeps visible text. |
| D2 | No running session → parser/scrape yields empty (fallback). |

## Location
- Parsers: `src/backend/application/services/provider-tui-parsers.ts` (done).
- PTY-driving scrape + contracts + desktop wiring: subsequent slices.
