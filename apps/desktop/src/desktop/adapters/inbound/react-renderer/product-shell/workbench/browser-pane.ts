import type { ProductShellBrowserSnapshot, ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell-state.ts";
import type { ProductShellHandlers } from "../types.ts";
import { createElement, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { ArrowLeft, ArrowRight, CornerDownRight, Crosshair, ExternalLink, FileText, RotateCw } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// `<webview>.executeJavaScript` throws *synchronously* if called before the
// guest has emitted `dom-ready`. Wrap it so an early call (e.g. from an effect
// that runs on mount) can never throw out and unmount the whole React tree.
function safeWebviewExec(webview: BrowserWebViewElement, code: string): Promise<unknown> {
  try {
    const result = webview.executeJavaScript?.(code);
    return result instanceof Promise ? result.catch(() => undefined) : Promise.resolve(undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

// Injected into the Browser Pane's <webview> to run a devtools-style element
// picker. Clicking toggles an element into a multi-selection (kept in
// `window.__tidePicks`); the host reads the array + count and tears down via
// `window.__tideCancelPick`.
const BROWSER_ELEMENT_PICKER_SCRIPT = `(() => {
  if (window.__tidePickerActive) return;
  window.__tidePickerActive = true;
  window.__tidePicks = [];
  var els = [];
  var style = document.createElement('style');
  style.id = '__tidePickerStyle';
  style.textContent = '.__tidePickHover{outline:2px dashed #4c8bf5 !important;outline-offset:1px;cursor:crosshair !important;}.__tidePicked{outline:2px solid #4c8bf5 !important;outline-offset:1px;background:rgba(76,139,245,0.14) !important;cursor:crosshair !important;}';
  document.documentElement.appendChild(style);
  var last = null;
  function sync(){ window.__tidePicks = els.map(function(x){ return { text:(x.innerText||x.textContent||'').trim().slice(0,3000), tag:(x.tagName||'element').toLowerCase() }; }); }
  function over(e){ if(last && els.indexOf(last)<0){last.classList.remove('__tidePickHover');} last=e.target; if(last&&last.classList&&els.indexOf(last)<0){last.classList.add('__tidePickHover');} }
  function click(e){ e.preventDefault(); e.stopPropagation(); var el=e.target; var i=els.indexOf(el); if(i>=0){ els.splice(i,1); el.classList.remove('__tidePicked'); } else { els.push(el); el.classList.remove('__tidePickHover'); el.classList.add('__tidePicked'); } sync(); }
  function cleanup(){ els.forEach(function(x){x.classList.remove('__tidePicked');}); if(last){last.classList.remove('__tidePickHover');} document.removeEventListener('mouseover',over,true); document.removeEventListener('click',click,true); var s=document.getElementById('__tidePickerStyle'); if(s){s.remove();} window.__tidePickerActive=false; window.__tidePicks=[]; els=[]; }
  window.__tideCancelPick=cleanup;
  document.addEventListener('mouseover',over,true);
  document.addEventListener('click',click,true);
})()`;

export function WorkbenchBrowserPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const webviewRef = useRef<BrowserWebViewElement | null>(null);
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
  useEffect(() => {
    const webview = webviewRef.current;
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
  }, [pickMode, props.pane.paneId]);
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
    const webview = webviewRef.current;
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
  }, [props.pane.paneId, props.pane.url]);
  // Keep the address bar in sync when the backend reports a navigated URL.
  useEffect(() => {
    if (props.pane.url !== undefined) {
      setAddress(props.pane.url);
    }
  }, [props.pane.url]);
  // Back/forward availability, tracked from the webview's own navigation events.
  const [nav, setNav] = useState<{ canBack: boolean; canForward: boolean }>({ canBack: false, canForward: false });
  useEffect(() => {
    const webview = webviewRef.current;
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
  }, [props.pane.paneId]);
  // Apply EXTERNAL navigation (agent action / chat link → open_browser →
  // pane.url) via the webview API. `requestedUrlRef` tracks the URL we last
  // intended to be at — seeded with the initial src so we never re-load it at
  // mount, and updated to absorb the did-finish-load snapshot (which writes the
  // resolved ?zx URL back into pane.url). We only loadURL when the target is a
  // genuinely new destination — so the snapshot echo is a no-op (no reload loop)
  // while real navigation (incl. from about:blank) still works.
  const requestedUrlRef = useRef(initialSrcRef.current);
  useEffect(() => {
    const webview = webviewRef.current;
    const target = props.pane.url;
    if (webview?.loadURL === undefined || target === undefined || target.length === 0) {
      return;
    }
    if (target === requestedUrlRef.current) {
      return; // already handled (initial src, or a prior navigation/echo)
    }
    let current = "";
    try {
      current = typeof webview.getURL === "function" ? webview.getURL() : "";
    } catch {
      return; // not dom-ready yet — the initial src load is in flight
    }
    requestedUrlRef.current = target;
    if (target === current) {
      return; // snapshot echo: the webview is already here
    }
    void webview.loadURL(target).catch(() => undefined);
  }, [props.pane.url, props.pane.paneId]);
  const goBack = () => webviewRef.current?.goBack?.();
  const goForward = () => webviewRef.current?.goForward?.();
  const reload = () => webviewRef.current?.reload?.();
  const navigate = () => {
    const url = normalizeBrowserUrl(address);
    if (url.length === 0) {
      return;
    }
    setAddress(url);
    const webview = webviewRef.current;
    if (webview?.loadURL !== undefined) {
      void webview.loadURL(url).catch(() => undefined);
    }
    // Report the navigation so the backend pane reflects it; did-finish-load
    // will follow up with the resolved title/body snapshot.
    props.handlers.onBrowserSnapshot(props.pane.paneId, {
      revision: props.pane.revision,
      url,
      loading: true,
    });
  };
  useEffect(() => {
    const webview = webviewRef.current;
    if (webview === null) {
      return;
    }
    const paneId = props.pane.paneId;
    const revision = props.pane.revision;
    const emitSnapshot = () => {
      void readBrowserWebViewSnapshot(webview).then((snapshot) => {
        props.handlers.onBrowserSnapshot(paneId, {
          revision,
          loading: false,
          ...snapshot,
        });
      });
    };
    webview.addEventListener("did-finish-load", emitSnapshot);
    webview.addEventListener("did-stop-loading", emitSnapshot);
    return () => {
      webview.removeEventListener("did-finish-load", emitSnapshot);
      webview.removeEventListener("did-stop-loading", emitSnapshot);
    };
  }, [props.handlers, props.pane.paneId, props.pane.revision, props.pane.url]);
  useEffect(() => {
    const webview = webviewRef.current;
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
    props.handlers,
    props.pane.paneId,
    props.pane.pendingAction?.actionId,
    props.pane.revision,
    props.pane.url,
  ]);
  return createElement(
    "div",
    { className: "workbench-pane-content workbench-pane-content--browser" },
    // Slim editable address bar — the page fills the pane below it.
    createElement(
      "form",
      {
        className: "workbench-browser-bar",
        "aria-label": "Browser address",
        onSubmit: (event: { preventDefault: () => void }) => {
          event.preventDefault();
          navigate();
        },
      },
      createElement(
        "button",
        {
          type: "button",
          className: "workbench-browser-bar__nav",
          title: "Back",
          "aria-label": "Back",
          disabled: !nav.canBack,
          onClick: goBack,
        },
        createElement(ArrowLeft, { size: 15, strokeWidth: 1.9, "aria-hidden": true }),
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "workbench-browser-bar__nav",
          title: "Forward",
          "aria-label": "Forward",
          disabled: !nav.canForward,
          onClick: goForward,
        },
        createElement(ArrowRight, { size: 15, strokeWidth: 1.9, "aria-hidden": true }),
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "workbench-browser-bar__nav",
          title: props.pane.loading ? "Stop / reloading" : "Reload",
          "aria-label": "Reload",
          onClick: reload,
          "data-loading": props.pane.loading ? "true" : "false",
        },
        createElement(RotateCw, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
      ),
      createElement("input", {
        className: "workbench-browser-bar__input",
        "aria-label": "Browser address input",
        value: address,
        placeholder: "Enter a URL and press Enter",
        spellCheck: false,
        autoCapitalize: "off",
        autoCorrect: "off",
        onChange: (event: { currentTarget: { value: string } }) =>
          setAddress(event.currentTarget.value),
      }),
      createElement(
        "button",
        {
          type: "button",
          className: "workbench-browser-bar__icon",
          title: "Add this page to the chat composer",
          "aria-label": "Add this page to chat",
          onClick: () => {
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
          },
        },
        createElement(FileText, { size: 14, strokeWidth: 1.8, "aria-hidden": true }),
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "workbench-browser-bar__icon",
          title: "Open this page in your default browser",
          "aria-label": "Open in external browser",
          onClick: () => {
            const url = props.pane.url ?? address;
            if (url.length > 0 && typeof window !== "undefined" && window.tide) {
              void window.tide.openExternal(url);
            }
          },
        },
        createElement(ExternalLink, { size: 14, strokeWidth: 1.8, "aria-hidden": true }),
      ),
      pickMode && pickCount > 0
        ? createElement(
            "button",
            {
              type: "button",
              className: "workbench-browser-bar__to-chat",
              "data-active": "true",
              title: "Add the selected elements to chat",
              onClick: confirmElementPicks,
            },
            createElement(CornerDownRight, { size: 13, strokeWidth: 1.8, "aria-hidden": true }),
            `Add ${pickCount} to chat`,
          )
        : null,
      createElement(
        "button",
        {
          type: "button",
          className: "workbench-browser-bar__icon",
          "data-active": pickMode ? "true" : "false",
          title: pickMode ? "Cancel element pick" : "Pick elements/components to add to chat",
          "aria-label": "Pick elements to add to chat",
          "aria-pressed": pickMode,
          onClick: () => setPickMode((prev) => !prev),
        },
        createElement(Crosshair, { size: 14, strokeWidth: 1.8, "aria-hidden": true }),
      ),
    ),
    createElement("webview", {
      ref: webviewRef,
      className: "workbench-browser-webview",
      "data-browser-pane-webview": props.pane.paneId,
      src: initialSrcRef.current,
      partition: "persist:tide-workbench-browser",
    }),
    browserSelToolbar === null
      ? null
      : createElement(
          "button",
          {
            type: "button",
            className: "editor-selection-toolbar",
            style: {
              left: `${browserSelToolbar.x}px`,
              top: `${Math.max(browserSelToolbar.y - 36, 8)}px`,
            } as CSSProperties,
            onMouseDown: (event: { preventDefault: () => void }) => {
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
            },
          },
          createElement(CornerDownRight, { size: 13, strokeWidth: 1.9, "aria-hidden": true }),
          "Add selection",
        ),
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
  return createElement(
    "div",
    { className: "background-browser-host", "aria-hidden": true },
    ...props.panes.map((pane) =>
      createElement(BackgroundBrowserWebView, {
        key: `${pane.threadId}:${pane.paneId}`,
        pane,
        handlers: props.handlers,
      }),
    ),
  );
}

function BackgroundBrowserWebView(props: {
  pane: ProductShellViewModel["backgroundBrowserPanes"][number];
  handlers: ProductShellHandlers;
}): ReactElement {
  const webviewRef = useRef<BrowserWebViewElement | null>(null);
  const executedActionIdsRef = useRef<Set<string>>(new Set());
  const { threadId, paneId, revision, url, pendingAction } = props.pane;
  const handlers = props.handlers;

  // Report a snapshot when the offscreen page settles, routed to the pane's thread.
  useEffect(() => {
    const webview = webviewRef.current;
    if (webview === null) {
      return;
    }
    const emitSnapshot = () => {
      void readBrowserWebViewSnapshot(webview).then((snapshot) => {
        handlers.onBackgroundBrowserSnapshot(threadId, paneId, {
          revision,
          loading: false,
          ...snapshot,
        });
      });
    };
    webview.addEventListener("did-finish-load", emitSnapshot);
    webview.addEventListener("did-stop-loading", emitSnapshot);
    return () => {
      webview.removeEventListener("did-finish-load", emitSnapshot);
      webview.removeEventListener("did-stop-loading", emitSnapshot);
    };
  }, [handlers, threadId, paneId, revision, url]);

  // Execute a scheduled background action (click/type) against the offscreen webview.
  useEffect(() => {
    const webview = webviewRef.current;
    if (
      webview === null ||
      url === undefined ||
      pendingAction === undefined ||
      executedActionIdsRef.current.has(pendingAction.actionId)
    ) {
      return;
    }
    executedActionIdsRef.current.add(pendingAction.actionId);
    void executeBrowserWebViewAction(webview, pendingAction)
      .then(async (actionResult) => {
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
  }, [handlers, threadId, paneId, revision, url, pendingAction?.actionId]);

  return createElement("webview", {
    ref: webviewRef,
    className: "background-browser-host__webview",
    "data-browser-pane-webview": paneId,
    src: url ?? "about:blank",
    partition: "persist:tide-workbench-browser",
  });
}

type BrowserWebViewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>;
  getURL?: () => string;
  loadURL?: (url: string) => Promise<void>;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
};

// Turn a user-typed address into a navigable URL: keep explicit schemes, treat a
// dotted token as a bare host (https://), and fall back to a web search.
function normalizeBrowserUrl(input: string): string {
  const value = input.trim();
  if (value.length === 0) {
    return "";
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith("about:")) {
    return value;
  }
  if (/^[^\s/]+\.[^\s/]+/.test(value)) {
    return `https://${value}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

type BrowserWebViewSnapshot = Omit<ProductShellBrowserSnapshot, "revision" | "loading">;

type BrowserWebViewAction = NonNullable<
  NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>["pendingAction"]
>;

type BrowserWebViewActionExecution = { ok: boolean; message: string };

async function readBrowserWebViewSnapshot(
  webview: BrowserWebViewElement,
): Promise<BrowserWebViewSnapshot> {
  const script = `(() => ({
    url: window.location.href,
    pageTitle: document.title,
    bodyTextPreview: (document.body?.innerText ?? "").slice(0, 65536)
  }))()`;
  const rawSnapshot = await webview.executeJavaScript?.(script).catch(() => undefined);
  const snapshot =
    rawSnapshot !== null && typeof rawSnapshot === "object"
      ? (rawSnapshot as Record<string, unknown>)
      : {};
  return {
    url: stringRecordField(snapshot, "url") ?? webview.getURL?.(),
    pageTitle: stringRecordField(snapshot, "pageTitle"),
    bodyTextPreview: stringRecordField(snapshot, "bodyTextPreview"),
  };
}

async function executeBrowserWebViewAction(
  webview: BrowserWebViewElement,
  action: BrowserWebViewAction,
): Promise<BrowserWebViewActionExecution> {
  if (webview.executeJavaScript === undefined) {
    return { ok: false, message: "Browser WebView does not expose script execution." };
  }
  const payload = JSON.stringify({
    kind: action.kind,
    selector: action.selector,
    text: action.text ?? "",
  });
  const script = `((payload) => {
    const target = document.querySelector(payload.selector);
    if (!target) {
      return { ok: false, message: "Selector not found: " + payload.selector };
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    if (payload.kind === "click") {
      target.click();
      return { ok: true, message: "Clicked " + payload.selector };
    }
    if (payload.kind === "type_text") {
      target.focus?.();
      if ("value" in target) {
        target.value = payload.text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, message: "Typed " + payload.selector };
      }
      target.textContent = payload.text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, message: "Typed " + payload.selector };
    }
    return { ok: false, message: "Unsupported Browser action." };
  })(${payload})`;
  return browserActionExecutionFromUnknown(await webview.executeJavaScript(script));
}

function browserActionExecutionFromUnknown(value: unknown): BrowserWebViewActionExecution {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ok = typeof record.ok === "boolean" ? record.ok : false;
    const message =
      typeof record.message === "string" ? record.message : "Browser action finished.";
    return { ok, message };
  }
  return { ok: false, message: "Browser action returned an invalid result." };
}

function stringRecordField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}
