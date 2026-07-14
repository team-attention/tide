import { styled } from "styled-components";

export const CodeEditorSurface = styled.div`
  --tide-code-bg: #171716;
  --tide-code-chrome: #20201f;
  --tide-code-gutter: #131312;
  --tide-code-line: #31302d;
  --tide-code-line-soft: #272623;
  --tide-code-text: #dbd9d2;
  --tide-code-muted: #77746c;
  --tide-code-selection: rgba(48, 116, 197, 0.42);
  --tide-code-active-line: rgba(57, 112, 240, 0.12);
  --tide-code-cursor: #efe7c8;
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--tide-code-bg);
`;

export const CodeEditorCommandBar = styled.div`
  min-height: 32px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-top: 1px solid var(--tide-code-line);
  border-bottom: 1px solid var(--tide-code-line);
  background: var(--tide-code-chrome);
`;

export const CodeEditorCommandButton = styled.button`
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-code-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--tide-code-text) 10%, transparent);
    color: var(--tide-code-text);
  }

  &:focus-visible {
    outline: 2px solid var(--tide-action);
    outline-offset: -2px;
  }

  &:disabled {
    cursor: default;
    opacity: 0.34;
  }
`;

export const CodeEditorCommandSeparator = styled.span`
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--tide-code-line);
`;

export const CodeMirrorHost = styled.div`
  min-height: 0;
  flex: 1 1 auto;

  > div {
    min-height: 0;
    height: 100%;
    flex: 1 1 auto;
  }

  .cm-editor {
    height: 100%;
    background: var(--tide-code-bg);
    color: var(--tide-code-text);
    font: 12.5px/1.62 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-ligatures: contextual;
  }

  .cm-scroller {
    overflow: auto;
    background: var(--tide-code-bg);
  }

  .cm-content {
    min-height: 100%;
    padding: 12px 0 28px;
    caret-color: var(--tide-code-cursor);
  }

  .cm-line {
    padding: 0 28px 0 18px;
  }

  .cm-cursor,
  .cm-dropCursor {
    border-left-color: var(--tide-code-cursor);
  }

  .cm-tide-occurrence {
    border-radius: 2px;
    background: rgba(var(--tide-ink-rgb), 0.09);
  }

  .cm-tide-occurrence--write {
    background: rgba(var(--tide-ink-rgb), 0.17);
  }

  .cm-tide-cmdlink {
    color: #7dcfff;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .cm-tide-git-line {
    background-image: linear-gradient(
      90deg,
      var(--tide-git-line-color) 0 3px,
      transparent 3px
    );
  }

  .cm-tide-git-line--added {
    --tide-git-line-color: var(--tide-diff-add);
    background-color: color-mix(in srgb, var(--tide-diff-add) 9%, transparent);
  }

  .cm-tide-git-line--changed {
    --tide-git-line-color: var(--tide-diff-add);
    background-color: color-mix(in srgb, var(--tide-diff-add) 11%, var(--tide-diff-del) 5%, transparent);
  }

  .cm-tide-git-line--deleted {
    --tide-git-line-color: var(--tide-diff-del);
    background-color: color-mix(in srgb, var(--tide-diff-del) 8%, transparent);
  }

  .cm-tooltip {
    overflow: hidden;
    border: 1px solid var(--tide-code-line);
    border-radius: 6px;
    background: var(--tide-code-chrome);
    color: var(--tide-code-text);
    box-shadow: var(--tide-shadow-popover);
  }

  .cm-tide-hover,
  .cm-tide-signature {
    max-width: 480px;
    overflow-wrap: break-word;
    padding: 7px 10px;
    font: 12px/1.55 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap;
  }

  .cm-tide-hover {
    max-height: 320px;
    overflow-y: auto;
  }

  .cm-tide-signature strong {
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .cm-tooltip-autocomplete > ul {
    max-height: 240px;
    font: 12px/1.7 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .cm-tooltip-autocomplete > ul > li {
    padding: 2px 8px;
    color: var(--tide-code-text);
  }

  .cm-tooltip-autocomplete > ul > li[aria-selected] {
    background: var(--tide-code-active-line);
    color: var(--tide-code-text);
  }

  .cm-completionIcon {
    color: var(--tide-code-muted);
  }

  .cm-completionDetail {
    margin-left: 8px;
    color: var(--tide-code-muted);
    font-style: normal;
  }

  .cm-gutters {
    border-right: 1px solid var(--tide-code-line-soft);
    background: var(--tide-code-gutter);
    color: var(--tide-code-muted);
    font-size: 12px;
  }

  .cm-gutterElement {
    padding: 0 10px 0 16px;
  }

  .cm-lineNumbers .cm-gutterElement {
    min-width: 44px;
  }

  .cm-activeLineGutter {
    color: color-mix(in srgb, var(--tide-code-text) 82%, transparent);
  }

  .cm-activeLine,
  .cm-activeLineGutter {
    background: var(--tide-code-active-line);
  }

  .cm-editor.cm-focused {
    outline: none;
  }

  .cm-selectionBackground,
  .cm-focused .cm-selectionBackground,
  .cm-content ::selection {
    background: var(--tide-code-selection) !important;
  }

  .tok-keyword,
  .tok-controlKeyword,
  .tok-moduleKeyword,
  .tok-operatorKeyword {
    color: #c792ea;
  }

  .tok-string,
  .tok-string2,
  .tok-special.tok-string {
    color: #8bdc8b;
  }

  .tok-comment,
  .tok-lineComment,
  .tok-blockComment {
    color: #77746c;
    font-style: italic;
  }

  .tok-number,
  .tok-bool,
  .tok-atom {
    color: #f6bd60;
  }

  .tok-typeName,
  .tok-className,
  .tok-namespace {
    color: #82aaff;
  }

  .tok-function,
  .tok-function.tok-variableName,
  .tok-macroName {
    color: #7dcfff;
  }

  .tok-propertyName {
    color: #ff8f8f;
  }

  .tok-variableName,
  .tok-definition.tok-variableName {
    color: #dbd9d2;
  }

  .tok-operator,
  .tok-punctuation,
  .tok-bracket,
  .tok-separator {
    color: #8e8a82;
  }

  .tok-meta,
  .tok-annotation {
    color: #f6bd60;
  }

  .tok-link,
  .tok-url {
    color: #7dcfff;
  }

  .tok-heading {
    color: #ff8f8f;
    font-weight: 650;
  }
`;

export const CodeEditorSelectionToolbar = styled.button`
  position: fixed;
  z-index: 80;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--tide-line-strong, var(--tide-line));
  border-radius: 8px;
  background: var(--tide-text);
  color: var(--tide-bg);
  box-shadow: 0 6px 18px -6px rgba(36, 33, 38, 0.45);
  cursor: pointer;
  font: 600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  white-space: nowrap;

  svg {
    color: var(--tide-bg);
    opacity: 0.85;
  }

  &:hover {
    opacity: 0.92;
  }
`;

export const CodeEditorMenuBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
`;

export const CodeEditorMenu = styled.div`
  position: fixed;
  min-width: 184px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--tide-line-strong, var(--tide-line));
  border-radius: 8px;
  background: var(--tide-bg);
  box-shadow: 0 10px 30px -10px rgb(20 18 24 / 28%);
  animation: tide-pop-in 0.13s ease;
  transform-origin: top;
`;

export const CodeEditorMenuItem = styled.button`
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-text);
  cursor: pointer;
  font: 13px/1 -apple-system, system-ui, sans-serif;
  text-align: left;
  transition: background-color 0.12s ease, color 0.12s ease;

  &:hover:not(:disabled) {
    background: var(--tide-selection);
  }

  &:disabled {
    cursor: default;
    opacity: 0.4;
  }
`;

export const CodeEditorMenuSeparator = styled.div`
  height: 1px;
  margin: 4px 8px;
  background: var(--tide-line);
`;
