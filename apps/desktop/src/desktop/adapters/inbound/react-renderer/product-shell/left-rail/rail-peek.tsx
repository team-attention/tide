import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { styled } from "styled-components";
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

  // Clear a pending close if we unmount mid-countdown (no state update on an unmounted
  // component). Review feedback.
  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) {
        clearTimeout(closeTimer.current);
      }
    };
  }, []);

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
    <RailPeekFrame data-open={open ? "true" : undefined} aria-label="Left Rail peek">
      <RailPeekHotZone data-rail-peek-hot-zone aria-hidden onMouseEnter={openNow} />
      <RailPeekPanel onMouseEnter={openNow} onMouseLeave={scheduleClose}>
        <LeftRailColumnView
          handlers={props.handlers}
          anchor={props.anchor}
          collapsedSections={props.collapsedSections}
        />
      </RailPeekPanel>
    </RailPeekFrame>
  );
}

const RailPeekFrame = styled.div`
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 70;
  pointer-events: none;
`;

const RailPeekHotZone = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 8px;
  pointer-events: auto;
`;

const RailPeekPanel = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 264px;
  overflow: hidden;
  border-right: 1px solid var(--tide-line);
  background: var(--tide-bg);
  box-shadow: 6px 0 18px -10px rgba(0, 0, 0, 0.22);
  pointer-events: none;
  transform: translateX(-100%);
  transition: transform 0.16s ease;

  ${RailPeekFrame}[data-open] & {
    overflow: visible;
    pointer-events: auto;
    transform: none;
  }

  & [data-column="left-rail"] {
    width: 100%;
    height: 100%;
  }
`;
