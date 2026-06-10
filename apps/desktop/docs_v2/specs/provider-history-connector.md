# Spec: Provider History Connector — uniform content/binding/settle plane

Realizes the content-plane half of `agent-runtime-event-spine.md`: every piece of
provider-specific knowledge (how to find THIS runtime's session file, how to parse
it into frames, how to decide the turn ended, how to read a hook payload) moves
into the provider's Agent Integration. `live-backend.ts` keeps exactly one generic
history loop and one generic signal loop, with **zero `agentId === …` branches**.

## Evidence (as-is, 2026-06-10)

- `live-backend.ts` holds four ~100-line per-provider history emitters
  (`emitCodexHistory` / `emitClaudeHistory` / `emitAntigravityHistory` /
  `emitGeminiHistory`) that are ~90% identical, dispatched by hardcoded
  `if (runtime.agentId === …)` in `trackRuntime` and `ingestOutput`.
- gemini has **no frame reader**: its whole answer arrives as the turn-end
  `finalMessage` — the documented "(gemini is one-shot)" exception to the
  single-content-source rule.
- gemini session binding is a recency heuristic (`findRecentGeminiSessionPath`,
  claim-sets) that can swap two same-prompt threads — system-overview.md open
  problem #2.
- `providerSessionRefFromProviderSignalPayload` dispatches per agentId in infra.

## Ground truth (verified on installed CLIs)

- `gemini` 0.46 supports `--session-id <uuid>`: the session file is
  `~/.gemini/tmp/<project>/chats/session-<ts>-<uuid8>.jsonl` and its header line
  carries the full `sessionId`. Binding is **assignable at launch**.
- `claude` 2.1 supports `--session-id <uuid>`: the transcript is
  `~/.claude/projects/<munged-cwd>/<uuid>.jsonl`. Also assignable.
- codex has no assignable id; its rollout path arrives via the runtime-keyed hook
  payload (already deterministic per runtime).
- gemini 0.46 supports Claude-style **hooks** (settings-configured), every hook
  payload carrying `session_id` + `transcript_path`; `AfterAgent` fires exactly
  once per turn after the final response; `Notification` fires with
  `notification_type: "ToolPermission"` when a tool waits for approval.

## Decisions

1. **One generic history loop.** `live-backend.ts` keeps a single
   `emitProviderHistory` + `scheduleProviderHistoryPolling` used for all
   providers. The four per-provider emitters and every `agentId === …` branch in
   `trackRuntime` / `ingestOutput` are deleted.
2. **`AgentIntegrationPort.history(): ProviderHistoryConnector`.** The connector
   owns: `resolveSessionRef` (deterministic binding), `readFrames` (session file →
   provider-record frames), `sessionRefFromHookPayload` (hook payload → ref).
   Per-provider reader code physically lives in that provider's adapter directory.
3. **Deterministic binding only — recency heuristics are deleted.**
   - claude/gemini: Tide mints a UUID per runtime in `buildStartPlan`, passes
     `--session-id <uuid>`, and returns the known `providerSessionRef` on the
     launch plan; the runtime port reports it with `onRuntimeStarted` and it is
     recorded before the first poll. The connector resolves the on-disk path from
     the uuid (never from recency).
   - codex/antigravity: ref arrives from the runtime-keyed hook payload (as-is).
   - `findRecentGeminiSessionPath` + claim-sets are deleted.
4. **gemini becomes a full streaming provider.** A real gemini frame reader
   parses the session JSONL (user/gemini records, `thoughts` → reasoning,
   tool records → tool_call/tool_result) into the same frame→block path as the
   other providers. `turnEndFromHistory` no longer returns content.
5. **gemini turn-end = `AfterAgent` hook.** Tide's bootstrap writes gemini hook
   settings (same spool protocol as claude): `AfterAgent` → settle signal,
   `SessionStart` → early binding confirmation, `Notification(ToolPermission)` →
   approval `PromptState`. The session-file settle remains only as the
   adapter-internal fused fallback (spec rule: adapters may fuse their own
   signals; shared code sees one outcome).
6. **gemini stops defaulting to `--yolo`.** Default approval mode follows the
   thread's permission launch option exactly like claude/codex; un-opted turns run
   `--approval-mode default` and surface approval prompts (Notification hook +
   TUI box answered via the existing nav-token PTY path).
7. **Turn settle stays uniform** (`ingestTurnOutcomeAndSettle`), and
   `settleFromHistory` is invoked for every provider; an adapter that settles by
   hook (claude, gemini-with-hooks) simply returns `null` from
   `turnEndFromHistory`.

## Invariants

1. `live-backend.ts` contains no `agentId === "codex" | "claude" | "gemini" |
   "antigravity"` comparisons and no per-provider reader/binder symbols.
2. A thread's `providerSessionRef` is only ever set from (a) a launch-plan
   assignment or (b) a runtime-keyed hook payload — never from file recency.
3. Every provider's content renders only via history frames (single content
   source); turn-end outcomes carry at most a `notice`.
4. Two concurrent threads on the same provider with identical prompts can never
   exchange sessions, prompts, or answers.

## Tests

- Boundary: extend `runtime-spine-boundary.test.ts` — forbid per-provider reader
  symbols and agentId comparisons in `live-backend.ts`.
- Per-adapter connector tests (existing bootstrap test files + new
  `gemini-provider-integration-bootstrap.test.ts`): minted `--session-id`,
  resolveSessionRef from uuid, frame parsing fixtures, hook turn-end.
- Live: `scripts/v2-provider-smoke.mjs` per provider; concurrency smoke (two
  same-prompt threads, distinct answers); permission flow harness per provider.
