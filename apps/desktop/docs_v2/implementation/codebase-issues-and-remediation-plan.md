# Tide v2 — Codebase Audit and Remediation Plan

_Audited 2026-06-11 against main (`6950d502`, v0.1.41). Every issue below carries
file:line evidence captured during the audit; re-verify line numbers before acting
on a slice, the files move._

## 0. The product, restated

This section is the contract the rest of the document serves. From
`docs_v2/master-plan.md`, the goal directive, and the current state of the repo:

> **Tide v2 is a free, open-source Codex-App-style GUI for many public coding
> agents** — codex, claude code, and gemini today, opencode already wired as the
> 4th provider, antigravity (agy) intended later. All agents run through **one
> unified abstraction**: a provider-neutral spine plus one explicit adapter per
> agent. The UI/UX is seamless and identical across agents. The codebase must be
> **structurally symmetric across agents** (no per-agent special cases outside
> adapters), organized as **small, single-purpose files**, and **provably
> runnable** — easy to execute end-to-end tests so "it works" is a checked fact,
> not a belief.

Derived acceptance criteria used throughout this plan:

1. **Symmetry:** adding (or re-adding) an agent means one new adapter directory
   plus one registry entry — not edits scattered across layers.
2. **Small files:** no file so large that locating behavior requires search
   instead of navigation. Working target ≤ 500 lines, hard guard at 800 for new
   growth (mechanically enforced, see Phase 3).
3. **Runnability:** one command proves the app works end-to-end; CI runs the
   provable subset on every push, not only at release tags.

## 1. What is already sound (do not re-litigate)

The audit confirmed these are in good shape; later phases must preserve them:

- **Structured protocol cutover is complete and clean.** All four providers
  speak their native machine protocol (claude stream-json / codex app-server /
  gemini+opencode shared ACP client). The PTY scrape machinery
  (`stripTerminalSequences`, `detectPromptState`, prompt-box parsing) is fully
  deleted from `src/`. There are **zero `setInterval` pollers** left in the
  backend — the protocol pushes.
- **The backend spine is provider-neutral.** `thread-runtime-service.ts` has
  zero agent-id branches. `tests/runtime-spine-boundary.test.ts` mechanically
  pins codex turn-end literals and hook-event names to the adapters. This
  guard-by-test pattern works and is the model for everything in Phase 1.
- **Deterministic session binding** (minted `--session-id`, hook-confirmed refs,
  never recency) is implemented and documented in
  `docs_v2/specs/runtime-mental-model.md`.
- **The unit/behavior suite is healthy:** 668 tests pass in ~5.6 s
  (`npm test`, node:test + type stripping). Typecheck clean. Real-PTY tests are
  CI-gated via `tests/pty-ci-gate.ts`.
- **Backend god-file decomposition already delivered** the hard half:
  `thread-runtime-service.ts` 4536 → ~1976 (collaborator classes + shared
  `ThreadStore`), `live-backend.ts` 3221 → 1599 (8 infra leaf modules). The
  remaining problem is the *desktop* layer (§3.B) and re-growth (§3.B5).
- **A real verification battery exists** (`v2-provider-smoke.mjs`,
  `v2-provider-permission-flow.mjs`, `v2-provider-state-matrix.mjs`,
  `pw-provider-e2e.cjs`, `v2-electron-runtime-smoke.mjs`). The problem is
  orchestration, coverage asymmetry, and CI wiring — not absence (§3.C).

## 2. Issue catalog

Severity: **P0** = blocks the product promise or silently degrades it now;
**P1** = structural debt that compounds with every feature; **P2** = hygiene.

### A. Structural asymmetry between agents

**A1. Adding an agent fans out across ~16 files in 3 layers. (P1 — the core
asymmetry)**
Evidence: commit `d54de8d2` ("opencode support — 4th provider, reuses the shared
ACP client") — the *cheapest possible* new agent, no new protocol client —
touched 16 source files: `shared/contracts/agent.ts`, `shared/contracts/envelopes.ts`,
domain `thread.ts`, `agent-integration.ts`, `live-backend.ts`,
`provider-state-readers.ts`, `thread-persistence-service.ts`, the runtime port,
plus **four desktop files** (`agent-chat-shell.ts`, `tide-product-shell.ts`,
`agent-chat-shell-state.ts`, `product-shell-state.ts`) and the smoke script.
It then needed two follow-up commits (`cacfd509` "selectable-but-dead",
`f68d7797` "coming soon") purely because UI availability gating is a separate,
hand-maintained list. There is no single registration point.

**A2. Per-agent product knowledge lives in the UI layer as control flow. (P1)**
The desktop layer holds the largest concentration of agent-id branches in the
codebase (backend spine has ~0):
- `agent-chat-shell-state.ts` — `PERMISSION_OPTIONS` static registry plus
  `normalizePermissionValue` with `agentId === "codex" / "claude"` legacy-value
  branches (lines ~1618–1638); more branches at 1245/1249/1474–1476/2224.
- `product-shell-state.ts:3012–3014` — agent-id list branch.
- Model/effort menus are hand-curated statics in the UI (see memory note
  `v2-model-effort-accuracy`): runtime-accurate model lists from ACP
  `session/new` are received and dropped.
- `availableProviderAgents` is a module-level singleton in
  `agent-chat-shell-state.ts:1654` set as a side effect from an event handler.
Per-agent vocabulary (permission modes, models, icons, display names,
availability) is data, and it currently has no owner.

**A3. Dead agent vocabulary: antigravity. (P1, cheap)**
`ProviderCliAgentId = "codex" | "claude" | "gemini" | "opencode"`
(`shared/contracts/agent.ts:1`) — antigravity is not a launchable agent. Yet
non-comment antigravity code remains in ~12 files: 11 sites in
`agent-chat-shell-state.ts` (including branches comparing values that can no
longer occur, e.g. line 2224), 5 in `tide-product-shell.ts`, 4 in
`provider-command-discovery.ts`, 3 in `product-shell-state.ts`, plus
`node-provider-trust-port.ts`, `recent-provider-files.ts`,
`thread-persistence-service.ts`, `preload/index.ts`, `renderer-entry.ts`,
`app-chrome-state.ts`. These branches typecheck only because the comparisons
happen on widened `string` types — which itself signals the id type isn't
flowing through.

**A4. The history/restore plane is asymmetric per provider. (P0 for the
restore gap, P1 for the rest)**
- History connectors exist for claude/codex/gemini; **opencode has none**
  (`agent-integrations/opencode/` contains only the integration file).
- Conversation rebuild from provider history
  (`provider-conversation-rebuilders.ts:40–43`) covers **codex and claude
  only**. If a gemini or opencode thread's Tide block cache is lost or stale,
  there is no fallback — the "No messages here" class of bug (already hit once,
  fixed for the cache-pointer case in 0.1.35) remains reachable for exactly
  those two providers.
- External-session adoption (`provider-session-discovery.ts`,
  `read*ProviderSessionRefsFromHome`) covers claude/codex/gemini; opencode: 0
  references.

**A5. Provider knowledge leaked into infrastructure. (P1)**
`live-backend.ts` (infra) contains `locateClaudeTranscriptFile` (line ~1508),
`locateGeminiSessionFile` (~1530), `claudeProjectDirName` (~1371), and the
`providerCliCommands` executable map (~1325). By the repo's own rule ("anything
agent-specific belongs in the adapter", `system-overview.md` §1) these belong to
the claude/gemini adapters and the registry. The boundary test currently guards
only codex turn-end and hook-event literals — this entire class is unguarded.

**A6. The runtime port hardcodes the agent list. (P1, cheap)**
`agent-integration-agent-runtime-port.ts:337–340` gates structured-runtime
capability on a literal `agentId === codex || claude || gemini || opencode`
chain, and line 313 picks `sessionRefKind` via an opencode/gemini ternary inside
the shared ACP wiring. Both should be derived from the integrations registry /
adapter descriptors — today a 5th agent compiles but silently falls out of the
capability gate.

**A7. Harness coverage is asymmetric per provider. (P1)**
`v2-provider-smoke.mjs` knows all four agents; `v2-provider-permission-flow.mjs`,
`v2-provider-state-matrix.mjs`, and `pw-provider-e2e.cjs` know only
claude/codex/gemini (0 opencode references). The newest provider has the
weakest verification — backwards from the symmetry goal. (Memory confirms:
gemini/opencode image paths and several opencode flows were never
live-verified.)

### B. God files — the desktop layer was never decomposed

The backend decomposition (build-status doc) stopped at the process boundary.
Current sizes (`wc -l`, audit day):

| File | Lines | Top-level decls | Contents crammed together |
|---|---|---|---|
| `desktop/adapters/inbound/react-renderer/tide-product-shell.ts` | **5,822** | 92 | Shell component (~1,350 lines, lines 1062–2410), content-search panel, worktree dialogs, **all six workbench panes** (browser ~460, markdown ~575, editor, diff, terminal ~313, launcher), background webview, left-rail section builders (project/pinned/thread), icons, column-fit math |
| `desktop/application/domains/product-shell/product-shell-state.ts` | **3,054** | — | Whole-app view state: thread list, projects, workbench, dialogs, menus, queue, event application |
| `desktop/adapters/inbound/react-renderer/agent-chat-shell.ts` | **2,415** | — | Transcript rendering, markdown, tool blocks, reasoning, composer, readiness surface, paste/attachments |
| `desktop/application/domains/agent-chat/agent-chat-shell-state.ts` | **2,340** | — | Chat view state + per-agent permission/model vocab (A2) + composer/queue logic |
| `backend/application/services/thread-runtime-service.ts` | 1,976 | — | Lifecycle core + facade (post-decomposition) |
| `backend/infrastructure/node/live-backend.ts` | 1,599 | — | Wiring + projector closure + adoption/discovery + provider helpers (A5) |
| `desktop/main/electron-main.ts` | 1,144 | 41 fns / 15 `ipcMain` sites | Window policy, menus, IPC bridge, backend supervisor wiring, attachments, fullscreen, close-intent |
| `backend/adapters/inbound/contract-message-adapter/backend-contract-message-adapter.ts` | 1,012 | — | Every contract command's routing in one switch |

**B5. Re-growth is already happening. (P1)**
`thread-runtime-service.ts` was decomposed to 1,616 lines (build-status); it is
1,976 today — new features (interrupt, steer, queue, persistence fixes,
mid-thread options) landed in the facade again. Nothing prevents the next 4,500-
line file. The decomposition effort needs a ratchet, not heroics.

### C. E2E / "be sure it runs" gaps

**C1. No CI on push or PR. (P0)**
`.github/workflows/` contains only `release.yml` (v1, tags `v*`) and
`desktop-release.yml` (v2, tags `tide-v*`). Typecheck + tests run **only when
cutting a release**. Any commit between releases can break the build/tests
silently — the exact opposite of "we can be sure it runs". The suite is fast
(5.6 s) and already CI-aware (`pty-ci-gate.ts`), so this is pure wiring.

**C2. There is no single end-to-end gate command. (P0)**
The canonical battery exists but must be invoked piecewise, per provider, from
memory: `test:smoke:providers` covers only the smoke script; permission-flow,
state-matrix, and the real-app Playwright e2e have no npm entry at all. Nothing
aggregates results into one verdict. "Did everything pass for all four agents?"
currently requires ~13 manual invocations and human bookkeeping.

**C3. The scripts directory is 80% unlabeled debris. (P1)**
58 files in `scripts/`; only ~11 are referenced by package.json, docs, or CI
(`v2-provider-smoke/permission-flow/state-matrix`, `v2-electron-runtime-smoke`,
`pw-provider-e2e`, `pw-smoke`, `seed-thread`, `v2-tooling-command`,
`provider-evidence-harness.py`, `pw-slash-verify`, `pw-trust-editor-verify`).
The other ~47 are one-off debugging artifacts (`pw-live-claude.cjs`,
`pw-live-claude2.cjs`, `pw-live-claude3.cjs`, `pw-md-inspect.cjs`, …) plus
`_pwdbg3.cjs` **committed at the app root**. Each hand-rolls its own Electron
launch/selector boilerplate (no shared driver), so they rot individually. The
canonical battery is indistinguishable from the debris without tribal knowledge.

**C4. Node version is unpinned. (P1, trivial fix)**
No `engines` field, no `.nvmrc`. The test runner requires node ≥ 22.6
(`--experimental-strip-types`); under nvm the shell drifts to node 20 and the
suite fails with confusing errors (this has already burned sessions — memory
note `v2-uiux-batch-jun11`).

**C5. No auth-free full-app e2e. (P1)**
The only full-app click-path test (`pw-provider-e2e.cjs`) requires live provider
auth, so it can never run in CI. The ingredients for an auth-free variant
already exist — `v2-electron-runtime-smoke.mjs` boots the real packaged app
against a fake OpenAI server headlessly — but no Playwright click-driving is
wired on top of it. CI therefore proves compile+unit only, never "a thread
starts, an answer renders, a reopen restores".

**C6. Minor test-infra debt. (P2)**
`vitest` is in devDependencies but imported nowhere (the suite is node:test).
3 real-PTY tests are load-flaky (documented, CI-skipped — acceptable, keep).

### D. Dead and legacy machinery (post-cutover residue)

**D1. The adapter contract still carries the dead PTY-era surface. (P1)**
`domains/agent-integration/agent-integration.ts` still defines — and adapters
still populate — `inputTiming`, `submitKeySequence`, `autoRespondPrompts`,
`expectedSignalSources`, `supportsHiddenPty`, `requiresTerminalKeyProtocol`,
`transport: "hidden_pty"`, `ProviderSignalSourceKind: "pty_transcript"`, and
`AgentPromptSignalInput.source: "pty_transcript"`. No PTY agent runtime exists
anymore (the runtime port has no PTY spawn path; the scrape machinery is
deleted). Every new adapter author confronts ~9 contract fields that mean
nothing. Note: `python-pty-process-launcher.ts` is **not** dead — it serves
workbench Terminal panes and the Provider Setup Surface; keep it.

**D2. Bootstrap artifacts are written but never read. (P1)**
`ensureProviderBootstrapArtifacts` still runs at spawn (`live-backend.ts:116`
import), generating hook/MCP/plugin files the structured runtimes no longer
consume (`structured-agent-runtime.md` explicitly tracks this as "the
dead-transport cleanup task"). Caveat discovered during audit: codex's launch
may still reference Tide MCP through `-c` config overrides — verify per
provider with a captured transcript before deleting anything (the spec's own
evidence discipline).

**D3. Dead exports in the history-reader modules. (P2)**
`live-backend.ts` imports only the session-ref discovery functions
(`read*ProviderSessionRefsFromHome`) and the codex/claude rebuilders. The frame
readers (`read*ProviderHistoryFramesFromHome`) and the spool reader
(`readProviderSignalFramesFromSpool`) in `provider-history-readers.ts` have no
remaining importers — dead weight that still *looks* load-bearing.

**D4. `createMemoryPtyTranscriptPort`** (`live-backend.ts:308,1349`) feeds a
transcript port that no longer has a scraping consumer — fold into D1's sweep.

**D5. Docs drift. (P2)**
`system-overview.md` says the four adapters are "claude / codex / gemini /
antigravity" (it's opencode now) and describes PTY-scrape prompt handling that
was deleted; `v2-build-status.md` reports service line counts from before the
re-growth; `specs/README.md` statuses are stale ("Drafted" for long-done specs).
For a repo whose CLAUDE.md sends every agent to these docs first, drift is
actively harmful.

### E. Performance issues

The perf budget (memory: `v2-performance-budget`) demands v2 stay fast/light.
Two compounding O(conversation-size)-per-chunk pipelines were found on the
streaming hot path — invisible in short demos, dominant in long threads.

**E1. Backend: every streaming chunk rewrites the whole conversation to disk.
(P0)**
Path, per ACP `agent_message_chunk` / claude content record
(`live-backend.ts:855–902, 1116–1194`; `thread-persistence-service.ts:310–337`):

```
content_record
 → appendFrameAndEmit
    → service.hydrateThread()            // deep-clones ALL cached blocks (thread-runtime-service.ts:700–739)
    → reader.read → blockUpdate
       → recordBlockUpdateInThreadCache
          → persistThreadBlocks
             → service.hydrateThread()   // second full deep-clone
             → writeAgentSessionCache
                → loadThreadMetadata     // disk READ
                → writeJsonlAtomic(ALL blocks)  // full-conversation serialize + tmp+rename WRITE
                → saveThreadMetadata     // second disk WRITE
```

Per chunk: 2 full deep-clones, 1 metadata read, 1 full-conversation JSONL
write, 1 metadata write. A 500-chunk answer into a 300-block thread ≈ 1,000
full-conversation clones and 1,000 disk writes. SSDs hide it until threads get
long; battery, IO contention, and GC do not.

**E2. Renderer: every chunk re-renders the entire transcript and re-parses
markdown for every block. (P0)**
Each `agentSessionBlock.upserted` produces a new `blocks` array → the
`sessionView` `useMemo` (`agent-chat-shell.ts:129–150`, keyed on array
identity) misses → `createAgentSession` rebuilds the full transcript →
`renderAgentMarkdown` calls `markdown.render(body)` for **every** agent block
on **every** chunk (`agent-chat-shell.ts:1059`). O(blocks × chunks) markdown
parses per turn, plus full React reconciliation of the transcript subtree.
Transcript virtualization is consciously deferred (fine), but this is worse:
cost scales with chunk *rate*, not scroll length.

**E3. Whole-shell re-render per backend event. (P1)**
Every forwarded event (`electron-main.ts:593` → renderer) produces a new
top-level state object; the left rail (project/pinned/thread section builders),
workbench chrome, and dialogs all rebuild per chunk. xterm/CodeMirror manage
their own DOM (good), but reconciliation of a 5,822-line component tree per
chunk is pure waste. No section-level `React.memo`; no event coalescing
anywhere between protocol client and React (a chunk:render ratio of 1:1).

**E4. `hydrateThread` clones unconditionally. (P1)**
Internal hot-path callers (the projector, persist) pay `cloneBlocks(...)` +
`snapshotThread(...)` per call even though they only read. A non-cloning
internal read (or chunk-scoped snapshot reuse) removes most of E1's CPU cost
independently of the IO fix.

**E5. Confirmed non-issues** (for the record): startup adoption scans are
bounded (`recent-provider-files.ts` `slice(-8)`); backend has no timers; the
terminal output path already bypasses React; bundle sizes are budgeted.

## 3. Remediation plan

Ordering rationale: **guardrails → registry → e2e gate → decomposition → perf →
deletion**. Guards first so everything after is mechanically protected; the
agent registry before file splits so decomposition doesn't relocate per-agent
branches it should be deleting; the e2e gate before decomposition so behavior-
preserving moves are provably behavior-preserving; deletion last because it
needs the guards and harnesses as a net. The two perf fixes are independent and
may land any time — they are scheduled but not blocked.

Every slice states **Goal / Gap / Verify** (the CLAUDE.md contract). A slice is
done only when its Verify passes.

---

### Phase 0 — Guardrails (small, do immediately)

**0.1 CI on every push/PR. [fixes C1]**
- *Goal:* `typecheck` + `npm test` + `npm run build` run on a macOS runner for
  every push/PR touching `apps/desktop/`; failures block merge.
- *Gap:* workflows trigger only on release tags today.
- *Plan:* add `.github/workflows/desktop-ci.yml` (push/PR, path-filtered,
  `npm ci && npm run typecheck && npm test && npm run build`). PTY tests
  already self-skip on `CI=true`. Add `npm run test:smoke:electron` as a
  second, non-required job to start collecting signal (promote to required once
  stable on runners).
- *Verify:* open a PR with a deliberately failing test → red; revert → green.

**0.2 Pin the node engine. [fixes C4]**
- *Plan:* `"engines": { "node": ">=22.6" }` in package.json + `.nvmrc` (22) at
  `apps/desktop/` + one line in README. Optionally a preflight check in
  `v2-tooling-command.mjs` printing a clear error on old node.
- *Verify:* `nvm use 20 && npm test` fails with the explicit message, not a
  syntax error.

**0.3 Script hygiene + battery manifest. [fixes C3, part of C2]**
- *Plan:* move the ~47 non-canonical `pw-*.cjs`/probe scripts to
  `scripts/archive/` (delete the obviously dead ones: `pw-live-claude{2,3}`,
  `_pwdbg3.cjs` at root); write `scripts/README.md` naming each canonical
  script, what it proves, and what it needs (auth? built app?). Drop the unused
  `vitest` devDependency (C6).
- *Verify:* `npm test` + `npm run build` green; `ls scripts/*.cjs *.mjs` shows
  only canonical entries; README lists them all.

---

### Phase 1 — One agent, one place: the Agent Descriptor registry
*(fixes A1, A2, A3, A6; enables A7, Phase 5)*

**1.1 Introduce `AgentDescriptor` and derive everything from it.**
- *Goal:* a single per-agent module owns ALL declarative agent knowledge:
  `{ id, displayName, monogram/icon key, executable candidates,
  permissionModes (+ legacy-value normalization data), modelOptions /
  effortOptions (until runtime-accurate lists land), sessionRefKind,
  capabilities, comingSoon/availability flags }`. The registry
  (`agent-integrations/registry.ts`) maps id → `{ descriptor, createIntegration }`,
  and is the **only** place an agent id is born.
- *Gap:* this knowledge is currently distributed across UI statics
  (`PERMISSION_OPTIONS`, model menus, icons), infra maps
  (`providerCliCommands`), the runtime port's hardcoded gate
  (`agent-integration-agent-runtime-port.ts:313,337–340`), and contracts.
- *Plan:* (a) define the descriptor type in the agent-integration domain;
  (b) write four descriptors next to their integrations; (c) replace the
  runtime port's literal gates and `sessionRefKind` ternary with registry
  lookups; (d) ship the descriptor snapshot to the renderer over the existing
  contract (extend the payload that already carries available agents), and
  delete the UI's hand-maintained copies — `PERMISSION_OPTIONS`,
  `normalizePermissionValue` branches, availability lists, monogram switches
  become pure data lookups; (e) move `providerCliCommands` resolution into the
  registry.
- *Verify:* `npm test` green; behavior tests asserting the composer menu /
  permission rows / model chips render identically from descriptor data; the
  provider smoke for all four agents still answers+settles
  (`v2-provider-smoke.mjs --agent each`).

**1.2 Excise the antigravity remnants. [A3]**
- *Plan:* delete every antigravity branch/string in desktop + preload + trust
  port + recent-files + persistence (12 files). Re-adding agy later goes
  through the registry like any agent.
- *Verify:* `grep -ri antigravity src/ --include='*.ts'` returns only doc/
  comment references that explain history (target: zero in desktop/).

**1.3 Extend the boundary tests to enforce symmetry mechanically.**
- *Goal:* the spine/UI can never re-grow agent branches; a new agent cannot be
  half-registered.
- *Plan:* extend `runtime-spine-boundary.test.ts` (or add
  `agent-symmetry-boundary.test.ts`) to assert: (a) no agent-id string literal
  comparisons (`=== "claude"` etc.) anywhere outside
  `agent-integrations/**` + the registry (regex over source, allowlist file);
  (b) for every id in `ProviderCliAgentId`: a descriptor exists, an integration
  factory exists, a history connector or an explicit
  `restoreStrategy: "cache_only"` declaration exists (see 5.3), and each
  canonical harness script names it; (c) infra files contain no provider path
  literals (`.claude`, `.codex`, `.gemini`, …) — prepares 5.2.
- *Verify:* temporarily add `=== "claude"` to a service file → test fails;
  remove an agent from a harness list → test fails.

**Phase-1 acceptance scenario (the user's A1 pain, reversed):** introducing a
stub 5th agent (e.g. antigravity returning canned preflight-not-installed)
touches exactly: one new directory under `agent-integrations/`, one registry
line, one id added to the contract union — and the boundary test *forces* the
harness-list updates. Demonstrate this in the PR that closes the phase, then
revert the stub.

---

### Phase 2 — The e2e gate: one command, every agent, honest verdicts
*(fixes C2, C5, A7, C3 remainder)*

**2.1 `npm run e2e` — the orchestrator.**
- *Goal:* one command builds once, then runs per agent: electron fake-provider
  smoke → provider smoke → permission flow → state matrix → real-app
  Playwright e2e, and prints one summary table (`agent × scenario →
  PASS/FAIL/SKIP(reason)`), exit code = any FAIL.
- *Gap:* today ~13 manual invocations, no aggregation, no npm entries for
  permission-flow/state-matrix/pw-provider-e2e at all.
- *Plan:* `scripts/e2e-run.mjs` wrapping the existing canonical scripts
  unchanged (they already exit non-zero on failure). Auth/install preflight per
  agent (reuse the integrations' own preflight via a tiny backend call or the
  state readers) so missing auth ⇒ **SKIP with reason**, never FAIL — honest
  on dev machines, strict in a fully-authed environment via `--require-live`.
  Flags: `--agent <id>|all`, `--scenario <name>`, `--require-live`.
- *Verify:* on this machine: claude/codex rows PASS live, unauthed agents show
  SKIP(no-auth); `--agent claude --scenario permission` runs one cell; a
  deliberately broken adapter turns exactly its row red.

**2.2 Close the harness asymmetry: opencode (then any new agent) in every
scenario. [A7]**
- *Plan:* add opencode to `v2-provider-permission-flow.mjs`,
  `v2-provider-state-matrix.mjs`, `pw-provider-e2e.cjs` (ACP permission shape
  already exists for gemini; the state matrix needs opencode's not-installed /
  not-authed / trust expectations). Phase 1.3(b)'s boundary test then pins this
  forever.
- *Verify:* `npm run e2e -- --agent opencode` produces a full column (live
  PASS where authed).

**2.3 Auth-free full-app e2e for CI. [C5]**
- *Goal:* CI proves "app boots → thread starts → answer renders → reopen
  restores conversation → workbench pane opens" with zero provider auth.
- *Plan:* extend the fake-OpenAI Electron smoke into a Playwright-driven
  click-path (`scripts/e2e-app-fake.mjs`): drive the real built app against
  the fake `openai_api` provider (the runtime path is identical above the
  provider port), assert rendered DOM, restart the app, assert restore. Wire as
  a required CI job (it needs no secrets).
- *Verify:* runs green in the 0.1 CI workflow on a clean runner; killing the
  fake server mid-turn shows the error block instead of hanging (also pins the
  "crash never strands Working" invariant).

**2.4 One shared Playwright driver lib. [C7/C3]**
- *Plan:* `scripts/lib/app-driver.mjs` (launch built app, locate window, common
  selectors, seed thread, screenshot-on-fail) consumed by `pw-provider-e2e`,
  `e2e-app-fake`, and the surviving verify scripts; new debug scripts compose
  it instead of copy-pasting.
- *Verify:* `pw-provider-e2e.cjs` ports to the driver with no behavior change
  (same assertions pass); line count of the ported scripts drops sharply.

---

### Phase 3 — Desktop decomposition: small files, enforced
*(fixes B1–B4, ratchets B5)*

Rules for every slice: **move, don't rewrite**; one cluster per PR; after each:
`npm test` + typecheck + `e2e-app-fake` + a `pw-smoke` screenshot compare.
The markup-level behavior tests already exist and travel with the moved code.

**3.1 `tide-product-shell.ts` (5,822) → a directory.** Natural seams are
already visible in the file's own structure:
```
react-renderer/
  product-shell/
    tide-product-shell.tsx        # the shell component only (~target 600)
    left-rail/  (project-section, pinned-section, thread-section, section-header)
    workbench/  (split-view, browser-pane, background-webview, editor-pane,
                 markdown-view, diff-pane, terminal-pane/-view, launcher-pane,
                 pane-chrome)
    dialogs/    (worktree-delete, editor-picker)
    content-search-panel.tsx
    agent-identity.tsx  (monogram/icon — descriptor-driven after Phase 1)
    column-layout.ts    (fitColumnsToWidth + geometry)
```
- *Verify per slice:* suite green; screenshot diff of the dev-harness fixture
  unchanged; `e2e-app-fake` click-path green.

**3.2 `agent-chat-shell.ts` (2,415) →** `agent-chat/` directory: transcript
(session items, turn renderers, tool-log body, reasoning), markdown rendering
(one module — becomes the E2 cache point), composer (input, paste/attachments,
chips/popovers), readiness surface, working indicator.

**3.3 State stores (3,054 + 2,340) → domain slices.** Split each into
event-application modules per concern (thread-list, workbench, chat/session,
composer/queue, menus/dialogs) combined by a thin root reducer; per-agent vocab
is already gone via Phase 1. Pure-function moves — the state shape and action
vocabulary stay identical in slice 1; only *then* consider shape changes.

**3.4 `electron-main.ts` (1,144) →** `main/` modules: window-policy (the nav
guard — do not weaken it; memory `v2-external-link-window-guard`), app-menu,
ipc-bridge (the 15 `ipcMain` sites), backend-supervisor wiring, attachments.

**3.5 The ratchet: a file-size boundary test. [B5]**
- *Plan:* `tests/file-size-ratchet.test.ts`: every `src/**/*.ts(x)` ≤ 800
  lines, with an explicit allowlist of current oversized files **pinned at
  their current line counts** — a file may shrink or hold, never grow; remove
  entries as phases land. Same mechanism as the spine boundary test: a test,
  not a new toolchain.
- *Verify:* adding 50 lines to `thread-runtime-service.ts` fails the suite
  with a message pointing at the right collaborator module to extend instead.

**3.6 Backend remainder (smaller):** finish the planned
`RuntimeLifecycleCoordinator` split of `thread-runtime-service.ts` per the
existing `specs/thread-runtime-service-decomposition.md` (the re-grown 360
lines mostly belong there); split `backend-contract-message-adapter.ts`'s
switch into per-domain routers; extract the projector closure from
`live-backend.ts` into `live-projector.ts` (mechanical now that A5/D-cleanups
shrink the file).

---

### Phase 4 — Performance: fix the two O(N)-per-chunk pipelines
*(fixes E1–E4; independent, may land before Phases 1–3)*

**4.1 Coalesce conversation persistence. [E1]**
- *Goal:* disk writes per streamed turn go from O(chunks) to O(1)–O(seconds),
  with zero durability loss at the moments that matter.
- *Plan:* in the projector, replace the per-update
  `recordBlockUpdateInThreadCache` persistence with: record block in service
  memory immediately (unchanged), but schedule `persistThreadBlocks` through a
  per-thread trailing debounce (~300 ms) with hard flush on: turn end, prompt
  open, runtime exit, thread switch/hydrate, backend shutdown. Skip the
  `loadThreadMetadata` re-read by caching the metadata record per thread
  (invalidate on metadata writes — the cache-pointer-clobber regression test
  from 0.1.35 must stay green). Add a debug counter
  (`TIDE_DEBUG_PERSIST=1` logs writes per turn).
- *Verify:* unit test for the flush triggers (incl. crash-before-flush at most
  loses the trailing window, never the turn-end state); instrument a 1,000-
  chunk fake stream: writes drop from ~1,000 to < 10; `persistence.test.ts` +
  restart-restore (`pw-restart-verify` scenario, now in the e2e gate) green;
  state-matrix `concurrency` green.

**4.2 Renderer: per-block memoization + markdown cache (+ chunk coalescing).
[E2, E3]**
- *Plan:* (a) make each transcript turn a `React.memo` component keyed on
  `(blockId, updatedAt/body)` so only the streaming block re-renders; (b) cache
  `markdown.render(body)` in a small LRU keyed by body string — a completed
  block's HTML is computed once; (c) coalesce `agentSessionBlock.upserted`
  bursts for the *same* block in the desktop event application (or main-process
  forwarder) to animation-frame cadence (~33 ms) — UI streaming stays smooth,
  chunk:render becomes ~30 Hz max; (d) `React.memo` the left-rail sections and
  workbench chrome on their actual props (E3).
- *Verify:* dev-harness fixture with a scripted 5,000-chunk stream into a 300-
  block thread: count `markdown.render` calls (instrumented) before/after —
  from ~1.5 M to ≤ blocks + stream-block updates; Chrome tracing shows long
  tasks < 16 ms during streaming; the transcript-selection memo behavior
  (comment at `agent-chat-shell.ts:123–128`) still holds — drag-select during
  stream survives.
- *Note:* list virtualization stays deferred (consistent with build-status),
  but set its trigger now: profile at 1,000+ blocks after (a)–(c); if scroll
  jank remains, schedule it.

**4.3 Non-cloning internal reads. [E4]**
- *Plan:* add an internal `peekThread(threadId)` (no clone) used by the
  projector/persist paths; `hydrateThread` keeps cloning for external callers.
- *Verify:* suite green (any test mutating returned blocks would fail —
  none should); CPU profile of the 4.2 fixture shows clone time gone.

---

### Phase 5 — Delete the dead machinery, move the leaked knowledge
*(fixes D1–D4, A4/A5; needs Phase 1 registry + Phase 2 gate as the net)*

**5.1 Strip the PTY-era adapter contract. [D1, D4]**
- *Plan:* remove `inputTiming`, `submitKeySequence`, `autoRespondPrompts`,
  `supportsHiddenPty`, `requiresTerminalKeyProtocol`, `expectedSignalSources`,
  `transport:"hidden_pty"`, `pty_transcript` source kinds, and
  `createMemoryPtyTranscriptPort` + the transcript port wiring. Adapters lose
  the dead fields; `ProviderLaunchPlan` shrinks to what structured transports
  use. Keep the workbench PTY launcher (live feature).
- *Verify:* typecheck forces every dead read site into the open; full suite +
  `npm run e2e -- --agent all` green (live rows on authed agents).

**5.2 Evidence-gated bootstrap-artifact removal + provider-knowledge
relocation. [D2, D3, A5]**
- *Plan:* per provider, capture one live launch transcript proving the
  hook/MCP bootstrap files are unread (watch for codex `-c` references!); then
  stop writing what's unread and delete the now-orphaned frame/spool readers
  (`read*ProviderHistoryFramesFromHome`, `readProviderSignalFramesFromSpool`).
  Move `locateClaudeTranscriptFile` / `locateGeminiSessionFile` /
  `claudeProjectDirName` into their adapters' history connectors; turn on the
  Phase-1.3(c) infra-path-literal guard.
- *Verify:* per-provider smoke + permission flow live; boundary test forbids
  regressions; `live-backend.ts` drops well under the ratchet line.

**5.3 Symmetric restore: gemini/opencode conversation rebuild. [A4 — the P0]**
- *Goal:* a thread whose Tide block cache is lost restores its conversation
  from the provider's own session file for **all** providers, or the provider
  explicitly declares `cache_only` and the UI says so (no silent
  "No messages here").
- *Plan:* implement `rebuildGeminiConversation` (the session JSONL format is
  already parsed by `gemini-history-connector.ts`) and an opencode
  history connector + rebuilder (its ACP session store is on disk; capture
  evidence first per the discipline). Wire both into
  `rebuildConversationFromProviderHistory`. The Phase-1.3 boundary test makes
  a missing connector a failing test for any future agent.
- *Verify:* per provider: start a live thread → quit → delete the thread's
  Tide cache file → relaunch → conversation renders from provider history
  (add this as an e2e-gate scenario, fake-provider variant for CI).

**5.4 Docs refresh. [D5]**
- *Plan:* update `system-overview.md` (opencode, structured-protocol prompt
  story, this plan's link), `v2-build-status.md` numbers, `specs/README.md`
  statuses; add this document to the docs index.
- *Verify:* a new contributor (or agent) reading `docs_v2` finds no claim
  contradicted by the code — spot-check the three corrected docs.

---

## 4. Verification map (what "we can be sure it runs" means when this lands)

| Layer | Gate | When it runs |
|---|---|---|
| Types | `npm run typecheck` | CI every push (0.1) |
| Behavior | `npm test` (668+, fast) incl. boundary tests: spine purity, **agent symmetry (1.3)**, **file-size ratchet (3.5)** | CI every push |
| App e2e, auth-free | `e2e-app-fake` — real app + fake provider, click-driven, restart-restore (2.3) | CI every push |
| Provider e2e, live | `npm run e2e -- --agent all` — smoke/permission/state-matrix/real-app per agent, SKIP-honest (2.1) | dev machines + pre-release; `--require-live` in an authed environment |
| Perf | instrumented stream fixtures: writes/turn, markdown calls, long tasks (4.1/4.2) | per perf-touching PR |
| Release | existing `desktop-release.yml` (unchanged) on `tide-v*` | tags |

## 5. Risks and anti-goals

- **Do not rewrite the protocol clients.** They encode live-captured empirical
  traps (claude first-write deadlock, codex non-jsonrpc framing, gemini silent
  MCP-skip). Phases 1/5 move *declarative* knowledge only; client logic moves
  byte-identical or not at all, and every touch re-runs the live battery.
- **Evidence before deletion** (D2/5.2): "written but unread" must be proven
  per provider with a transcript, not assumed from the spec.
- **Decomposition slices are moves.** Any "while I'm here" rewrite inside a
  Phase-3 slice is a review-rejection criterion. Shape changes get their own
  PRs after the moves.
- **Several live paths were never eyeball-verified** (gemini/opencode image
  attachments, codex/gemini mid-thread live-apply — memory notes). Phase 2's
  gate turns these from "remembered caveats" into standing red/green cells; do
  not mark the matching cells PASS until they actually run live.
- **Focus and binding invariants** (`runtime-mental-model.md`) are
  non-negotiable across all refactors: thread-keyed everything, focus is
  user-only, one content source per answer. The existing tests pin most of
  this; keep them green at every slice.

## 6. Suggested execution order (compounding value per step)

1. **0.1 + 0.2 + 0.3** — one short PR each; CI exists from day one. ✅ low risk
2. **4.1 + 4.2** — the two perf fixes; user-visible snappiness in long threads,
   independent of everything else.
3. **1.1 → 1.2 → 1.3** — the registry; ends the 16-file fan-out; proves itself
   with the stub-agent scenario.
4. **2.1 → 2.4** — the e2e gate; from here on, every later phase self-verifies.
5. **3.1 → 3.6** — decomposition under the ratchet, biggest files first.
6. **5.1 → 5.4** — deletion and relocation, now safe and mechanical.
