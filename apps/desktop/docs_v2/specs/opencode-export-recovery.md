# Spec: opencode Export Recovery

## Scope

Make persisted and adopted opencode Threads reopen reliably when an unsanitized
`opencode export <session-id>` is larger than the provider CLI can flush through
a captured stdout pipe.

This slice covers the Backend-owned export subprocess boundary and the
Agent Session Cache fallback used by Thread hydrate. It does not change the
Desktop renderer or the opencode resume transport.

## Evidence

- Raw Agent Session history remains provider-owned and is the preferred source
  for rebuilding Agent Session Blocks.
- Agent Session Cache is Tide-owned derived state intended to make old Threads
  reopen quickly and survive temporary provider-history unavailability.
- opencode 1.18.2 loads the session, serializes the complete export, then calls
  `process.stdout.write(...)` without waiting for stdout backpressure to drain.
- For the affected browser-heavy local session, captured pipe stdout ends at
  exactly 65,536 bytes inside a browser-image base64 string even though the
  process exits with status 0. Directing stdout to a regular file produces a
  valid 567,183-byte JSON export with 21 messages.
- `--sanitize` produces parseable output but redacts user text, reasoning, tool
  input/output, and file data, so it cannot rebuild the visible conversation.
- The affected Tide Thread already has 61 persisted Agent Session Blocks, but
  the current hydrate path treats its single failed import diagnostic block as
  a successful non-empty provider rebuild and never reads that cache.

## Decisions

1. Keep unsanitized `opencode export` as the provider-owned history boundary.
   Do not use sanitized output as visible conversation history.
2. Capture opencode export stdout in a private temporary regular file. This
   avoids the provider CLI's pipe-flush loss while preserving the public CLI
   boundary and full provider-native values.
3. Create the temporary directory with the operating system temp allocator,
   create the stdout file exclusively with mode `0600`, and remove both in a
   `finally` path.
4. Preserve the existing 8-second command timeout and accept at most 8 MiB of
   completed export output. Oversized, missing, non-zero, timed-out, or unreadable
   results are export failures.
5. A provider-history diagnostic is not successful history. When a persisted
   Agent Session Cache exists, hydrate returns the cached conversation followed
   by the diagnostic. With no cache, the diagnostic remains the visible failure.
6. A valid provider export still replaces derived cache content for the opened
   Thread. Provider history remains the source of truth.

## Out Of Scope

- Patching or distributing a modified opencode executable.
- Reading opencode's private SQLite schema.
- Persisting a second raw export copy in Tide storage.
- Changing opencode ACP resume or live runtime behavior.
- Changing the visual design of runtime diagnostic blocks.

## Domain Model

No application-domain type changes are required.

Node infrastructure gains one provider-specific command function:

```ts
runOpencodeExport(sessionId: string): string | undefined
```

The function returns complete export text only after a successful bounded
subprocess and file read. Every failure returns `undefined`.

Thread reopen also distinguishes usable provider blocks from a failed import
diagnostic before choosing whether to hydrate the Agent Session Cache.

## Contracts

No Shared Contract changes are required. `thread.hydrated` continues carrying
the existing ordered `AgentSessionBlock[]` DTOs.

## Flow

1. Backend opens a persisted or newly adopted opencode Thread.
2. Backend resolves the opencode executable and creates a private temporary
   export destination.
3. Backend launches `opencode export <session-id>` with stdout attached directly
   to that regular file and stderr captured for process status only.
4. On successful exit, Backend rejects a missing or greater-than-8-MiB file,
   otherwise reads the complete UTF-8 JSON text.
5. Backend closes file handles and removes temporary artifacts on every path.
6. The opencode conversation rebuilder parses the complete export and emits
   Agent Session Blocks.
7. If export or parse still fails for a persisted Thread, Backend hydrates the
   Tide Agent Session Cache. A non-empty cache is returned with the diagnostic
   appended; otherwise the diagnostic is returned alone.
8. A newly adopted Thread with no cache still receives the diagnostic instead
   of disappearing or aborting the discovery pass.

## Invariants

- Tide never writes to opencode provider history.
- Unsanitized text, reasoning, and tool evidence are preserved on successful
  export.
- Temporary export files are private and removed on success and failure.
- Export timeout and accepted output size remain bounded.
- Provider-history failure never hides an existing non-empty Agent Session Cache.
- A valid provider export remains preferred over derived cache content.
- One failed session export does not abort other local-session discovery.

## Tests

- File-backed capture preserves a synthetic stdout payload larger than 64 KiB
  from a child that exits immediately after writing.
- File-backed capture rejects non-zero exits and output larger than 8 MiB.
- File-backed capture removes its temporary directory after success and failure.
- opencode export parsing still preserves text, reasoning, tool, and raw parts.
- Reopen reconciliation chooses valid provider blocks over cached blocks.
- Reopen reconciliation chooses cached blocks plus the diagnostic when provider
  rebuild returns only a failed import diagnostic.
- Reopen reconciliation keeps the diagnostic when no cache exists.
- A real local smoke against the affected session produces parseable JSON larger
  than 65,536 bytes and rebuilds its conversation blocks.

## Implementation Notes

- Keep the file-backed capture beside provider history infrastructure; it is a
  workaround for an observed opencode CLI output behavior, not a new generic
  Agent Runtime transport.
- Both adopted-session discovery and persisted Thread reopen must call the same
  export function so their behavior cannot drift.
- The temporary file may grow beyond the accepted 8 MiB until the bounded child
  exits; the 8-second timeout limits that exposure. If real exports regularly
  exceed the accepted bound, replace the synchronous command boundary with a
  dedicated streaming worker rather than silently truncating data.
