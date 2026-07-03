# Tide v2 scripts

Canonical scripts only. Each entry says **what it proves** and **what it needs**.
One-off debugging probes from past sessions live in `archive/` (kept for
reference, not maintained). New debug scripts should compose the shared driver,
not copy-paste launch boilerplate — see `lib/` (added by Phase 2.4).

## Toolchain

| Script | Proves / does | Needs |
|---|---|---|
| `v2-tooling-command.mjs` | Wraps electron-vite/tsc/electron-builder; node-version preflight. Used by `npm run dev/build/typecheck`. | node ≥ 22.6 |
| `assert-node-version.mjs` | Fails fast if node < 22.6 (the `--experimental-strip-types` floor). Runs as `pretest`. | — |
| `v2-verification-loop.mjs` | Runs the deterministic Tide verification loop: diff check, typecheck, affected tests, full tests, optional build/smoke, plus JSON/Markdown reports. Used by `npm run verify:tide`. | node ≥ 22.6 |

## Verification battery

Run the whole battery via `npm run e2e` (Phase 2.1). Individual scripts:

| Script | Proves | Needs |
|---|---|---|
| `v2-provider-smoke.mjs --agent <id>` | Real backend + real CLI: answer renders once, turn settles. | provider auth + trusted dir |
| `v2-opencode-adoption-smoke.mjs --cwd <path>` | Real backend + real opencode: adopts an existing local session, hydrates it, sends a follow-up, verifies the same session export. | opencode auth + existing session + explicit user approval |
| `v2-provider-permission-flow.mjs --agent <id>` | Forces approval prompts, auto-answers, asserts surface once + settle (allow + deny). | provider auth |
| `v2-provider-state-matrix.mjs --case <name>` | Non-happy paths: `notinstalled`, `notauth`, `trust`, `concurrency`, `followup`. | varies per case |
| `v2-electron-runtime-smoke.mjs` | Boots the real packaged backend against a fake provider; full agent loop headless. No auth. | — (CI-safe) |
| `pw-provider-e2e.cjs <id>` | The REAL built Electron app driven by Playwright like a human (chip, permission menu, send, Allow/Submit, follow-up, on-disk side effect). Catches packaged-only failures. | built app + provider auth |
| `v2-claude-second-permission.mjs` | claude batched multi-permission (the second box surfaces). | claude auth |
| `pw-claude-research-permissions.cjs` | claude WebSearch + two batched WebFetch cards → final answer (the user's exact research scenario). | claude auth |
| `pw-restart-verify.cjs` | App restart restores the conversation from cache. | built app |

## Native Agent Evidence

These scripts capture bounded provider protocol evidence for adapter work. They
write reduced/redacted files; do not commit raw provider transcripts.

| Script | Proves / does | Needs |
|---|---|---|
| `native-agent-evidence/capture-codex-app-server.mjs` | Captures Codex app-server help by default. With `--review-start --allow-provider-review`, deliberately starts app-server, creates a read-only thread, sends `review/start`, and records redacted protocol frames. | codex auth; trusted repo cwd; explicit review approval for `--review-start` |
| `native-agent-evidence/capture-claude-stream-json.mjs` | Captures Claude stream-json evidence for structured runtime behavior. | claude auth |
| `native-agent-evidence/capture-acp-provider.mjs` | Captures ACP initialize/session evidence for opencode-family providers. | provider auth unless capturing auth-required fixtures |
| `native-agent-evidence/capture-opencode-serve.mjs` | Captures opencode serve surface evidence for support/adoption work. | opencode auth |

Codex review capture example:

```sh
node apps/desktop/scripts/native-agent-evidence/capture-codex-app-server.mjs \
  --codex codex \
  --out /tmp/tide-codex-review-evidence \
  --review-start \
  --allow-provider-review \
  --cwd /path/to/scratch/repo \
  --target base \
  --base-branch main \
  --delivery detached
```

## Verification loop

`npm run verify:tide` is the default local loop for AI-assisted and human review:

- `git diff --check`
- `npm run typecheck`
- affected tests selected from changed files
- full `npm run test:v2`
- optional `--build` or `--smoke`

Reports are written to `dist/verification/latest.json` and
`dist/verification/latest.md`, with per-gate logs under `dist/verification/runs/`.
Use `npm run verify:tide -- --quick` for a tighter edit loop, and
`npm run verify:tide -- --smoke` before risky runtime or packaging changes.

## Targeted UI / feature verifiers

| Script | Proves | Needs |
|---|---|---|
| `pw-smoke.cjs` | App boots and renders the product shell. | built app |
| `pw-slash-verify.cjs` | Slash-command menu surfaces and filters. | built app |
| `pw-trust-editor-verify.cjs` | Trust grant + editor open path. | built app |

## Helpers

| Script | Purpose |
|---|---|
| `seed-thread.cjs` | Seed a thread fixture into the app's data dir for click-path tests (never seed a codex thread — breaks auth). |
| `provider-evidence-harness.py` | Capture provider PTY/readiness/prompt/history evidence before implementing an adapter. |

## Debug flags

- `TIDE_DEBUG_PTY=1` — dump raw PTY output on any harness.
- `TIDE_DEBUG_PERSIST=1` — log conversation-cache writes per turn (Phase 4.1).
