import { styled } from "styled-components";

export const FloatingMenuBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 60;
`;

export const FloatingMenuSurface = styled.div<{
  $kind?: "thread" | "project" | "list_settings" | "file_tree";
}>`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid var(--tide-line);
  border-radius: 12px;
  padding: ${({ $kind }) => ($kind === "list_settings" ? "0" : "5px")};
  background: var(--tide-bg);
  box-shadow: var(--tide-shadow-popover);
  transform-origin: top;
  animation: tide-pop-in 0.13s ease;
`;

export const FloatingMenuItem = styled.button<{
  $danger?: boolean;
  $disabled?: boolean;
}>`
  height: 30px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 7px;
  padding: 0 8px;
  background: transparent;
  color: ${({ $danger }) => ($danger ? "var(--tide-danger)" : "var(--tide-text)")};
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  white-space: nowrap;
  cursor: ${({ $disabled }) => ($disabled ? "default" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? "0.4" : "1")};
  transition: background-color 0.12s ease, color 0.12s ease;

  &:hover {
    background: ${({ $disabled }) => ($disabled ? "none" : "var(--tide-selection)")};
  }
`;

export const FloatingMenuIcon = styled.span<{ $danger?: boolean }>`
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: ${({ $danger }) => ($danger ? "var(--tide-danger)" : "var(--tide-muted)")};
`;

export const FloatingMenuSectionLabel = styled.div`
  padding: 6px 12px 2px;
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
`;
