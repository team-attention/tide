import { css } from "styled-components";

// Presentation-only styling for the Markdown CodeMirror extension. Shared
// editor chrome and source typography stay in code-editor.styles.ts.
export const markdownLivePreviewStyles = css`
  &[data-editor-presentation="markdown-live"] .cm-editor {
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 22px;
  }

  &[data-editor-presentation="markdown-live"] .cm-content {
    width: min(100%, 75ch);
    margin: 0 auto;
    padding: 24px clamp(20px, 5vw, 56px) 56px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 22px;
  }

  &[data-editor-presentation="markdown-live"] .cm-line {
    padding-right: 0;
    padding-left: 0;
  }

  &[data-editor-presentation="markdown-live"] .cm-gutters {
    background: var(--tide-code-bg);
    color: color-mix(in srgb, var(--tide-code-muted) 70%, transparent);
  }

  .cm-md-marker-hidden {
    display: inline-block;
    width: 0;
    max-width: 0;
    overflow: hidden;
    color: transparent;
    font-size: 0;
    line-height: 0;
    opacity: 0;
    pointer-events: none;
    vertical-align: baseline;
  }

  .cm-md-heading {
    color: var(--tide-code-text);
  }

  .cm-md-heading-1 {
    padding-top: 8px;
    padding-bottom: 8px;
    font-size: 25px;
    font-weight: 650;
    line-height: 32px;
  }

  .cm-md-heading-2 {
    padding-top: 12px;
    padding-bottom: 5px;
    font-size: 20px;
    font-weight: 650;
    line-height: 28px;
  }

  .cm-md-heading-3 {
    padding-top: 9px;
    padding-bottom: 3px;
    font-size: 16px;
    font-weight: 600;
    line-height: 24px;
  }

  .cm-md-heading-4,
  .cm-md-heading-5,
  .cm-md-heading-6 {
    padding-top: 7px;
    padding-bottom: 2px;
    font-weight: 650;
  }

  .cm-md-heading-5,
  .cm-md-heading-6 {
    color: color-mix(in srgb, var(--tide-code-text) 76%, var(--tide-code-muted));
    font-size: 13px;
    letter-spacing: 0.015em;
    text-transform: uppercase;
  }

  .cm-md-strong {
    color: var(--tide-code-text);
    font-weight: 650;
  }

  .cm-md-emphasis {
    font-style: italic;
  }

  .cm-md-strikethrough {
    color: var(--tide-code-muted);
    text-decoration: line-through;
  }

  .cm-md-inline-code {
    padding: 1px 4px;
    border: 1px solid color-mix(in srgb, var(--tide-code-line) 82%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--tide-code-chrome) 72%, transparent);
    color: var(--tide-code-text);
    font: 12px/1.55 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .cm-md-link {
    color: var(--tide-code-link);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--tide-code-link) 48%, transparent);
    text-underline-offset: 3px;
  }

  .cm-md-blockquote {
    margin-top: 4px;
    margin-bottom: 4px;
    padding-left: 14px !important;
    border-left: 1px solid var(--tide-code-line);
    color: color-mix(in srgb, var(--tide-code-text) 72%, var(--tide-code-muted));
  }

  .cm-md-list-line {
    padding-left: 16px !important;
  }

  .cm-md-list-marker {
    display: inline-flex;
    width: 16px;
    justify-content: flex-start;
    color: var(--tide-code-muted);
    font: 12px/22px Inter, ui-sans-serif, system-ui, sans-serif;
    user-select: none;
  }

  .cm-md-task-checkbox {
    width: 14px;
    height: 14px;
    margin: 0 7px 0 0;
    accent-color: var(--tide-action);
    vertical-align: -2px;
  }

  .cm-md-horizontal-rule {
    min-height: 22px;
    color: transparent;
  }

  .cm-md-horizontal-rule::after {
    content: "";
    display: block;
    margin-top: 10px;
    border-top: 1px solid var(--tide-code-line);
  }

  .cm-md-fence-boundary,
  .cm-md-fence-code {
    padding-right: 14px !important;
    padding-left: 14px !important;
    background: color-mix(in srgb, var(--tide-code-chrome) 72%, var(--tide-code-bg));
  }

  .cm-md-fence-boundary {
    min-height: 9px;
    color: transparent;
  }

  .cm-md-fence-open {
    margin-top: 8px;
    padding-top: 8px;
    border: 1px solid var(--tide-code-line);
    border-bottom: 0;
    border-radius: 6px 6px 0 0;
  }

  .cm-md-fence-open::after {
    content: attr(data-md-language);
    color: var(--tide-code-muted);
    font: 500 11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
  }

  .cm-md-fence-code {
    border-right: 1px solid var(--tide-code-line);
    border-left: 1px solid var(--tide-code-line);
    color: var(--tide-code-text);
    font: 12px/1.55 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre;
  }

  .cm-md-fence-close {
    margin-bottom: 8px;
    padding-bottom: 8px;
    border: 1px solid var(--tide-code-line);
    border-top: 0;
    border-radius: 0 0 6px 6px;
  }

  .cm-md-table-row,
  .cm-md-table-header {
    overflow-x: auto;
    padding: 5px 8px !important;
    border-right: 1px solid var(--tide-code-line);
    border-bottom: 1px solid var(--tide-code-line);
    border-left: 1px solid var(--tide-code-line);
    font-size: 13px;
    white-space: nowrap;
  }

  .cm-md-table-header {
    margin-top: 8px;
    border-top: 1px solid var(--tide-code-line);
    border-radius: 6px 6px 0 0;
    background: color-mix(in srgb, var(--tide-code-chrome) 76%, transparent);
    font-weight: 650;
  }

  .cm-md-table-row:last-of-type {
    border-radius: 0 0 6px 6px;
  }

  .cm-md-table-cell {
    display: inline-block;
    min-width: 10ch;
    padding: 0 8px;
  }

  .cm-md-table-separator {
    min-height: 1px;
    max-height: 1px;
    overflow: hidden;
    padding: 0 !important;
    border-right: 1px solid var(--tide-code-line);
    border-left: 1px solid var(--tide-code-line);
    color: transparent;
    font-size: 0;
    line-height: 0;
  }

  .cm-md-image-preview {
    max-width: min(100%, 620px);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0 12px;
    padding: 8px;
    border: 1px solid var(--tide-code-line);
    border-radius: 6px;
    background: color-mix(in srgb, var(--tide-code-chrome) 58%, transparent);
    color: var(--tide-code-muted);
    font: 12px/1.45 Inter, ui-sans-serif, system-ui, sans-serif;
  }

  .cm-md-image-preview img {
    max-width: 100%;
    max-height: 280px;
    display: block;
    border-radius: 4px;
  }
`;
