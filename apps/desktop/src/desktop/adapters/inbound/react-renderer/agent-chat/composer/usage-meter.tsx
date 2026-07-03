import type { AgentChatShellViewModel } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { ReactElement } from "react";
import { styled } from "styled-components";
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
    <AgentUsage
      role="status"
      aria-label={summary}
      data-agent-usage="true"
    >
      <AgentUsageSegments>
        <UsageSegment segment={segment} />
      </AgentUsageSegments>
    </AgentUsage>
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
    <AgentUsageSegment
      data-has-bar={segment.fillPercent !== undefined ? "true" : "false"}
      data-usage-tone={tone}
    >
      <AgentUsageSegmentText>
        <AgentUsageSegmentLabel>{segment.label}</AgentUsageSegmentLabel>
        {segment.detail ? <AgentUsageSegmentDetail>{segment.detail}</AgentUsageSegmentDetail> : null}
      </AgentUsageSegmentText>
      {segment.fillPercent !== undefined ? (
        <AgentUsageBar aria-hidden>
          <AgentUsageBarFill
            style={{ width: `${Math.max(2, Math.min(100, segment.fillPercent))}%` }}
          />
        </AgentUsageBar>
      ) : null}
      <AgentUsageSegmentValue>{segment.value}</AgentUsageSegmentValue>
    </AgentUsageSegment>
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

const AgentUsage = styled.div`
  position: relative;
  display: block;
  margin: -5px 6px -8px;
  padding: 5px 2px 0;
  border-top: 1px solid color-mix(in srgb, var(--tide-line) 72%, transparent);
  color: var(--tide-text);
  font-size: 12px;
  line-height: 1.25;
  letter-spacing: 0;
  user-select: none;
`;

const AgentUsageSegments = styled.div`
  min-width: 0;
  display: block;
`;

const AgentUsageSegment = styled.div`
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  grid-template-areas:
    "text value"
    "bar bar";
  align-items: center;
  gap: 5px 10px;
  padding: 0;

  &[data-has-bar="false"] {
    grid-template-areas: "text value";
  }
`;

const AgentUsageSegmentText = styled.div`
  grid-area: text;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
`;

const AgentUsageSegmentLabel = styled.span`
  flex: 0 0 auto;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0;
  text-transform: uppercase;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AgentUsageSegmentValue = styled.span`
  grid-area: value;
  justify-self: end;
  flex: 0 0 auto;
  color: var(--tide-text);
  font-size: 12.5px;
  font-weight: 670;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const AgentUsageSegmentDetail = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AgentUsageBar = styled.span`
  grid-area: bar;
  width: 100%;
  height: 2px;
  margin-top: 1px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tide-line) 78%, transparent);
`;

const AgentUsageBarFill = styled.span`
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--tide-muted);
  transition: width 0.35s ease;

  ${AgentUsageSegment}[data-usage-tone="ok"] & {
    background: var(--tide-success);
  }

  ${AgentUsageSegment}[data-usage-tone="warn"] & {
    background: var(--tide-warn);
  }

  ${AgentUsageSegment}[data-usage-tone="critical"] & {
    background: var(--tide-danger);
  }
`;
