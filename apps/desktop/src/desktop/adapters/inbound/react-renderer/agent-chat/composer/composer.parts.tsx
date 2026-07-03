import { styled } from "styled-components";

export const ComposerChipIcon = styled.span`
  flex: 0 0 auto;
  color: var(--tide-muted);

  [data-agent-icon] {
    width: 16px;
    height: 16px;
    border-radius: 5px;
    font-size: 8.5px;
  }
`;

export const ComposerChipLabel = styled.span`
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ComposerChipChevron = styled.span`
  flex: 0 0 auto;
  margin-left: 2px;
  color: var(--tide-muted);
  opacity: 0.8;
`;

const chipButtonBase = `
  height: 28px;
  max-width: 200px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--tide-line);
  border-radius: 999px;
  background: transparent;
  color: var(--tide-text);
  font-size: 12.5px;
  line-height: 1;
  white-space: nowrap;
  transition: background 0.12s ease, border-color 0.12s ease;
`;

export const ComposerContextChip = styled.button`
  ${chipButtonBase}
  min-width: 0;
  padding: 0 11px;
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
  }
`;

export const ComposerChoiceChip = styled.button<{ $variant?: "default" | "model" | "update" }>`
  ${chipButtonBase}
  min-width: ${({ $variant }) => ($variant === "model" ? "112px" : "0")};
  padding: 0 12px;
  cursor: pointer;

  &:hover {
    border-color: var(--tide-line);
    background: var(--tide-selection);
  }

  ${({ $variant }) =>
    $variant === "update"
      ? `
        ${ComposerChipIcon} {
          color: var(--tide-text);
        }
      `
      : ""}
`;
