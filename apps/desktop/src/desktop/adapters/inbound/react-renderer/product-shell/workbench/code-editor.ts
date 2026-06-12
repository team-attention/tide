import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { createElement, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { editorLanguageExtensions } from "./editor-pane.ts";
import { CornerDownRight } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Real code editor: CodeMirror 6 (MIT). Grammar-based highlighting, line
// numbers, selection, editing. Read-only Panes still render highlighted via
// CodeMirror with editing disabled.
export function WorkbenchCodeEditor(props: {
  paneId: string;
  value: string;
  readOnly: boolean;
  dirty: boolean;
  language: string;
  revision: string;
  navigationTarget?: NonNullable<
    ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
  >["navigationTarget"];
  relativePath?: string;
  handlers: ProductShellHandlers;
}): ReactElement {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // The text selection captured when the context menu opened (before the caret is
  // moved to the clicked symbol), so "Add selection to chat" uses it.
  const [menuSelection, setMenuSelection] = useState<{ text: string; fromLine: number; toLine: number } | null>(null);
  // A floating "Add to chat" button anchored to the current text selection.
  const [selToolbar, setSelToolbar] = useState<
    { x: number; y: number; text: string; fromLine: number; toLine: number } | null
  >(null);
  const nav = props.navigationTarget;

  // Attach a code selection to the composer as a chip (shared by the right-click
  // menu and the floating selection toolbar).
  const attachCodeSelection = (sel: { text: string; fromLine: number; toLine: number }) => {
    const path = props.relativePath ?? "selection";
    const baseName = path.slice(path.lastIndexOf("/") + 1);
    const lines = sel.fromLine === sel.toLine ? `L${sel.fromLine}` : `L${sel.fromLine}-${sel.toLine}`;
    props.handlers.onAddContentToChat({
      kind: "code",
      label: `${baseName} ${lines}`,
      text: `\`${path}\` (${lines})\n\`\`\`${props.language}\n${sel.text}\n\`\`\``,
    });
  };
  useEffect(() => {
    const view = editorRef.current?.view;
    if (nav === undefined || view === undefined) {
      return;
    }
    const lineNumber = Math.min(Math.max(nav.line + 1, 1), view.state.doc.lines);
    const lineInfo = view.state.doc.line(lineNumber);
    const from = Math.min(lineInfo.from + Math.max(nav.character, 0), lineInfo.to);
    const to = Math.min(from + Math.max(nav.length ?? 0, 0), view.state.doc.length);
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  }, [nav?.line, nav?.character, nav?.length, props.revision]);

  // Cmd/Ctrl+S saves — like a real editor, instead of a Save button.
  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        props.handlers.onEditorSave(props.paneId);
        return true;
      },
    },
  ]);

  // Right-click targets the symbol under the pointer (move the caret there so
  // the LSP query resolves the clicked identifier), then opens the editor
  // context menu with Go to Definition / Find References.
  const openContextMenu = (event: {
    preventDefault: () => void;
    clientX: number;
    clientY: number;
  }) => {
    event.preventDefault();
    const view = editorRef.current?.view;
    if (view) {
      // Capture any active selection BEFORE collapsing the caret to the click.
      const sel = view.state.selection.main;
      if (!sel.empty) {
        setMenuSelection({
          text: view.state.sliceDoc(sel.from, sel.to),
          fromLine: view.state.doc.lineAt(sel.from).number,
          toLine: view.state.doc.lineAt(sel.to).number,
        });
      } else {
        setMenuSelection(null);
      }
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos !== null && pos !== undefined) {
        view.dispatch({ selection: { anchor: pos } });
        props.handlers.onEditorCursorChange(props.paneId, pos);
      }
    }
    setContextMenu({ x: event.clientX, y: event.clientY });
  };
  const closeMenu = () => setContextMenu(null);

  const addSelectionToChat = () => {
    if (menuSelection !== null) {
      attachCodeSelection(menuSelection);
    }
  };

  const menuItem = (label: string, onSelect: () => void, disabled = false) =>
    createElement(
      "button",
      {
        type: "button",
        className: "workbench-editor-menu__item",
        disabled,
        onClick: () => {
          onSelect();
          closeMenu();
        },
      },
      label,
    );

  // Cmd/Ctrl+click a symbol → jump to its definition (VS Code parity). Sets the
  // caret to the clicked token, then runs go-to-definition on it.
  const onCmdClick = (event: {
    metaKey: boolean;
    ctrlKey: boolean;
    button: number;
    clientX: number;
    clientY: number;
    preventDefault: () => void;
  }) => {
    if ((!event.metaKey && !event.ctrlKey) || event.button !== 0) {
      return;
    }
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null || pos === undefined) {
      return;
    }
    event.preventDefault();
    view.dispatch({ selection: { anchor: pos } });
    props.handlers.onEditorCursorChange(props.paneId, pos);
    props.handlers.onEditorGoToDefinition(props.paneId);
  };

  return createElement(
    "div",
    {
      className: "workbench-editor-surface",
      "aria-label": "Editor Pane text",
      "data-editor-language": props.language,
      "data-navigation-target": nav?.label,
      onContextMenu: openContextMenu,
      onMouseDownCapture: onCmdClick,
    },
    createElement(CodeMirror, {
      ref: editorRef,
      className: "workbench-editor-cm",
      value: props.value,
      editable: !props.readOnly,
      readOnly: props.readOnly,
      basicSetup: {
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !props.readOnly,
      },
      extensions: [saveKeymap, EditorView.lineWrapping, ...editorLanguageExtensions(props.language)],
      onChange: (next: string) => props.handlers.onEditorDraftChange(props.paneId, next),
      onUpdate: (update: ViewUpdate) => {
        if (!update.selectionSet) {
          return;
        }
        const sel = update.state.selection.main;
        props.handlers.onEditorCursorChange(props.paneId, sel.head);
        const view = editorRef.current?.view;
        if (!sel.empty && view !== undefined && typeof view.coordsAtPos === "function") {
          const coords = view.coordsAtPos(sel.from);
          if (coords) {
            setSelToolbar({
              x: coords.left,
              y: coords.top,
              text: update.state.sliceDoc(sel.from, sel.to),
              fromLine: update.state.doc.lineAt(sel.from).number,
              toLine: update.state.doc.lineAt(sel.to).number,
            });
            return;
          }
        }
        setSelToolbar(null);
      },
    }),
    selToolbar === null
      ? null
      : createElement(
          "button",
          {
            type: "button",
            className: "editor-selection-toolbar",
            style: { left: `${selToolbar.x}px`, top: `${Math.max(selToolbar.y - 36, 8)}px` } as CSSProperties,
            // Use mousedown so the click lands before the selection clears.
            onMouseDown: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              attachCodeSelection(selToolbar);
              setSelToolbar(null);
            },
          },
          createElement(CornerDownRight, { size: 13, strokeWidth: 1.9, "aria-hidden": true }),
          "Add to chat",
        ),
    contextMenu === null
      ? null
      : createElement(
          "div",
          {
            className: "workbench-editor-menu-backdrop",
            onClick: closeMenu,
            onContextMenu: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              closeMenu();
            },
          },
          createElement(
            "div",
            {
              className: "workbench-editor-menu",
              role: "menu",
              "aria-label": "Editor actions",
              style: { left: `${contextMenu.x}px`, top: `${contextMenu.y}px` } as CSSProperties,
            },
            menuItem("Add selection to chat", addSelectionToChat, menuSelection === null),
            createElement("div", { className: "workbench-editor-menu__sep", role: "separator" }),
            menuItem("Go to Definition", () => props.handlers.onEditorGoToDefinition(props.paneId)),
            menuItem("Find References", () => props.handlers.onEditorGoToReferences(props.paneId)),
            props.readOnly
              ? null
              : menuItem("Save", () => props.handlers.onEditorSave(props.paneId), !props.dirty),
          ),
        ),
  );
}
