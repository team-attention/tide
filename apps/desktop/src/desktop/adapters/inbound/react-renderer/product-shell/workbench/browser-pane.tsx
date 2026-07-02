import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, FileText, RotateCw } from "lucide-react";

function useBrowserRuntimeStage(input: {
  threadId: string | null;
  paneId: string;
  url?: string;
  title?: string;
  agentDriving: boolean;
  agentCursor?: { x: number; y: number };
  stageRef: { current: HTMLDivElement | null };
}): void {
  const { agentCursor, agentDriving, paneId, stageRef, threadId, title, url } = input;
  useEffect(() => {
    if (
      threadId === null ||
      typeof window === "undefined" ||
      typeof window.tide?.setBrowserRuntimeStage !== "function"
    ) {
      return undefined;
    }
    const overlay = {
      agentDriving,
      cursor: agentCursor === undefined ? undefined : { ...agentCursor },
    };
    let frame = 0;
    const emit = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const stage = stageRef.current;
        if (stage === null) {
          window.tide?.setBrowserRuntimeStage?.({
            threadId,
            paneId,
            visible: false,
            bounds: null,
            url,
            title,
            overlay,
          });
          return;
        }
        const rect = stage.getBoundingClientRect();
        window.tide?.setBrowserRuntimeStage?.({
          threadId,
          paneId,
          visible: rect.width > 1 && rect.height > 1,
          url,
          title,
          overlay,
          bounds: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
        });
      });
    };
    const observer = new ResizeObserver(emit);
    if (stageRef.current !== null) {
      observer.observe(stageRef.current);
    }
    emit();
    window.addEventListener("resize", emit);
    window.addEventListener("scroll", emit, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", emit);
      window.removeEventListener("scroll", emit, true);
      window.tide?.setBrowserRuntimeStage?.({
        threadId,
        paneId,
        visible: false,
        bounds: null,
        overlay: { agentDriving: false },
      });
    };
  }, [
    agentCursor?.x,
    agentCursor?.y,
    agentDriving,
    paneId,
    stageRef,
    threadId,
    title,
    url,
  ]);
}

export function WorkbenchBrowserPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
  threadId: string | null;
}): ReactElement {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [address, setAddress] = useState(props.pane.url ?? "");
  const runtimeAvailable =
    props.threadId !== null &&
    typeof window !== "undefined" &&
    typeof window.tide?.setBrowserRuntimeStage === "function";

  useBrowserRuntimeStage({
    agentCursor: props.pane.agentCursor,
    agentDriving: props.pane.agentDriving === true,
    threadId: props.threadId,
    paneId: props.pane.paneId,
    url: props.pane.url,
    title: props.pane.title,
    stageRef,
  });

  useEffect(() => {
    if (props.pane.url !== undefined) {
      setAddress(props.pane.url);
    }
  }, [props.pane.url]);

  useEffect(() => {
    if (
      props.threadId === null ||
      typeof window === "undefined" ||
      typeof window.tide?.onBrowserRuntimeReleaseControl !== "function"
    ) {
      return undefined;
    }
    const threadId = props.threadId;
    const paneId = props.pane.paneId;
    return window.tide.onBrowserRuntimeReleaseControl((eventThreadId, eventPaneId) => {
      if (eventThreadId === threadId && eventPaneId === paneId) {
        props.handlers.onReleaseAgentBrowserControl(paneId);
      }
    });
  }, [props.handlers, props.pane.paneId, props.threadId]);

  const sendRuntimeCommand = (command: "goBack" | "goForward" | "reload"): void => {
    if (props.threadId === null || typeof window === "undefined") {
      return;
    }
    void window.tide?.browserRuntimeCommand?.({
      kind: command,
      threadId: props.threadId,
      paneId: props.pane.paneId,
    });
  };

  const navigate = (): void => {
    const url = normalizeBrowserUrl(address);
    if (url.length === 0) {
      return;
    }
    setAddress(url);
    props.handlers.onOpenBrowserPane(url, { newPane: false });
  };

  const addPageToChat = (): void => {
    const url = props.pane.url ?? address;
    if (url.length === 0) {
      return;
    }
    const title = props.pane.title && props.pane.title !== "Browser" ? props.pane.title : url;
    const label = title.length > 40 ? `${title.slice(0, 40)}...` : title;
    const excerpt = (props.pane.bodyTextPreview ?? "").trim().slice(0, 2000);
    props.handlers.onAddContentToChat({
      kind: "browser",
      label,
      text: `[${title}](${url})${excerpt.length > 0 ? `\n\n${excerpt}` : ""}`,
    });
  };

  return (
    <div className="workbench-pane-content workbench-pane-content--browser">
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
          disabled={!runtimeAvailable}
          onClick={() => sendRuntimeCommand("goBack")}
        >
          <ArrowLeft size={15} strokeWidth={1.9} aria-hidden />
        </button>
        <button
          type="button"
          className="workbench-browser-bar__nav"
          title="Forward"
          aria-label="Forward"
          disabled={!runtimeAvailable}
          onClick={() => sendRuntimeCommand("goForward")}
        >
          <ArrowRight size={15} strokeWidth={1.9} aria-hidden />
        </button>
        <button
          type="button"
          className="workbench-browser-bar__nav"
          title={props.pane.loading ? "Stop / reloading" : "Reload"}
          aria-label="Reload"
          disabled={!runtimeAvailable}
          onClick={() => sendRuntimeCommand("reload")}
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
          onClick={addPageToChat}
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
      </form>
      <div ref={stageRef} className="workbench-browser-stage" data-native-runtime="true">
        <div className="workbench-browser-native-stage" aria-hidden />
      </div>
    </div>
  );
}

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
