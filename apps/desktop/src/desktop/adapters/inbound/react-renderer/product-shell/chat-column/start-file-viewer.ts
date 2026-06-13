import type { ProductShellStartPageFile } from "../../../../../application/domains/product-shell/product-shell.ts";
import { createElement, useEffect } from "react";
import type { ReactElement } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import { X } from "lucide-react";
import { editorLanguageExtensions, inferEditorLanguage } from "../workbench/editor-pane.ts";

// Read-only file viewer for the START (New Thread) page: clicking a file in
// the start-page tree has no thread/workbench to open an Editor Pane in, so
// the file renders here, over the empty stage, with the same themed syntax
// highlighting as the real editor (spec: start-page-file-viewer). Editing
// starts once a thread exists.
export function StartFileViewer(props: {
  file: ProductShellStartPageFile;
  onClose: () => void;
}): ReactElement {
  const language = inferEditorLanguage(props.file.relativePath);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);
  return createElement(
    "div",
    { className: "start-file-viewer", role: "region", "aria-label": "File preview" },
    createElement(
      "header",
      { className: "start-file-viewer__head" },
      createElement("span", { className: "start-file-viewer__path", title: props.file.relativePath }, props.file.relativePath),
      props.file.truncated
        ? createElement("span", { className: "start-file-viewer__truncated" }, "preview truncated")
        : null,
      createElement(
        "button",
        {
          type: "button",
          className: "start-file-viewer__close",
          "aria-label": "Close file preview",
          onClick: props.onClose,
        },
        createElement(X, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
      ),
    ),
    createElement(
      "div",
      { className: "start-file-viewer__body workbench-editor-cm" },
      createElement(CodeMirror, {
        value: props.file.content,
        editable: false,
        readOnly: true,
        basicSetup: { lineNumbers: true, foldGutter: false, highlightActiveLine: false, autocompletion: false },
        extensions: [
          EditorView.lineWrapping,
          // Same themed tok-* palette as the workbench editor and chat code.
          syntaxHighlighting(classHighlighter),
          ...editorLanguageExtensions(language),
        ],
      }),
    ),
  );
}
