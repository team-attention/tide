import { keyframes, styled } from "styled-components";

const worktreeDialogSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

export const WorktreeDialogBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 16vh;
  background: rgba(36, 33, 38, 0.28);
  animation: tide-overlay-in 0.12s ease;
`;

export const WorktreeDialogPanel = styled.div`
  width: min(440px, calc(100vw - 48px));
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--tide-line-strong, var(--tide-line));
  border-radius: 12px;
  background: var(--tide-bg);
  box-shadow: 0 24px 60px -12px rgba(36, 33, 38, 0.35);
  animation: tide-sheet-in 0.16s ease;
`;

export const WorktreeDialogTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--tide-text);
  font-size: 14px;
  font-weight: 600;

  svg {
    color: var(--tide-muted);
  }
`;

export const WorktreeDialogInput = styled.input`
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  outline: none;
  background: var(--tide-surface);
  color: var(--tide-text);
  font-size: 14px;

  &:focus {
    border-color: var(--tide-line-strong, var(--tide-muted));
  }
`;

export const WorktreeDialogField = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const WorktreeDialogFieldLabel = styled.span`
  flex: 0 0 auto;
  color: var(--tide-muted);
  font-size: 12.5px;
`;

export const WorktreeDialogSelect = styled.select`
  min-width: 0;
  flex: 1 1 auto;
  padding: 7px 9px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  outline: none;
  background: var(--tide-surface);
  color: var(--tide-text);
  font-size: 13px;
  cursor: pointer;

  &:focus {
    border-color: var(--tide-line-strong, var(--tide-muted));
  }
`;

export const WorktreeDialogPreview = styled.div`
  overflow: hidden;
  color: var(--tide-muted);
  font-family: "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;

  &[data-kind="sentence"] {
    direction: ltr;
    white-space: normal;
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.45;
  }
`;

export const WorktreeDialogActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const WorktreeDialogButton = styled.button`
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

export const WorktreeDialogCancelButton = styled(WorktreeDialogButton)`
  border: 1px solid var(--tide-line);
  background: transparent;
  color: var(--tide-text);

  &:hover {
    background: var(--tide-selection);
  }
`;

export const WorktreeDialogConfirmButton = styled(WorktreeDialogButton)`
  border: 1px solid transparent;
  background: var(--tide-text);
  color: var(--tide-bg);

  &[data-variant="danger"] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: var(--tide-danger);
    color: var(--tide-bg);
  }
`;

export const WorktreeDeleteCheck = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--tide-text);
  font-size: 12.5px;
  cursor: pointer;

  input {
    cursor: pointer;
  }
`;

export const WorktreeDialogWarning = styled.div`
  padding: 7px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--tide-danger) 12%, transparent);
  color: var(--tide-danger);
  font-size: 12px;
  line-height: 1.4;
`;

export const WorktreeDialogSpinner = styled.span`
  display: inline-flex;
  animation: ${worktreeDialogSpin} 0.8s linear infinite;
`;
