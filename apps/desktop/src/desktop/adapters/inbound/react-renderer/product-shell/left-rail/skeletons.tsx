import type { CSSProperties, ReactElement } from "react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Rail shimmer shown on a cold boot until the first thread list arrives.
export function createRailSkeleton(): ReactElement {
  const groups: number[][] = [[78, 60], [70, 84, 52], [66]];
  return (
    <div className="rail-skeleton" aria-hidden aria-label="Loading threads">
      {groups.map((rows, groupIndex) => (
        <div key={groupIndex} className="rail-skeleton__group">
          <span className="rail-skeleton__heading" style={{ width: "38%" } as CSSProperties} />
          {rows.map((width, rowIndex) => (
            <div key={rowIndex} className="rail-skeleton__row">
              <span className="rail-skeleton__dot" />
              <span
                className="rail-skeleton__label"
                style={{ width: `${width}%` } as CSSProperties}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
