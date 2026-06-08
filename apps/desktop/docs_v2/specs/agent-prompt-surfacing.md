# Spec: Agent Prompt Surfacing (approvals & questions)

## Scope

Every interactive prompt an agent CLI raises mid-turn — tool-use approval, shell
command / escalation approval, free-form questions, and choice menus — MUST surface
in the v2 UI and route the user's answer back to the agent. With the hidden PTY,
prompts that live only in the provider's TUI are currently invisible, so the turn
hangs "Working…" forever waiting for an answer no one can see.

Goal: behavior matches using the coding agent in a plain terminal — anything the
agent would stop and ask, Tide shows and answers.

In scope:
- Detect codex's TUI approval/question prompts (the boxed "Allow …?"/numbered-option
  menus) from the hidden-PTY transcript, since codex does not fire a hook for them.
- Build a normalized `PromptState` (message + choices + default) from the parsed TUI.
- Route the chosen answer back into the live PTY (navigate to the option + submit).

Out of scope (already handled / separate):
- Tide's own first-party MCP tools — pre-approved in provider config, never prompt
  ([[v2-agent-turn-handoff-readiness]] / agent-turn-handoff-readiness.md).
- claude/antigravity hook-delivered prompts (already flow through `detectPromptState`
  via `provider_hook` + the agent-needs-input hooks).
- TUI pickers (model/slash) — tui-scrape-native-menus.md.

## Evidence

- `codex-agent-integration.detectPromptState` only handles `provider_hook` +
  `eventName === "PermissionRequest"`. codex's MCP-tool and shell-command approval
  prompts are pure TUI menus (no hook), so they are never surfaced → turn hangs.
- Observed: codex hit a sandbox-network failure on `curl`, then "re-ran as an
  approval request"; that approval menu sat unanswered in the PTY for minutes.
- `PromptState` already supports `choices: PromptChoice[]` + `defaultChoiceId`, and
  `prompt.answer` routing exists. `provider-tui-parsers.ts` already strips ANSI and
  parses one TUI menu (`parseClaudeModelPicker`) — the same approach fits here.
- codex approval menu shape (ANSI-stripped):
  ```
  Allow the <server> MCP server to run tool "<tool>"?
  > 1. Allow                 Run the tool and continue.
    2. Allow for this session ...
    3. Always allow          ...
    4. Cancel                Cancel this tool call
  enter to submit | esc to cancel
  ```

## Decisions

- D1: Detect codex prompts by scraping the PTY transcript (no hook exists). Tolerant
  parser: strip ANSI, find the question line + the numbered options.
- D2: Normalize to `PromptState` (kind `approval` for "Allow …?", `choice`/`question`
  otherwise). `choices[i].providerValue` encodes how to answer (the option index).
- D3: Answer routing drives the live PTY: from the default cursor row, ArrowDown to
  the chosen index, then Enter. Cancel/Esc maps to option "Cancel" or Esc.
- D4: Idempotent: the same menu streams across chunks; surface it once per
  appearance (dedupe by parsed signature), and clear it when answered/gone.

## Domain Model

- `parseCodexApprovalPrompt(raw): CodexApprovalPrompt | null` — pure parser:
  `{ question, options: { index, label, detail? }[], defaultIndex }`.

## Flow

1. PTY output → codex integration inspects it (alongside existing scrape) →
   `parseCodexApprovalPrompt`.
2. Non-null → build `PromptState` → emit as the thread's prompt (same path hooks use)
   → v2 renders the approval/question card.
3. User answers → `prompt.answer` → runtime port writes the navigation keys to the
   PTY → codex proceeds. Turn continues.

## Invariants

- A turn never hangs on an unsurfaced prompt: any parsed TUI prompt becomes a
  `PromptState`.
- Answering routes exactly one selection; the surfaced prompt clears.
- Non-Tide tools are NOT auto-approved — they reach the user as a prompt.

## Tests

- `parseCodexApprovalPrompt` extracts the question + ordered options + default from a
  real ANSI-laden codex approval frame; returns null for non-prompt output.
- `stripTerminalSequences` already covered.
- (later) detection → PromptState mapping; prompt.answer → PTY key sequence.

## Implementation Notes

- Parser slice first (this slice): `provider-tui-parsers.ts` +
  `tests/provider-tui-parsers.test.ts`. Pure, no wiring.
- Next slices: wire detection into the codex integration's PTY-output path; map to
  `PromptState`; implement `prompt.answer` → PTY navigation in the runtime port;
  dedupe/clear lifecycle.
