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
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const {
  applyProductShellBackendEvent,
  createProductShellState,
  openProductShellThread,
} = await import("../src/desktop/application/domains/product-shell/product-shell.ts");
const { TideProductShell } = await import(
  "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx"
);
const { editProductShellWorkbenchEditorPane, goToProductShellEditorDefinition } = await import(
  "../src/desktop/application/domains/product-shell/product-shell.ts"
);
const { inferEditorLanguage, editorLanguageExtensions } = await import(
  "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/editor-pane.tsx"
);
const {
  deriveEditorRoot,
  hasCodeIntelligence,
  mapCompletionKindToCmType,
  payloadCompletionsToCm,
  payloadDiagnosticsToCm,
  payloadHighlightsToRanges,
  payloadHoverContents,
  signatureRenderModel,
  wordRangeInLine,
} = await import(
  "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/code-intel-mappers.ts"
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
    root.render(<TideProductShell initialState={state} />);
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

test("markdown_editor_pane_toggle_shows_source_editor", async () => {
  // Spec: docs_v2/specs/workbench-markdown-preview-editor.md (UC-1, UC-2)
  const root = await mountShell(editorState("# Title\n\nSome body text.\n", "notes.md"));
  try {
    // Default: rendered Preview (a real <h1>), no CodeMirror source surface.
    assert.ok(dom.window.document.querySelector(".workbench-md-preview"), "preview renders by default");
    assert.ok(dom.window.document.querySelector(".workbench-md-preview h1"), "heading is rendered");
    assert.equal(dom.window.document.querySelector(".workbench-editor-cm .cm-editor"), null);

    const editButton = Array.from(
      dom.window.document.querySelectorAll(".workbench-md-toggle__option"),
    ).find((button) => (button.textContent ?? "").trim() === "Edit");
    assert.ok(editButton, "Edit toggle present");

    await act(async () => {
      editButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Edit mode shows the real source editor.
    assert.ok(
      dom.window.document.querySelector(".workbench-editor-cm .cm-editor"),
      "source editor appears after toggling to Edit",
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test("html_editor_pane_renders_a_browser_preview_by_default_and_toggles_to_code", async () => {
  // Spec: docs_v2/specs/workbench-html-preview.md
  const root = await mountShell(editorState("<!doctype html><h1>Hi</h1>", "page.html"));
  try {
    // Default: a rendered <webview> preview, no CodeMirror source surface.
    assert.ok(dom.window.document.querySelector(".workbench-html-webview"), "webview preview renders by default");
    assert.equal(dom.window.document.querySelector(".workbench-editor-cm .cm-editor"), null);

    const codeButton = Array.from(
      dom.window.document.querySelectorAll(".workbench-html-toggle__option"),
    ).find((button) => (button.textContent ?? "").trim() === "Code");
    assert.ok(codeButton, "Code toggle present");

    await act(async () => {
      codeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Code mode shows the real source editor; the preview webview is gone.
    assert.ok(
      dom.window.document.querySelector(".workbench-editor-cm .cm-editor"),
      "source editor appears after toggling to Code",
    );
    assert.equal(dom.window.document.querySelector(".workbench-html-webview"), null);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test("fileUrlFromPath builds a file:// url, encoding spaces and normalizing Windows paths", async () => {
  // Gemini review: Windows backslash + drive-letter paths must become file:///C:/…
  const { fileUrlFromPath } = await import(
    "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/html-view.tsx"
  );
  assert.equal(fileUrlFromPath("/Users/a b/page.html"), "file:///Users/a%20b/page.html");
  assert.equal(fileUrlFromPath("C:\\dir\\sub\\page.html"), "file:///C:/dir/sub/page.html");
});

test("workbench_editor_pane_opens_lsp_actions_on_right_click_not_buttons", async () => {
  // Spec: docs_v2/specs/workbench-editor-code-navigation.md
  // A real code editor exposes Go to Definition / Find References on the
  // right-click context menu, not as a row of buttons below the code.
  const root = await mountShell(editorState("export const value = 1;\n", "src/app.ts"));
  try {
    // No LSP/save action button bar in the editor chrome.
    assert.equal(dom.window.document.querySelector(".workbench-editor-actions"), null);

    const surface = dom.window.document.querySelector(".workbench-editor-surface");
    assert.ok(surface, "editor surface should mount");

    await act(async () => {
      surface.dispatchEvent(
        new dom.window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });

    const menu = dom.window.document.querySelector('.workbench-editor-menu[role="menu"]');
    assert.ok(menu, "right-click should open the editor context menu");
    const labels = Array.from(menu.querySelectorAll(".workbench-editor-menu__item")).map(
      (el) => (el.textContent ?? "").trim(),
    );
    assert.ok(labels.includes("Go to Definition"), `menu items were ${JSON.stringify(labels)}`);
    assert.ok(labels.includes("Find References"), `menu items were ${JSON.stringify(labels)}`);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test("editor_context_menu_lists_clipboard_items_above_navigation", async () => {
  // Spec: docs_v2/specs/workbench-editor-language-intelligence.md — the menu
  // grows Cut / Copy / Paste while keeping the existing navigation items.
  const root = await mountShell(editorState("export const value = 1;\n", "src/app.ts"));
  try {
    const surface = dom.window.document.querySelector(".workbench-editor-surface");
    assert.ok(surface, "editor surface should mount");

    await act(async () => {
      surface.dispatchEvent(
        new dom.window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });

    const menu = dom.window.document.querySelector('.workbench-editor-menu[role="menu"]');
    assert.ok(menu, "right-click should open the editor context menu");
    const labels = Array.from(menu.querySelectorAll(".workbench-editor-menu__item")).map(
      (el) => (el.textContent ?? "").trim(),
    );
    for (const label of ["Cut", "Copy", "Paste"]) {
      assert.ok(labels.includes(label), `expected ${label} in ${JSON.stringify(labels)}`);
    }
    // Clipboard block sits above Go to Definition.
    assert.ok(
      labels.indexOf("Paste") < labels.indexOf("Go to Definition"),
      `clipboard items should precede navigation: ${JSON.stringify(labels)}`,
    );
    // No selection captured → selection-dependent items are disabled; Paste is
    // enabled because this pane is editable.
    const items = Array.from(menu.querySelectorAll(".workbench-editor-menu__item"));
    const byLabel = (label: string) =>
      items.find((el) => (el.textContent ?? "").trim() === label) as HTMLButtonElement;
    assert.equal(byLabel("Cut").disabled, true);
    assert.equal(byLabel("Copy").disabled, true);
    assert.equal(byLabel("Paste").disabled, false);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test("infer_editor_language_covers_new_grammars", () => {
  const cases: Record<string, string> = {
    "main.py": "python",
    "cmd/main.go": "go",
    "index.html": "html",
    "ci.yaml": "yaml",
    "ci.yml": "yaml",
    "schema.sql": "sql",
    "layout.xml": "xml",
    "main.cpp": "cpp",
    "main.c": "cpp",
    "header.hpp": "cpp",
    "list.h": "cpp",
    "App.java": "java",
    "run.sh": "shell",
    "Cargo.toml": "toml",
  };
  for (const [path, language] of Object.entries(cases)) {
    assert.equal(inferEditorLanguage(path), language, `language for ${path}`);
  }
});

test("editor_language_extensions_nonempty_for_new_grammars", () => {
  for (const language of [
    "python",
    "go",
    "html",
    "yaml",
    "sql",
    "xml",
    "cpp",
    "java",
    "shell",
    "toml",
  ]) {
    assert.ok(
      editorLanguageExtensions(language).length > 0,
      `expected a grammar extension for ${language}`,
    );
  }
});

test("code_intel_mappers_map_result_payloads_to_codemirror_shapes", () => {
  // Engine coverage: TS in-process plus rust-analyzer/gopls behind the port.
  assert.equal(hasCodeIntelligence("ts"), true);
  assert.equal(hasCodeIntelligence("rust"), true);
  assert.equal(hasCodeIntelligence("go"), true);
  assert.equal(hasCodeIntelligence("python"), false);

  // Root derivation: filePath minus trailing relativePath; directory fallback.
  assert.equal(deriveEditorRoot("/repo/src/app.ts", "src/app.ts"), "/repo");
  assert.equal(deriveEditorRoot("/repo/src/app.ts", "other/file.ts"), "/repo/src");
  assert.equal(deriveEditorRoot("/repo/src/app.ts", undefined), "/repo/src");

  // Provider kind names → CodeMirror completion types.
  assert.equal(mapCompletionKindToCmType("var"), "variable");
  assert.equal(mapCompletionKindToCmType("Method"), "method");
  assert.equal(mapCompletionKindToCmType("property"), "property");
  assert.equal(mapCompletionKindToCmType("mystery"), undefined);
  assert.equal(mapCompletionKindToCmType(undefined), undefined);

  // Completions: insertText wins for apply, label is the fallback; malformed
  // entries are dropped.
  const completions = payloadCompletionsToCm({
    kind: "completion",
    ok: true,
    completions: [
      { label: "toString", kind: "method", detail: "() => string", insertText: "toString()" },
      { label: "value" },
      { notALabel: true },
    ],
  });
  assert.deepEqual(completions, [
    { label: "toString", type: "method", detail: "() => string", apply: "toString()" },
    { label: "value", type: undefined, detail: undefined, apply: "value" },
  ]);

  // Position resolution against a known buffer.
  const content = "const a = 1;\nconst b: string = 2;\n";
  const lineStarts = [0, 13, 34];
  const posToOffset = (line: number, character: number) =>
    line < 0 || line >= lineStarts.length ? null : lineStarts[line] + character;

  // Diagnostics: 0-based positions become clamped from/to offsets; rows on
  // out-of-range lines are dropped, overlong ranges clamp to the doc end.
  const diagnostics = payloadDiagnosticsToCm(
    {
      diagnostics: [
        { line: 1, character: 6, length: 1, message: "Type 'number' is not 'string'.", severity: "error" },
        { line: 99, character: 0, length: 1, message: "dropped", severity: "error" },
        { line: 1, character: 6, length: 999, message: "clamped", severity: "warning" },
      ],
    },
    posToOffset,
    content.length,
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0], {
    from: 19,
    to: 20,
    severity: "error",
    message: "Type 'number' is not 'string'.",
  });
  assert.equal(diagnostics[1].to, content.length);
  assert.equal(diagnostics[1].severity, "warning");

  // Highlights: write occurrences are flagged; zero-length ranges are dropped.
  const highlights = payloadHighlightsToRanges(
    {
      highlights: [
        { line: 0, character: 6, length: 1, kind: "write" },
        { line: 1, character: 6, length: 1 },
        { line: 0, character: 3, length: 0 },
      ],
    },
    posToOffset,
    content.length,
  );
  assert.deepEqual(highlights, [
    { from: 6, to: 7, write: true },
    { from: 19, to: 20, write: false },
  ]);

  // Hover: empty/whitespace contents mean "no tooltip".
  assert.equal(payloadHoverContents({ hover: null }), null);
  assert.equal(payloadHoverContents({ hover: { contents: "  " } }), null);
  assert.deepEqual(payloadHoverContents({ hover: { contents: "const a: number", line: 0, character: 6, length: 1 } }), {
    contents: "const a: number",
    line: 0,
    character: 6,
    length: 1,
  });

  // Signature help: the active parameter is isolated for <strong> emphasis,
  // resolving repeated labels by scanning past earlier parameters.
  const model = signatureRenderModel({
    signature: {
      signatures: [
        { label: "add(x: number, x: number): number", parameters: [{ label: "x: number" }, { label: "x: number" }] },
      ],
      activeSignature: 0,
      activeParameter: 1,
    },
  });
  assert.deepEqual(model, {
    before: "add(x: number, ",
    active: "x: number",
    after: "): number",
  });
  assert.equal(signatureRenderModel({ signature: null }), null);
  assert.equal(signatureRenderModel({ signature: { signatures: [] } }), null);

  // Cmd+hover word detection.
  assert.deepEqual(wordRangeInLine("foo.bar(x)", 5), { start: 4, end: 7 });
  assert.equal(wordRangeInLine("foo. (x)", 4), null);
});

test("go_to_definition_carries_dirty_draft_content", () => {
  // Spec: docs_v2/specs/workbench-editor-language-intelligence.md — navigation
  // on an unsaved buffer must resolve against what's on screen, so a dirty
  // draft rides along as command data `content` (clean panes stay content-free,
  // covered by desktop-product-shell-visual-foundation tests).
  const edited = "export const value = 2;\n";
  const state = editProductShellWorkbenchEditorPane(
    editorState("export const value = 1;\n", "src/app.ts"),
    "pane-editor",
    edited,
  );
  const result = goToProductShellEditorDefinition(state, "pane-editor");
  assert.ok(result.command, "go_to_definition should emit a command");
  assert.equal(result.command.kind, "workbench.command");
  const payload = result.command.payload as { command?: string; data?: { content?: string } };
  assert.equal(payload.command, "go_to_definition");
  assert.equal(payload.data?.content, edited);
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
