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
- D2: Normalize to `PromptState` (kind `approval` for "Allow …?", `choice` otherwise).
  `choices[i].providerValue` encodes how to answer as a codex-menu navigation token
  `codex-menu:<steps>`, where `steps = optionPosition − defaultIndex` (signed: down is
  positive). `defaultChoiceId` is the option codex has the cursor on. The
  parse→`PromptState` mapping lives in the codex Agent Integration's
  `detectPromptState` (`source: "pty_transcript"` branch), NOT in infrastructure —
  provider-specific detection stays in the adapter (runtime-spine invariant #1).
- D3: Answer routing drives the live PTY. The runtime port decodes the
  `codex-menu:<steps>` token: from the default cursor row it sends |steps| ArrowDown
  (steps>0) or ArrowUp (steps<0) key events, each followed by a short delay (the codex
  TUI needs a beat between key events, same as the hook-trust auto-answer), then Enter.
  Cancel is just the "Cancel" option — navigate to it + Enter, uniform with every
  other option. Non-codex / non-token `prompt_answer` values keep the existing typed
  `<value>\r` path unchanged.
- D4: Idempotent lifecycle, owned by the live-backend projector (generic plumbing, not
  provider detection): a bounded per-runtime rolling PTY buffer accumulates chunks so a
  box split across writes still parses. While a codex pty prompt is already pending,
  codex's box redraws are no-ops (don't re-surface). When the prompt is answered (the
  thread's `promptState` clears) the projector drops the rolling buffer so the now-stale
  box text can't re-surface; a genuinely repeated approval re-renders a fresh box and
  surfaces again.

## Domain Model

- `parseCodexApprovalPrompt(raw): CodexApprovalPrompt | null` — pure parser:
  `{ question, options: { index, label, detail? }[], defaultIndex }`.
- `encodeCodexMenuNavigation(steps): string` / `decodeCodexMenuNavigation(value):
  CodexMenuNavigation | null` — pure inverse pair for the `codex-menu:<steps>` token.
  Decode returns null for any non-token value (the generic typed-answer fallthrough).

## Flow

1. PTY output → live-backend projector appends to the runtime's rolling buffer →
   `integrations.codex.detectPromptState({ source: "pty_transcript", text: buffer })`.
2. Non-null → `emitPromptState` records it as the thread's prompt (same path hooks use)
   → v2 renders the approval card with the codex options as choices.
3. User selects an option → `prompt.answer` (providerValue = `codex-menu:<steps>`) →
   runtime port writes the navigation keys to the PTY → codex proceeds. Turn continues,
   and the projector drops the buffer so the consumed box can't re-surface.

## Invariants

- A turn never hangs on an unsurfaced prompt: any parsed TUI prompt becomes a
  `PromptState`.
- Answering routes exactly one selection; the surfaced prompt clears.
- Non-Tide tools are NOT auto-approved — they reach the user as a prompt.

## Tests

- `parseCodexApprovalPrompt` extracts the question + ordered options + default from a
  real ANSI-laden codex approval frame; returns null for non-prompt output. (done)
- `stripTerminalSequences` already covered. (done)
- `encodeCodexMenuNavigation`/`decodeCodexMenuNavigation` round-trip; decode returns
  null for non-token values.
- codex `detectPromptState({ source: "pty_transcript", text })` maps the ANSI box to a
  `PromptState` (kind `approval`, choices with `codex-menu:<steps>` providerValues,
  `defaultChoiceId` = the cursor option); returns null for ordinary output.
- runtime port `writeInput` `prompt_answer`: a `codex-menu:2` value on codex emits
  `["\x1b[B","\x1b[B","\r"]`; `codex-menu:-1` emits `["\x1b[A","\r"]`; `codex-menu:0`
  emits `["\r"]`; a non-token value keeps the existing `<value>\r` path.

## Implementation Notes

- Parser slice first (done): `provider-tui-parsers.ts` + tests. Pure, no wiring.
- Slice 2–3: codex integration `detectPromptState` gains a `pty_transcript` branch that
  calls `parseCodexApprovalPrompt` + builds the `PromptState` with nav-token choices.
- Slice 4: runtime port `writeInput` decodes the codex-menu token and emits the keyed
  navigation with inter-key delays; generic typed-answer path unchanged.
- Slice 5: live-backend projector buffers codex PTY per runtime, surfaces once, drops
  the buffer when the prompt clears. Detection stays in the adapter; the projector only
  feeds text in and emits the result.
