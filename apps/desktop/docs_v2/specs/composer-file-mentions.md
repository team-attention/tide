# Spec: Composer File Mentions

## Scope

Add `@` file mention suggestions to the Composer. When the user types an `@`
trigger token in the Start Composer or Follow-up Composer, Tide lists files from
the current Execution Context and lets the user insert a provider-native
`@relative/path` mention into the draft.

## Evidence

- `docs_v2/master-plan.md` defines Composer context attachment as part of the
  core flow.
- `docs_v2/glossary.md` says the Composer is the active input surface and
  Follow-up Composer inherits the active Thread's Project and execution context.
- `src/desktop/application/domains/agent-chat/state/composer.ts` already detects
  `/`, `$`, `@`, and `!` trigger tokens.
- `src/shared/contracts/commands.ts` already exposes `workspace.readFileTree`,
  and `workspace.fileTreeLoaded` already carries `WorkbenchFileTreeDto`.

## Decisions

- `@` uses the existing transient Composer suggestion surface rather than a new
  permanent chip.
- Selecting a file inserts `@relative/path ` at the active trigger token.
- The file list is read from the active Thread scope, or the Start Composer
  project scope when no Thread is selected.
- File mentions reuse `workspace.readFileTree`; no new Backend command is
  introduced for this slice.

## Out Of Scope

- Reading file contents into Composer context chips.
- Directory mentions.
- Cursor-position-aware insertion beyond the existing active end-token behavior.
- Provider-specific escaping rules for paths with whitespace.

## Domain Model

- `AgentChatFileMentionOption`: one file candidate with `relativePath`, `name`,
  and optional root/cwd metadata.
- `ProductShellComposerFileMentions`: renderer cache of the most recently loaded
  file tree for Composer `@` suggestions.

## Contracts

No Shared Contract changes. Desktop sends `workspace.readFileTree` with a
bounded full-tree request and consumes `workspace.fileTreeLoaded`.

## Flow

1. User types an active `@` token in the Composer.
2. Desktop opens the existing `command_suggestions` popover.
3. Product Shell requests a bounded file tree for the active cwd if the Composer
   file mention cache is missing or for a different root.
4. `workspace.fileTreeLoaded` updates the Composer file mention cache only when
   the response cwd still matches the active Execution Context cwd.
5. The popover filters file rows by basename or relative path.
6. User selects a file row.
7. AgentChat replaces the active `@` token with `@relative/path ` and closes the
   popover.

## Invariants

- `@` suggestions never invent files; rows come from a Backend file tree payload.
- Empty or unavailable cwd shows an empty state row.
- Folder rows are excluded from Composer file mentions.
- Selecting a file mention preserves any text before the active trigger token.
- Stale file tree responses for a previous Project or Thread cwd are ignored;
  they must not replace the active Composer file mention cache.

## Tests

- AgentChat: `@` renders file rows, filters by query, and selection splices the
  mention in place.
- ProductShell: `workspace.fileTreeLoaded` updates Composer mention candidates
  without requiring the FileTree column to be open.
- ProductShell: a stale `workspace.fileTreeLoaded` response for a previous cwd
  does not replace the active Composer file mention candidates.

## Implementation Notes

- Keep the trigger detection in `composer.ts`.
- Keep row derivation in `choice-surfaces.ts` so the view model remains the only
  source for Composer surface rows.
- Keep backend IO in the Product Shell renderer effect and use existing command
  dispatch.
