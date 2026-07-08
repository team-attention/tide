# Spec: Agent Chat Composer Render Isolation

## Scope

Keep Composer typing responsive in long Threads by preventing draft-only edits from
invalidating the Agent Session transcript.

This slice is narrower than Product Shell render isolation. Product Shell columns
already subscribe to area selectors; this spec closes the lower Agent Chat gap where
a change to `agentChat.composer.draft` can rebuild the visible block view array and
force transcript memoization to miss.

## Evidence

- Composer input is controlled by `viewModel.composer.draft` and calls
  `onDraftChange` for each textarea change.
- `updateComposerDraft` returns a new Agent Chat state object for every keystroke.
- `createAgentChatShellViewModel` derives `visibleBlocks` and maps every block to an
  `AgentChatBlockView`.
- `AgentChatShell` memoizes the transcript element by `viewModel.blocks`; a fresh
  block-view array makes that memo miss even when no transcript block changed.
- Older Threads are most affected because the transcript can contain many cached
  blocks. The viewport showing only a small portion does not help if the React/DOM
  transcript remains fully mounted.
- Browser/WebView panes may add GPU/compositor load, but Product Shell selector
  isolation should keep Workbench panes from re-rendering on chat draft changes. They
  remain a performance risk to diagnose separately, not the primary typing path.

## Decisions

- Preserve the existing controlled Composer behavior and state ownership.
- Preserve the existing transcript DOM and rendering output.
- Make Agent Chat block derivation referentially stable when the source `blocks` array
  and active `threadId` are unchanged.
- Reuse per-block `AgentChatBlockView` objects for unchanged source block objects.
- Keep this as an internal Desktop view-model/rendering optimization; no Shared
  Contracts or Backend changes.

## Out Of Scope

- Transcript virtualization/windowing.
- Browser Runtime or WebView lifecycle changes.
- Persisted Agent Session cache compaction.
- Product Shell store/selector refactors.
- Changing Composer UX, command suggestions, or backend command behavior.

## Domain Model

- **Visible block list**: the active Thread's raw `AgentChatBlock[]`, filtered by the
  active `threadId` when a Thread is open.
- **Block-view list**: the `AgentChatBlockView[]` passed to the transcript renderer.
- **Draft-only update**: an Agent Chat state change where `composer.draft` changes but
  `blocks` and the active `threadId` do not.

## Contracts

No process-boundary contracts change.

Internal invariant:

- For a draft-only update, `createAgentChatShellViewModel(after).blocks ===
  createAgentChatShellViewModel(before).blocks`.

## Flow

1. User types in the Composer.
2. `updateComposerDraft` updates only the Composer draft/surface state.
3. `createAgentChatShellViewModel` reuses the previous visible block list because
   `state.blocks` and active `threadId` are unchanged.
4. The block-view list is reused by reference.
5. `AgentChatShell` re-renders the Composer, but its transcript `useMemo` sees the same
   `viewModel.blocks` reference and does not rebuild the transcript subtree.

## Invariants

1. Draft-only updates keep the block-view array reference stable.
2. Updating a source block produces a new block-view array and a new view for that
   changed block.
3. Unchanged source block objects may reuse their existing block views across a block
   array update.
4. Product Shell chat selectors may recompute the Agent Chat view-model on a draft
   change, but the nested `agentChat.blocks` view reference remains stable.

## Tests

- Domain test: a long existing Thread keeps `viewModel.blocks` reference-equal after
  `updateComposerDraft`.
- Domain test: changing one source block invalidates the block-view array and updates
  that block's rendered body while reusing unchanged block views.
- Product Shell selector test: `updateProductShellComposerDraft` may recompute the chat
  slice, but preserves the nested Agent Chat block-view reference.

## Implementation Notes

- Use a small single-slot memo for `visibleBlocksForState`, keyed by source `blocks`
  reference and active `threadId`.
- Use a small single-slot memo for the mapped `AgentChatBlockView[]`, keyed by the
  visible block list reference.
- Use a `WeakMap<AgentChatBlock, AgentChatBlockView>` for per-block view reuse.
- Keep the cache local to the Agent Chat view-model module; it is an implementation
  detail, not application state.
