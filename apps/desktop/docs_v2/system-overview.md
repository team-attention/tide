# Tide v2 — System Overview & Open Problems

_Snapshot: 2026-06-10. Branch `v2-uniform-one-source-answer`._

Tide v2 wraps interactive CLI coding agents (Codex, Claude Code, Gemini) so that, to the
user, they all behave like one uniform chat. The shared flow lives in one place; each
agent's quirks are isolated in its adapter.

---

## 1. Layers

```
React renderer (UI)
   │  contract messages: thread.start, prompt.answer, agentRuntime.stop, thread.hydrate …
   ▼
Backend service (Electron main)
   │
   ▼
live-backend.ts  ── the shared spine: one flow for every agent
   │
   ▼
Agent Integration adapters  ── per-agent differences ONLY
   │   claude / codex / gemini / antigravity
   ▼
real CLI process (hidden PTY)  +  that CLI's own history file
```

Rule: **the spine is identical for all agents; anything agent-specific belongs in the
adapter.** When something is special-cased in `live-backend.ts`, that's a smell.

---

## 2. How one turn runs

1. **Start** — UI picks an agent (chip) + types a prompt → `thread.start`. The adapter's
   `buildStartPlan` produces the launch argv. All three run in a **hidden PTY**
   (`supportsHiddenPty: true`): claude/codex interactive, gemini via `--prompt-interactive`.
2. **Content** — the CLI writes the conversation to **its own history file**:
   - claude → `~/.claude/projects/<cwd>/<session>.jsonl` (transcript)
   - codex  → `~/.codex/sessions/.../rollout-*.jsonl`
   - gemini → `~/.gemini/tmp/<proj>/chats/session-*.jsonl`

   `provider-history-readers.ts` parses that file into **blocks** (agent_message,
   reasoning, tool_call, tool_result). A 1s poll (`pollWhileRunning`) streams new blocks
   while the turn is in flight.
3. **Prompts** (permission / questions) — claude/codex hooks fire to a spool
   (`~/.tide/agent-bootstrap/provider-signals/runtime-*.jsonl`); the adapter's
   `detectPromptState` turns them into a `PromptState`; the user's Allow/Deny is replayed
   as keystrokes on the PTY box. codex/gemini boxes that have no hook are scraped from the
   PTY text instead.
4. **Turn end (settle)** — claude `agent-idle` (Stop hook) / codex `task_complete` /
   gemini session end. This **only settles** the turn (and may add a `notice`); it carries
   **no answer content**.

### The one rule that matters: SINGLE CONTENT SOURCE

The answer is produced by **exactly one** path — the history reader. Turn-end never emits
the answer. Because nothing is produced twice, **there is no dedup anywhere** — the
duplicate-answer bug that plagued earlier versions cannot exist. A turn legitimately has
many answer segments (intro → tools → reply); each is a distinct reader block and all
render. (Gemini is one-shot per turn: its single session read *is* the content, surfaced
through the same turn-end outcome; no competing reader, so still one source.)

---

## 3. Persistence / reload / adopted

- **Live**: blocks held in `blocksByThread` (memory) + appended to `agent-session-cache.jsonl`.
- **Reload** (Tide ran it before): read the block cache, not re-parsed.
- **Adopted** (Tide never ran it): rebuilt from the provider's own history file.
- **Thread ↔ session binding**: a thread is pinned to one provider session file
  (`providerSessionRef.transcriptPath`). claude learns its session id from the hook
  payload; gemini has to discover its file (see open problem #2).

---

## 4. Why the answer & permission flow finally works (this session)

- **No dedup**: turn-end is settle-only; reader owns content. (`adf6e5f6`)
- **Permission surfaces**: `detectPromptState` reads `payload.hook_event_name` (Tide
  normalizes every claude hook to `agent-needs-input`; the real hook is in the payload).
  Allow = Enter on claude's default option; Deny = Esc (`PTY_CANCEL_TOKEN`). (`d895fb2a`)
- **Multi-permission**: `pollWhileRunning` keeps polling through `waiting_for_approval`
  so a SECOND prompt (WebFetch after WebSearch) is still read after the user answers the
  first. (`4e67770e`)
- **Self-driving check**: `scripts/v2-claude-permission-flow.mjs` launches real backend +
  real claude, auto-Allows every prompt, asserts the turn settles with an answer — so this
  flow is verified without a human. Observed PASS: 2 prompts → idle + real answer.

---

## 5. Open problems / not yet done

1. **gemini is not yet fully uniform.** It runs in a PTY now (good), but its turn-end +
   content still flow through a slightly different path than claude/codex. Goal: same
   reader+settle shape as the other two.
2. **gemini session binding is heuristic.** Gemini doesn't tell Tide its session id, so a
   thread finds its `session-*.jsonl` by "most recent + first-prompt match + not already
   claimed" (`c233632c`). Robust for distinct prompts; two threads with the *same* prompt
   started together could still mis-attribute (they won't share one file, but could swap).
   Proper fix: capture gemini's session id from the runtime.
3. **Possible double permission prompt.** A tool box that BOTH scrapes via PTY *and* fires
   a `PermissionRequest` hook may now surface twice (different promptIds). Not yet seen
   live; needs a dedup if it appears.
4. **codex/gemini have no self-driving permission harness yet** — only claude. They auto-
   approve by config in normal use, but the harness should cover them too.
5. **antigravity** is wired but hidden (can't auth when spawned).

---

## 6. How to verify (no manual testing)

- `npm test` — 597 behavior tests.
- `npm run typecheck`.
- `node scripts/v2-provider-smoke.mjs --agent <claude|codex|gemini>` — real backend + real
  CLI, asserts the answer renders **once** (`answerBlocksWithToken <= 1`) and settles.
- `node scripts/v2-claude-permission-flow.mjs` — self-driving permission/multi-tool flow.
