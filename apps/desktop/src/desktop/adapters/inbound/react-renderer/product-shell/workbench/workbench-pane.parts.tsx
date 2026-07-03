import { styled } from "styled-components";

export const WorkbenchPaneSurface = styled.div`
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: block;
  padding: 8px;

  &[data-pane-surface-kind="browser"],
  &[data-pane-surface-kind="editor"] {
    flex: 1 1 auto;
    height: auto;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
  }

  &[data-pane-surface-kind="launcher"] {
    width: 100%;
    max-width: 460px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 10px;
    margin: 0 auto;
    padding: 18px clamp(12px, 4%, 32px);
  }
`;

export const WorkbenchPaneKindLabel = styled.div`
  color: var(--tide-muted);
  font-size: 12px;
  text-transform: uppercase;
`;

export const WorkbenchPaneActionButton = styled.button`
  width: fit-content;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
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
