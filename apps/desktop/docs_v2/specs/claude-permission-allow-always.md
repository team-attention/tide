# Spec: Claude permission "Allow always" via CLI permission_suggestions

## Scope

Claude permission cards currently offer only **Allow** / **Deny**. Every non-edit
tool call (notably every side-effecting Bash command, WebFetch, etc.) therefore
re-prompts on every turn, even in `acceptEdits` mode — and the same approved command
(`npm test`, …) is re-asked forever because Tide never persists a decision.

This slice adds a third choice — **Allow always** — to Claude permission cards, driven
by the persistent allow-rule the Claude CLI *already* sends with each `can_use_tool`
request (`permission_suggestions`, the `addRules` variant). When the user picks it, Tide
echoes those rules back as `updatedPermissions` on the allow `control_response`. The CLI
then applies and persists the rule itself (its own permission store /
`settings.local.json`), so subsequent matching calls auto-allow with no prompt.

**Tide owns no permission-rule store.** It only (a) reads the suggestion, (b) renders it
as a labeled choice, (c) echoes the chosen rules back. Persistence/matching/scope are the
CLI's.

Scope is **claude only**, and within claude, **`addRules` suggestions only** (see D2/D-Defer).
codex/gemini/opencode are untouched (ACP already surfaces its own `allow_always` natively).

## Evidence

`can_use_tool` control_requests captured from `claude 2.1.186` via Tide's exact spawn
(`--print --input-format stream-json --output-format stream-json --verbose
--include-partial-messages --permission-prompt-tool stdio
--allow-dangerously-skip-permissions`), one forced tool call per run. The suggestion
shape and `destination` are **tool-dependent**:

| Forced tool | `permission_suggestions` | destination |
|---|---|---|
| `Bash(npm test)` | `[{type:"addRules", rules:[{toolName:"Bash", ruleContent:"npm test *"}], behavior:"allow"}]` | `localSettings` |
| `WebFetch(example.com)` | `[{type:"addRules", rules:[{toolName:"WebFetch", ruleContent:"domain:example.com"}], behavior:"allow"}]` | `localSettings` |
| `Bash(git status)` / `Bash(echo …)` | *(no prompt — CLI auto-allows safe commands)* | — |
| `Write(/tmp/x.txt)` | `[{type:"setMode", mode:"acceptEdits"}, {type:"addDirectories", directories:["/tmp","/private/tmp"]}]` | `session` |
| `Write(./in-repo.txt)` | `[{type:"setMode", mode:"acceptEdits"}]` | `session` |

Three facts this establishes:

1. **No mixed destinations within a request.** Every entry in a given request shares one
   `destination`. The earlier worry ("one Allow always applies rules across different
   scopes") does not occur — a request's suggestions are a single coherent set at one scope.
2. **Suggestion *semantics* split by tool**, and that split matters:
   - **`addRules`** (Bash, WebFetch, most non-edit tools) → a persistent allow-rule at
     `localSettings` (this project). This is the literal "always allow this command/domain"
     case and the source of the user's pain (the same Bash command re-prompting forever).
   - **`setMode acceptEdits` (+ `addDirectories`)** (Write/Edit) → a **session-scoped
     permission-MODE change**, not a per-file rule. "Don't ask again" here means "accept all
     edits for this session," equivalent to flipping Tide's own permission-mode dropdown.
3. **The user's actual pain is entirely `addRules`.** The complaint is "too many prompts
   *even in acceptEdits*"; in acceptEdits, Write/Edit are already auto-allowed (no prompt),
   so the `setMode` suggestion never appears there. What still prompts in acceptEdits is
   exactly the `addRules` tools (Bash/WebFetch/…).

Wire/SDK facts (from the `claude 2.1.186` bundle Zod schemas):
- The allow `control_response` accepts optional `updatedPermissions: PermissionUpdate[]`
  (`{ behavior:"allow", updatedInput?, updatedPermissions? }`). On receipt the CLI applies
  (`setToolPermissionContext`) **and persists** at each entry's `destination`.
- `permission_suggestions` is snake_case on the wire but its **contents are camelCase**
  (`toolName`, `ruleContent`, `type:"addRules"`, `behavior`, `destination`) — exactly the
  `PermissionUpdate` shape `updatedPermissions` expects back. ⇒ echo entries **verbatim**.

Current code:
- `claude-stream-json-client.ts:684` pending = `{ requestId, toolInput }`;
  `permission_suggestions` parsed nowhere (only the protocol comment `:14-15`).
- `:700-703` choices hardcoded `Allow`/`Deny`.
- `:240-248` allow path sends `{ behavior:"allow", updatedInput }` — no `updatedPermissions`.
- `PromptChoiceKindDto` already includes `"allow_always"` (`shared/contracts/prompt.ts:14-18`);
  `prompt-card.tsx` already styles `data-kind="allow_always"`. ⇒ **no contract change**;
  the new choice rides the existing `kind` path (same as ACP gemini/opencode).

Deferred originally in `prompt-full-fidelity-fields.md` Out-Of-Scope; this spec closes the
`addRules` half.

## Decisions

- **D1 — Echo the CLI's rules verbatim.** Tide does not construct, re-scope, or
  re-serialize rules. The `destination` the CLI chose (e.g. `localSettings`) is honored
  as-is. (User-confirmed: "cli가 정해서 주는거 그대로 따라가자".)
- **D2 — Show the Allow-always choice only when the suggestion set is *purely* `addRules`.**
  If every entry has `type:"addRules"`, render one **Allow always** choice and echo the whole
  array. If `permission_suggestions` is empty/absent, **or contains any non-`addRules` entry**
  (`setMode`/`addDirectories`/…), show only today's Allow/Deny (see D-Defer). This makes the
  choice mean exactly one thing — "persist these allow rules" — never a hidden mode change.
- **D-Defer — `setMode`/`addDirectories` suggestions are out of this slice.** They are a
  session-scoped permission-MODE change that overlaps Tide's existing permission dropdown and
  would desync Tide's `launchOptions.permission` mirror if applied behind its back. They also
  never surface in the user's pain path (acceptEdits already auto-allows edits). Revisit as a
  separate slice that routes mode changes through Tide's own mode state if wanted.
- **D3 — Choice order: Allow / Allow always / Deny.** `defaultChoiceId` stays `"allow"`
  (allow-once). `kind:"allow_always"` on the new choice; `allow`/`deny` keep `kind` undefined.
- **D4 — Distinct token.** `STRUCTURED_ALLOW_ALWAYS_TOKEN = "structured:allow_always"` as the
  choice `providerValue`; `write()` branches on it to attach `updatedPermissions`. Plain
  `STRUCTURED_ALLOW_TOKEN` keeps today's exact behavior (allow once, no rule).
- **D5 — Honest label from the rules + scope.** Label = `Always allow ${ruleList}${scope}`,
  where each rule formats as the CLI does — `ruleContent ? \`${toolName}(${ruleContent})\` :
  toolName` (e.g. `Bash(npm test *)`, `WebFetch(domain:example.com)`); multiple rules → first
  `+ (+N more)`; scope suffix from `destination`: `localSettings`/`projectSettings` →
  `" · this project"`, `userSettings` → `" · all projects"`, `session` →
  `" · this session"` (session won't occur under D2 for addRules, but mapped for safety).
- **D6 — AskUserQuestion unaffected** (separate pending path; always-choice built only on the
  generic permission path).

## Out Of Scope

- codex / gemini / opencode (ACP native).
- **`setMode` / `addDirectories` suggestions** (session permission-mode change) — D-Defer.
- A Tide-side permission-rule store / editor / settings UI — persistence is the CLI's.
- Choosing `destination` scope in the card — honor what the CLI suggests (D1); surface it as a
  read-only scope hint only (D5).
- Keeping Tide's permission-mode indicator in sync after a CLI-side mode change (only relevant
  once D-Defer is taken up).
- Reducing prompt *breadth* (auto-allowing more under acceptEdits) — a permission-mode concern.

## Domain Model

`PendingPermission` (`claude-ask-user-question.ts:19`) gains:

```ts
// The addRules PermissionUpdate[] from the can_use_tool request, kept verbatim to echo as
// `updatedPermissions` when the user picks Allow always. Set only when the suggestion set is
// purely addRules (D2); undefined otherwise ⇒ no Allow-always choice.
permissionRuleUpdates?: unknown[];
```

No new domain entity. Entries are opaque pass-through `PermissionUpdate` objects, validated
only as "every entry is `{type:"addRules"}`".

## Contracts

**No change.** `PromptChoiceDto.kind` already accepts `"allow_always"`; `PromptStateDto`
already carries `choices`. The new choice flows through the existing PromptState → DTO →
renderer path unchanged. `STRUCTURED_ALLOW_ALWAYS_TOKEN` is a backend-internal provider
token (sibling of the existing tokens in `claude-stream-json-shared.ts`), a `providerValue`
string — not a contract type.

## Flow

1. **Ingress** (`handleControlRequest`, `:656`): on `can_use_tool`, read
   `request.permission_suggestions`. Compute `addRulesOnly = Array.isArray(s) && s.length>0 &&
   s.every(e => isRecord(e) && e.type === "addRules")`. If `addRulesOnly`: store the array on
   `pending.permissionRuleUpdates` and append a choice
   `{ choiceId:"allow_always", label: buildAllowAlwaysLabel(s),
   providerValue: STRUCTURED_ALLOW_ALWAYS_TOKEN, kind:"allow_always" }`. Else: today's two
   choices unchanged. `defaultChoiceId` stays `"allow"`.
2. **Render**: Allow / Allow always / Deny; always-button gets `data-kind="allow_always"`.
3. **Answer** (`write`, `:187`):
   - `=== STRUCTURED_ALLOW_ALWAYS_TOKEN` → `{ behavior:"allow", updatedInput: pending.toolInput,
     updatedPermissions: pending.permissionRuleUpdates }`.
   - `=== STRUCTURED_ALLOW_TOKEN` → unchanged (`{ behavior:"allow", updatedInput }`).
   - else → unchanged deny.
4. **CLI persists**: claude applies the rules, writes them at the suggested `destination`
   (e.g. `.claude/settings.local.json`). Next matching call is auto-allowed CLI-side → no
   `can_use_tool` → no card.

## Invariants

- I1 — The Allow-always choice appears **iff** `permission_suggestions` is non-empty **and
  every entry is `addRules`**. A set containing any `setMode`/`addDirectories` → no
  always-choice (D-Defer).
- I2 — `updatedPermissions` is sent **only** for the allow-always token and equals the stored
  `addRules` array **byte-for-byte** (no transform). Plain-allow and deny payloads are
  unchanged from today.
- I3 — Default selection and allow-once / deny semantics unchanged; anything that is not an
  explicit allow / allow-always token still denies (`claude-parallel-permission-wedge.md`).
- I4 — AskUserQuestion and all non-claude providers are byte-identical to before.

## Tests

Backend (`tests/`, fake transport, no real CLI):

- **T1 ingress addRules → 3 choices**: request with a pure-`addRules` `permission_suggestions`
  → 3 choices; middle has `kind:"allow_always"`,
  `providerValue:"structured:allow_always"`, label `Always allow Bash(npm test *) · this project`;
  `defaultChoiceId==="allow"`; `detail`/`message` unchanged.
- **T2 ingress none → 2 choices**: no/empty suggestions → existing 2 choices only.
- **T3 ingress setMode → 2 choices (defer guard)**: suggestions `[{type:"setMode",…}]` (or
  setMode+addDirectories) → **no** allow_always choice; exactly Allow/Deny.
- **T4 answer allow-always**: answer `structured:allow_always` → `control_response`
  `response.response` deep-equals `{ behavior:"allow", updatedInput:<input>,
  updatedPermissions:<the exact addRules array> }`.
- **T5 answer allow-once unchanged**: answer `structured:allow` → response has **no**
  `updatedPermissions` key (regression guard for I2).
- **T6 answer deny unchanged**: deny path byte-identical to today.
- **T7 label builder unit**: `buildAllowAlwaysLabel` — single rule, multi-rule `(+N more)`,
  WebFetch `domain:` rule, and each `destination` → scope-suffix mapping.

Renderer: covered structurally by the existing ACP `allow_always` rendering; add a light
claude-path assertion only if it exercises a branch ACP doesn't.

## Implementation Notes

- `STRUCTURED_ALLOW_ALWAYS_TOKEN = "structured:allow_always"` in
  `claude-stream-json-shared.ts` (beside the existing tokens).
- `permissionRuleUpdates?: unknown[]` on `PendingPermission` (`claude-ask-user-question.ts:19`).
- `handleControlRequest` (`:684, 700-703`): compute `addRulesOnly`, store + build the choice.
  Extract a pure `buildAllowAlwaysLabel(suggestions): string` helper (D5) for isolated,
  testable formatting; `isAddRulesOnly(suggestions): updates | undefined` keeps the filter
  in one place.
- `write()` allow branch (`:240-248`): allow-always check **before** the generic allow; echo
  `pending.permissionRuleUpdates` verbatim.
- Validation is intentionally minimal beyond the `addRules`-only gate — entries pass through
  opaquely; the CLI is the schema authority, and re-shaping risks dropping a field it needs
  back.

### Module quality

- `claude-stream-json-client.ts`: responsibility (claude stream-json control protocol I/O)
  unchanged — one ingress field + one egress branch on the same protocol.
- `claude-ask-user-question.ts`: `PendingPermission` is the shared pending-state shape for the
  claude permission path; an optional field stays within that responsibility.
- `buildAllowAlwaysLabel` / `isAddRulesOnly`: pure helpers beside the client (or in
  `claude-stream-json-shared.ts` if reused); adapter implementation, not contract.

## Verification scenario (live, manual)

Run a thread in `acceptEdits` → ask Claude to run `npm test` → card shows
**"Allow always `Bash(npm test *)` · this project"** → click it → command runs **and**
`.claude/settings.local.json` gains the rule → ask Claude to run `npm test` again →
**no card**, runs straight through. Separately confirm a `Write` prompt (in `default` mode)
shows only Allow/Deny (no Allow-always), per D-Defer.

## Residual risk / open questions

- **R1 (resolved by D2)**: mixed-destination / mixed-semantic suggestions can't be applied by
  one ambiguous button — we only ever show Allow-always for pure `addRules` sets at a single
  scope, labeled with the exact rule + scope.
- **R2 (deferred, D-Defer)**: the "accept edits this session" (`setMode`) path is left to the
  existing permission-mode dropdown. If we later surface it via the card, it must drive Tide's
  own `launchOptions.permission` so the indicator stays in sync (no behind-the-back CLI mode
  change).
- **R3 (live-verify)**: that a freshly-persisted rule suppresses the *next* call within the
  same session (bundle shows immediate `setToolPermissionContext`, expected yes) and that the
  `allow_always` styling reads well on claude permission cards (same component as ACP).
