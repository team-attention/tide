# Spec: Usage Status Placement

## Scope

Show current-session context near the composer, and show provider quota-window
usage in Settings by provider/model. Settings rows show the known provider
windows (5h, 1 week, and any future reported windows) as **used percentage**
values plus the provider reset time.

This is a renderer-only display change. The backend already parses every
provider's windows (label, usedPercent, windowMinutes, resetsAt) and the renderer
state already carries them. The composer strip is context-only; account/window
usage stays in Settings.

## Evidence

- `src/shared/contracts/agent-runtime.ts` — `AgentRuntimeRateLimitDto { label?, usedPercent?, windowMinutes?, resetsAt? }`.
- `src/backend/.../agent-runtime/rate-limit-usage.ts` — universal parser fills all four fields for claude/codex/gemini/opencode (PR #191).
- `src/desktop/.../agent-chat/state/events.ts` (`agentRuntime.usageChanged`) — merges `rateLimits` incl. `resetsAt` onto thread usage state.
- `src/desktop/.../agent-chat/state/types.ts` — `AgentChatUsageRateLimit` has `resetsAt`; `AgentChatUsageView` carries preformatted context labels plus used/remaining labels for rate-limit windows.
- `src/desktop/.../agent-chat/composer/usage-meter.tsx` — renders the current-session context meter above the composer.
- Reference: Codex account menu exposes quota window percentages and reset times.

## Decisions

- **Composer surface**: current-session context only. It shows the active
  thread's context remaining and token detail when known.
- **Settings surface**: provider window usage only. It does not show session
  context/token counts.
- **Scope**: known usage from the current renderer session, grouped by
  provider/model. No fabricated global account usage and no new per-provider
  persistence.
- **Settings framing**: used %, i.e. provider `usedPercent`, clamped to
  `[0, 100]`, rounded to an integer.
- **View-model compatibility**: rate-limit views still expose remaining % for
  any existing remaining-framed callers, but Settings renders `usedLabel`.
- **Reset format**: windows that reset within a day (`windowMinutes <= 1440`, e.g. 5h) show a clock time (`8:31 PM`); longer windows (Weekly/Monthly) show a calendar date (`Jun 28`). Uses the user's locale/timezone (`toLocaleTimeString` / `toLocaleDateString`).
- A window with no `usedPercent` is dropped (cannot show usage). `resetLabel` is omitted when `resetsAt` is absent.

## Out Of Scope

- Account-level persistence outside the current renderer session.
- Per-token streaming during a turn; context-window detail beyond today's chip text.
- A "Learn more" / docs link and any account actions (log out etc.) from Settings.

## Domain Model

Renderer view only (no new backend/domain types).

```ts
interface AgentChatUsageRateLimitView {
  label: string;            // "5h", "Weekly", "Daily", "<n>h", "<n>m"
  usedPercent: number;      // 0-100
  usedLabel: string;        // "58%"
  remainingPercent: number; // 0-100, retained for compatibility
  remainingLabel: string;   // "42%"
  resetLabel?: string;      // "8:31 PM" | "Jun 28"
}
```

`AgentChatUsageView.rateLimits?: AgentChatUsageRateLimitView[]` drives each
Settings usage row. The context remaining fields drive the composer meter.

## Contracts

No process-boundary contract change. Backend DTOs and `agentRuntime.usageChanged`
unchanged.

## Flow

1. `agentRuntime.usageChanged` merges `rateLimits` (incl. `resetsAt`) onto thread usage state (existing).
2. `createAgentChatUsageView()` maps each window with a known `usedPercent` to an
   `AgentChatUsageRateLimitView` (used + remaining + reset label), preserving order.
3. The Product Shell view model collects known thread usage and groups rows by
   provider/model.
4. The composer stack renders `Session context 68% left`, with token detail when
   available.
5. Settings renders window rows, e.g. `5h window 18% used Resets 8:31 PM`,
   `1 week window 71% used Resets Jun 28`.

## Invariants

- Composer never renders provider quota windows.
- Settings never renders session context/token counts in the Usage section.
- `remainingPercent = clamp(0, 100, round(100 − usedPercent))`.
- `usedPercent = clamp(0, 100, round(usedPercent))`.
- A window without `usedPercent` produces no view row.
- `createAgentChatUsageView()` still returns `null` when there is no token,
  context, or rate-limit data.
- Reset label selection is driven by `windowMinutes` only (pure/deterministic); the formatted clock/date string itself uses the host locale.

## Tests

- view-model: `usedPercent 58 / window 300` → `{ label: "5h", usedLabel: "58%", remainingLabel: "42%", resetLabel: <time-with-colon> }`; `usedPercent 68 / window 10080` → `{ label: "Weekly", usedLabel: "68%", remainingLabel: "32%", resetLabel: <date-no-colon, has letters> }`.
- view-model: window missing `usedPercent` is dropped; usage with only token/context still renders (no rateLimits).
- component/shell: composer usage shows only session context. Settings usage rows
  show 5h and 1 week window used percentages plus reset labels, without session
  context/token detail.

## Implementation Notes

- `formatResetLabel(resetsAt, windowMinutes)` is a pure helper in `view-model.ts`; tests assert shape (colon for time, letters/no-colon for date) to stay timezone/locale robust.
- `usage-meter.tsx` exports `SessionContextMeter` for the composer stack.
- Settings renders its own lightweight window rows so context and quota windows
  do not share the same component.
