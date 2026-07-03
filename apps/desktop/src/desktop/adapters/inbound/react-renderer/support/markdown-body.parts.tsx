import { styled } from "styled-components";

export const MarkdownBodySurface = styled.div`
  > :first-child {
    margin-top: 0;
  }

  h1 {
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--tide-line);
    color: var(--tide-text);
    font-size: 30px;
    font-weight: 700;
    line-height: 38px;
  }

  h2 {
    margin: 28px 0 14px;
    padding-bottom: 7px;
    border-bottom: 1px solid var(--tide-line);
    color: var(--tide-text);
    font-size: 22px;
    font-weight: 700;
    line-height: 30px;
  }

  h3 {
    margin: 18px 0 8px;
    color: var(--tide-text);
    font-size: 16px;
    font-weight: 600;
    line-height: 24px;
  }

  h4 {
    margin: 16px 0 8px;
    color: var(--tide-text);
    font-size: 14.5px;
    font-weight: 600;
    line-height: 22px;
  }

  h5,
  h6 {
    margin: 14px 0 6px;
    color: var(--tide-muted);
    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    text-transform: none;
  }

  p,
  ul,
  ol {
    margin: 0 0 16px;
  }

  ul,
  ol {
    padding-left: 24px;
  }

  li {
    margin: 4px 0;
  }

  li > p {
    margin: 8px 0;
  }

  a {
    color: var(--tide-action);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  code {
    padding: 0.16em 0.38em;
    border: 1px solid var(--tide-line);
    border-radius: 6px;
    background: var(--tide-surface);
    font: 13px/1.4 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  pre {
    margin: 0 0 16px;
    padding: 14px 16px;
    overflow: auto;
    border: 1px solid var(--tide-line);
    border-radius: 8px;
    background: var(--tide-surface);
  }

  pre code {
    padding: 0;
    border: 0;
    background: transparent;
    font-size: 12.5px;
  }

  blockquote {
    margin: 0 0 16px;
    padding: 2px 0 2px 14px;
    border-left: 3px solid var(--tide-line-strong);
    color: var(--tide-muted);
  }

  hr {
    margin: 24px 0;
    border: 0;
    border-top: 1px solid var(--tide-line);
  }

  del {
    color: var(--tide-muted);
  }

  img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    position: relative;
    scroll-margin-top: 16px;
  }

  .markdown-heading-anchor {
    display: inline-flex;
    width: 18px;
    margin-left: -22px;
    margin-right: 4px;
    color: var(--tide-muted);
    text-decoration: none;
    opacity: 0;
  }

  h1:hover .markdown-heading-anchor,
  h2:hover .markdown-heading-anchor,
  h3:hover .markdown-heading-anchor,
  h4:hover .markdown-heading-anchor,
  h5:hover .markdown-heading-anchor,
  h6:hover .markdown-heading-anchor,
  .markdown-heading-anchor:focus-visible {
    opacity: 1;
  }

  pre.md-fence {
    background: var(--tide-surface);
  }

  table {
    display: block;
    width: max-content;
    max-width: 100%;
    margin: 0 0 16px;
    overflow-x: auto;
    border-collapse: collapse;
    font-size: 14px;
  }

  th,
  td {
    padding: 6px 12px;
    border: 1px solid var(--tide-line);
    text-align: left;
  }

  thead th {
    background: var(--tide-surface);
    font-weight: 650;
  }

  .contains-task-list {
    padding-left: 4px;
    list-style: none;
  }

  .task-list-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 6px 0;
  }

  .task-list-item-checkbox {
    flex: 0 0 auto;
    margin: 5px 0 0;
  }
`;
