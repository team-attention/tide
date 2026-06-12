// Spec: docs_v2/specs/workbench-terminal-pane-session.md
//
// xterm.js mounts in a real DOM, so this renders the Product Shell in jsdom
// (SSR snapshot tests cannot exercise xterm's client mount).

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).Window = dom.window.Window;
(globalThis as Record<string, unknown>).document = dom.window.document;
(globalThis as Record<string, unknown>).ResizeObserver = TestResizeObserver;
(globalThis as Record<string, unknown>).MutationObserver = dom.window.MutationObserver;
(globalThis as Record<string, unknown>).getSelection = dom.window.getSelection.bind(dom.window);
(globalThis as Record<string, unknown>).Range = dom.window.Range;
const matchMediaStub = () => ({
  matches: false,
  media: "",
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});
(dom.window as unknown as Record<string, unknown>).matchMedia = matchMediaStub;
(globalThis as Record<string, unknown>).matchMedia = matchMediaStub;

const { createElement } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const {
  applyProductShellBackendEvent,
  createProductShellState,
  openProductShellThread,
} = await import("../src/desktop/application/domains/product-shell/product-shell.ts");
const { TideProductShell } = await import(
  "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.ts"
);

function terminalState() {
  return applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-term",
        panes: [
          {
            paneId: "pane-term",
            kind: "terminal",
            title: "zsh",
            visible: true,
            revision: "pane-term:rev",
            updatedAt: "2026-05-31T00:00:00.000Z",
            status: "running",
            command: "/bin/zsh",
            cwd: "/repo/tide",
            transcriptPreview: "tide-terminal-hello",
          },
        ],
      },
    },
  );
}

test("workbench_terminal_pane_mounts_an_xterm_terminal", async () => {
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => {
    root.render(createElement(TideProductShell, { initialState: terminalState() }));
  });
  // Let the terminal mount effect run.
  await new Promise((resolve) => setTimeout(resolve, 50));

  try {
    const host = dom.window.document.querySelector('[data-terminal-xterm="pane-term"]');
    assert.ok(host, "terminal host element should render");
    // xterm initialized inside the host (the .xterm element is created by term.open()).
    assert.ok(host.querySelector(".xterm"), "xterm should mount inside the terminal host");
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
