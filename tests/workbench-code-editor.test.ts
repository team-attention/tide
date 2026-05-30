// Spec: docs_v2/specs/workbench-editor-pane-editing.md
//
// CodeMirror mounts in a real DOM, so this suite renders the Product Shell in a
// jsdom document (SSR snapshot tests cannot exercise CodeMirror's client mount).

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

const domWindow = dom.window as unknown as Record<string, unknown>;
class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
domWindow.ResizeObserver = TestResizeObserver;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).Window = dom.window.Window;
(globalThis as Record<string, unknown>).document = dom.window.document;
(globalThis as Record<string, unknown>).ResizeObserver = TestResizeObserver;
(globalThis as Record<string, unknown>).MutationObserver = dom.window.MutationObserver;
(globalThis as Record<string, unknown>).DOMParser = dom.window.DOMParser;
(globalThis as Record<string, unknown>).getSelection = dom.window.getSelection.bind(dom.window);
(globalThis as Record<string, unknown>).Range = dom.window.Range;
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (t: number) => void) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => clearTimeout(id);
(globalThis as Record<string, unknown>).getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

// Dynamic imports AFTER DOM globals exist, so react-dom/client and CodeMirror
// bind to the jsdom document.
const { createElement } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const {
  applyProductShellBackendEvent,
  createProductShellState,
  openProductShellThread,
} = await import("../src/desktop/application/domains/product-shell/product-shell-state.ts");
const { TideProductShell } = await import(
  "../src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts"
);

function editorState(bodyText: string, relativePath: string) {
  return applyProductShellBackendEvent(
    openProductShellThread(createProductShellState(), "thread-workbench"),
    {
      kind: "workbench.changed",
      payload: {
        threadId: "thread-workbench",
        activePaneId: "pane-editor",
        panes: [
          {
            paneId: "pane-editor",
            kind: "editor",
            title: relativePath,
            visible: true,
            revision: "pane-editor:rev",
            updatedAt: "2026-05-28T00:00:00.000Z",
            filePath: `/repo/${relativePath}`,
            relativePath,
            bodyText,
            bodyTextPreview: bodyText,
            byteLength: bodyText.length,
            truncated: false,
          },
        ],
      },
    },
  );
}

async function mountShell(state: ReturnType<typeof editorState>) {
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => {
    root.render(createElement(TideProductShell, { initialState: state }));
  });
  // Let CodeMirror's mount effect run.
  await new Promise((resolve) => setTimeout(resolve, 30));
  return root;
}

test("workbench_editor_pane_mounts_codemirror_with_file_content_and_line_numbers", async () => {
  const code = "export const value = 1;\nconst doubled = value * 2;\n";
  const root = await mountShell(editorState(code, "src/app.ts"));
  try {
    const content = dom.window.document.querySelector(".cm-content");
    assert.ok(content, "CodeMirror content element should mount");
    assert.match(content.textContent ?? "", /export const value = 1;/);
    assert.match(content.textContent ?? "", /const doubled = value \* 2;/);

    // Real editor affordances: a line-number gutter is present.
    const gutterLineNumbers = dom.window.document.querySelectorAll(
      ".cm-gutters .cm-lineNumbers .cm-gutterElement",
    );
    assert.ok(gutterLineNumbers.length >= 2, "editor should render line numbers");

    // The editable surface is a CodeMirror contenteditable, not a plain textarea.
    assert.equal(dom.window.document.querySelector(".workbench-editor-cm .cm-editor") !== null, true);
    assert.equal(dom.window.document.querySelector(".workbench-editor-textarea"), null);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test("workbench_editor_pane_applies_grammar_highlighting_tokens", async () => {
  const code = 'const greeting = "hello";\n';
  const root = await mountShell(editorState(code, "src/greet.ts"));
  try {
    const content = dom.window.document.querySelector(".cm-content");
    assert.ok(content);
    // Grammar highlighting splits a line into multiple token spans (keyword,
    // string, etc.) rather than a single flat text node.
    const tokenSpans = dom.window.document.querySelectorAll(".cm-line span");
    assert.ok(
      tokenSpans.length >= 2,
      `expected grammar highlighting to produce token spans, got ${tokenSpans.length}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
