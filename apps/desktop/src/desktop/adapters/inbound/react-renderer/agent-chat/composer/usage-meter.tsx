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
  fillPercent?: number;
  tonePercent?: number;
}

export function SessionContextMeter({ usage }: { usage: Usage }): ReactElement | null {
  const segment = sessionContextSegment(usage);
  if (segment === null) {
    return null;
  }
  const summary = [segment.label, segment.detail, segment.value].filter(Boolean).join(", ");

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
  const tone = usageTone(segment.tonePercent);
  return (
    <div
      className="agent-usage__segment"
      data-has-bar={segment.fillPercent !== undefined ? "true" : "false"}
      data-usage-tone={tone}
    >
      <div className="agent-usage__segment-text">
        <span className="agent-usage__segment-label">{segment.label}</span>
        {segment.detail ? <span className="agent-usage__segment-detail">{segment.detail}</span> : null}
      </div>
      {segment.fillPercent !== undefined ? (
        <span className="agent-usage__bar" aria-hidden>
          <span
            className="agent-usage__bar-fill"
            style={{ width: `${Math.max(2, Math.min(100, segment.fillPercent))}%` }}
          />
        </span>
      ) : null}
      <span className="agent-usage__segment-value">{segment.value}</span>
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
      // The text keeps the remaining amount, while the meter itself fills as
      // the session consumes context so the bar grows in the intuitive direction.
      fillPercent: usage.contextUsedPercent,
      tonePercent: usage.contextRemainingPercent,
    };
  }
  const tokenValue = usage.contextTokensLabel ?? usage.tokensLabel;
  if (tokenValue !== undefined) {
    return {
      key: "tokens",
      label: "Session context",
      value: tokenValue,
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
