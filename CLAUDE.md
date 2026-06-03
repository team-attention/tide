# Tide — Monorepo

This repo hosts **two independent Tide products** that share the brand but not code
(different languages, separate builds). Pick the right app directory before working.

| App | Path | Stack | Build |
|-----|------|-------|-------|
| **Terminal** (v1) | `apps/terminal/` | Rust + WGPU native macOS app | `cargo` (run from `apps/terminal/`) |
| **Desktop** (v2) | `apps/desktop/` | Electron + Node + React | `npm` (run from `apps/desktop/`) |

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
