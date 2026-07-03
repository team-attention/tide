import { useEffect, useMemo, useState, type ReactElement } from "react";
import { styled } from "styled-components";
import { Activity, GitCompare, Square, X } from "lucide-react";
import type { ProductShellAgentMonitorSession } from "../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "./support/types.ts";

export function AgentMonitorPanel(props: {
  sessions: ProductShellAgentMonitorSession[];
  handlers: ProductShellHandlers;
}): ReactElement {
  const { sessions, handlers } = props;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const grouped = useMemo(() => ({
    needs: sessions.filter((session) => session.state === "waiting_for_input" || session.state === "waiting_for_approval"),
    running: sessions.filter((session) => session.state === "running" || session.state === "starting"),
    other: sessions.filter(
      (session) =>
        session.state !== "waiting_for_input" &&
        session.state !== "waiting_for_approval" &&
        session.state !== "running" &&
        session.state !== "starting",
    ),
  }), [sessions]);

  return (
    <MonitorFrame role="dialog" aria-label="Agent Monitor">
      <MonitorHeader>
        <MonitorTitle>
          <Activity size={16} strokeWidth={1.9} aria-hidden />
          <span>Agent Monitor</span>
        </MonitorTitle>
        <MonitorCloseButton type="button" title="Close Agent Monitor" aria-label="Close Agent Monitor" onClick={handlers.onAgentMonitorToggle}>
          <X size={15} strokeWidth={2} aria-hidden />
        </MonitorCloseButton>
      </MonitorHeader>
      <MonitorBody>
        {sessions.length === 0 ? (
          <MonitorEmpty>No live agent sessions.</MonitorEmpty>
        ) : (
          <>
            <MonitorGroup title="Needs You" sessions={grouped.needs} now={now} handlers={handlers} />
            <MonitorGroup title="Running" sessions={grouped.running} now={now} handlers={handlers} />
            <MonitorGroup title="Idle / Stopped" sessions={grouped.other} now={now} handlers={handlers} />
          </>
        )}
      </MonitorBody>
    </MonitorFrame>
  );
}

function MonitorGroup(props: {
  title: string;
  sessions: ProductShellAgentMonitorSession[];
  now: number;
  handlers: ProductShellHandlers;
}): ReactElement | null {
  if (props.sessions.length === 0) {
    return null;
  }
  return (
    <MonitorSection>
      <MonitorSectionTitle>{props.title}</MonitorSectionTitle>
      <MonitorList>
        {props.sessions.map((session) => (
          <MonitorSessionRow key={session.threadId} session={session} now={props.now} handlers={props.handlers} />
        ))}
      </MonitorList>
    </MonitorSection>
  );
}

function MonitorSessionRow(props: {
  session: ProductShellAgentMonitorSession;
  now: number;
  handlers: ProductShellHandlers;
}): ReactElement {
  const { session, now, handlers } = props;
  const cwd = session.cwd ?? "";
  return (
    <MonitorSession data-active={session.active ? "true" : "false"}>
      <MonitorSessionMain>
        <MonitorSessionTitle title={session.title}>{session.title}</MonitorSessionTitle>
        <MonitorSessionMeta>
          <span>{agentLabel(session.agentId)}</span>
          <span>{stateLabel(session.state)}</span>
          {session.startedAt !== undefined ? <span>{formatElapsed(session.startedAt, now)}</span> : null}
        </MonitorSessionMeta>
        <MonitorSessionDetail>
          {session.activityLabel ?? promptLabel(session.pendingPromptKind) ?? session.usageLabel ?? session.projectName ?? cwd}
        </MonitorSessionDetail>
      </MonitorSessionMain>
      <MonitorActions>
        <MonitorIconButton type="button" title="Focus thread" aria-label="Focus thread" onClick={() => handlers.onThreadSelect(session.threadId)}>
          <Activity size={14} strokeWidth={1.9} aria-hidden />
        </MonitorIconButton>
        <MonitorIconButton
          type="button"
          title="Open changes"
          aria-label="Open changes"
          disabled={cwd.length === 0}
          onClick={() => handlers.onOpenThreadChanges(session.threadId)}
        >
          <GitCompare size={14} strokeWidth={1.9} aria-hidden />
        </MonitorIconButton>
        <MonitorIconButton
          type="button"
          title={session.active ? "Stop active agent" : "Focus thread to stop"}
          aria-label={session.active ? "Stop active agent" : "Focus thread to stop"}
          disabled={!session.active}
          onClick={handlers.onInterrupt}
        >
          <Square size={13} strokeWidth={1.9} aria-hidden />
        </MonitorIconButton>
      </MonitorActions>
    </MonitorSession>
  );
}

function agentLabel(agentId: ProductShellAgentMonitorSession["agentId"]): string {
  return agentId === "opencode" ? "opencode" : agentId[0].toUpperCase() + agentId.slice(1);
}

function stateLabel(state: ProductShellAgentMonitorSession["state"]): string {
  switch (state) {
    case "waiting_for_approval":
      return "needs approval";
    case "waiting_for_input":
      return "needs input";
    case "starting":
      return "starting";
    case "running":
      return "running";
    case "failed":
      return "failed";
    case "stopping":
      return "stopping";
    case "stopped":
      return "stopped";
    case "idle":
      return "idle";
    case "not_started":
      return "not started";
  }
}

function promptLabel(kind: ProductShellAgentMonitorSession["pendingPromptKind"]): string | undefined {
  switch (kind) {
    case "approval":
      return "Approval waiting";
    case "question":
      return "Question waiting";
    case "mcp_elicitation":
      return "Prompt waiting";
    default:
      return undefined;
  }
}

function formatElapsed(startedAt: string, now: number): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) {
    return "live";
  }
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return `${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 1) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes % 60}m`;
}

const MonitorFrame = styled.aside`
  position: fixed;
  top: 54px;
  right: 14px;
  width: min(440px, calc(100vw - 28px));
  max-height: min(620px, calc(100vh - 72px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--tide-line);
  border-radius: 9px;
  background: var(--tide-bg);
  box-shadow: 0 18px 52px color-mix(in srgb, black 20%, transparent);
  z-index: 80;
`;

const MonitorHeader = styled.header`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--tide-line);
`;

const MonitorTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 700;
`;

const MonitorCloseButton = styled.button`
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

const MonitorBody = styled.div`
  min-height: 0;
  overflow: auto;
  padding: 10px;
`;

const MonitorEmpty = styled.p`
  margin: 20px 8px;
  color: var(--tide-muted);
  font-size: 13px;
`;

const MonitorSection = styled.section`
  display: grid;
  gap: 7px;
  margin-bottom: 14px;
`;

const MonitorSectionTitle = styled.h3`
  margin: 0 2px;
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
`;

const MonitorList = styled.div`
  display: grid;
  gap: 6px;
`;

const MonitorSession = styled.div`
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 9px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: var(--tide-surface);

  &[data-active="true"] {
    border-color: color-mix(in srgb, var(--tide-action) 45%, var(--tide-line));
  }
`;

const MonitorSessionMain = styled.div`
  min-width: 0;
  display: grid;
  gap: 4px;
`;

const MonitorSessionTitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-text);
  font-size: 12.5px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MonitorSessionMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--tide-muted);
  font-size: 11.5px;
`;

const MonitorSessionDetail = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MonitorActions = styled.div`
  display: inline-flex;
  gap: 5px;
`;

const MonitorIconButton = styled.button`
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--tide-selection);
    color: var(--tide-action);
  }

  &:disabled {
    cursor: default;
    opacity: 0.35;
  }
`;
