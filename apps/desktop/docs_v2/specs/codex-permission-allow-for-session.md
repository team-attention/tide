# Spec: Codex permission "Allow for this session"

## Scope

Sibling to `claude-permission-allow-always.md`. Codex approval cards only offer Allow/Deny,
so under the `ask-for-approval` policy the same command re-prompts every time. Codex's
app-server protocol natively carries a session-scoped approval decision — this slice surfaces
it as an **Allow for this session** choice.

Codex is NOT ACP and does NOT use claude's `permission_suggestions`; it has its own
mechanism. Whereas claude/gemini/opencode were covered elsewhere (claude by the sibling
spec; gemini/opencode are ACP-native), codex had the same Allow/Deny-only gap claude had.

## Evidence

Codex app-server JSON Schema (`codex app-server generate-json-schema --out`, codex-cli
0.141.0). Tide's codex client handles the **v2** approval server-requests
(`codex-app-server-client.ts:509,520`):

- `item/commandExecution/requestApproval` → response decision is a `CommandExecutionApprovalDecision`
- `item/fileChange/requestApproval` → response decision is a `FileChangeApprovalDecision`

Both v2 decision enums are identical in shape:

| decision | meaning |
|---|---|
| `accept` | approve once |
| **`acceptForSession`** | approve + don't re-prompt for the same command/files **this session** |
| `decline` | deny, agent continues the turn |
| `cancel` | deny, interrupt the turn |

(`CommandExecutionApprovalDecision.acceptForSession`: "future prompts in the same
session-scoped approval cache run without prompting." `FileChangeApprovalDecision.acceptForSession`:
"future changes to the same files run without prompting.")

Current code: Tide responds `{ id, result: { decision } }` with `decision` = `"accept"` /
`"decline"` only (`codex-app-server-client.ts:306-307`); the card is hardcoded Allow/Deny
(`:554-555`). So the session-scope decision is available but never offered.

Note: codex's session-scope approval is an **in-memory session cache**, NOT a disk-persisted
rule like claude's `settings.local.json`. The persistent-rule analog ("execpolicy
amendment" / persistent network-policy variants of the decision union) carries structured
amendment objects (command sets / hosts) and is out of scope here — same deferral posture as
claude's `setMode` suggestions.

## Decisions

- **D1 — Use codex's native `acceptForSession` decision** for the new choice; do not invent a
  rule. `accept`/`decline` responses are unchanged.
- **D2 — One extra choice, unconditional.** Both v2 approval types Tide handles
  (`commandExecution` + `fileChange`) support `acceptForSession`, and both flow through the
  shared `surfaceApproval`, so the choice is added there for every codex approval.
- **D3 — Order Allow / Allow for this session / Deny.** `defaultChoiceId` stays `"allow"`.
  `kind: "allow_always"` on the new choice (shared styling slot; ACP/claude use it too).
- **D4 — Distinct token** `CODEX_ACCEPT_FOR_SESSION_TOKEN = "structured:accept_for_session"`;
  `write()` maps it to `decision: "acceptForSession"`.
- **D5 — Honest label.** `Allow for this session` — no project/disk scope hint (codex's
  cache is session-scoped, not a persisted file). Distinct from claude's
  `… · this project`.

## Out Of Scope

- Persistent codex approvals (execpolicy amendment / network-policy decision variants) — they
  carry structured amendment params; a separate slice.
- claude / gemini / opencode (covered: claude sibling spec; ACP native).
- `cancel` (deny-and-interrupt) as a distinct choice — today's `decline` (deny, continue) is
  the single Deny; unchanged.

## Domain Model

No new domain entity. `pendingApprovals` (Map<promptId, serverRequestId>) is unchanged — the
chosen decision is derived from the answer token in `write()`, not stored.

## Contracts

**No change.** Reuses `PromptChoiceDto.kind: "allow_always"`.
`CODEX_ACCEPT_FOR_SESSION_TOKEN` is a backend-internal provider token (sibling of
`CODEX_ACCEPT_TOKEN` / `CODEX_DECLINE_TOKEN`).

## Flow

1. **Ingress** (`surfaceApproval`): build choices Allow / **Allow for this session** / Deny;
   the session choice carries `providerValue: CODEX_ACCEPT_FOR_SESSION_TOKEN, kind:"allow_always"`.
2. **Answer** (`write`): map the token to a decision —
   `CODEX_DECLINE_TOKEN → "decline"`, `CODEX_ACCEPT_FOR_SESSION_TOKEN → "acceptForSession"`,
   else `"accept"`. Send `{ id: serverRequestId, result: { decision } }`.
3. **Codex suppresses**: codex caches the session approval; the same command/file isn't
   re-prompted for the rest of the session.

## Invariants

- I1 — Every codex approval card has exactly three choices (Allow / Allow for this session /
  Deny); the session choice is always present (both handled approval types support it).
- I2 — `acceptForSession` is sent only for the session token; `accept` / `decline` payloads
  are byte-identical to today (regression guard).
- I3 — `cancel` is never sent by this slice.

## Tests

Backend (`tests/`, fake codex app-server stdio):

- **T1** command approval → 3 choices; middle = `{choiceId:"allow_session",
  kind:"allow_always", providerValue:"structured:accept_for_session", label:"Allow for this
  session"}`; `defaultChoiceId === "allow"`.
- **T2** answer session token → response `{ id, result: { decision: "acceptForSession" } }`.
- **T3** answer plain allow → `{ decision: "accept" }` (regression).
- **T4** answer deny → `{ decision: "decline" }` (regression).
- **T5** a fileChange approval also carries the session choice (shared `surfaceApproval`).

## Implementation Notes

- `CODEX_ACCEPT_FOR_SESSION_TOKEN` beside the existing tokens (`codex-app-server-client.ts:44-45`).
- `surfaceApproval` (`:554-555`): insert the session choice between Allow and Deny.
- `write()` (`:306-307`): replace the binary map with a three-way map.
- codex client is 737 lines (< 800 cap); additions are ~10 lines, no ratchet pressure.

## Verification scenario (live)

Run codex with `ask-for-approval` → it requests approval for a shell command → card shows
**Allow for this session** → pick it (Tide sends `decision: acceptForSession`) → ask codex to
run the same command again in the SAME session → no approval card (auto-allowed from codex's
session cache).
