import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { fileIconFor } from "../../support/file-icons.ts";
import { WorkbenchMarkdownView } from "./markdown-view.tsx";
import { WorkbenchHtmlView } from "./html-view.tsx";
import { WorkbenchCodeEditor } from "./code-editor.tsx";
import { javascript } from "@codemirror/lang-javascript";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { css as cssLanguage } from "@codemirror/lang-css";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { html as htmlLang } from "@codemirror/lang-html";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";
import { xml as xmlLang } from "@codemirror/lang-xml";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { StreamLanguage } from "@codemirror/language";
import { shell as shellMode } from "@codemirror/legacy-modes/mode/shell";
import { toml as tomlMode } from "@codemirror/legacy-modes/mode/toml";
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
  const isHtml = language === "html";
  // The file-path breadcrumb. For markdown/html it rides INSIDE the view's header row
  // (alongside the Preview/Code toggle) so the controls sit in the path bar — one row,
  // like the Browser Pane's address bar. For code it stays a standalone path bar.
  const breadcrumb = createEditorBreadcrumb(props.pane, props.draft?.dirty === true, props.handlers);
  return (
    <div
      className="workbench-pane-content workbench-pane-content--editor"
      data-editor-readonly={readOnly ? "readonly" : "editable"}
    >
      {isMarkdown ? (
        <WorkbenchMarkdownView
          paneId={props.pane.paneId}
          value={value}
          readOnly={readOnly}
          dirty={props.draft?.dirty === true}
          revision={props.pane.revision}
          relativePath={props.pane.relativePath ?? props.pane.filePath}
          breadcrumb={breadcrumb}
          handlers={props.handlers}
        />
      ) : isHtml ? (
        <WorkbenchHtmlView
          paneId={props.pane.paneId}
          value={value}
          readOnly={readOnly}
          dirty={props.draft?.dirty === true}
          revision={props.pane.revision}
          filePath={props.pane.filePath}
          relativePath={props.pane.relativePath ?? props.pane.filePath}
          breadcrumb={breadcrumb}
          handlers={props.handlers}
        />
      ) : (
        <>
          {breadcrumb}
          <div className="workbench-editor-stack">
            <WorkbenchCodeEditor
              paneId={props.pane.paneId}
              value={value}
              readOnly={readOnly}
              dirty={props.draft?.dirty === true}
              language={language}
              revision={props.pane.revision}
              navigationTarget={props.pane.navigationTarget}
              relativePath={props.pane.relativePath ?? props.pane.filePath}
              handlers={props.handlers}
            />
            {createWorkbenchEditorReferences(props.pane.references, props.handlers)}
          </div>
        </>
      )}
    </div>
  );
}

// Breadcrumb path bar matching the Figma editor (`tide › CLAUDE.md`): the
// workspace root name followed by the file's path segments.
function createEditorBreadcrumb(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  dirty: boolean,
  handlers: ProductShellHandlers,
): ReactElement {
  const relativePath = pane.relativePath ?? pane.title;
  const pathSegments = relativePath.split("/").filter((segment) => segment.length > 0);
  const segments: Array<{
    kind: "root" | "folder" | "file";
    label: string;
    path?: string;
  }> = [];
  if (pane.filePath && pane.relativePath && pane.filePath.endsWith(pane.relativePath)) {
    const root = pane.filePath.slice(0, pane.filePath.length - pane.relativePath.length);
    const rootName = root.replace(/\/+$/, "").split("/").pop();
    if (rootName) {
      segments.push({ kind: "root", label: rootName });
    }
  }
  pathSegments.forEach((segment, index) => {
    segments.push({
      kind: index === pathSegments.length - 1 ? "file" : "folder",
      label: segment,
      path: pane.relativePath ? pathSegments.slice(0, index + 1).join("/") : undefined,
    });
  });
  if (segments.length === 0) {
    segments.push({ kind: "file", label: pane.title, path: pane.relativePath });
  }
  const createCrumb = (
    segment: (typeof segments)[number],
    index: number,
  ): ReactElement => {
    const className = `workbench-editor-breadcrumb__crumb workbench-editor-breadcrumb__crumb--${segment.kind}`;
    if (segment.path === undefined) {
      return (
        <span key={`crumb-${index}`} className={className} title={segment.label}>
          {segment.label}
        </span>
      );
    }
    const title =
      segment.kind === "folder"
        ? `Reveal ${segment.path} in FileTree`
        : `Open ${segment.path}`;
    return (
      <button
        key={`crumb-${index}`}
        type="button"
        className={className}
        title={title}
        aria-label={title}
        onClick={() =>
          segment.kind === "folder"
            ? handlers.onFileTreeEntryOpen(segment.path as string)
            : handlers.onOpenFile(segment.path as string)
        }
      >
        {segment.label}
      </button>
    );
  };
  return (
    <div className="workbench-editor-breadcrumb" aria-label="Editor breadcrumb">
      {segments.flatMap((segment, index) =>
        index < segments.length - 1
          ? [
              createCrumb(segment, index),
              <span key={`sep-${index}`} className="workbench-editor-breadcrumb__sep">
                ›
              </span>,
            ]
          : [createCrumb(segment, index)],
      )}
      {dirty ? (
        <span className="workbench-editor-breadcrumb__dirty" title="Unsaved changes">
          ●
        </span>
      ) : null}
    </div>
  );
}

function createWorkbenchEditorReferences(
  references: NonNullable<
    ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
  >["references"],
  handlers: ProductShellHandlers,
): ReactElement | null {
  if (references === undefined) {
    return null;
  }
  const countLabel = `${references.items.length}${references.truncated ? "+" : ""}`;
  return (
    <div className="workbench-editor-references" aria-label="References">
      <div className="workbench-editor-references__heading">
        <span className="workbench-editor-references__title">References</span>
        {references.query ? (
          <code className="workbench-editor-references__query">{references.query}</code>
        ) : null}
        <span className="workbench-editor-references__count">{countLabel}</span>
      </div>
      {references.items.length === 0 ? (
        <div className="workbench-editor-references__empty">No references found.</div>
      ) : (
        <ul className="workbench-editor-references__list">
          {references.items.map((item, index) => {
            const Icon = fileIconFor(fileNameForReference(item.relativePath));
            const folder = folderForReference(item.relativePath);
            const lineColumn = `${item.line + 1}:${item.character + 1}`;
            const preview = item.label?.trim() || "No preview";
            return (
              <li
                key={`${item.relativePath}:${item.line}:${item.character}:${index}`}
                className="workbench-editor-references__item-wrap"
              >
                <button
                  type="button"
                  className="workbench-editor-references__item"
                  title={`Open ${item.relativePath}:${lineColumn}`}
                  aria-label={`Open reference ${item.relativePath}:${lineColumn}`}
                  onClick={() => handlers.onOpenFile(item.relativePath)}
                >
                  <span className="workbench-editor-references__meta">
                    <Icon size={13} strokeWidth={1.8} aria-hidden />
                    <span className="workbench-editor-references__file">
                      {fileNameForReference(item.relativePath)}
                    </span>
                    {folder.length > 0 ? (
                      <span className="workbench-editor-references__path">{folder}</span>
                    ) : null}
                    <span className="workbench-editor-references__location">{lineColumn}</span>
                  </span>
                  <code className="workbench-editor-references__label">{preview}</code>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function fileNameForReference(relativePath: string): string {
  return relativePath.replaceAll("\\", "/").split("/").filter(Boolean).pop() ?? relativePath;
}

function folderForReference(relativePath: string): string {
  const parts = relativePath.replaceAll("\\", "/").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function inferEditorLanguage(path: string | undefined): string {
  const ext = (path ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mts", "cts"].includes(ext)) return "ts";
  if (ext === "json") return "json";
  if (ext === "rs") return "rust";
  if (ext === "css") return "css";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  if (ext === "py") return "python";
  if (ext === "go") return "go";
  if (["html", "htm"].includes(ext)) return "html";
  if (["yaml", "yml"].includes(ext)) return "yaml";
  if (ext === "sql") return "sql";
  if (["xml", "svg"].includes(ext)) return "xml";
  if (["c", "cc", "cpp", "cxx", "h", "hpp"].includes(ext)) return "cpp";
  if (ext === "java") return "java";
  if (["sh", "bash", "zsh"].includes(ext)) return "shell";
  if (ext === "toml") return "toml";
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
    case "python":
      return [python()];
    case "go":
      return [go()];
    case "html":
      return [htmlLang()];
    case "yaml":
      return [yamlLang()];
    case "sql":
      return [sql()];
    case "xml":
      return [xmlLang()];
    case "cpp":
      return [cpp()];
    case "java":
      return [java()];
    // No Lezer grammar published; the legacy CM5 stream modes still tokenize.
    case "shell":
      return [StreamLanguage.define(shellMode)];
    case "toml":
      return [StreamLanguage.define(tomlMode)];
    default:
      return [];
  }
}
