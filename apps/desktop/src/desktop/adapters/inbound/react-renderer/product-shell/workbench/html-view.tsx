import type { ProductShellHandlers } from "../support/types.ts";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { WorkbenchCodeEditor } from "./code-editor.tsx";
import {
  safeFindInWebView,
  safeStopFindInWebView,
  type BrowserWebViewElement,
} from "./browser-webview-actions.ts";
import { InPaneFindBar, useInPaneFindState, usePaneFindIntent } from "../../support/in-pane-find.tsx";
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
  gitDiffText?: string;
  // The file-path breadcrumb, rendered INLINE in the header row next to the
  // Preview/Code toggle (one row), like the Browser Pane's address bar.
  breadcrumb?: ReactElement;
  handlers: ProductShellHandlers;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<BrowserWebViewElement | null>(null);
  const [webviewElement, setWebviewElement] = useState<BrowserWebViewElement | null>(null);
  const setWebviewRef = useCallback((element: BrowserWebViewElement | null) => {
    webviewRef.current = element;
    setWebviewElement(element);
  }, []);
  const canPreview = typeof props.filePath === "string" && props.filePath.length > 0;
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const find = useInPaneFindState();
  const [matchCount, setMatchCount] = useState(0);
  // No resolvable file path ⇒ nothing to render in a browser; show Code only.
  const effectiveMode = canPreview ? mode : "code";
  const previewFindNext = useCallback(() => {
    const query = find.query.trim();
    const webview = webviewRef.current;
    if (query.length > 0 && webview !== null) {
      safeFindInWebView(webview, query, { findNext: true, forward: true, matchCase: false });
    }
  }, [find.query]);
  const previewFindPrevious = useCallback(() => {
    const query = find.query.trim();
    const webview = webviewRef.current;
    if (query.length > 0 && webview !== null) {
      safeFindInWebView(webview, query, { findNext: true, forward: false, matchCase: false });
    }
  }, [find.query]);
  usePaneFindIntent(rootRef, {
    enabled: effectiveMode === "preview",
    open: find.open,
    onOpen: find.openFind,
    onClose: find.closeFind,
    onNext: previewFindNext,
    onPrevious: previewFindPrevious,
  });
  useEffect(() => {
    const webview = webviewElement;
    if (webview === null) {
      return undefined;
    }
    const onFound = (event: Event): void => {
      const result = (event as BrowserFoundInPageEvent).result;
      if (typeof result?.matches === "number") {
        setMatchCount(result.matches);
      }
      if (typeof result?.activeMatchOrdinal === "number" && result.activeMatchOrdinal > 0) {
        find.setActiveIndex(result.activeMatchOrdinal - 1);
      }
    };
    webview.addEventListener("found-in-page", onFound);
    return () => webview.removeEventListener("found-in-page", onFound);
  }, [webviewElement, find.setActiveIndex]);
  useEffect(() => {
    const webview = webviewElement;
    const query = find.query.trim();
    if (webview === null) {
      return undefined;
    }
    if (!find.open || effectiveMode !== "preview" || query.length === 0) {
      setMatchCount(0);
      safeStopFindInWebView(webview, "clearSelection");
      return undefined;
    }
    safeFindInWebView(webview, query, { findNext: false, forward: true, matchCase: false });
    return undefined;
  }, [webviewElement, effectiveMode, find.open, find.query, props.paneId]);
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
    <div ref={rootRef} className="workbench-html" data-html-mode={effectiveMode}>
      <div className="workbench-html-header">
        {props.breadcrumb ?? null}
        {canPreview ? (
          <div className="workbench-html-toggle" role="group" aria-label="HTML view mode">
            {toggle("preview", "Preview")}
            {toggle("code", "Code")}
          </div>
        ) : null}
      </div>
      {find.open && effectiveMode === "preview" ? (
        <InPaneFindBar
          query={find.query}
          matchCount={matchCount}
          activeIndex={find.activeIndex}
          placeholder="Find in preview"
          onQueryChange={find.setQuery}
          onNext={previewFindNext}
          onPrevious={previewFindPrevious}
          onClose={find.closeFind}
        />
      ) : null}
      {effectiveMode === "preview" ? (
        <div className="workbench-html-stage">
          {/* `<webview>` is an Electron custom element with no JSX typing, so it stays a
              createElement call (same as the Browser Pane). file:// renders the saved
              page with its relative assets. */}
          {createElement("webview", {
            ref: setWebviewRef,
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
          gitDiffText={props.gitDiffText}
          navigationTarget={undefined}
          relativePath={props.relativePath}
          handlers={props.handlers}
        />
      )}
    </div>
  );
}

type BrowserFoundInPageEvent = Event & {
  result?: {
    activeMatchOrdinal?: number;
    matches?: number;
  };
};
