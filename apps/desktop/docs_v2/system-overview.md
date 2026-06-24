# Tide v2 — System Overview

_Snapshot: 2026-06-10 (v2-uniform-provider-abstraction). Supersedes the previous
snapshot's "Open problems" — every item in it is resolved below._

Tide v2 wraps interactive CLI coding agents (Codex, Claude Code, and
opencode) so that, to the user, they all behave like one uniform chat. The shared
flow lives in one place; each agent's quirks are isolated in its adapter.

> Update (2026-06-12, branch `v2-remediation-impl`): the four shipped provider-CLI
> agents are **codex / claude / opencode**. Antigravity has been fully removed from every layer (it was wired but
> could not authenticate when spawned). All declarative agent knowledge
> (id list, display name, monogram, session-ref kind, permission modes) now lives in
> one registry — `shared/contracts/agent-descriptors.ts` — and the runtime port,
> infra, and UI derive from it (guarded by `tests/agent-symmetry-boundary.test.ts`).
> See `implementation/codebase-issues-and-remediation-plan.md` for the broader pass
> (CI on push, persistence/render perf coalescing, the `npm run e2e` gate, the
> file-size ratchet).

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
   │   claude / codex / opencode
   ▼
real CLI process (structured protocol: stream-json / app-server / ACP)
   +  that CLI's own history file
```

Rule: **the spine is identical for all agents; anything agent-specific belongs in
the adapter.** Enforced by `tests/runtime-spine-boundary.test.ts`.

File-level navigation ("where do I change X") lives in
[implementation/source-map.md](implementation/source-map.md); the directory
structure it describes is enforced by `tests/file-size-ratchet.test.ts`.

## 2. The provider abstraction (one port, three adapters)

Each adapter implements `AgentIntegrationPort`:

| Concern | Port method | claude | codex | opencode |
|---|---|---|---|---|
| Launch | `buildStartPlan` | structured/PTY plan with session id | readiness-gated handoff | ACP over stdio |
| Binding | plan ref / provider session ref | claude transcript | codex rollout | opencode session |
| Content | `history().readFrames` / structured runtime events | transcript JSONL | rollout JSONL | ACP events + session history |
| Turn end | runtime settle signal | Stop hook / idle | rollout task_complete | ACP session turn end |
| Prompts | `detectPromptState` / structured permission request | hook + PTY scrape | PTY scrape + hook | ACP permission |
| TUI keys | plan `submitKeySequence` / `autoRespondPrompts` | CSI-u Enter | hook-trust auto-answer | protocol-owned |

The shared loop (`emitProviderHistory`) per poll: resolve binding → bounded tail
read → `connector.readFrames` → frame→block pipeline → `turnEndFromHistory`
settle. Identical for all providers.

### Deterministic session binding (no recency, ever)

A thread is bound to its provider session by an identifier the runtime itself
carries — never by "most recent file":

- claude: Tide mints a UUID per runtime and launches with
  `--session-id <uuid>`; the on-disk file is located BY that id
  (`locateClaudeTranscriptFile`), and every
  runtime-keyed hook payload confirms `session_id` + `transcript_path`.
- codex: the runtime-keyed hook payload carries the rollout path.
- opencode: ACP session ids are recorded as provider session refs.
- `recordProviderSessionRef` lets the hook REFINE the same session's paths and
  refuses a different session outright — concurrent threads cannot swap.
- Paths are never guessed from Tide's cwd spelling (symlinks `/var` →
  `/private/var` and macOS casing differ from the provider's own getcwd).

### Single content source (no dedup anywhere)

The answer is produced by exactly one path — the history reader. Turn-end
signals settle the turn and may add a `notice`; they carry NO content for any
provider (codex's `task_complete.last_agent_message` copy is deliberately
dropped).

### Prompts (permission / question / trust)

- Surfaces are owned per box kind by the adapter; the same box never has two
  owners. claude permissions = PermissionRequest hook (Allow=Enter, Deny=Esc);
  claude questions = PTY scrape of the rendered menu (its PreToolUse /
  PermissionRequest for AskUserQuestion are deliberately silent — they fire
  before the box exists and would blind-pick).
- codex boxes (shell/MCP approvals) = PTY scrape → nav tokens (ArrowDown/Up +
  Enter). opencode approvals are handled through ACP permission requests.
- TUI scraping survives modern repaint styles: `stripTerminalSequences`
  translates absolute cursor positioning (CSI row;colH — how codex 0.13x and
  claude paint) into line breaks, and option rows tolerate `›` cursors and
  missing post-number spaces. Both regressions are pinned by live-captured
  fixtures.
- provider bypass modes are selected only when the user picks Bypass.

### Workspace trust

Tide's Trust button (`provider.trustWorkspace`) writes the provider's own trust
store for BOTH Tide's spelling of the cwd and its canonical kernel path
(`realpathSync.native`), then re-checks readiness and auto-replays the queued
first message. Provider runtime environment should match the user's terminal
shell snapshot plus explicit Tide bridge additions required for provider
protocols and MCP.

## 3. How to verify (no human in the loop)

- `npm test` — behavior tests incl. boundary tests; `npm run typecheck`.
- `node scripts/v2-provider-smoke.mjs --agent <claude|codex|opencode>` — real
  backend + real CLI: answer renders once, turn settles.
- `node scripts/v2-provider-permission-flow.mjs --agent <claude|codex|opencode>` —
  forces approval prompts, auto-answers them, asserts: prompt surfaces, no
  double-surface, settles with an answer. (claude question flow:
  `TIDE_MESSAGE="Use the AskUserQuestion tool …"`.)
- `node scripts/v2-provider-state-matrix.mjs --case <name>` — the non-happy
  paths: `notinstalled`, `notauth`, `trust` (blocked → Trust → live answer),
  `concurrency` (two same-provider threads, answers never cross), `followup`
  (second turn into the live TUI).
- `node scripts/pw-provider-e2e.cjs <claude|codex|opencode>` — the REAL built
  Electron app driven by Playwright like a human: agent chip, permission mode
  menu, send, the rendered Prompt Card's real Allow/Submit buttons, answer
  rendered once, follow-up turn, and the approved tool's side effect on disk.
  This is the layer that catches packaged-app-only failures (e.g. the Electron
  Helper hook hang the headless harnesses could never see).
- `TIDE_DEBUG_PTY=1` on any harness dumps raw PTY output for diagnosis.

All of the above pass as of this snapshot.

## 4. Remaining known gaps

1. The provider-signal spool and history polling still run on 0.5s/1s timers
   inside the shared loop; the full push-based `AgentRuntimeEventSource`
   (agent-runtime-event-spine.md) remains the north star. Provider knowledge is
   already adapter-owned, so the cutover is now mechanical, not architectural.
2. `parseProviderUsage` (context meter) still branches by agentId internally —
   registry-shaped, not a control-flow leak.
