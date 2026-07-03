import { styled } from "styled-components";

const columnTopRowAttrs = (): Record<string, string> => ({
  "data-column-top-row": "true",
});

export const ColumnTopRow = styled.header.attrs(columnTopRowAttrs)`
  height: 52px;
  min-height: 52px;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--tide-line);
  background: var(--tide-bg);
  -webkit-app-region: drag;

  & button,
  & input,
  & a,
  & [role="tab"],
  & [role="button"] {
    -webkit-app-region: no-drag;
  }
`;

export const ColumnTopRowLeading = styled.div`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 11px;
`;

export const ColumnTopRowTrailing = styled.div`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

export const ColumnTopRowTitle = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-text);
  font-size: 14px;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ColumnTopRowScope = styled.span`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--tide-selection);
  color: var(--tide-muted);
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;

  & svg {
    opacity: 0.8;
  }
`;

export const TopRowButton = styled.button`
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
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-action);
  }
`;
