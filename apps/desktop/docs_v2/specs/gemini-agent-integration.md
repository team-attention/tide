# Spec: Gemini CLI Agent Integration

Add the **Gemini CLI** (`gemini`, v0.40.1, bundled in Tide Terminal resources) as a
first-class Tide agent at the SAME hierarchy as codex / claude / antigravity — a new
`ProviderCliAgentId`. It exists because Antigravity (`agy`) cannot authenticate when
spawned programmatically (only in an interactive/IDE session), while `gemini`
authenticates and responds when spawned headless. Gemini is Google's working,
integration-friendly CLI (the gemini→agy product transition keeps `gemini` usable).

## Scope

In scope:
- New `ProviderCliAgentId` value `"gemini"` across shared contracts + backend.
- A `gemini-agent-integration.ts` adapter implementing `AgentIntegrationPort`.
- The runtime transport + turn outcome for gemini, wired into the existing uniform
  `AgentTurnOutcome` settle path (`ingestTurnOutcomeAndSettle`).
- Selectability in the composer agent menu + the provider-smoke judge.

Out of scope (later): gemini tool-call/diff rich rendering, MCP tool surface parity,
resume across app restarts beyond session_id capture.

## Evidence (verified 2026-06-09, spawned from a non-interactive context)

- `gemini -p "reply exactly: PONG"` → prints `PONG` and exits 0. **Authenticates when
  spawned** (auth in `~/.gemini/oauth_creds.json`), unlike `agy`.
- `gemini -p "<prompt>" -o json` → clean structured stdout:
  `{ "session_id": "<uuid>", "response": "<final answer>", "stats": {...} }`.
  `response` IS the final answer. No PTY scraping, no transcript race.
- `gemini --list-sessions` lists resumable sessions; `-r/--resume <id|latest>` resumes.
- Each run writes a session JSONL at `~/.gemini/tmp/<cwd-slug>/chats/session-*.jsonl`.
- `gemini hooks migrate` (from Claude Code) → gemini hooks use the Claude hook format
  in `settings.json` `hooks`. But hooks do NOT fire in `-p` (one-shot) mode.
- Flags: `-o text|json|stream-json`, `-i/--prompt-interactive`, `-y/--yolo`,
  `--approval-mode default|auto_edit|yolo|plan`, `--skip-trust`, `--include-directories`,
  `-m/--model`.

## Decisions

1. **Runtime transport = one-shot `gemini -p -o json` per turn (not hidden PTY).**
   This is the cleanest, most reliable shape and the reason gemini is viable: send the
   prompt, read the structured `response` from stdout, process exit = turn end. No
   PTY-scrape, no hook spool, no transcript-binding race (the failure modes that broke
   claude/agy). Follow-up turns resume via `--resume <session_id>` captured from the
   prior run's JSON.

2. **Turn outcome is uniform.** A gemini turn produces
   `AgentTurnOutcome { finalMessage: json.response }` (or a `notice` on error/empty).
   It flows through the SAME `ingestTurnOutcomeAndSettle` as the other agents — the
   answer becomes an `agent_message` block, then settle. Provider specifics
   (spawn `gemini -p -o json`, parse stdout) live in the gemini runtime path only.

3. **Permissions.** Default `--approval-mode default`; map Tide's permission launch
   option (`auto`/`yolo` → `yolo`, `plan` → `plan`). One-shot mode means no interactive
   approval prompt mid-turn for the first cut (tools auto-handled by approval-mode).

4. **Auth/trust preflight.** Installed (`gemini` on PATH / bundled) + authed
   (`~/.gemini/oauth_creds.json` present) + workspace trusted (`--skip-trust` or
   `trustedFolders.json`). Surface blockers like the other adapters.

## Domain Model / Contracts

- `ProviderCliAgentId = "codex" | "claude" | "antigravity" | "gemini"` in BOTH
  `src/shared/contracts/agent.ts` and `src/backend/application/domains/thread/thread.ts`.
- Update `isProviderCliAgentId` guard (`src/shared/contracts/envelopes.ts`).
- Adapter: `src/backend/adapters/outbound/agent-integrations/gemini/gemini-agent-integration.ts`
  implementing `AgentIntegrationPort`. `turnEndFromHook`/`turnEndFromHistory` return
  null (gemini settles from the one-shot process result, not hooks/transcript).

## Flow

```
Composer send
  -> runtime spawns: gemini -p "<prompt>" -o json [-r <session_id>] [--approval-mode ...]
  -> capture stdout to completion; process exit
  -> parse JSON: { session_id, response }
  -> bind thread.providerSessionRef = session_id (for --resume on next turn)
  -> AgentTurnOutcome { finalMessage: response } -> ingestTurnOutcomeAndSettle -> idle
  (non-zero exit / unparseable / empty response -> notice)
```

## Invariants

1. gemini is a peer `ProviderCliAgentId`; the service/UI treat it uniformly.
2. The final answer is `json.response`; a turn never settles silently empty (notice on
   failure).
3. Follow-ups resume the same gemini session via captured `session_id`.
4. No PTY-scrape / hook-spool / transcript-binding dependency for gemini.

## Tests

- `gemini-agent-integration-bootstrap.test.ts`: preflight blockers (not installed / not
  authed / untrusted), launch plan args (`-p`, `-o json`, `--resume`, approval-mode).
- Pure parse test: `{session_id,response}` JSON → `AgentTurnOutcome`.
- Judge: `scripts/v2-provider-smoke.mjs --agent gemini` → answer block + settle (gemini
  works headless, so this is objectively verifiable, unlike agy).

## Implementation Notes

The one-shot subprocess runtime is a NEW transport beside the hidden-PTY path. Add it as
a focused gemini runtime in the backend (spawn + capture + parse), reusing
`ingestTurnOutcomeAndSettle` for the outcome. Keep the PTY machinery untouched. This
also de-risks the broader runtime: gemini demonstrates the clean
"structured-output subprocess" model the event-spine spec gestures at.

## Open Questions

1. Streaming: `-o stream-json` could stream partial output for live typing; start with
   non-streaming `-o json` (whole answer on exit) and add streaming later.
2. Tool calls / approvals mid-turn: one-shot `--approval-mode yolo|auto_edit` handles
   them non-interactively for v1; interactive approval routing is a later slice.
3. Selecting gemini's model (`-m`): map Tide's model launch option; gemini-3-flash by
   default.
