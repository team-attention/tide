import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { createElement } from "react";
import type { ReactElement } from "react";
import { WorkbenchMarkdownView } from "./markdown-view.ts";
import { WorkbenchCodeEditor } from "./code-editor.ts";
import { javascript } from "@codemirror/lang-javascript";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { css as cssLanguage } from "@codemirror/lang-css";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function WorkbenchEditorPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  draft: ProductShellViewModel["editorDrafts"][string] | undefined;
  handlers: ProductShellHandlers;
}): ReactElement {
  const readOnly = props.pane.truncated === true;
  const value = props.draft?.content ?? props.pane.bodyText ?? props.pane.bodyTextPreview ?? "";
  const language = inferEditorLanguage(props.pane.relativePath ?? props.pane.filePath);
  const isMarkdown = language === "markdown";
  return createElement(
    "div",
    {
      className: "workbench-pane-content workbench-pane-content--editor",
      "data-editor-readonly": readOnly ? "readonly" : "editable",
    },
    createEditorBreadcrumb(props.pane, props.draft?.dirty === true),
    isMarkdown
      ? createElement(WorkbenchMarkdownView, {
          paneId: props.pane.paneId,
          value,
          readOnly,
          dirty: props.draft?.dirty === true,
          revision: props.pane.revision,
          relativePath: props.pane.relativePath ?? props.pane.filePath,
          handlers: props.handlers,
        })
      : createElement(
          "div",
          { className: "workbench-editor-stack" },
          createElement(WorkbenchCodeEditor, {
            paneId: props.pane.paneId,
            value,
            readOnly,
            dirty: props.draft?.dirty === true,
            language,
            revision: props.pane.revision,
            navigationTarget: props.pane.navigationTarget,
            relativePath: props.pane.relativePath ?? props.pane.filePath,
            handlers: props.handlers,
          }),
          createWorkbenchEditorReferences(props.pane.references),
        ),
  );
}

// Breadcrumb path bar matching the Figma editor (`tide › CLAUDE.md`): the
// workspace root name followed by the file's path segments.
function createEditorBreadcrumb(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  dirty: boolean,
): ReactElement {
  const relativePath = pane.relativePath ?? pane.title;
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (pane.filePath && pane.relativePath && pane.filePath.endsWith(pane.relativePath)) {
    const root = pane.filePath.slice(0, pane.filePath.length - pane.relativePath.length);
    const rootName = root.replace(/\/+$/, "").split("/").pop();
    if (rootName) {
      segments.unshift(rootName);
    }
  }
  return createElement(
    "div",
    { className: "workbench-editor-breadcrumb", "aria-label": "Editor breadcrumb" },
    ...segments.flatMap((segment, index) =>
      index < segments.length - 1
        ? [
            createElement("span", { key: `crumb-${index}`, className: "workbench-editor-breadcrumb__crumb" }, segment),
            createElement("span", { key: `sep-${index}`, className: "workbench-editor-breadcrumb__sep" }, "›"),
          ]
        : [createElement("span", { key: `crumb-${index}`, className: "workbench-editor-breadcrumb__crumb" }, segment)],
    ),
    dirty
      ? createElement("span", { className: "workbench-editor-breadcrumb__dirty", title: "Unsaved changes" }, "●")
      : null,
  );
}

function createWorkbenchEditorReferences(
  references: NonNullable<
    ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
  >["references"],
): ReactElement | null {
  if (references === undefined) {
    return null;
  }
  const heading = `References${references.query ? ` to ${references.query}` : ""} (${references.items.length}${references.truncated ? "+" : ""})`;
  return createElement(
    "div",
    { className: "workbench-editor-references", "aria-label": "References" },
    createElement("div", { className: "workbench-editor-references__heading" }, heading),
    references.items.length === 0
      ? createElement("div", { className: "workbench-editor-references__empty" }, "No references found.")
      : createElement(
          "ul",
          { className: "workbench-editor-references__list" },
          references.items.map((item, index) =>
            createElement(
              "li",
              {
                key: `${item.relativePath}:${item.line}:${item.character}:${index}`,
                className: "workbench-editor-references__item",
              },
              createElement(
                "span",
                { className: "workbench-editor-references__location" },
                `${item.relativePath}:${item.line + 1}:${item.character + 1}`,
              ),
              item.label
                ? createElement("span", { className: "workbench-editor-references__label" }, item.label)
                : null,
            ),
          ),
        ),
  );
}

function inferEditorLanguage(path: string | undefined): string {
  const ext = (path ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mts", "cts"].includes(ext)) return "ts";
  if (ext === "json") return "json";
  if (ext === "rs") return "rust";
  if (ext === "css") return "css";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  return "text";
}

export function editorLanguageExtensions(language: string) {
  switch (language) {
    case "ts":
      return [javascript({ jsx: true, typescript: true })];
    case "json":
      return [jsonLanguage()];
    case "rust":
      return [rust()];
    case "css":
      return [cssLanguage()];
    case "markdown":
      return [markdownLang()];
    default:
      return [];
  }
}
