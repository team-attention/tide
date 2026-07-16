import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { useEffect, useState, type ReactElement } from "react";
import { css, styled } from "styled-components";
import { fileIconFor } from "../../support/file-icons.ts";
import { WorkbenchMarkdownView } from "./markdown-view.tsx";
import { WorkbenchHtmlView } from "./html-view.tsx";
import { WorkbenchCodeEditor } from "./code-editor.tsx";
import { javascript } from "@codemirror/lang-javascript";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { rust } from "@codemirror/lang-rust";
import { css as cssLanguage } from "@codemirror/lang-css";
import { markdown as markdownLang, markdownLanguage } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { html as htmlLang } from "@codemirror/lang-html";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";
import { xml as xmlLang } from "@codemirror/lang-xml";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { StreamLanguage, type Language } from "@codemirror/language";
import { shell as shellMode } from "@codemirror/legacy-modes/mode/shell";
import { toml as tomlMode } from "@codemirror/legacy-modes/mode/toml";
import { X } from "lucide-react";
import { WorkbenchPaneSurface } from "./workbench-pane.parts.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function WorkbenchEditorPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  draft: ProductShellViewModel["editorDrafts"][string] | undefined;
  handlers: ProductShellHandlers;
  gitDiffTarget?: { cwd: string; relativePath: string; changeKey: string };
}): ReactElement {
  const readOnly = props.pane.truncated === true;
  const value = props.draft?.content ?? props.pane.bodyText ?? props.pane.bodyTextPreview ?? "";
  const language = inferEditorLanguage(props.pane.relativePath ?? props.pane.filePath);
  const isMarkdown = language === "markdown";
  const isHtml = language === "html";
  const [gitDiffState, setGitDiffState] = useState<{ targetId: string; text: string } | null>(null);
  const gitDiffTarget = props.gitDiffTarget;
  const gitDiffTargetId =
    gitDiffTarget === undefined ? undefined : `${gitDiffTarget.cwd}\0${gitDiffTarget.relativePath}`;
  const gitDiffText =
    gitDiffTargetId !== undefined && gitDiffState?.targetId === gitDiffTargetId
      ? gitDiffState.text
      : undefined;
  useEffect(() => {
    const target = gitDiffTarget;
    if (target === undefined) {
      setGitDiffState(null);
      return undefined;
    }
    const targetId = `${target.cwd}\0${target.relativePath}`;
    let cancelled = false;
    setGitDiffState((current) => current?.targetId === targetId ? current : null);
    void props.handlers.onGitFileDiff(target.cwd, target.relativePath)
      .then((diffText) => {
        if (!cancelled) {
          setGitDiffState({ targetId, text: diffText });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGitDiffState((current) => current?.targetId === targetId ? current : null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gitDiffTarget?.changeKey, gitDiffTargetId, props.handlers]);
  // The file-path breadcrumb. For Markdown/HTML it rides inside the view's header row
  // (alongside the presentation toggle) so the controls sit in one path-bar row,
  // like the Browser Pane's address bar. For code it stays a standalone path bar.
  const breadcrumb = createEditorBreadcrumb(props.pane, props.draft?.dirty === true, props.handlers);
  return (
    <EditorPaneSurface
      data-pane-surface-kind="editor"
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
          gitDiffText={gitDiffText}
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
          gitDiffText={gitDiffText}
          handlers={props.handlers}
        />
      ) : (
        <>
          {breadcrumb}
          <EditorCodeStack>
            <WorkbenchCodeEditor
              paneId={props.pane.paneId}
              value={value}
              readOnly={readOnly}
              dirty={props.draft?.dirty === true}
              language={language}
              revision={props.pane.revision}
              gitDiffText={gitDiffText}
              navigationTarget={props.pane.navigationTarget}
              relativePath={props.pane.relativePath ?? props.pane.filePath}
              handlers={props.handlers}
            />
            {createWorkbenchEditorReferences(props.pane, props.handlers)}
          </EditorCodeStack>
        </>
      )}
    </EditorPaneSurface>
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
    if (segment.path === undefined) {
      return (
        <EditorBreadcrumbText key={`crumb-${index}`} $kind={segment.kind} title={segment.label}>
          {segment.label}
        </EditorBreadcrumbText>
      );
    }
    const title =
      segment.kind === "folder"
        ? `Reveal ${segment.path} in FileTree`
        : `Open ${segment.path}`;
    return (
      <EditorBreadcrumbButton
        key={`crumb-${index}`}
        type="button"
        $kind={segment.kind}
        title={title}
        aria-label={title}
        onClick={() =>
          segment.kind === "folder"
            ? handlers.onFileTreeEntryOpen(segment.path as string)
            : handlers.onOpenFile(segment.path as string)
        }
      >
        {segment.label}
      </EditorBreadcrumbButton>
    );
  };
  return (
    <EditorBreadcrumb aria-label="Editor breadcrumb" data-editor-breadcrumb="true">
      {segments.flatMap((segment, index) =>
        index < segments.length - 1
          ? [
              createCrumb(segment, index),
              <EditorBreadcrumbSeparator key={`sep-${index}`}>
                ›
              </EditorBreadcrumbSeparator>,
            ]
          : [createCrumb(segment, index)],
      )}
      {dirty ? (
        <EditorBreadcrumbDirty title="Unsaved changes">
          ●
        </EditorBreadcrumbDirty>
      ) : null}
    </EditorBreadcrumb>
  );
}

function createWorkbenchEditorReferences(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  handlers: ProductShellHandlers,
): ReactElement | null {
  const references = pane.references;
  if (references == null) {
    return null;
  }
  const sourcePath = pane.relativePath ?? pane.filePath ?? "";
  const referenceItems = references.items ?? [];
  const orderedItems = [...referenceItems].sort((a, b) => {
    const aPath = a.relativePath ?? "";
    const bPath = b.relativePath ?? "";
    const aCurrent = aPath === sourcePath ? 0 : 1;
    const bCurrent = bPath === sourcePath ? 0 : 1;
    if (aCurrent !== bCurrent) {
      return aCurrent - bCurrent;
    }
    if (aPath !== bPath) {
      return aPath.localeCompare(bPath);
    }
    return a.line - b.line || a.character - b.character;
  });
  const countLabel = `${referenceItems.length}${references.truncated ? "+" : ""}`;
  return (
    <EditorReferencesPanel aria-label="References" data-editor-references="true">
      <EditorReferencesHeading>
        <EditorReferencesTitle data-editor-reference-title="true">References</EditorReferencesTitle>
        {references.query ? (
          <EditorReferencesQuery data-editor-reference-query="true">{references.query}</EditorReferencesQuery>
        ) : null}
        <EditorReferencesCount data-editor-reference-count="true">{countLabel}</EditorReferencesCount>
        <EditorReferencesDismissButton
          type="button"
          title="Close references"
          aria-label="Close references"
          onClick={() => handlers.onEditorReferencesDismiss(pane.paneId)}
        >
          <X size={14} strokeWidth={2} aria-hidden />
        </EditorReferencesDismissButton>
      </EditorReferencesHeading>
      {referenceItems.length === 0 ? (
        <EditorReferencesEmpty>No references found.</EditorReferencesEmpty>
      ) : (
        <EditorReferencesList>
          {orderedItems.map((item, index) => {
            const relativePath = item.relativePath ?? "";
            const fileName = fileNameForReference(relativePath) || "Unknown file";
            const Icon = fileIconFor(fileName);
            const folder = folderForReference(relativePath);
            const lineColumn = `${item.line + 1}:${item.character + 1}`;
            const preview = item.label?.trim() || "No preview";
            const isCurrentFile = relativePath === sourcePath;
            return (
              <EditorReferencesItemWrap
                key={`${relativePath}:${item.line}:${item.character}:${index}`}
              >
                <EditorReferencesItemButton
                  type="button"
                  data-editor-reference-item="true"
                  data-current-file={isCurrentFile ? "true" : "false"}
                  title={
                    relativePath.length > 0
                      ? `Open ${relativePath}:${lineColumn}`
                      : `Reference target unavailable:${lineColumn}`
                  }
                  aria-label={
                    relativePath.length > 0
                      ? `Open reference ${relativePath}:${lineColumn}`
                      : `Reference target unavailable:${lineColumn}`
                  }
                  onClick={() => {
                    if (relativePath.length === 0) {
                      return;
                    }
                    handlers.onOpenFile(relativePath, {
                      line: item.line,
                      character: item.character,
                      length: item.length,
                      label: preview,
                      sourcePaneId: pane.paneId,
                    });
                  }}
                >
                  <EditorReferencesMeta>
                    <Icon size={13} strokeWidth={1.8} aria-hidden />
                    <EditorReferencesFile data-editor-reference-file="true">{fileName}</EditorReferencesFile>
                    {folder.length > 0 ? (
                      <EditorReferencesPath data-editor-reference-path="true">{folder}</EditorReferencesPath>
                    ) : null}
                    <EditorReferencesLocation>{lineColumn}</EditorReferencesLocation>
                  </EditorReferencesMeta>
                  <EditorReferencesPreview>{preview}</EditorReferencesPreview>
                </EditorReferencesItemButton>
              </EditorReferencesItemWrap>
            );
          })}
        </EditorReferencesList>
      )}
    </EditorReferencesPanel>
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
      return [
        markdownLang({
          base: markdownLanguage,
          codeLanguages: markdownFencedCodeLanguage,
        }),
      ];
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

const markdownFencedCodeLanguageFactories: Record<string, () => Language> = {
  typescript: () => javascript({ jsx: true, typescript: true }).language,
  javascript: () => javascript({ jsx: true }).language,
  json: () => jsonLanguage().language,
  rust: () => rust().language,
  css: () => cssLanguage().language,
  python: () => python().language,
  go: () => go().language,
  html: () => htmlLang().language,
  yaml: () => yamlLang().language,
  sql: () => sql().language,
  xml: () => xmlLang().language,
  cpp: () => cpp().language,
  java: () => java().language,
};
const markdownFencedCodeLanguageAliases: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  rs: "rust",
  py: "python",
  htm: "html",
  yml: "yaml",
  svg: "xml",
  c: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "cpp",
  hpp: "cpp",
};
const markdownFencedCodeLanguageCache = new Map<string, Language>();

function markdownFencedCodeLanguage(info: string): Language | null {
  const requested = info.trim().toLowerCase();
  const language = markdownFencedCodeLanguageAliases[requested] ?? requested;
  const factory = markdownFencedCodeLanguageFactories[language];
  if (factory === undefined) {
    return null;
  }
  const cached = markdownFencedCodeLanguageCache.get(language);
  if (cached !== undefined) {
    return cached;
  }
  const created = factory();
  markdownFencedCodeLanguageCache.set(language, created);
  return created;
}

const EditorPaneSurface = styled(WorkbenchPaneSurface)``;

const EditorCodeStack = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
`;

const EditorBreadcrumb = styled.div`
  min-width: 0;
  min-height: 34px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  padding: 8px 18px 4px;
  color: var(--tide-muted);
  font: 500 13px/16px Inter, ui-sans-serif, system-ui, sans-serif;
  white-space: nowrap;
`;

const editorBreadcrumbCrumb = css<{ $kind: "root" | "folder" | "file" }>`
  min-width: ${({ $kind }) => ($kind === "file" ? "36px" : "0")};
  max-width: min(30ch, 100%);
  height: 24px;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: ${({ $kind }) => ($kind === "file" ? "var(--tide-text)" : "inherit")};
  font: inherit;
  font-weight: ${({ $kind }) => ($kind === "file" ? "600" : "inherit")};
  text-overflow: ellipsis;
  white-space: nowrap;
  ${({ $kind }) => ($kind === "file" ? "flex: 1 1 auto;" : "flex: 0 4 auto;")}
`;

const EditorBreadcrumbText = styled.span<{ $kind: "root" | "folder" | "file" }>`
  ${editorBreadcrumbCrumb}
`;

const EditorBreadcrumbButton = styled.button<{ $kind: "root" | "folder" | "file" }>`
  ${editorBreadcrumbCrumb}
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }

  &:active {
    background: color-mix(in srgb, var(--tide-selection) 70%, var(--tide-action) 8%);
  }
`;

const EditorBreadcrumbSeparator = styled.span`
  flex: 0 0 auto;
  color: var(--tide-muted);
  opacity: 0.7;
`;

const EditorBreadcrumbDirty = styled.span`
  margin-left: 6px;
  color: var(--tide-action);
  font-size: 10px;
`;

const EditorReferencesPanel = styled.div`
  max-height: min(34%, 260px);
  flex: 0 0 auto;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  margin: 0;
  border-top: 1px solid var(--tide-line);
  background: var(--tide-bg);
`;

const EditorReferencesHeading = styled.div`
  min-height: 34px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 6px 12px;
  border-bottom: 1px solid var(--tide-line);
  background: var(--tide-bg);
`;

const EditorReferencesTitle = styled.span`
  flex: 0 0 auto;
  color: var(--tide-text);
  font-size: 12px;
  font-weight: 650;
`;

const EditorReferencesQuery = styled.code`
  min-width: 0;
  max-width: 46ch;
  height: 20px;
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  padding: 0 6px;
  border: 1px solid var(--tide-line);
  border-radius: 5px;
  background: var(--tide-surface);
  color: var(--tide-muted);
  font: 11px/1.2 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EditorReferencesCount = styled.span`
  min-width: 22px;
  height: 20px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--tide-selection);
  color: var(--tide-text);
  font: 600 11px/1 Inter, ui-sans-serif, system-ui, sans-serif;
`;

const EditorReferencesDismissButton = styled.button`
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }

  &:focus-visible {
    outline: 2px solid var(--tide-action);
    outline-offset: -1px;
  }
`;

const EditorReferencesEmpty = styled.div`
  padding: 14px 12px;
  color: var(--tide-muted);
  font-size: 12px;
`;

const EditorReferencesList = styled.ul`
  overflow: auto;
  margin: 0;
  padding: 4px 6px 6px;
  list-style: none;
`;

const EditorReferencesItemWrap = styled.li`
  margin: 0;
`;

const EditorReferencesItemButton = styled.button`
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 6px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-text);
  cursor: pointer;
  text-align: left;

  &:hover {
    background: var(--tide-selection);
  }

  &[data-current-file="true"] {
    background: color-mix(in srgb, var(--tide-selection) 62%, transparent);
  }

  &:focus-visible {
    outline: 2px solid var(--tide-action);
    outline-offset: -1px;
  }

  &:active {
    background: color-mix(in srgb, var(--tide-selection) 76%, var(--tide-action) 8%);
  }
`;

const EditorReferencesMeta = styled.span`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--tide-muted);

  svg {
    flex: 0 0 auto;
    color: var(--tide-muted);
  }
`;

const EditorReferencesFile = styled.span`
  min-width: 0;
  max-width: 24ch;
  flex: 0 1 auto;
  overflow: hidden;
  color: var(--tide-text);
  font: 600 12px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EditorReferencesPath = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--tide-muted);
  font: 11px/1.35 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EditorReferencesLocation = styled.span`
  height: 18px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border: 1px solid var(--tide-line);
  border-radius: 5px;
  background: var(--tide-bg);
  color: var(--tide-muted);
  font: 11px/1.4 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
`;

const EditorReferencesPreview = styled.code`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-text);
  font: 12px/1.5 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
