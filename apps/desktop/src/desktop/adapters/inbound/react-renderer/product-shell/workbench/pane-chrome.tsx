import type { ReactElement } from "react";
import { styled } from "styled-components";
import { WorkbenchPaneKindLabel } from "./workbench-pane.parts.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createWorkbenchPaneHeading(kind: string, title: string, status?: string): ReactElement {
  return (
    <WorkbenchPaneHeading>
      <WorkbenchPaneKindLabel>{kind}</WorkbenchPaneKindLabel>
      <WorkbenchPaneHeadingRow>
        <h2>{title}</h2>
        {status ? <WorkbenchPaneHeadingStatus>{status}</WorkbenchPaneHeadingStatus> : null}
      </WorkbenchPaneHeadingRow>
    </WorkbenchPaneHeading>
  );
}

export function createWorkbenchPaneMeta(rows: Array<[string, string | undefined]>): ReactElement | null {
  const visibleRows = rows.filter(([, value]) => value !== undefined && value.length > 0);
  if (visibleRows.length === 0) {
    return null;
  }
  return (
    <WorkbenchPaneMeta>
      {visibleRows.flatMap(([label, value]) => [
        <dt key={`${label}-label`}>{label}</dt>,
        <dd key={`${label}-value`}>{value}</dd>,
      ])}
    </WorkbenchPaneMeta>
  );
}

export function formatBeforeAfterBytes(before: number | undefined, after: number | undefined): string | undefined {
  return typeof before === "number" && typeof after === "number"
    ? `${before} -> ${after} bytes`
    : undefined;
}

const WorkbenchPaneHeading = styled.div`
  min-width: 0;
  display: grid;
  gap: 6px;
`;

const WorkbenchPaneHeadingRow = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;

  h2 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const WorkbenchPaneHeadingStatus = styled.span`
  height: 22px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--tide-selection);
  color: var(--tide-muted);
  font-size: 12px;
`;

const WorkbenchPaneMeta = styled.dl`
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 5px 10px;
  margin: 0;
  color: var(--tide-muted);
  font-size: 12px;

  dt,
  dd {
    min-width: 0;
    margin: 0;
  }

  dd {
    overflow: hidden;
    color: var(--tide-text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
