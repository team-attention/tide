import { styled } from "styled-components";

export const PromptCardFrame = styled.div<{ $wizard?: boolean }>`
  min-width: 0;
  max-height: min(520px, calc(100vh - 220px));
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--tide-line);
  border-radius: 12px;
  background: var(--tide-bg);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.14);
  overflow: hidden;
`;

export const PromptHead = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
`;

export const PromptBody = styled.div`
  min-height: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  padding-right: 2px;
`;

export const PromptKind = styled.span`
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--tide-muted);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.04em;
  line-height: 1.3;
  text-transform: uppercase;
`;

export const PromptHeaderChip = styled.span`
  max-width: 100%;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--tide-selection);
  color: var(--tide-text);
  font-size: 11px;
  font-weight: 620;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: none;
  white-space: nowrap;
`;

export const PromptMessage = styled.p`
  margin: 0;
  color: var(--tide-text);
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
`;

export const PromptOptions = styled.div`
  flex: 0 0 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
`;

export const PromptOptionButton = styled.button`
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid var(--tide-line);
  border-radius: 9px;
  background: var(--tide-bg);
  color: var(--tide-text);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background 0.12s ease, border-color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
  }

  &[data-selected="true"] {
    border-color: var(--tide-action);
    background: color-mix(in srgb, var(--tide-action) 10%, var(--tide-bg));
  }

  &[data-kind="reject_once"],
  &[data-kind="reject_always"] {
    border-color: color-mix(in srgb, var(--tide-danger) 24%, var(--tide-line));
  }
`;

export const PromptOptionMark = styled.span`
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  margin-top: 2px;
  border: 1px solid var(--tide-line-strong, var(--tide-line));
  border-radius: 999px;
  background: transparent;

  ${PromptOptionButton}[data-selected="true"] & {
    border-color: var(--tide-action);
    box-shadow: inset 0 0 0 4px var(--tide-action);
  }

  ${PromptOptionButton}[data-multi="true"] & {
    border-radius: 4px;
  }

  ${PromptOptionButton}[data-multi="true"][data-selected="true"] & {
    display: grid;
    place-items: center;
    box-shadow: none;
    background: var(--tide-action);
  }

  ${PromptOptionButton}[data-multi="true"][data-selected="true"] &::after {
    content: "";
    width: 6px;
    height: 3px;
    border-bottom: 1.5px solid var(--tide-bg);
    border-left: 1.5px solid var(--tide-bg);
    transform: rotate(-45deg) translateY(-1px);
  }
`;

export const PromptOptionText = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const PromptOptionLabel = styled.span`
  font-weight: 500;
`;

export const PromptOptionValue = styled.span`
  color: var(--tide-muted);
  font-size: 12px;
  line-height: 1.35;
  overflow-wrap: anywhere;
`;

export const PromptOptionShortcut = styled.span`
  flex: 0 0 auto;
  color: var(--tide-muted);
  font-size: 11px;
`;

export const PromptOptionPreview = styled.pre`
  max-height: 180px;
  overflow: auto;
  margin: 0;
  padding: 9px 10px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: var(--tide-surface);
  color: var(--tide-text);
  font: 12px/1.5 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
`;

const promptTextareaCss = `
  width: 100%;
  min-height: 38px;
  flex: 0 0 auto;
  padding: 9px 10px;
  border: 1px dashed var(--tide-line-strong, var(--tide-line));
  border-radius: 9px;
  background: var(--tide-bg);
  color: var(--tide-text);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  resize: vertical;
  outline: none;
`;

export const PromptCustomReply = styled.textarea`
  ${promptTextareaCss}
  min-height: 64px;
  max-height: 150px;

  &:focus {
    border-color: var(--tide-action, var(--tide-muted));
  }
`;

export const PromptAnswerNote = styled.textarea`
  ${promptTextareaCss}
  min-height: 52px;

  &:focus {
    border-style: solid;
    border-color: var(--tide-action, var(--tide-muted));
  }
`;

export const PromptActions = styled.div`
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

export const PromptSecondaryButton = styled.button`
  padding: 7px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  font: inherit;
  font-size: 13px;

  &:hover {
    background: var(--tide-selection);
  }

  &:disabled {
    cursor: default;
    opacity: 0.4;
  }

  &:disabled:hover {
    background: transparent;
  }
`;

export const PromptSubmitButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 0;
  border-radius: 8px;
  background: var(--tide-action);
  color: var(--tide-on-action);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 620;

  &:disabled {
    cursor: default;
    opacity: 0.4;
  }
`;

export const PromptSubmitShortcut = styled.span`
  opacity: 0.65;
  font-size: 11px;
`;

export const PromptWizardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
`;

export const PromptStepCount = styled.span`
  color: var(--tide-muted);
  font-weight: 520;
`;

export const PromptStepTabs = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

export const PromptStepDot = styled.button`
  width: 9px;
  height: 9px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--tide-line-strong, var(--tide-line));
  cursor: pointer;
  transition: transform 0.12s ease, background 0.12s ease;

  &:hover {
    transform: scale(1.25);
  }

  &[data-answered="true"] {
    background: var(--tide-success);
  }

  &[data-active="true"] {
    background: var(--tide-action);
    transform: scale(1.25);
  }
`;

export const PromptDetail = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 2px;
`;

export const PromptDetailBody = styled.pre`
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--tide-selection);
  color: var(--tide-text);
  font: 12px/1.5 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-x: auto;
  white-space: pre-wrap;
`;

export const PromptDetailLine = styled.span`
  display: block;

  &[data-line="add"] {
    color: var(--tide-diff-add);
  }

  &[data-line="del"] {
    color: var(--tide-diff-del);
  }
`;

export const PromptDetailLocations = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

export const PromptDetailLocation = styled.span`
  max-width: 100%;
  padding: 2px 7px;
  border: 1px solid var(--tide-line);
  border-radius: 999px;
  color: var(--tide-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
