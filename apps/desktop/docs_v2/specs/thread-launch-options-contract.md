# Spec: Thread Launch Options Contract

## Scope

This spec keeps the Start Composer's selected Launch Options attached to the Thread after it starts, hydrates, lists, and restores.

It covers:

- storing Thread Launch Options in Backend Thread state.
- carrying Launch Options through `ThreadSummaryDto`.
- preserving Launch Options in live Thread metadata persistence.
- rendering Follow-up Composer Model and Permission chips from the active Thread instead of stale Start Composer defaults.

It does not implement provider-native in-session model switching or final model catalog discovery.

## Evidence

- `docs_v2/glossary.md` defines Launch Options as provider-native settings applied when starting an Agent Runtime.
- `docs_v2/specs/composer-agent-runtime-source.md` says Model Source depends on Agent Runtime Source and that an existing Thread opens from the full Agent Binding.
- `docs_v2/specs/desktop-agent-chat-composer-shell.md` says the Follow-up Composer inherits the active Thread's Agent, Project, Worktree, and Branch, and the Agent is locked after start.
- `src/backend/application/services/thread-runtime-service.ts` currently receives `launchOptions` in `startThread`, passes them to Provider Readiness and Agent Runtime start, and preserves them only in `pendingInput` while Provider Readiness is blocked.
- `src/shared/contracts/thread.ts` currently exposes Agent Binding but no Launch Options on `ThreadSummaryDto`.
- `src/desktop/application/domains/agent-chat/agent-chat.ts` currently renders Composer `modelLabel` from Start Composer launch options, so a Follow-up Composer can show a Codex/GPT default for an Antigravity Thread.

## Decisions

### D1. Thread stores initial Launch Options

When Desktop starts a Thread, Backend stores a cloned copy of the initial Launch Options on the Thread.

### D2. Thread summary carries Launch Options

`ThreadSummaryDto.launchOptions` carries the stored Thread Launch Options across `thread.started`, `thread.hydrated`, and `thread.listed`.

### D3. Persistence preserves Launch Options

Live Thread metadata persistence stores and restores Thread Launch Options so a restarted app does not fall back to a different Agent's defaults.

### D4. Follow-up Composer reads active Thread Launch Options

When a Thread is active, Composer labels use the active Thread's Launch Options. If a legacy Thread has no Launch Options, the label falls back to the active Thread's Agent default, not to the Start Composer default.

## Out Of Scope

- In-session model switching.
- Provider model catalog fetching.
- Backfilling old persisted Threads with inferred Launch Options.

## Domain Model

Thread state gains optional Launch Options:

```ts
interface ThreadRecord {
  launchOptions?: Record<string, unknown>;
}
```

Shared Contracts expose the same field as a Contract DTO:

```ts
interface ThreadSummaryDto {
  launchOptions?: Record<string, unknown>;
}
```

## Flow

### UC-1: Start Provider CLI Thread

1. User selects Antigravity CLI and sends a Start Composer draft.
2. Desktop sends `thread.start` with Antigravity Agent Binding and Antigravity Launch Options.
3. Backend stores those Launch Options on the Thread.
4. `thread.started` or `thread.hydrated` carries those Launch Options back to Desktop.
5. Follow-up Composer shows Antigravity model and permission values.

### UC-2: Restore persisted Thread

1. Live Backend restores Thread metadata.
2. Restored Thread includes stored Launch Options.
3. `thread.listed` and later `thread.hydrated` expose the same Launch Options.
4. Follow-up Composer does not fall back to Codex/GPT defaults.

## Invariants

1. Agent Binding and Launch Options are both Thread-owned after the Thread starts.
2. Follow-up Composer never derives Model Chip or Permission Chip labels from an unrelated Start Composer default.
3. Legacy Threads without Launch Options fall back by active Agent, not by prior Start Composer state.
4. Persistence keeps Launch Options optional for backward compatibility.

## Tests

| Rule | Test expectation |
|------|------------------|
| Backend stores Launch Options | `starting_thread_preserves_launch_options_on_thread_snapshot` |
| Contract emits Launch Options | `thread_start_contract_events_preserve_thread_launch_options` |
| Persistence preserves Launch Options | `thread_summary_storage_record_preserves_launch_options` |
| Live restore preserves Launch Options | `live_backend_restores_persisted_thread_launch_options_before_thread_list` |
| Follow-up Composer uses active Thread | `follow_up_composer_model_label_uses_active_thread_launch_options` |
| Legacy fallback uses active Agent | `follow_up_composer_model_label_falls_back_to_active_agent_default` |

## Implementation Notes

- Keep Launch Options as provider-native JSON-compatible values.
- Do not normalize model names across Provider CLI Agents.
- Do not use Launch Options to allow changing an existing Thread's Agent Binding.
