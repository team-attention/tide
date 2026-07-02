export type HtmlWebViewElement = HTMLElement & {
  findInPage?: (
    text: string,
    options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean },
  ) => number;
  stopFindInPage?: (action: "clearSelection" | "keepSelection" | "activateSelection") => void;
};

export function safeFindInWebView(
  webview: HtmlWebViewElement,
  text: string,
  options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean },
): number | undefined {
  try {
    return webview.findInPage?.(text, options);
  } catch {
    return undefined;
  }
}

export function safeStopFindInWebView(
  webview: HtmlWebViewElement,
  action: "clearSelection" | "keepSelection" | "activateSelection",
): void {
  try {
    webview.stopFindInPage?.(action);
  } catch {
    // Ignore pre-dom-ready guest API throws from the find bar mount/close path.
  }
}
