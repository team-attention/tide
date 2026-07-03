import type { ProductShellHandlers } from "../support/types.ts";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { styled } from "styled-components";
import { WorkbenchCodeEditor } from "./code-editor.tsx";
import {
  safeFindInWebView,
  safeStopFindInWebView,
  type HtmlWebViewElement,
} from "./html-webview.ts";
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
  const webviewRef = useRef<HtmlWebViewElement | null>(null);
  const [webviewElement, setWebviewElement] = useState<HtmlWebViewElement | null>(null);
  const setWebviewRef = useCallback((element: HtmlWebViewElement | null) => {
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
    <HtmlModeButton
      type="button"
      data-html-mode-option="true"
      data-active={mode === target ? "true" : "false"}
      aria-pressed={mode === target}
      onClick={() => setMode(target)}
    >
      {label}
    </HtmlModeButton>
  );
  return (
    <HtmlViewFrame ref={rootRef} data-html-mode={effectiveMode}>
      <HtmlHeader>
        {props.breadcrumb ?? null}
        {canPreview ? (
          <HtmlModeToggle role="group" aria-label="HTML view mode">
            {toggle("preview", "Preview")}
            {toggle("code", "Code")}
          </HtmlModeToggle>
        ) : null}
      </HtmlHeader>
      {find.open && effectiveMode === "preview" ? (
        <InPaneFindBar
          query={find.query}
          matchCount={matchCount}
          activeIndex={find.activeIndex}
          scopeLabel="Preview"
          placeholder="Find in preview"
          onQueryChange={find.setQuery}
          onNext={previewFindNext}
          onPrevious={previewFindPrevious}
          onClose={find.closeFind}
        />
      ) : null}
      {effectiveMode === "preview" ? (
        <HtmlPreviewStage data-html-preview-stage="true">
          {/* `<webview>` is an Electron custom element with no JSX typing, so it stays a
              createElement call. file:// renders the saved page with its relative assets. */}
          {createElement("webview", {
            ref: setWebviewRef,
            "data-html-pane-webview": props.paneId,
            src: fileUrlFromPath(props.filePath as string),
            partition: "persist:tide-workbench-browser",
          })}
        </HtmlPreviewStage>
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
    </HtmlViewFrame>
  );
}

type BrowserFoundInPageEvent = Event & {
  result?: {
    activeMatchOrdinal?: number;
    matches?: number;
  };
};

const HtmlViewFrame = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
`;

const HtmlHeader = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--tide-line);

  [data-editor-breadcrumb] {
    min-height: 28px;
    flex: 1 1 160px;
    padding: 0;
  }
`;

const HtmlModeToggle = styled.div`
  flex: 0 0 auto;
  display: inline-flex;
  gap: 2px;
  margin-left: auto;
  padding: 2px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: var(--tide-surface);
`;

const HtmlModeButton = styled.button`
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  font: 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;

  &[data-active="true"] {
    background: var(--tide-bg);
    color: var(--tide-text);
    box-shadow: 0 1px 2px rgb(52 48 56 / 8%);
  }
`;

const HtmlPreviewStage = styled.div`
  position: relative;
  min-height: 0;
  flex: 1 1 0;
  display: flex;

  [data-html-pane-webview] {
    width: 100%;
    height: 100%;
    min-height: 0;
    flex: 1 1 0;
    display: flex;
    background: var(--tide-bg);
  }
`;
