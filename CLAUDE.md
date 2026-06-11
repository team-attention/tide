# Tide — Monorepo

This repo hosts **two independent Tide products** that share the brand but not code
(different languages, separate builds). Pick the right app directory before working.

| App | Path | Stack | Build |
|-----|------|-------|-------|
| **Terminal** (v1) | `apps/terminal/` | Rust + WGPU native macOS app | `cargo` (run from `apps/terminal/`) |
| **Desktop** (v2) | `apps/desktop/` | Electron + Node + React | `npm` (run from `apps/desktop/`) |

## Before building, define the work

Whenever a request means **creating or changing** something — a feature, a fix, a
refactor, anything you'd write code for — do not start until these three are explicit.
They are the contract for the work:

1. **Goal** — exactly what is wanted, as a concrete outcome, not a vague direction.
2. **Current state & gap** — how it works today and precisely what's missing or wrong.
   If you can't state the gap, you don't understand the task yet.
3. **Verification scenario** — the concrete steps that prove it's done: what you'll do,
   what you expect to see. If you can't name how you'd check it, you can't claim it works.

If any of the three is missing or ambiguous, **ask before writing code** — one focused
round of questions to pin it down. Don't guess the goal, don't invent a gap, and don't
build something you have no way to verify. Filling these in *is* the first step of the
work, not overhead.

## Rules

- **Each app is self-contained.** Its build files (`Cargo.toml` / `package.json`),
  source, tests, docs, and scripts all live under its own directory. The repo root
  holds only brand-level files (`README.md`, `LICENSE`, `assets/`, `.github/`).
- **Never run a build from the repo root.** `cd apps/terminal` for Rust,
  `cd apps/desktop` for the Electron app.
- **No code is shared across the two apps** (Rust ≠ TypeScript). If you ever share
  anything it is the process-boundary *contract shape*, mirrored per language.
- **Each app has its own detailed instructions** — read those before changing code:
  - `apps/terminal/CLAUDE.md` (+ `apps/terminal/AGENTS.md`, `apps/terminal/docs/`)
  - `apps/desktop/docs_v2/` and the `tide-v2-plan` skill.

## Quick commands

```bash
# Desktop (v2 Electron)
cd apps/desktop && npm start        # build + launch
cd apps/desktop && npm run dev      # HMR dev
cd apps/desktop && npm test         # behavior tests

# Terminal (v1 Rust)
cd apps/terminal && cargo run
cd apps/terminal && cargo test
```
