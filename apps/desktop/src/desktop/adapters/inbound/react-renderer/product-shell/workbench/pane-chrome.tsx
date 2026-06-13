import type { ReactElement } from "react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createWorkbenchPaneHeading(kind: string, title: string, status?: string): ReactElement {
  return (
    <div className="workbench-pane-heading">
      <div className="workbench-column__kind">{kind}</div>
      <div className="workbench-pane-heading__row">
        <h2>{title}</h2>
        {status ? <span className="workbench-pane-heading__status">{status}</span> : null}
      </div>
    </div>
  );
}

export function createWorkbenchPaneMeta(rows: Array<[string, string | undefined]>): ReactElement | null {
  const visibleRows = rows.filter(([, value]) => value !== undefined && value.length > 0);
  if (visibleRows.length === 0) {
    return null;
  }
  return (
    <dl className="workbench-pane-meta">
      {visibleRows.flatMap(([label, value]) => [
        <dt key={`${label}-label`}>{label}</dt>,
        <dd key={`${label}-value`}>{value}</dd>,
      ])}
    </dl>
  );
}

export function formatBeforeAfterBytes(before: number | undefined, after: number | undefined): string | undefined {
  return typeof before === "number" && typeof after === "number"
    ? `${before} -> ${after} bytes`
    : undefined;
}
