# Spec: Usage Status Placement

## Scope

Show current-session context near the composer, and show usage remaining in
Settings as a simple Codex-style list. Provider quota windows (5h, Weekly, and
any future reported windows) render as label, used percentage, and reset time.

The composer strip is context-only. Settings is account/provider quota only:
it does not read thread session context and it does not show token/context
fallback rows.

## Evidence

- `src/shared/contracts/agent-runtime.ts` — `AgentRuntimeRateLimitDto { label?, usedPercent?, windowMinutes?, resetsAt? }`.
- `src/backend/.../agent-runtime/rate-limit-usage.ts` — universal parser fills all four fields for claude/codex/gemini/opencode (PR #191).
- `src/desktop/.../agent-chat/state/events.ts` (`agentRuntime.usageChanged`) — merges `rateLimits` incl. `resetsAt` onto thread usage state.
- `src/shared/contracts/events.ts` (`providerUsage.changed`) — carries app-level provider/account usage snapshots for Settings.
- `src/desktop/.../agent-chat/state/types.ts` — `AgentChatUsageRateLimit` has `resetsAt`; `AgentChatUsageView` carries preformatted context labels plus used/remaining labels for rate-limit windows.
- `src/desktop/.../agent-chat/composer/usage-meter.tsx` — renders the current-session context meter above the composer.
- Reference: Codex account menu exposes quota window percentages and reset times.

## Decisions

- **Composer surface**: current-session context only. It shows the active
  thread's context remaining and token detail when known.
- **Settings surface**: simple usage-remaining rows grouped by provider/model.
  It shows provider quota windows only.
- **Scope**: provider/account quota snapshots from provider history at startup,
  plus live provider quota updates during turns. Thread/session usage is never a
  Settings source.
- **Settings framing**: used %, i.e. provider `usedPercent`, clamped to
  `[0, 100]`, rounded to an integer.
- **View-model compatibility**: rate-limit views still expose remaining % for
  any existing remaining-framed callers, but Settings renders `usedLabel`.
- **Reset format**: windows that reset within a day (`windowMinutes <= 1440`, e.g. 5h) show a clock time (`8:31 PM`); longer windows (Weekly/Monthly) show a calendar date (`Jun 28`). Uses the user's locale/timezone (`toLocaleTimeString` / `toLocaleDateString`).
- A window with no `usedPercent` is dropped (cannot show usage). `resetLabel` is omitted when `resetsAt` is absent.

## Out Of Scope

- Per-token streaming during a turn; context-window detail beyond today's chip text.
- A "Learn more" / docs link and any account actions (log out etc.) from Settings.

## Domain Model

Settings is driven by app-level provider snapshots.

```ts
interface ProviderUsageSnapshotDto {
  agentId: ProviderCliAgentId;
  usage: AgentRuntimeUsageDto;
  observedAt?: string;
}

interface AgentChatUsageRateLimitView {
  label: string;            // "5h", "Weekly", "Daily", "<n>h", "<n>m"
  usedPercent: number;      // 0-100
  usedLabel: string;        // "58%"
  remainingPercent: number; // 0-100, retained for compatibility
  remainingLabel: string;   // "42%"
  resetLabel?: string;      // "8:31 PM" | "Jun 28"
}
```

`AgentChatUsageView.rateLimits?: AgentChatUsageRateLimitView[]` drives the
provider-window items in each Settings usage row. The context remaining fields
drive only the composer meter.

## Contracts

Adds `providerUsage.changed`:

```ts
"providerUsage.changed": {
  usages: ProviderUsageSnapshotDto[];
}
```

`agentRuntime.usageChanged` remains per Thread and continues to drive the
composer/session context UI.

## Flow

1. Backend startup scans recent Codex/Claude provider history for the latest
   usage record with quota windows, then emits `providerUsage.changed`.
2. A live turn that reports quota windows emits both `agentRuntime.usageChanged`
   for the Thread and `providerUsage.changed` for Settings.
3. Product Shell stores `providerUsage.changed` snapshots in app-level state.
4. `createAgentChatUsageView()` maps each window with a known `usedPercent` to an
   `AgentChatUsageRateLimitView` (used + remaining + reset label), preserving order.
5. The Product Shell view model derives Settings rows from provider snapshots
   only and drops snapshots without quota windows.
6. The composer stack renders `Session context 68% left`, with token detail when
   available.
7. Settings renders window rows when reported, e.g. `5h 18% 8:31 PM`,
   `Weekly 71% Jun 28`. If no account quota windows exist, it renders
   `No usage reported yet.`

## Invariants

- Composer never renders provider quota windows.
- Settings never renders session context.
- Settings is independent of the active Thread and thread list.
- `remainingPercent = clamp(0, 100, round(100 − usedPercent))`.
- `usedPercent = clamp(0, 100, round(usedPercent))`.
- A window without `usedPercent` produces no view row.
- `createAgentChatUsageView()` still returns `null` when there is no token,
  context, or rate-limit data.
- Reset label selection is driven by `windowMinutes` only (pure/deterministic); the formatted clock/date string itself uses the host locale.

## Tests

- view-model: `usedPercent 58 / window 300` → `{ label: "5h", usedLabel: "58%", remainingLabel: "42%", resetLabel: <time-with-colon> }`; `usedPercent 68 / window 10080` → `{ label: "Weekly", usedLabel: "68%", remainingLabel: "32%", resetLabel: <date-no-colon, has letters> }`.
- view-model: window missing `usedPercent` is dropped; usage with only token/context still renders (no rateLimits).
- component/shell: composer usage shows only session context. Settings usage
  rows show 5h and Weekly used percentages with reset labels when account
  provider windows are present.
- component/shell: thread-only session usage leaves Settings empty; account
  usage renders on New Thread without any listed/open thread.

## Implementation Notes

- `formatResetLabel(resetsAt, windowMinutes)` is a pure helper in `view-model.ts`; tests assert shape (colon for time, letters/no-colon for date) to stay timezone/locale robust.
- `usage-meter.tsx` exports `SessionContextMeter` for the composer stack.
- Settings renders a plain text list, no bars.
