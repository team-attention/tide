import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import {
  captureBrowserWebViewScreenshot,
  executeBrowserWebViewAction,
  isWebViewSettled,
  readBrowserWebViewSnapshot,
  safeFindInWebView,
  safeGetWebViewURL,
  safeInvokeWebView,
  safeLoadWebViewURL,
  safeStopFindInWebView,
  type BrowserWebViewElement,
} from "./browser-webview-actions.ts";
import { BrowserAgentOverlay } from "./browser-agent-overlay.tsx";
import {
  BROWSER_ELEMENT_PICKER_SCRIPT,
  normalizeBrowserUrl,
  safeWebviewExec,
  waitForPostActionSettle,
} from "./browser-pane-helpers.ts";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { ArrowLeft, ArrowRight, CornerDownRight, Crosshair, ExternalLink, FileText, RotateCw } from "lucide-react";
import { InPaneFindBar, useInPaneFindState, usePaneFindIntent } from "../../support/in-pane-find.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

type BrowserFoundInPageEvent = Event & {
  result?: {
    activeMatchOrdinal?: number;
    matches?: number;
  };
};

export function WorkbenchBrowserPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<BrowserWebViewElement | null>(null);
  const [webviewElement, setWebviewElement] = useState<BrowserWebViewElement | null>(null);
  const setWebviewRef = useCallback((element: BrowserWebViewElement | null) => {
    webviewRef.current = element;
    setWebviewElement(element);
  }, []);
  const find = useInPaneFindState();
  const [browserMatchCount, setBrowserMatchCount] = useState(0);
  const executedActionIdsRef = useRef<Set<string>>(new Set());
  // The webview `src` is PINNED to the pane's initial URL and never re-bound to
  // pane.url. A page load fires did-finish-load → snapshot, which writes the
  // resolved URL (e.g. google's ?zx=… cache-buster) back into pane.url; binding
  // src to that re-set the attribute, reloaded the page, fired another snapshot
  // with a fresh ?zx, and looped forever. Subsequent navigation goes through
  // webview.loadURL (see the effect below), not src. The component is keyed by
  // paneId at the call site, so a new pane remounts with its own initial src.
  const initialSrcRef = useRef(props.pane.url ?? "about:blank");
  const [address, setAddress] = useState(props.pane.url ?? "");
  // Floating "Add selection" toolbar that follows an in-page text selection. The
  // <webview> is isolated, so we poll its selection + bounding rect and map it
  // into host coordinates. This is distinct from the address-bar "Add page".
  const [browserSelToolbar, setBrowserSelToolbar] = useState<{ x: number; y: number; text: string } | null>(null);
  // Element-picker mode: a devtools-style "select component/block" engine — the
  // page highlights elements; clicking toggles each into a multi-selection and a
  // confirm attaches them all.
  const [pickMode, setPickMode] = useState(false);
  const [pickCount, setPickCount] = useState(0);
  const browserFindNext = useCallback(() => {
    const query = find.query.trim();
    if (query.length === 0) {
      return;
    }
    const webview = webviewRef.current;
    if (webview !== null) {
      safeFindInWebView(webview, query, { findNext: true, forward: true, matchCase: false });
    }
  }, [find.query]);
  const browserFindPrevious = useCallback(() => {
    const query = find.query.trim();
    if (query.length === 0) {
      return;
    }
    const webview = webviewRef.current;
    if (webview !== null) {
      safeFindInWebView(webview, query, { findNext: true, forward: false, matchCase: false });
    }
  }, [find.query]);
  usePaneFindIntent(rootRef, {
    enabled: true,
    open: find.open,
    onOpen: find.openFind,
    onClose: find.closeFind,
    onNext: browserFindNext,
    onPrevious: browserFindPrevious,
  });
  useEffect(() => {
    const webview = webviewElement;
    if (webview === null) {
      return undefined;
    }
    const onFound = (event: Event): void => {
      const result = (event as BrowserFoundInPageEvent).result;
      if (typeof result?.matches === "number") {
        setBrowserMatchCount(result.matches);
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
    if (!find.open || query.length === 0) {
      setBrowserMatchCount(0);
      safeStopFindInWebView(webview, "clearSelection");
      return undefined;
    }
    safeFindInWebView(webview, query, { findNext: false, forward: true, matchCase: false });
    return undefined;
  }, [webviewElement, find.open, find.query, props.pane.paneId]);
  useEffect(() => {
    const webview = webviewElement;
    if (webview?.executeJavaScript === undefined) {
      return undefined;
    }
    if (!pickMode) {
      setPickCount(0);
      void safeWebviewExec(webview, "window.__tideCancelPick && window.__tideCancelPick()");
      return undefined;
    }
    void safeWebviewExec(webview, BROWSER_ELEMENT_PICKER_SCRIPT);
    let cancelled = false;
    const poll = window.setInterval(() => {
      void safeWebviewExec(webview, "(window.__tidePicks ? window.__tidePicks.length : 0)").then((count) => {
        if (!cancelled && typeof count === "number") {
          setPickCount(count);
        }
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      void safeWebviewExec(webview, "window.__tideCancelPick && window.__tideCancelPick()");
    };
  }, [webviewElement, pickMode, props.pane.paneId]);
  const confirmElementPicks = () => {
    const webview = webviewRef.current;
    if (webview === null) {
      return;
    }
    void safeWebviewExec(webview, "JSON.stringify(window.__tidePicks || [])").then((raw) => {
      let picks: { text?: string; tag?: string }[] = [];
      try {
        picks = typeof raw === "string" ? (JSON.parse(raw) as { text?: string; tag?: string }[]) : [];
      } catch {
        picks = [];
      }
      const url = props.pane.url ?? address;
      const title = props.pane.title && props.pane.title !== "Browser" ? props.pane.title : url;
      const body = picks
        .map((p) => {
          const text = (p.text ?? "").trim();
          const tag = p.tag ?? "element";
          return `\`<${tag}>\`\n${text.split("\n").map((l) => `> ${l}`).join("\n")}`;
        })
        .join("\n\n");
      if (body.length > 0) {
        props.handlers.onAddContentToChat({
          kind: "browser",
          label: `${title.slice(0, 24)} · ${picks.length} element${picks.length === 1 ? "" : "s"}`,
          text: `From [${title}](${url}):\n\n${body}`,
        });
      }
      setPickMode(false);
    });
  };
  useEffect(() => {
    const webview = webviewElement;
    if (webview?.executeJavaScript === undefined) {
      return undefined;
    }
    let cancelled = false;
    const script =
      "(() => { const s = window.getSelection && window.getSelection(); const t = s ? s.toString() : ''; if (!t.trim()) return { text: '' }; const r = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null; return { text: t, left: r ? r.left : 0, top: r ? r.top : 0 }; })()";
    const tick = () => {
      void safeWebviewExec(webview, script)
        .then((result) => {
          if (cancelled) {
            return;
          }
          const record = result !== null && typeof result === "object" ? (result as Record<string, unknown>) : {};
          const text = typeof record.text === "string" ? record.text : "";
          if (text.trim().length === 0) {
            setBrowserSelToolbar((prev) => (prev === null ? prev : null));
            return;
          }
          const host = webview.getBoundingClientRect?.();
          const left = (host?.left ?? 0) + (typeof record.left === "number" ? record.left : 0);
          const top = (host?.top ?? 0) + (typeof record.top === "number" ? record.top : 0);
          setBrowserSelToolbar({ x: left, y: top, text });
        })
        .catch(() => {});
    };
    const interval = window.setInterval(tick, 500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [webviewElement, props.pane.paneId, props.pane.url]);
  // Keep the address bar in sync when the backend reports a navigated URL.
  useEffect(() => {
    if (props.pane.url !== undefined) {
      setAddress(props.pane.url);
    }
  }, [props.pane.url]);
  // Back/forward availability, tracked from the webview's own navigation events.
  const [nav, setNav] = useState<{ canBack: boolean; canForward: boolean }>({ canBack: false, canForward: false });
  useEffect(() => {
    const webview = webviewElement;
    if (webview === null) {
      return undefined;
    }
    const update = () => {
      try {
        setNav({
          canBack: typeof webview.canGoBack === "function" ? webview.canGoBack() : false,
          canForward: typeof webview.canGoForward === "function" ? webview.canGoForward() : false,
        });
      } catch {
        // webview not yet attached
      }
    };
    webview.addEventListener("did-navigate", update);
    webview.addEventListener("did-navigate-in-page", update);
    webview.addEventListener("did-finish-load", update);
    return () => {
      webview.removeEventListener("did-navigate", update);
      webview.removeEventListener("did-navigate-in-page", update);
      webview.removeEventListener("did-finish-load", update);
    };
  }, [webviewElement, props.pane.paneId]);
  // Apply EXTERNAL navigation (agent action / chat link → open_browser →
  // pane.url) via the webview API. `requestedUrlRef` tracks the URL we last
  // intended to be at — seeded with the initial src so we never re-load it at
  // mount, and updated to absorb the did-finish-load snapshot (which writes the
  // resolved ?zx URL back into pane.url). We only loadURL when the target is a
  // genuinely new destination — so the snapshot echo is a no-op (no reload loop)
  // while real navigation (incl. from about:blank) still works.
  const requestedUrlRef = useRef(initialSrcRef.current);
  useEffect(() => {
    const webview = webviewElement;
    const target = props.pane.url;
    if (webview?.loadURL === undefined || target === undefined || target.length === 0) {
      return;
    }
    if (target === requestedUrlRef.current) {
      return; // already handled (initial src, or a prior navigation/echo)
    }
    const current = safeGetWebViewURL(webview);
    if (current === undefined) {
      const loadWhenReady = () => {
        requestedUrlRef.current = target;
        safeLoadWebViewURL(webview, target);
      };
      webview.addEventListener("dom-ready", loadWhenReady, { once: true });
      return () => webview.removeEventListener("dom-ready", loadWhenReady);
    }
    requestedUrlRef.current = target;
    if (target === current) {
      return; // snapshot echo: the webview is already here
    }
    safeLoadWebViewURL(webview, target);
  }, [webviewElement, props.pane.url, props.pane.paneId]);
  const goBack = () => {
    const webview = webviewRef.current;
    if (webview !== null) {
      safeInvokeWebView(webview, "goBack");
    }
  };
  const goForward = () => {
    const webview = webviewRef.current;
    if (webview !== null) {
      safeInvokeWebView(webview, "goForward");
    }
  };
  const reload = () => {
    const webview = webviewRef.current;
    if (webview !== null) {
      safeInvokeWebView(webview, "reload");
    }
  };
  const navigate = () => {
    const url = normalizeBrowserUrl(address);
    if (url.length === 0) {
      return;
    }
    setAddress(url);
    const webview = webviewRef.current;
    if (webview?.loadURL !== undefined) {
      safeLoadWebViewURL(webview, url);
    }
    // Report the navigation so the backend pane reflects it; did-finish-load
    // will follow up with the resolved title/body snapshot.
    props.handlers.onBrowserSnapshot(props.pane.paneId, {
      revision: props.pane.revision,
      url,
      loading: true,
    });
  };
  // Latest revision via ref so the snapshot effect below does NOT depend on it: re-running
  // that effect on every backend revision bump would re-fire the already-loaded capture and
  // waste a capturePage per action/navigation.
  const snapshotRevisionRef = useRef(props.pane.revision);
  useEffect(() => {
    snapshotRevisionRef.current = props.pane.revision;
  }, [props.pane.revision]);
  useEffect(() => {
    const webview = webviewElement;
    if (webview === null) {
      return;
    }
    const paneId = props.pane.paneId;
    // Text-only on every load event (NO capturePage): the recurring did-stop-loading/
    // did-finish-load storm across every mounted pane is what pegged the host renderer. Pixels
    // are pulled on demand at observe time (pendingCapture). Spec:
    // docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
    const emitSnapshot = () => {
      void readBrowserWebViewSnapshot(webview).then((snapshot) => {
        props.handlers.onBrowserSnapshot(paneId, {
          revision: snapshotRevisionRef.current,
          loading: false,
          ...snapshot,
        });
      });
    };
    webview.addEventListener("dom-ready", emitSnapshot);
    webview.addEventListener("did-finish-load", emitSnapshot);
    webview.addEventListener("did-stop-loading", emitSnapshot);
    // Attach-race guard (spec browser-pane-live-pull-vision.md): a fast/static page can fire
    // its load events BEFORE this effect attaches the listeners above, so the URL/title would
    // never be reported. If the guest is already loaded, emit once now; the listeners cover
    // later loads. Deps are paneId-only so a backend revision bump does not re-run this.
    if (isWebViewSettled(webview)) {
      emitSnapshot();
    }
    return () => {
      webview.removeEventListener("dom-ready", emitSnapshot);
      webview.removeEventListener("did-finish-load", emitSnapshot);
      webview.removeEventListener("did-stop-loading", emitSnapshot);
    };
  }, [webviewElement, props.handlers, props.pane.paneId]);
  // Observe-time pixel-capture pull: the backend marks this pane with a pendingCapture when the
  // agent calls tide_observe_browser(vision). Capture the live <webview> NOW (capturePage) and
  // report it back — this is the ONLY place a screenshot is encoded, so a mounted pane never
  // PNG-encodes on the recurring page-load storm. Spec:
  // docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
  // Only the CURRENT pendingCapture needs de-duping (captureIds are unique + monotonic), so one
  // last-id string is O(1) vs. a Set that would grow over the pane's lifetime.
  const lastCapturedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const webview = webviewElement;
    const capture = props.pane.pendingCapture;
    if (
      webview === null ||
      capture === undefined ||
      lastCapturedIdRef.current === capture.captureId
    ) {
      return;
    }
    lastCapturedIdRef.current = capture.captureId;
    const paneId = props.pane.paneId;
    const captureId = capture.captureId;
    void captureBrowserWebViewScreenshot(webview).then((screenshot) => {
      props.handlers.onBrowserCaptureResult(paneId, { captureId, screenshot });
    });
  }, [webviewElement, props.handlers, props.pane.paneId, props.pane.pendingCapture?.captureId]);
  useEffect(() => {
    const webview = webviewElement;
    const action = props.pane.pendingAction;
    if (
      webview === null ||
      props.pane.url === undefined ||
      action === undefined ||
      executedActionIdsRef.current.has(action.actionId)
    ) {
      return;
    }
    executedActionIdsRef.current.add(action.actionId);
    const paneId = props.pane.paneId;
    const revision = props.pane.revision;
    void executeBrowserWebViewAction(webview, action)
      .then(async (actionResult) => {
        await waitForPostActionSettle(webview);
        // Text-only: the post-action pixels (if the agent wants them) are pulled on its next
        // tide_observe_browser via pendingCapture, not captured here. Spec:
        // docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
        const snapshot = await readBrowserWebViewSnapshot(webview);
        props.handlers.onBrowserActionResult(paneId, {
          revision,
          actionId: action.actionId,
          status: actionResult.ok ? "completed" : "failed",
          message: actionResult.message,
          loading: false,
          ...snapshot,
        });
      })
      .catch((error: unknown) => {
        props.handlers.onBrowserActionResult(paneId, {
          revision,
          actionId: action.actionId,
          status: "failed",
          message: error instanceof Error ? error.message : "Browser action failed.",
          loading: false,
        });
      });
  }, [
    webviewElement,
    props.handlers,
    props.pane.paneId,
    props.pane.pendingAction?.actionId,
    props.pane.revision,
    props.pane.url,
  ]);
  return (
    <div ref={rootRef} className="workbench-pane-content workbench-pane-content--browser">
      {/* Slim editable address bar — the page fills the pane below it. */}
      <form
        className="workbench-browser-bar"
        aria-label="Browser address"
        onSubmit={(event: { preventDefault: () => void }) => {
          event.preventDefault();
          navigate();
        }}
      >
        <button
          type="button"
          className="workbench-browser-bar__nav"
          title="Back"
          aria-label="Back"
          disabled={!nav.canBack}
          onClick={goBack}
        >
          <ArrowLeft size={15} strokeWidth={1.9} aria-hidden />
        </button>
        <button
          type="button"
          className="workbench-browser-bar__nav"
          title="Forward"
          aria-label="Forward"
          disabled={!nav.canForward}
          onClick={goForward}
        >
          <ArrowRight size={15} strokeWidth={1.9} aria-hidden />
        </button>
        <button
          type="button"
          className="workbench-browser-bar__nav"
          title={props.pane.loading ? "Stop / reloading" : "Reload"}
          aria-label="Reload"
          onClick={reload}
          data-loading={props.pane.loading ? "true" : "false"}
        >
          <RotateCw size={14} strokeWidth={1.9} aria-hidden />
        </button>
        <input
          className="workbench-browser-bar__input"
          aria-label="Browser address input"
          value={address}
          placeholder="Enter a URL and press Enter"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event: { currentTarget: { value: string } }) => setAddress(event.currentTarget.value)}
        />
        <button
          type="button"
          className="workbench-browser-bar__icon"
          title="Add this page to the chat composer"
          aria-label="Add this page to chat"
          onClick={() => {
            const url = props.pane.url ?? address;
            if (url.length === 0) {
              return;
            }
            const title = props.pane.title && props.pane.title !== "Browser" ? props.pane.title : url;
            const label = title.length > 40 ? `${title.slice(0, 40)}…` : title;
            const webview = webviewRef.current;
            if (webview !== null) {
              void readBrowserWebViewSnapshot(webview)
                .then((snapshot) => {
                  const excerpt = (snapshot.bodyTextPreview ?? "").trim().slice(0, 2000);
                  props.handlers.onAddContentToChat({
                    kind: "browser",
                    label,
                    text: `[${title}](${url})${excerpt.length > 0 ? `\n\n${excerpt}` : ""}`,
                  });
                })
                .catch(() =>
                  props.handlers.onAddContentToChat({ kind: "browser", label, text: `[${title}](${url})` }),
                );
            } else {
              props.handlers.onAddContentToChat({ kind: "browser", label, text: `[${title}](${url})` });
            }
          }}
        >
          <FileText size={14} strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          className="workbench-browser-bar__icon"
          title="Open this page in your default browser"
          aria-label="Open in external browser"
          onClick={() => {
            const url = props.pane.url ?? address;
            if (url.length > 0 && typeof window !== "undefined" && window.tide) {
              void window.tide.openExternal(url);
            }
          }}
        >
          <ExternalLink size={14} strokeWidth={1.8} aria-hidden />
        </button>
        {pickMode && pickCount > 0 ? (
          <button
            type="button"
            className="workbench-browser-bar__to-chat"
            data-active="true"
            title="Add the selected elements to chat"
            onClick={confirmElementPicks}
          >
            <CornerDownRight size={13} strokeWidth={1.8} aria-hidden />
            {`Add ${pickCount} to chat`}
          </button>
        ) : null}
        <button
          type="button"
          className="workbench-browser-bar__icon"
          data-active={pickMode ? "true" : "false"}
          title={pickMode ? "Cancel element pick" : "Pick elements/components to add to chat"}
          aria-label="Pick elements to add to chat"
          aria-pressed={pickMode}
          onClick={() => setPickMode((prev) => !prev)}
        >
          <Crosshair size={14} strokeWidth={1.8} aria-hidden />
        </button>
      </form>
      {find.open ? (
        <InPaneFindBar
          query={find.query}
          matchCount={browserMatchCount}
          activeIndex={find.activeIndex}
          placeholder="Find in page"
          onQueryChange={find.setQuery}
          onNext={browserFindNext}
          onPrevious={browserFindPrevious}
          onClose={find.closeFind}
        />
      ) : null}
      {/* `<webview>` is an Electron custom element with no JSX.IntrinsicElements
          typing, so it stays a createElement call (the string-tag overload accepts
          its partition/src attrs and the BrowserWebViewElement ref). The relative
          stage lets the agent-driving overlay sit exactly over the page area. */}
      <div className="workbench-browser-stage">
        {createElement("webview", {
          ref: setWebviewRef,
          className: "workbench-browser-webview",
          "data-browser-pane-webview": props.pane.paneId,
          src: initialSrcRef.current,
          partition: "persist:tide-workbench-browser",
          // allowpopups is REQUIRED for target=_blank / window.open links (e.g. Google
          // results with newwindow=1) to navigate. Without it Electron silently suppresses
          // the popup BEFORE setWindowOpenHandler ever fires — a plain click does nothing
          // (no URL change, no spinner). With it, the app's main-process handler intercepts
          // ordinary popup URLs and routes them over IPC: foreground-tab → reuse this pane
          // in place; background-tab / new-window (Cmd/Ctrl/Shift+click) → a new Browser Pane.
          // Auth popups that require window.opener may be preserved as native child windows.
          // See web-contents-created in electron-main.ts. String form ("true") because
          // Electron only checks attribute presence (hasAttribute) and string attrs render
          // reliably on this custom tag (as src/partition already do).
          allowpopups: "true",
        })}
        {props.pane.agentDriving === true ? (
          <BrowserAgentOverlay
            cursor={props.pane.agentCursor ?? null}
            onTakeControl={() => props.handlers.onReleaseAgentBrowserControl(props.pane.paneId)}
          />
        ) : null}
      </div>
      {browserSelToolbar === null ? null : (
        <button
          type="button"
          className="editor-selection-toolbar"
          style={{
            left: `${browserSelToolbar.x}px`,
            top: `${Math.max(browserSelToolbar.y - 36, 8)}px`,
          } as CSSProperties}
          onMouseDown={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            const url = props.pane.url ?? address;
            const title = props.pane.title && props.pane.title !== "Browser" ? props.pane.title : url;
            const trimmed = browserSelToolbar.text.trim().replace(/\s+/g, " ");
            const quoted = browserSelToolbar.text
              .trim()
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n");
            props.handlers.onAddContentToChat({
              kind: "browser",
              label: `${trimmed.slice(0, 40)}${trimmed.length > 40 ? "…" : ""}`,
              text: `From [${title}](${url}):\n\n${quoted}`,
            });
            setBrowserSelToolbar(null);
          }}
        >
          <CornerDownRight size={13} strokeWidth={1.9} aria-hidden />
          Add selection
        </button>
      )}
    </div>
  );
}

// Persistent offscreen host for Browser Panes owned by NON-active threads. Each
// pane's <webview> stays mounted (alive) so a background agent keeps driving its own
// browser (snapshots + scheduled actions) without being visible or stealing focus.
export function BackgroundBrowserHost(props: {
  panes: ProductShellViewModel["backgroundBrowserPanes"];
  handlers: ProductShellHandlers;
}): ReactElement | null {
  if (props.panes.length === 0) {
    return null;
  }
  return (
    <div className="background-browser-host" aria-hidden>
      {props.panes.map((pane) => (
        <BackgroundBrowserWebView
          key={`${pane.threadId}:${pane.paneId}`}
          pane={pane}
          handlers={props.handlers}
        />
      ))}
    </div>
  );
}

function BackgroundBrowserWebView(props: {
  pane: ProductShellViewModel["backgroundBrowserPanes"][number];
  handlers: ProductShellHandlers;
}): ReactElement {
  const webviewRef = useRef<BrowserWebViewElement | null>(null);
  const [webviewElement, setWebviewElement] = useState<BrowserWebViewElement | null>(null);
  const setWebviewRef = useCallback((element: BrowserWebViewElement | null) => {
    webviewRef.current = element;
    setWebviewElement(element);
  }, []);
  const executedActionIdsRef = useRef<Set<string>>(new Set());
  const [settleVersion, setSettleVersion] = useState(0);
  const { threadId, paneId, revision, url, pendingAction, pendingCapture } = props.pane;
  const handlers = props.handlers;

  // Latest revision via ref so the snapshot effect below does NOT depend on it: re-running
  // that effect on every backend revision bump would re-fire the already-loaded capture and
  // waste a capturePage per action/navigation on an offscreen page.
  const snapshotRevisionRef = useRef(revision);
  useEffect(() => {
    snapshotRevisionRef.current = revision;
  }, [revision]);
  // Report a text-only snapshot when the offscreen page settles, routed to the pane's thread.
  // NO capturePage here — an offscreen background page firing did-stop-loading repeatedly used to
  // re-encode a PNG each time, multiplying host-renderer CPU by every background pane ever opened.
  // Pixels are pulled on demand at observe time (pendingCapture). Spec:
  // docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
  useEffect(() => {
    const webview = webviewElement;
    if (webview === null) {
      return;
    }
    const emitSnapshot = () => {
      setSettleVersion((version) => version + 1);
      void readBrowserWebViewSnapshot(webview).then((snapshot) => {
        handlers.onBackgroundBrowserSnapshot(threadId, paneId, {
          revision: snapshotRevisionRef.current,
          loading: false,
          ...snapshot,
        });
      });
    };
    webview.addEventListener("dom-ready", emitSnapshot);
    webview.addEventListener("did-finish-load", emitSnapshot);
    webview.addEventListener("did-stop-loading", emitSnapshot);
    // Attach-race guard (spec browser-pane-live-pull-vision.md): a fast/static page can fire
    // its load events BEFORE this effect attaches the listeners above, so the URL/title would
    // never be reported. If the guest is already loaded, emit once now; the listeners cover
    // later loads. Deps are paneId-only so a backend revision bump does not re-run this.
    if (isWebViewSettled(webview)) {
      emitSnapshot();
    }
    return () => {
      webview.removeEventListener("dom-ready", emitSnapshot);
      webview.removeEventListener("did-finish-load", emitSnapshot);
      webview.removeEventListener("did-stop-loading", emitSnapshot);
    };
  }, [webviewElement, handlers, threadId, paneId]);

  // Observe-time pixel-capture pull for a background thread's pane: an agent driving its browser
  // while you watch another thread still gets FRESH pixels on tide_observe_browser. capturePage
  // only when the backend asks (pendingCapture) — never on the page-load storm. Spec:
  // docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
  // One last-id string (not a growing Set) — same O(1) de-dup as the active pane.
  const lastCapturedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const webview = webviewElement;
    if (
      webview === null ||
      pendingCapture === undefined ||
      lastCapturedIdRef.current === pendingCapture.captureId ||
      !isWebViewSettled(webview)
    ) {
      return;
    }
    lastCapturedIdRef.current = pendingCapture.captureId;
    const captureId = pendingCapture.captureId;
    void captureBrowserWebViewScreenshot(webview).then((screenshot) => {
      handlers.onBackgroundBrowserCaptureResult(threadId, paneId, { captureId, screenshot });
    });
  }, [webviewElement, handlers, threadId, paneId, pendingCapture?.captureId, settleVersion]);

  // Execute a scheduled background action (click/type) against the offscreen webview.
  useEffect(() => {
    const webview = webviewElement;
    if (
      webview === null ||
      url === undefined ||
      pendingAction === undefined ||
      executedActionIdsRef.current.has(pendingAction.actionId) ||
      !isWebViewSettled(webview)
    ) {
      return;
    }
    executedActionIdsRef.current.add(pendingAction.actionId);
    void executeBrowserWebViewAction(webview, pendingAction)
      .then(async (actionResult) => {
        await waitForPostActionSettle(webview);
        // Text-only: post-action pixels are pulled on the agent's next observe (pendingCapture).
        const snapshot = await readBrowserWebViewSnapshot(webview);
        handlers.onBackgroundBrowserActionResult(threadId, paneId, {
          revision,
          actionId: pendingAction.actionId,
          status: actionResult.ok ? "completed" : "failed",
          message: actionResult.message,
          loading: false,
          ...snapshot,
        });
      })
      .catch((error: unknown) => {
        handlers.onBackgroundBrowserActionResult(threadId, paneId, {
          revision,
          actionId: pendingAction.actionId,
          status: "failed",
          message: error instanceof Error ? error.message : "Browser action failed.",
          loading: false,
        });
      });
  }, [webviewElement, handlers, threadId, paneId, revision, url, pendingAction?.actionId, settleVersion]);

  // See the WorkbenchBrowserPane note: `<webview>` stays a createElement call.
  return createElement("webview", {
    ref: setWebviewRef,
    className: "background-browser-host__webview",
    "data-browser-pane-webview": paneId,
    src: url ?? "about:blank",
    partition: "persist:tide-workbench-browser",
    // Same as the foreground pane: allowpopups lets target=_blank / window.open links route
    // through the main-process handler instead of being silently suppressed — so an agent
    // driving a background page can follow such links too. See the WorkbenchBrowserPane
    // webview above.
    allowpopups: "true",
  });
}
