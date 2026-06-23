import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).
// Popover detail: see usage-remaining-popover.md.

type Usage = NonNullable<AgentChatShellViewModel["usage"]>;

// A quiet context/token usage chip above the composer (Codex-app style): an
// optional thin context-window meter, then the percent + token labels, then a
// compact remaining summary of the provider's quota windows. When the active
// thread's provider reports rate-limit windows, the chip is a button that opens
// a "Usage remaining" popover (each window: remaining % + reset time).
export function UsageMeter({ usage }: { usage: Usage }): ReactElement {
  const rateLimits = usage.rateLimits ?? [];
  const hasWindows = rateLimits.length > 0;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const summary = [
    usage.contextPercentLabel ? `${usage.contextPercentLabel} context` : undefined,
    usage.tokensLabel,
    ...rateLimits.map((limit) => `${limit.label} ${limit.remainingLabel}`),
  ]
    .filter((value): value is string => value !== undefined)
    .join(" · ");

  return (
    <div className="agent-usage" aria-label="Usage" ref={rootRef}>
      {usage.contextUsedPercent !== undefined ? (
        <span className="agent-usage__bar" aria-hidden>
          <span
            className="agent-usage__bar-fill"
            style={{ width: `${Math.max(2, Math.min(100, usage.contextUsedPercent))}%` }}
          />
        </span>
      ) : null}
      {hasWindows ? (
        <button
          type="button"
          className="agent-usage__trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="agent-usage__text">{summary}</span>
          <ChevronDown size={12} aria-hidden className="agent-usage__chevron" />
        </button>
      ) : (
        <span className="agent-usage__text">{summary}</span>
      )}
      {open && hasWindows ? <UsagePopover rateLimits={rateLimits} /> : null}
    </div>
  );
}

function UsagePopover({ rateLimits }: { rateLimits: NonNullable<Usage["rateLimits"]> }): ReactElement {
  return (
    <div className="agent-usage__popover" role="dialog" aria-label="Usage remaining">
      <div className="agent-usage__popover-title">Usage remaining</div>
      {rateLimits.map((limit, index) => (
        <div className="agent-usage__row" key={`${limit.label}-${index}`}>
          <span className="agent-usage__row-label">{limit.label}</span>
          <span className="agent-usage__row-value">{limit.remainingLabel}</span>
          {limit.resetLabel ? (
            <span className="agent-usage__row-reset">{limit.resetLabel}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
