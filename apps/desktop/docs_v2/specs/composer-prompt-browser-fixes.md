# Spec: Composer / prompt / browser-takeover fixes (round 2)

Six user-reported fixes. Branch `fixes`.

## 1. Send with only a block (no text) while running
- **Gap:** the composer Stop/Send button checks only `draft.trim()` — while a turn
  runs, a chips/attachments-only follow-up shows **Stop** (interrupt), so you must
  type a character to get **Send**. (`submitComposer` already accepts chips/attachment-
  only sends.)
- **Fix:** the Stop-vs-Send decision uses `hasComposerContent` = draft OR attachments
  OR contextChips. Stop shows only when running AND there is nothing to send.

## 2. Answering a prompt wipes the composer draft
- **Gap:** `selectAgentChatChoiceSurfaceRow` (prompt choice click) and `answerPromptText`
  (prompt card "Other"/Skip) both hard-set `composer.draft = ""`. The prompt answer
  comes from the choice / the card's own field — clearing the unrelated composer draft
  loses what the user was typing.
- **Fix:** preserve `composer.draft` in both paths (only clear `promptState`).

## 3. Streaming reasoning prevents scrolling up
- **Gap:** the transcript auto-scroll re-pins to the bottom on every `blocks` change
  unless the user is >80px from the bottom; a fast (even collapsed) stream snaps them
  back, so they cannot scroll up to read.
- **Fix:** detach on any user upward scroll and re-attach only when the user returns to
  the very bottom; ignore the auto-scroll's own (programmatic) scroll events so they
  never re-arm stickiness.

## 4. User browser takeover should not break the agent
- **Decision (user):** prefer the agent not re-seize control; after takeover the turn
  should "just keep running normally" and a user state change (scroll, etc.) must not
  break it.
- **Fix:** `release_agent_browser_control` marks the pane `userControlled`. While set,
  `tide_act_browser` returns a clear, soft refusal ("the user took manual control —
  observe and continue, don't drive") instead of performing the action or erroring with
  a cryptic stale-reference; `tide_observe_browser` still works so the agent sees the
  current (user-modified) state and continues its turn. Turn end clears the flag.

## 5. Enter flickers when a prompt card is showing
- **Gap:** plain Enter in the composer while a prompt is active calls `onSubmit` (a
  no-op that still churns), causing a flicker. (User: Enter not submitting is fine.)
- **Fix:** when `viewModel.prompt` is present, plain Enter in the composer is a clean
  no-op (preventDefault, no submit). The prompt card keeps its own keys (⌘↵, arrows,
  Other-field Enter).

## 6. Multi-select questions finalize on first submit
- **Gap:** AskUserQuestion `multiSelect` is dropped; the prompt card is single-select
  radios, so one pick finalizes.
- **Fix:** carry `multiSelect` (claude `surfaceAskUserQuestion` → `PromptStateDto` →
  `AgentChatPromptState` → view). When multiSelect, the card renders toggle checkboxes;
  Submit sends the selected option labels joined by ", " via the free-text answer path
  (claude records the joined labels as that question's answer). Single-select unchanged.

## Tests
- composer hasContent Stop/Send; prompt answer preserves draft (both paths);
  multiSelect carried through + card join; takeover sets userControlled + act refused +
  observe works + turn-end clears. Scroll + Enter-flicker verified live (DOM effects).
