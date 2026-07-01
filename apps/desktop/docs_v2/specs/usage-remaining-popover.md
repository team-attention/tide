# Spec: Usage Remaining Status

## Scope

Make the usage status above the Composer show the active thread's session/context
usage and provider quota windows inline. Each visible segment (Session, 5h,
Weekly, …) shows the **remaining percentage** and, for provider windows, the
**reset time**. A small details button opens an account-menu-style popover with
the same values in row form.

This is a renderer-only display change. The backend already parses every
provider's windows (label, usedPercent, windowMinutes, resetsAt) and the renderer
state already carries them — `resetsAt` was simply never surfaced.

## Evidence

- `src/shared/contracts/agent-runtime.ts` — `AgentRuntimeRateLimitDto { label?, usedPercent?, windowMinutes?, resetsAt? }`.
- `src/backend/.../agent-runtime/rate-limit-usage.ts` — universal parser fills all four fields for claude/codex/gemini/opencode (PR #191).
- `src/desktop/.../agent-chat/state/events.ts` (`agentRuntime.usageChanged`) — merges `rateLimits` incl. `resetsAt` onto thread usage state.
- `src/desktop/.../agent-chat/state/types.ts` — `AgentChatUsageRateLimit` has `resetsAt`; `AgentChatUsageView` carries preformatted remaining labels for context and rate-limit windows.
- `src/desktop/.../agent-chat/composer/usage-meter.tsx` — renders the visible usage strip and details popover.
- Reference: Codex account menu shows `5h 100% 8:31 PM` / `Weekly 29% Jun 28` (remaining + reset).

## Decisions

- **Surface**: visible usage strip above the Composer. The popover is a secondary details view, not the only place reset times appear.
- **Scope**: the active thread's provider only (user choice). No new per-provider persistence.
- **Framing**: remaining %, i.e. `100 − usedPercent`, clamped to `[0, 100]`, rounded to an integer (user choice). The chip summary and the popover both use remaining.
- **Reset format**: windows that reset within a day (`windowMinutes <= 1440`, e.g. 5h) show a clock time (`8:31 PM`); longer windows (Weekly/Monthly) show a calendar date (`Jun 28`). Uses the user's locale/timezone (`toLocaleTimeString` / `toLocaleDateString`).
- A window with no `usedPercent` is dropped (cannot show remaining). `resetLabel` is omitted when `resetsAt` is absent.

## Out Of Scope

- Showing usage for providers other than the active thread's (would need per-provider cached usage).
- Per-token streaming during a turn; context-window detail beyond today's chip text.
- A "Learn more" / docs link and any account actions (log out etc.) from the popover.

## Domain Model

Renderer view only (no new backend/domain types).

```ts
interface AgentChatUsageRateLimitView {
  label: string;            // "5h", "Weekly", "Daily", "<n>h", "<n>m"
  remainingPercent: number; // 0–100 (bar + label source of truth)
  remainingLabel: string;   // "42%"
  resetLabel?: string;      // "8:31 PM" | "Jun 28"
}
```

`AgentChatUsageView.rateLimits?: AgentChatUsageRateLimitView[]` plus the
context remaining fields drive the visible segments.

## Contracts

No process-boundary contract change. Backend DTOs and `agentRuntime.usageChanged`
unchanged.

## Flow

1. `agentRuntime.usageChanged` merges `rateLimits` (incl. `resetsAt`) onto thread usage state (existing).
2. `usageView()` maps each window with a known `usedPercent` to an `AgentChatUsageRateLimitView` (remaining + reset label), preserving order.
3. The status strip renders visible segments, e.g. `Session 68% left`, `5h 82% left resets 8:31 PM`, `Weekly 29% left resets Jun 28`.
4. The details button toggles a popover listing session plus one row per window: label · remaining% · reset. Outside-click or Escape closes it.

## Invariants

- `remainingPercent = clamp(0, 100, round(100 − usedPercent))`.
- A window without `usedPercent` produces no view row.
- `usageView()` still returns `null` when there is no token, context, or rate-limit data.
- Reset label selection is driven by `windowMinutes` only (pure/deterministic); the formatted clock/date string itself uses the host locale.
- Popover is closed on first render (SSR-safe); core remaining values remain visible while it is closed.

## Tests

- view-model: `usedPercent 58 / window 300` → `{ label: "5h", remainingPercent: 42, remainingLabel: "42%", resetLabel: <time-with-colon> }`; `usedPercent 68 / window 10080` → `{ label: "Weekly", remainingPercent: 32, resetLabel: <date-no-colon, has letters> }`.
- view-model: window missing `usedPercent` is dropped; usage with only token/context still renders (no rateLimits).
- component/shell: visible strip shows Session, 5h, and Weekly segments inline; popover hidden by default; clicking details reveals rows with reset labels.

## Implementation Notes

- `formatResetLabel(resetsAt, windowMinutes)` is a pure helper in `view-model.ts`; tests assert shape (colon for time, letters/no-colon for date) to stay timezone/locale robust.
- `usage-meter.tsx` is a real React component (`UsageMeter`) with `useState`/`useEffect` for open state + outside-click/Escape; `composer.tsx` renders `<UsageMeter usage={…} />`.
- Strip and popover CSS live in colocated `usage-meter.css`; popover is positioned above the strip (`bottom: 100%`, right-aligned), since the strip sits just above the Composer.
- Update the two chip-text assertions in `tests/desktop-agent-chat-composer-shell.test.tsx` to the remaining framing.
