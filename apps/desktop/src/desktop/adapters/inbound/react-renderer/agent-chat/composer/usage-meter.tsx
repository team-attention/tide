import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).
// Popover detail: see usage-remaining-popover.md.

type Usage = NonNullable<AgentChatShellViewModel["usage"]>;
type RateLimit = NonNullable<Usage["rateLimits"]>[number];

interface UsageSegmentView {
  key: string;
  label: string;
  value: string;
  detail?: string;
  remainingPercent?: number;
}

// A visible usage/limit status strip above the composer. Context and provider
// quota windows render as separate segments so "session", "5h", and "Weekly"
// remaining values stay scannable without opening a menu.
export function UsageMeter({ usage }: { usage: Usage }): ReactElement {
  const rateLimits = usage.rateLimits ?? [];
  const segments = usageSegments(usage, rateLimits);
  const hasDetails = rateLimits.length > 0 || usage.contextDetailLabel !== undefined;
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

  const summary = segments
    .map((segment) => `${segment.label} ${segment.value}${segment.detail ? `, ${segment.detail}` : ""}`)
    .join("; ");

  return (
    <div className="agent-usage" role="group" aria-label={`Usage limits: ${summary}`} ref={rootRef}>
      <div className="agent-usage__segments">
        {segments.map((segment) => (
          <UsageSegment segment={segment} key={segment.key} />
        ))}
      </div>
      {hasDetails ? (
        <button
          type="button"
          className="agent-usage__trigger"
          title="Usage details"
          aria-label="Usage details"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={12} aria-hidden className="agent-usage__chevron" />
        </button>
      ) : null}
      {open && hasDetails ? <UsagePopover usage={usage} rateLimits={rateLimits} /> : null}
    </div>
  );
}

function UsageSegment({ segment }: { segment: UsageSegmentView }): ReactElement {
  const tone = usageTone(segment.remainingPercent);
  return (
    <div className="agent-usage__segment" data-usage-tone={tone}>
      <div className="agent-usage__segment-head">
        <span className="agent-usage__segment-label">{segment.label}</span>
        <span className="agent-usage__segment-value">{segment.value}</span>
      </div>
      {segment.detail ? <div className="agent-usage__segment-detail">{segment.detail}</div> : null}
      {segment.remainingPercent !== undefined ? (
        <span className="agent-usage__bar" aria-hidden>
          <span
            className="agent-usage__bar-fill"
            style={{ width: `${Math.max(2, Math.min(100, segment.remainingPercent))}%` }}
          />
        </span>
      ) : null}
    </div>
  );
}

function UsagePopover({
  usage,
  rateLimits,
}: {
  usage: Usage;
  rateLimits: NonNullable<Usage["rateLimits"]>;
}): ReactElement {
  return (
    <div className="agent-usage__popover" role="dialog" aria-label="Usage details">
      <div className="agent-usage__popover-title">Usage details</div>
      {usage.contextRemainingLabel ? (
        <div className="agent-usage__row">
          <span className="agent-usage__row-label">Session</span>
          <span className="agent-usage__row-value">{`${usage.contextRemainingLabel} left`}</span>
          <span className="agent-usage__row-reset">
            {usage.contextDetailLabel ?? ""}
          </span>
        </div>
      ) : null}
      {rateLimits.map((limit, index) => (
        <div className="agent-usage__row" key={`${limit.label}-${index}`}>
          <span className="agent-usage__row-label">{limit.label}</span>
          <span className="agent-usage__row-value">{`${limit.remainingLabel} left`}</span>
          {limit.resetLabel ? (
            <span className="agent-usage__row-reset">{`resets ${limit.resetLabel}`}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function usageSegments(usage: Usage, rateLimits: RateLimit[]): UsageSegmentView[] {
  const segments: UsageSegmentView[] = [];
  if (usage.contextRemainingLabel !== undefined) {
    segments.push({
      key: "session",
      label: "Session",
      value: `${usage.contextRemainingLabel} left`,
      detail: usage.contextDetailLabel ?? (
        usage.contextPercentLabel !== undefined ? `${usage.contextPercentLabel} used` : undefined
      ),
      remainingPercent: usage.contextRemainingPercent,
    });
  } else if (usage.tokensLabel !== undefined) {
    segments.push({
      key: "tokens",
      label: "Tokens",
      value: usage.tokensLabel,
    });
  }
  for (const [index, limit] of rateLimits.entries()) {
    segments.push({
      key: `limit-${limit.label}-${index}`,
      label: limit.label,
      value: `${limit.remainingLabel} left`,
      detail: limit.resetLabel ? `resets ${limit.resetLabel}` : "reset unknown",
      remainingPercent: limit.remainingPercent,
    });
  }
  return segments;
}

function usageTone(percent: number | undefined): "neutral" | "ok" | "warn" | "critical" {
  if (percent === undefined) {
    return "neutral";
  }
  if (percent <= 10) {
    return "critical";
  }
  if (percent <= 25) {
    return "warn";
  }
  return "ok";
}
