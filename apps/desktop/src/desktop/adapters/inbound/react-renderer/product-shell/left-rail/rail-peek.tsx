import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { LeftRailColumnView } from "../product-shell-columns.ts";
import type { MenuAnchorRect, ProductShellHandlers } from "../support/types.ts";

// Floating Left Rail peek for the COLLAPSED rail (spec: multitask-navigation L1).
// A thin left-edge hot zone reveals the full rail as an overlay that floats OVER the
// content (no layout reflow) and retracts on mouse-leave. Holding Ctrl auto-reveals it
// (Decision 7) so the ^N pin badges always have visible rows. Rendered only while the
// rail is collapsed.
export function RailPeek(props: {
  handlers: ProductShellHandlers;
  anchor: MenuAnchorRect | null;
  collapsedSections: Record<string, boolean>;
  // Multitask mode (Ctrl held) forces the peek open even without hover.
  forceOpen: boolean;
}): ReactElement {
  const [hovering, setHovering] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = hovering || props.forceOpen;

  const cancelClose = (): void => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = (): void => {
    cancelClose();
    setHovering(true);
  };
  // Small grace delay so a brief cursor slip off the panel edge doesn't snap it shut.
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovering(false), 180);
  };

  return (
    <div className="rail-peek" data-open={open ? "true" : undefined} aria-label="Left Rail peek">
      <div className="rail-peek__hot-zone" aria-hidden onMouseEnter={openNow} />
      <div className="rail-peek__panel" onMouseEnter={openNow} onMouseLeave={scheduleClose}>
        <LeftRailColumnView
          handlers={props.handlers}
          anchor={props.anchor}
          collapsedSections={props.collapsedSections}
        />
      </div>
    </div>
  );
}
