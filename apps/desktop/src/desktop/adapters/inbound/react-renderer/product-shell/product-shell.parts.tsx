import { styled } from "styled-components";

export const ProductShellBody = styled.div`
  height: 100%;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 256px minmax(460px, 1fr);
  transition: grid-template-columns 260ms cubic-bezier(0.4, 0, 0.2, 1);

  > :last-child [data-column-top-row] {
    padding-right: 84px;
  }

  &[data-workbench-controls="menu"] > :last-child [data-column-top-row] {
    padding-right: 124px;
  }

  &[data-workbench-controls="inline"] > :last-child [data-column-top-row] {
    padding-right: 210px;
  }

  &[data-workbench-controls="dots"] > :last-child [data-workbench-split-pane][data-corner="top-right"] > [data-workbench-split-pane-header] {
    padding-right: 48px;
  }
`;

export const ProductShellFrame = styled.div`
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--tide-bg);

  &[data-resizing="true"] ${ProductShellBody} {
    transition: none;
  }
`;
