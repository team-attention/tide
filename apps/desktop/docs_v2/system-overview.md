# Tide v2 — System Overview

_Snapshot: 2026-06-10 (v2-uniform-provider-abstraction). Supersedes the previous
snapshot's "Open problems" — every item in it is resolved below._

Tide v2 wraps interactive CLI coding agents (Codex, Claude Code, Gemini, and
opencode) so that, to the user, they all behave like one uniform chat. The shared
flow lives in one place; each agent's quirks are isolated in its adapter.

> Update (2026-06-12, branch `v2-remediation-impl`): the four shipped provider-CLI
> agents are **codex / claude / gemini / opencode**. Antigravity is demoted to a UI
> fallback (not a launchable `ProviderCliAgentId`). All declarative agent knowledge
> (id list, display name, monogram, session-ref kind, permission modes) now lives in
> one registry — `shared/contracts/agent-descriptors.ts` — and the runtime port,
> infra, and UI derive from it (guarded by `tests/agent-symmetry-boundary.test.ts`).
> See `implementation/codebase-issues-and-remediation-plan.md` for the broader pass
> (CI on push, persistence/render perf coalescing, the `npm run e2e` gate, the
> file-size ratchet, and gemini conversation restore).

---

## 1. Layers

```
React renderer (UI)
   │  contract messages: thread.start, composer.sendInput, prompt.answer,
   │  provider.trustWorkspace, agentRuntime.stop, thread.hydrate …
   ▼
Backend service (Electron main)
   │
   ▼
live-backend.ts  ── the shared spine: ONE flow for every agent
   │                (boundary-tested: zero `agentId === …` branches)
   ▼
Agent Integration adapters  ── ALL per-agent knowledge
   │   claude / codex / gemini / antigravity
   ▼
real CLI process (hidden PTY)  +  that CLI's own history file
```

Rule: **the spine is identical for all agents; anything agent-specific belongs in
the adapter.** Enforced by `tests/runtime-spine-boundary.test.ts`.

## 2. The provider abstraction (one port, four adapters)

Each adapter implements `AgentIntegrationPort`:

| Concern | Port method | claude | codex | gemini | antigravity |
|---|---|---|---|---|---|
| Launch | `buildStartPlan` | `--session-id` minted, prompt argv | readiness-gated handoff | `--session-id` minted, `-i` prompt | `-i` prompt |
| Binding | plan ref / `sessionRefFromHookPayload` | minted id + hook confirm | hook rollout_path | minted id + hook confirm | hook conversationId |
| Content | `history().readFrames` | transcript JSONL | rollout JSONL | session JSONL | transcript JSONL |
| Turn end | `turnEndFromHook` / `turnEndFromHistory` | Stop hook | rollout task_complete | AfterAgent hook | terminal PLANNER_RESPONSE |
| Prompts | `detectPromptState` | hook (permission) + PTY scrape (question box) | PTY scrape (boxes) + hook | Notification hook → PTY box | PreToolUse hook |
| TUI keys | plan `submitKeySequence` / `autoRespondPrompts` | CSI-u Enter | hook-trust auto-answer | default | default |

The shared loop (`emitProviderHistory`) per poll: resolve binding → bounded tail
read → `connector.readFrames` → frame→block pipeline → `turnEndFromHistory`
settle. Identical for all providers.

### Deterministic session binding (no recency, ever)

A thread is bound to its provider session by an identifier the runtime itself
carries — never by "most recent file":

- claude/gemini: Tide mints a UUID per runtime and launches with
  `--session-id <uuid>`; the on-disk file is located BY that id
  (`locateClaudeTranscriptFile` / `locateGeminiSessionFile`), and every
  runtime-keyed hook payload confirms `session_id` + `transcript_path`.
- codex/antigravity: the runtime-keyed hook payload carries the rollout /
  conversation path.
- `recordProviderSessionRef` lets the hook REFINE the same session's paths and
  refuses a different session outright — concurrent threads cannot swap.
- Paths are never guessed from Tide's cwd spelling (symlinks `/var` →
  `/private/var` and macOS casing differ from the provider's own getcwd).

### Single content source (no dedup anywhere)

The answer is produced by exactly one path — the history reader. Turn-end
signals settle the turn and may add a `notice`; they carry NO content for any
provider (codex's `task_complete.last_agent_message` copy is deliberately
dropped; gemini's hook `prompt_response` is deliberately ignored).

### Prompts (permission / question / trust)

- Surfaces are owned per box kind by the adapter; the same box never has two
  owners. claude permissions = PermissionRequest hook (Allow=Enter, Deny=Esc);
  claude questions = PTY scrape of the rendered menu (its PreToolUse /
  PermissionRequest for AskUserQuestion are deliberately silent — they fire
  before the box exists and would blind-pick).
- codex boxes (shell/MCP approvals) = PTY scrape → nav tokens (ArrowDown/Up +
  Enter). gemini approvals = Notification(ToolPermission) hook signal, answered
  on the PTY box.
- TUI scraping survives modern repaint styles: `stripTerminalSequences`
  translates absolute cursor positioning (CSI row;colH — how codex 0.13x and
  claude paint) into line breaks, and option rows tolerate `›` cursors and
  missing post-number spaces. Both regressions are pinned by live-captured
  fixtures.
- gemini defaults to `--approval-mode default` (prompts), exactly like
  claude/codex defaults. `--yolo` only when the user picks Bypass.

### Workspace trust

Tide's Trust button (`provider.trustWorkspace`) writes the provider's own trust
store for BOTH Tide's spelling of the cwd and its canonical kernel path
(`realpathSync.native`), then re-checks readiness and auto-replays the queued
first message. gemini needs no store write (`--skip-trust` is its supported
equivalent — same policy, Tide owns the trust decision).

## 3. How to verify (no human in the loop)

- `npm test` — behavior tests incl. boundary tests; `npm run typecheck`.
- `node scripts/v2-provider-smoke.mjs --agent <claude|codex|gemini>` — real
  backend + real CLI: answer renders once, turn settles.
- `node scripts/v2-provider-permission-flow.mjs --agent <claude|codex|gemini>` —
  forces approval prompts, auto-answers them, asserts: prompt surfaces, no
  double-surface, settles with an answer. (claude question flow:
  `TIDE_MESSAGE="Use the AskUserQuestion tool …"`.)
- `node scripts/v2-provider-state-matrix.mjs --case <name>` — the non-happy
  paths: `notinstalled`, `notauth`, `trust` (blocked → Trust → live answer),
  `concurrency` (two same-provider threads, answers never cross), `followup`
  (second turn into the live TUI).
- `node scripts/pw-provider-e2e.cjs <claude|codex|gemini>` — the REAL built
  Electron app driven by Playwright like a human: agent chip, permission mode
  menu, send, the rendered Prompt Card's real Allow/Submit buttons, answer
  rendered once, follow-up turn, and the approved tool's side effect on disk.
  This is the layer that catches packaged-app-only failures (e.g. the Electron
  Helper hook hang the headless harnesses could never see).
- `TIDE_DEBUG_PTY=1` on any harness dumps raw PTY output for diagnosis.

All of the above pass as of this snapshot.

## 4. Remaining known gaps

1. **antigravity** is wired but hidden (cannot auth when spawned; upstream).
2. The provider-signal spool and history polling still run on 0.5s/1s timers
   inside the shared loop; the full push-based `AgentRuntimeEventSource`
   (agent-runtime-event-spine.md) remains the north star. Provider knowledge is
   already adapter-owned, so the cutover is now mechanical, not architectural.
3. `parseProviderUsage` (context meter) still branches by agentId internally —
   registry-shaped, not a control-flow leak.
