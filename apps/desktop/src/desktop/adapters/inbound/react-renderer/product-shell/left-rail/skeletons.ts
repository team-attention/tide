import { createElement } from "react";
import type { CSSProperties, ReactElement } from "react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Rail shimmer shown on a cold boot until the first thread list arrives.
export function createRailSkeleton(): ReactElement {
  const groups: number[][] = [[78, 60], [70, 84, 52], [66]];
  return createElement(
    "div",
    { className: "rail-skeleton", "aria-hidden": true, "aria-label": "Loading threads" },
    ...groups.map((rows, groupIndex) =>
      createElement(
        "div",
        { key: groupIndex, className: "rail-skeleton__group" },
        createElement("span", { className: "rail-skeleton__heading", style: { width: "38%" } as CSSProperties }),
        ...rows.map((width, rowIndex) =>
          createElement(
            "div",
            { key: rowIndex, className: "rail-skeleton__row" },
            createElement("span", { className: "rail-skeleton__dot" }),
            createElement("span", { className: "rail-skeleton__label", style: { width: `${width}%` } as CSSProperties }),
          ),
        ),
      ),
    ),
  );
}
