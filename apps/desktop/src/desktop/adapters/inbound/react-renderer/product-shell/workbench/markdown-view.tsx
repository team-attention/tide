import type { ProductShellHandlers } from "../support/types.ts";
import { useState, type ReactElement } from "react";
import { styled } from "styled-components";
import { WorkbenchCodeEditor } from "./code-editor.tsx";

export type MarkdownEditorPresentation = "live-preview" | "source";

// Markdown keeps one CodeMirror document mounted. The control only changes the
// presentation extensions, so selection, history, draft state, and scroll stay
// attached to the same editor instance.
export function WorkbenchMarkdownView(props: {
  paneId: string;
  value: string;
  readOnly: boolean;
  dirty: boolean;
  revision: string;
  relativePath?: string;
  gitDiffText?: string;
  breadcrumb?: ReactElement;
  handlers: ProductShellHandlers;
}): ReactElement {
  const [presentation, setPresentation] = useState<MarkdownEditorPresentation>("live-preview");
  const toggle = (target: MarkdownEditorPresentation, label: string) => (
    <MarkdownModeButton
      type="button"
      data-md-mode-option="true"
      data-active={presentation === target ? "true" : "false"}
      aria-pressed={presentation === target}
      onClick={() => setPresentation(target)}
    >
      {label}
    </MarkdownModeButton>
  );

  return (
    <MarkdownViewFrame data-md-mode={presentation}>
      <MarkdownHeader data-md-header="true">
        {props.breadcrumb ?? null}
        <MarkdownModeToggle data-md-toggle="true" role="group" aria-label="Markdown presentation">
          {toggle("live-preview", "Live Preview")}
          {toggle("source", "Source")}
        </MarkdownModeToggle>
      </MarkdownHeader>
      <WorkbenchCodeEditor
        paneId={props.paneId}
        value={props.value}
        readOnly={props.readOnly}
        dirty={props.dirty}
        language="markdown"
        revision={props.revision}
        gitDiffText={props.gitDiffText}
        navigationTarget={undefined}
        relativePath={props.relativePath}
        presentation={presentation === "live-preview" ? "markdown-live" : "markdown-source"}
        handlers={props.handlers}
      />
    </MarkdownViewFrame>
  );
}

const MarkdownViewFrame = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  background: var(--tide-bg);
`;

const MarkdownHeader = styled.div`
  min-height: 38px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 10px 3px 12px;
  border-bottom: 1px solid var(--tide-line);
  background: var(--tide-bg);

  [data-editor-breadcrumb] {
    min-height: 30px;
    flex: 1 1 160px;
    padding: 0;
  }
`;

const MarkdownModeToggle = styled.div`
  flex: 0 0 auto;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-surface);
`;

const MarkdownModeButton = styled.button`
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  font: 520 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;

  &:hover {
    color: var(--tide-text);
  }

  &[data-active="true"] {
    background: var(--tide-bg);
    color: var(--tide-text);
    box-shadow: 0 1px 2px rgb(52 48 56 / 8%);
  }

  &:focus-visible {
    outline-offset: -2px;
  }
`;
