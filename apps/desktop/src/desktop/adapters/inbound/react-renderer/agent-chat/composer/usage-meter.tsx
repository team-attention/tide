import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).
// Current-session context meter: see usage-remaining-popover.md.

type Usage = NonNullable<AgentChatShellViewModel["usage"]>;

interface UsageSegmentView {
  key: string;
  label: string;
  value: string;
  detail?: string;
  remainingPercent?: number;
}

export function SessionContextMeter({ usage }: { usage: Usage }): ReactElement | null {
  const segment = sessionContextSegment(usage);
  if (segment === null) {
    return null;
  }
  const summary = `${segment.label} ${segment.value}${segment.detail ? `, ${segment.detail}` : ""}`;

  return (
    <div
      className="agent-usage"
      role="status"
      aria-label={summary}
    >
      <div className="agent-usage__segments">
        <UsageSegment segment={segment} />
      </div>
    </div>
  );
}

export function UsageMeter({
  usage,
}: {
  usage: Usage;
  compact?: boolean;
  popoverPlacement?: "above" | "below";
}): ReactElement | null {
  return <SessionContextMeter usage={usage} />;
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

function sessionContextSegment(usage: Usage): UsageSegmentView | null {
  if (usage.contextRemainingLabel !== undefined) {
    return {
      key: "session",
      label: "Session context",
      value: `${usage.contextRemainingLabel} left`,
      detail: usage.contextDetailLabel ?? (
        usage.contextPercentLabel !== undefined ? `${usage.contextPercentLabel} used` : undefined
      ),
      remainingPercent: usage.contextRemainingPercent,
    };
  }
  if (usage.tokensLabel !== undefined) {
    return {
      key: "tokens",
      label: "Session context",
      value: usage.tokensLabel,
    };
  }
  return null;
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
