import type { ProductShellHandlers } from "../support/types.ts";
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { WorkbenchCodeEditor } from "./code-editor.tsx";
// Extracted alongside markdown-view.tsx (spec: workbench-html-preview.md).

// Build a file:// URL from an absolute path, encoding each segment so spaces / # / ?
// don't break the URL. Normalizes Windows backslashes and forces a leading slash so a
// drive letter (C:) becomes the path, not a hostname (file:///C:/…) — and that
// drive-letter segment's colon is left unencoded. Exported for unit testing.
export function fileUrlFromPath(filePath: string): string {
  const forward = filePath.replace(/\\/g, "/");
  const rooted = forward.startsWith("/") ? forward : `/${forward}`;
  const encoded = rooted
    .split("/")
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join("/");
  return `file://${encoded}`;
}

// HTML Editor Pane: a rendered Preview (the page in a <webview>, like a browser) by
// default, toggleable to a raw-source Code editor — mirrors WorkbenchMarkdownView's
// Preview/Edit toggle. Preview renders the SAVED file via file:// so relative assets
// resolve; the webview is conditionally rendered, so toggling back to Preview after a
// save in Code mode remounts it and shows the latest.
export function WorkbenchHtmlView(props: {
  paneId: string;
  value: string;
  readOnly: boolean;
  dirty: boolean;
  revision: string;
  filePath?: string;
  relativePath?: string;
  // The file-path breadcrumb, rendered INLINE in the header row next to the
  // Preview/Code toggle (one row), like the Browser Pane's address bar.
  breadcrumb?: ReactElement;
  handlers: ProductShellHandlers;
}): ReactElement {
  const canPreview = typeof props.filePath === "string" && props.filePath.length > 0;
  const [mode, setMode] = useState<"preview" | "code">("preview");
  // No resolvable file path ⇒ nothing to render in a browser; show Code only.
  const effectiveMode = canPreview ? mode : "code";
  const toggle = (target: "preview" | "code", label: string) => (
    <button
      type="button"
      className="workbench-html-toggle__option"
      data-active={mode === target ? "true" : "false"}
      aria-pressed={mode === target}
      onClick={() => setMode(target)}
    >
      {label}
    </button>
  );
  return (
    <div className="workbench-html" data-html-mode={effectiveMode}>
      <div className="workbench-html-header">
        {props.breadcrumb ?? null}
        {canPreview ? (
          <div className="workbench-html-toggle" role="group" aria-label="HTML view mode">
            {toggle("preview", "Preview")}
            {toggle("code", "Code")}
          </div>
        ) : null}
      </div>
      {effectiveMode === "preview" ? (
        <div className="workbench-html-stage">
          {/* `<webview>` is an Electron custom element with no JSX typing, so it stays a
              createElement call (same as the Browser Pane). file:// renders the saved
              page with its relative assets. */}
          {createElement("webview", {
            className: "workbench-html-webview",
            "data-html-pane-webview": props.paneId,
            src: fileUrlFromPath(props.filePath as string),
            partition: "persist:tide-workbench-browser",
          })}
        </div>
      ) : (
        <WorkbenchCodeEditor
          paneId={props.paneId}
          value={props.value}
          readOnly={props.readOnly}
          dirty={props.dirty}
          language="html"
          revision={props.revision}
          navigationTarget={undefined}
          relativePath={props.relativePath}
          handlers={props.handlers}
        />
      )}
    </div>
  );
}
