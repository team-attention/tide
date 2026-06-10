# Spec: Agent Prompt Pipeline — the COMPLETE lifecycle of "the provider asks the user"

Supersedes the prompt-surfacing parts of `agent-prompt-surfacing.md` and the
prompt notes in `provider-history-connector.md`. This is the one document that
covers every case; any prompt change must be checked against the case matrix
below before shipping.

## Why this spec exists

The prompt pipeline was the last churn source after the provider-abstraction
cutover: a week of live failures (double cards, fused text, second box never
surfacing, batched permissions hanging, stale cards after restart) were all
partial symptoms of ONE structural mismatch — **a turn can raise N interactions,
from 2 sources, with no stable identity, and Tide forced them through a 1-slot
UI answered by blind keystrokes.** Each patch fixed one interleaving; this spec
fixes the model.

## The model

An **interaction** is one thing the provider is waiting on the user for (a tool
permission, a question with options, an elicitation). Its lifecycle:

```
raised (provider) ──► detected (adapter) ──► visible card (1 at a time)
                                   │                │
                                   ▼                ▼
                              queued (FIFO)    answered → keystrokes to PTY
                                   ▲                │
                                   └── promoted ◄───┘
                       (runtime death / stop ⇒ ALL dropped)
```

### Invariants

1. **Identity** — every interaction has a unique, stable `promptId`.
   - claude permission: per-call (call_id when present, else the message — which
     embeds the call's distinguishing target: command/url/query/path, so two
     batched WebFetch calls on different URLs NEVER collide).
   - scraped boxes (codex approvals, claude questions): content signature of the
     LAST box in the buffer.
   - Re-delivery of the same id (spool re-poll, box repaint) is idempotent.
2. **One owner per (provider, interaction kind)** — an interaction is detected by
   exactly one source; the other source must return null for it:

   | provider | tool permission | question/choice menu | free-text elicitation |
   |---|---|---|---|
   | claude | PermissionRequest hook | PTY scrape | Elicitation hook |
   | codex  | PTY scrape (boxes fire no hook) | PTY scrape | — |
   | gemini | Notification(ToolPermission) hook | — (no menu boxes observed) | — |

   Empirical basis (live-verified, do not re-litigate without new evidence):
   claude hooks fire once per call SEQUENTIALLY (count is exact, no parsing
   fragility); claude's box scrape was demoted because the answered box stays
   painted for a few frames and re-scrapes, and a buffer can hold 2 boxes.
3. **FIFO queue, one visible card** — the service holds `promptState` (visible)
   plus `promptQueue` (pending). A new interaction while one is visible QUEUES;
   it never clobbers the card. Answering writes the keystrokes and promotes the
   next. This matches the provider TUI itself, which presents its boxes
   sequentially in request order — so the visible card always corresponds to the
   box currently on screen (the alignment that makes keystroke answers safe).
4. **Prompts die with the runtime.** Never persisted. Stop clears card + queue.
   An explicit thread open (`thread.hydrate` with `reconcileStaleRuntime`)
   reconciles a dead-runtime waiting state to idle and drops card + queue.
   Internal poll reads NEVER mutate (a poll-side reconcile race-killed a live
   turn once; see commit 0b806203).
5. **A prompt is an ephemeral card, not a conversation block.** The hook frame is
   recorded as a non-rendering `provider_signal` for the audit trail; nothing
   `*_prompt`-shaped enters the block stream.
6. **Answer routing is provider-native**: menu-navigation tokens
   (`codex-menu:<steps>`) replayed as arrows+Enter, `pty-key:esc` as Esc, free
   text typed + submit key. The card's choices carry these; the runtime port is
   provider-neutral.
7. **Scrape hygiene** (for scrape-owned kinds): cursor-paint idioms are
   normalized (CUP/cursor-down → newline, CHA/cursor-forward → space) so words
   never fuse; the parser reads only the LAST box in the rolling buffer; an
   ANSWERED box's signature never re-surfaces in the same runtime.

### Case matrix (each row has a regression test or live harness)

| case | covered by |
|---|---|
| single permission, allow | unit + perm-flow harness + real-app E2E |
| single permission, deny | perm-flow `--deny` |
| sequential permissions (search → fetch) | v2-claude-second-permission + research E2E |
| BATCHED same-tool permissions (2×WebFetch, same instant) | unit (queue) + research E2E live |
| same prompt re-delivered (spool re-poll) | unit (idempotent) |
| question menu (AskUserQuestion) | live question flow (TIDE_MESSAGE) |
| answered box repainted before dismissal | answeredSignatures (live-captured) |
| two boxes in one PTY buffer | parser last-box regression test |
| prompt while user is on ANOTHER thread | hydrate carries prompt (E2E switch check) |
| app restart with waiting thread | reconcile-on-open unit test |
| Stop pressed with card + queue pending | unit (stop clears both) |
| runtime dies mid-wait | reconcile-on-open unit test |
| gemini permission (Notification hook) | gemini perm-flow + real-app E2E |
| codex approval box | codex perm-flow + real-app E2E |

## Known accepted edges

- Deny (Esc) on box 1 of a batch may cause the provider to cancel the remaining
  batched calls; queued cards for them become stale. Answering a stale card
  types into a box-less TUI — harmless — and the turn settles via the provider's
  turn-end signal. Not worth pre-empting until observed live.
- A provider that renders batched boxes OUT of request order would desync the
  card↔box alignment. Not observed in claude/codex/gemini; if ever observed,
  the fix is answer-by-content (type the option label) rather than navigation.
