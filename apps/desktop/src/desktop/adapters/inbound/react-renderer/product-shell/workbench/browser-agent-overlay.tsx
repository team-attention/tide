import type { CSSProperties, ReactElement } from "react";
import { Hand } from "lucide-react";

// On-screen "agent is driving" theater (D3): a lock veil that blocks user input to the
// page, an animated cursor at the agent's last pointer position, and a Take control
// button (user takeover, D5). Pure render derivation from the pane's agentDriving /
// agentCursor with NO focus side effects (D2) — the caller renders it only for the
// foreground driven Browser Pane (the offscreen background host renders no overlay), so
// it appears iff the driven pane is on screen.
// Spec: docs_v2/specs/browser-pane-agent-computer-use.md.
export function BrowserAgentOverlay(props: {
  cursor: { x: number; y: number } | null;
  onTakeControl: () => void;
}): ReactElement {
  return (
    <div className="browser-agent-overlay" data-testid="browser-agent-overlay">
      <div className="browser-agent-overlay__veil" />
      {props.cursor === null ? null : (
        <div
          className="browser-agent-overlay__cursor"
          style={{ left: `${props.cursor.x}px`, top: `${props.cursor.y}px` } as CSSProperties}
        >
          <span className="browser-agent-overlay__ripple" />
        </div>
      )}
      <div className="browser-agent-overlay__banner">
        <span className="browser-agent-overlay__label">Agent is driving this browser</span>
        <button
          type="button"
          className="browser-agent-overlay__take-control"
          onClick={props.onTakeControl}
        >
          <Hand size={13} strokeWidth={1.9} aria-hidden />
          Take control
        </button>
      </div>
    </div>
  );
}
