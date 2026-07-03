import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { styled } from "styled-components";
import CodeMirror from "@uiw/react-codemirror";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { SearchQuery } from "@codemirror/search";
import { editorLanguageExtensions } from "./editor-pane.tsx";
import { codeIntelligenceExtensions } from "./code-intel-extensions.ts";
import type { CodeIntelContext } from "./code-intel-extensions.ts";
import { createGitDiffLineDecorations, parseUnifiedDiffLineMarkers } from "./git-diff-lines.ts";
import { CornerDownRight, FileSearch, ListTree, Save, Search as SearchIcon } from "lucide-react";
import { InPaneFindBar, useInPaneFindState, usePaneFindIntent } from "../../support/in-pane-find.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).
// Language-intelligence extensions: spec workbench-editor-language-intelligence.

// Document offset → 0-based {line, character}. Go-to-definition/references carry
// the live position from the view; the reducer sends it to the thread Workbench.
function offsetToPosition(view: EditorView, offset: number): { line: number; character: number } {
  const line = view.state.doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

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
  gitDiffText?: string;
  navigationTarget?: NonNullable<
    ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
  >["navigationTarget"];
  relativePath?: string;
  handlers: ProductShellHandlers;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const find = useInPaneFindState();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  // The text selection captured when the context menu opened (before the caret is
  // moved to the clicked symbol), so "Add selection to chat" / Cut / Copy use it.
  const [menuSelection, setMenuSelection] = useState<
    { text: string; from: number; to: number; fromLine: number; toLine: number } | null
  >(null);
  // A floating "Add to chat" button anchored to the current text selection.
  const [selToolbar, setSelToolbar] = useState<
    { x: number; y: number; text: string; fromLine: number; toLine: number } | null
  >(null);
  const nav = props.navigationTarget;
  // Latest props for the intel extensions (built once, see useMemo below).
  const propsRef = useRef(props);
  propsRef.current = props;
  const findMatches = useMemo(() => {
    const query = find.query.trim();
    if (query.length === 0) {
      return [];
    }
    const view = editorRef.current?.view;
    if (view !== undefined) {
      const search = new SearchQuery({ search: find.query, caseSensitive: false, literal: true });
      const matches: { from: number; to: number }[] = [];
      const cursor = search.getCursor(view.state);
      for (let next = cursor.next(); !next.done; next = cursor.next()) {
        matches.push({ from: next.value.from, to: next.value.to });
      }
      return matches;
    }
    return plainTextMatches(props.value, find.query);
  }, [find.query, props.value, props.revision]);
  const findMatchCount = findMatches.length;
  useEffect(() => {
    if (!find.open || find.query.trim().length === 0 || findMatches.length === 0) {
      return;
    }
    const view = editorRef.current?.view;
    if (view === undefined) {
      return;
    }
    const index = Math.max(0, Math.min(find.activeIndex, findMatches.length - 1));
    if (index !== find.activeIndex) {
      find.setActiveIndex(index);
    }
    const match = findMatches[index];
    view.dispatch({
      selection: { anchor: match.from, head: match.to },
      scrollIntoView: true,
    });
  }, [find.open, find.query, find.activeIndex, findMatches, find.setActiveIndex]);
  usePaneFindIntent(rootRef, {
    enabled: true,
    open: find.open,
    onOpen: find.openFind,
    onClose: find.closeFind,
    onNext: () => find.next(findMatchCount),
    onPrevious: () => find.previous(findMatchCount),
  });

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

  // Language-intelligence extensions, built ONCE per mounted editor: the shell
  // re-renders on every keystroke and react-codemirror reconfigures on each new
  // extensions array, so these must keep their instances (module-level fields
  // keep their values across reconfigure) and read live props via propsRef.
  const codeIntelExtensions = useMemo(() => {
    const getContext = (): CodeIntelContext => ({
      paneId: propsRef.current.paneId,
      language: propsRef.current.language,
      readOnly: propsRef.current.readOnly,
      handlers: propsRef.current.handlers,
    });
    return codeIntelligenceExtensions(getContext);
  }, []);
  const gitDiffExtensions = useMemo(
    () => createGitDiffLineDecorations(parseUnifiedDiffLineMarkers(props.gitDiffText ?? "")),
    [props.gitDiffText],
  );

  // CodeMirror reconfigures — and re-parses the WHOLE document's grammar —
  // whenever `extensions`, `basicSetup`, `onChange`, or `onUpdate` change
  // identity (react-codemirror's reconfigure effect deps). The shell re-renders
  // on every keystroke and cursor move, so without stabilizing these a
  // text-heavy file re-parsed its grammar on each render and visibly stuttered.
  // Stabilizing them does NOT change read/write: `value` syncs through
  // CodeMirror's own value channel, and the callbacks read the LATEST props
  // through propsRef, so draft/save/cursor/agent-edit behavior is unchanged.
  const basicSetup = useMemo(
    () => ({
      lineNumbers: true,
      foldGutter: false,
      highlightActiveLine: !props.readOnly,
      // Replaced by the explicit autocompletion({override}) extension below.
      autocompletion: false,
    }),
    [props.readOnly],
  );
  // Reconfigure only when the language (grammar) actually changes — a different
  // file type loading into the pane — not on every render. The Cmd/Ctrl+S keymap
  // reads the live save handler through propsRef.
  const editorExtensions = useMemo(
    () => [
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            propsRef.current.handlers.onEditorSave(propsRef.current.paneId);
            return true;
          },
        },
      ]),
      EditorView.lineWrapping,
      gitDiffExtensions,
      ...codeIntelExtensions,
      ...editorLanguageExtensions(props.language),
    ],
    [props.language, codeIntelExtensions, gitDiffExtensions],
  );
  const onEditorChange = useCallback((next: string) => {
    propsRef.current.handlers.onEditorDraftChange(propsRef.current.paneId, next);
  }, []);
  const onEditorUpdate = useCallback((update: ViewUpdate) => {
    if (!update.selectionSet) {
      return;
    }
    const sel = update.state.selection.main;
    propsRef.current.handlers.onEditorCursorChange(propsRef.current.paneId, sel.head);
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
  }, []);

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
          from: sel.from,
          to: sel.to,
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

  const copySelection = () => {
    if (menuSelection !== null) {
      void navigator.clipboard?.writeText(menuSelection.text);
    }
  };

  const cutSelection = () => {
    const view = editorRef.current?.view;
    if (menuSelection === null || view === undefined || props.readOnly) {
      return;
    }
    // The doc can be replaced while the menu is open (agent edit, pane swap);
    // only delete if the captured range still holds the captured text.
    if (view.state.sliceDoc(menuSelection.from, menuSelection.to) !== menuSelection.text) {
      return;
    }
    void navigator.clipboard?.writeText(menuSelection.text);
    view.dispatch({
      changes: { from: menuSelection.from, to: menuSelection.to },
      selection: { anchor: menuSelection.from },
      userEvent: "delete.cut",
    });
  };

  const pasteIntoEditor = () => {
    const view = editorRef.current?.view;
    if (view === undefined || props.readOnly) {
      return;
    }
    void navigator.clipboard?.readText().then((text) => {
      if (typeof text !== "string" || text.length === 0) {
        return;
      }
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
        userEvent: "input.paste",
      });
    });
  };

  const menuItem = (label: string, onSelect: () => void, disabled = false) => (
    <CodeEditorMenuItem
      type="button"
      data-editor-menu-item="true"
      disabled={disabled}
      onClick={() => {
        onSelect();
        closeMenu();
      }}
    >
      {label}
    </CodeEditorMenuItem>
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
    props.handlers.onEditorGoToDefinition(props.paneId, offsetToPosition(view, pos));
  };
  const currentEditorPosition = (): { line: number; character: number } | undefined => {
    const view = editorRef.current?.view;
    if (view === undefined) {
      return undefined;
    }
    return offsetToPosition(view, view.state.selection.main.head);
  };

  return (
    <CodeEditorSurface
      ref={rootRef}
      aria-label="Editor Pane text"
      data-code-editor-surface="true"
      data-editor-language={props.language}
      data-navigation-target={nav?.label}
      onContextMenu={openContextMenu}
      onMouseDownCapture={onCmdClick}
    >
      <CodeEditorCommandBar data-editor-commandbar="true" role="toolbar" aria-label="Editor commands">
        <CodeEditorCommandButton
          type="button"
          title="Save"
          aria-label="Save"
          disabled={props.readOnly || !props.dirty}
          onClick={() => props.handlers.onEditorSave(props.paneId)}
        >
          <Save size={14} strokeWidth={1.9} aria-hidden />
        </CodeEditorCommandButton>
        <CodeEditorCommandButton
          type="button"
          title="Find in file"
          aria-label="Find in file"
          onClick={find.openFind}
        >
          <SearchIcon size={14} strokeWidth={1.9} aria-hidden />
        </CodeEditorCommandButton>
        <CodeEditorCommandSeparator aria-hidden />
        <CodeEditorCommandButton
          type="button"
          title="Go to Definition"
          aria-label="Go to Definition"
          disabled={props.readOnly}
          onClick={() => props.handlers.onEditorGoToDefinition(props.paneId, currentEditorPosition())}
        >
          <FileSearch size={14} strokeWidth={1.9} aria-hidden />
        </CodeEditorCommandButton>
        <CodeEditorCommandButton
          type="button"
          title="Find References"
          aria-label="Find References"
          disabled={props.readOnly}
          onClick={() => props.handlers.onEditorGoToReferences(props.paneId, currentEditorPosition())}
        >
          <ListTree size={14} strokeWidth={1.9} aria-hidden />
        </CodeEditorCommandButton>
      </CodeEditorCommandBar>
      {find.open ? (
        <InPaneFindBar
          query={find.query}
          matchCount={findMatchCount}
          activeIndex={find.activeIndex}
          scopeLabel="File"
          placeholder="Find in file"
          onQueryChange={find.setQuery}
          onNext={() => find.next(findMatchCount)}
          onPrevious={() => find.previous(findMatchCount)}
          onClose={find.closeFind}
        />
      ) : null}
      <CodeMirrorHost data-code-editor-host="true">
        <CodeMirror
          ref={editorRef}
          value={props.value}
          editable={!props.readOnly}
          readOnly={props.readOnly}
          basicSetup={basicSetup}
          extensions={editorExtensions}
          onChange={onEditorChange}
          onUpdate={onEditorUpdate}
        />
      </CodeMirrorHost>
      {selToolbar === null ? null : (
        <CodeEditorSelectionToolbar
          type="button"
          style={{ left: `${selToolbar.x}px`, top: `${Math.max(selToolbar.y - 36, 8)}px` } as CSSProperties}
          // Use mousedown so the click lands before the selection clears.
          onMouseDown={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            attachCodeSelection(selToolbar);
            setSelToolbar(null);
          }}
        >
          <CornerDownRight size={13} strokeWidth={1.9} aria-hidden />
          Add to chat
        </CodeEditorSelectionToolbar>
      )}
      {contextMenu === null ? null : (
        <CodeEditorMenuBackdrop
          onClick={closeMenu}
          onContextMenu={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            closeMenu();
          }}
        >
          <CodeEditorMenu
            role="menu"
            data-editor-menu="true"
            aria-label="Editor actions"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` } as CSSProperties}
          >
            {menuItem("Add selection to chat", addSelectionToChat, menuSelection === null)}
            <CodeEditorMenuSeparator role="separator" />
            {menuItem("Cut", cutSelection, props.readOnly || menuSelection === null)}
            {menuItem("Copy", copySelection, menuSelection === null)}
            {menuItem("Paste", pasteIntoEditor, props.readOnly)}
            <CodeEditorMenuSeparator role="separator" />
            {menuItem("Go to Definition", () => {
              const view = editorRef.current?.view;
              props.handlers.onEditorGoToDefinition(
                props.paneId,
                view ? offsetToPosition(view, view.state.selection.main.head) : undefined,
              );
            })}
            {menuItem("Find References", () => {
              const view = editorRef.current?.view;
              props.handlers.onEditorGoToReferences(
                props.paneId,
                view ? offsetToPosition(view, view.state.selection.main.head) : undefined,
              );
            })}
            {props.readOnly
              ? null
              : menuItem("Save", () => props.handlers.onEditorSave(props.paneId), !props.dirty)}
          </CodeEditorMenu>
        </CodeEditorMenuBackdrop>
      )}
    </CodeEditorSurface>
  );
}

function plainTextMatches(value: string, query: string): { from: number; to: number }[] {
  const needle = query.toLocaleLowerCase();
  const haystack = value.toLocaleLowerCase();
  const matches: { from: number; to: number }[] = [];
  let offset = haystack.indexOf(needle);
  while (needle.length > 0 && offset !== -1) {
    matches.push({ from: offset, to: offset + query.length });
    offset = haystack.indexOf(needle, offset + query.length);
  }
  return matches;
}

const CodeEditorSurface = styled.div`
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--tide-bg);
`;

const CodeEditorCommandBar = styled.div`
  min-height: 32px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-top: 1px solid var(--tide-line);
  border-bottom: 1px solid var(--tide-line);
  background: var(--tide-surface);
`;

const CodeEditorCommandButton = styled.button`
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--tide-selection);
    color: var(--tide-text);
  }

  &:focus-visible {
    outline: 2px solid var(--tide-action);
    outline-offset: -2px;
  }

  &:disabled {
    cursor: default;
    opacity: 0.34;
  }
`;

const CodeEditorCommandSeparator = styled.span`
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--tide-line);
`;

const CodeMirrorHost = styled.div`
  min-height: 0;
  flex: 1 1 auto;

  > div {
    min-height: 0;
    height: 100%;
    flex: 1 1 auto;
  }

  .cm-editor {
    height: 100%;
    background: var(--tide-bg);
    color: var(--tide-text);
    font: 12px/1.55 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .cm-scroller {
    overflow: auto;
  }

  .cm-tide-occurrence {
    border-radius: 2px;
    background: rgba(var(--tide-ink-rgb), 0.09);
  }

  .cm-tide-occurrence--write {
    background: rgba(var(--tide-ink-rgb), 0.17);
  }

  .cm-tide-cmdlink {
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .cm-tide-git-line {
    background-image: linear-gradient(
      90deg,
      var(--tide-git-line-color) 0 3px,
      transparent 3px
    );
  }

  .cm-tide-git-line--added {
    --tide-git-line-color: var(--tide-diff-add);
    background-color: color-mix(in srgb, var(--tide-diff-add) 9%, transparent);
  }

  .cm-tide-git-line--changed {
    --tide-git-line-color: var(--tide-diff-add);
    background-color: color-mix(in srgb, var(--tide-diff-add) 11%, var(--tide-diff-del) 5%, transparent);
  }

  .cm-tide-git-line--deleted {
    --tide-git-line-color: var(--tide-diff-del);
    background-color: color-mix(in srgb, var(--tide-diff-del) 8%, transparent);
  }

  .cm-tooltip {
    overflow: hidden;
    border: 1px solid var(--tide-line-strong, var(--tide-line));
    border-radius: 6px;
    background: var(--tide-surface);
    color: var(--tide-text);
    box-shadow: var(--tide-shadow-popover);
  }

  .cm-tide-hover,
  .cm-tide-signature {
    max-width: 480px;
    overflow-wrap: break-word;
    padding: 7px 10px;
    font: 12px/1.55 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: pre-wrap;
  }

  .cm-tide-hover {
    max-height: 320px;
    overflow-y: auto;
  }

  .cm-tide-signature strong {
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .cm-tooltip-autocomplete > ul {
    max-height: 240px;
    font: 12px/1.7 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .cm-tooltip-autocomplete > ul > li {
    padding: 2px 8px;
    color: var(--tide-text);
  }

  .cm-tooltip-autocomplete > ul > li[aria-selected] {
    background: var(--tide-selection);
    color: var(--tide-text);
  }

  .cm-completionIcon {
    color: var(--tide-muted);
  }

  .cm-completionDetail {
    margin-left: 8px;
    color: var(--tide-muted);
    font-style: normal;
  }

  .cm-gutters {
    border-right: 1px solid var(--tide-line);
    background: var(--tide-surface);
    color: var(--tide-muted);
  }

  .cm-activeLine,
  .cm-activeLineGutter {
    background: var(--tide-editor-active-line);
  }

  .cm-editor.cm-focused {
    outline: none;
  }

  .cm-selectionBackground,
  .cm-focused .cm-selectionBackground,
  .cm-content ::selection {
    background: var(--tide-editor-selection) !important;
  }
`;

const CodeEditorSelectionToolbar = styled.button`
  position: fixed;
  z-index: 80;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--tide-line-strong, var(--tide-line));
  border-radius: 8px;
  background: var(--tide-text);
  color: var(--tide-bg);
  box-shadow: 0 6px 18px -6px rgba(36, 33, 38, 0.45);
  cursor: pointer;
  font: 600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  white-space: nowrap;

  svg {
    color: var(--tide-bg);
    opacity: 0.85;
  }

  &:hover {
    opacity: 0.92;
  }
`;

const CodeEditorMenuBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
`;

const CodeEditorMenu = styled.div`
  position: fixed;
  min-width: 184px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--tide-line-strong, var(--tide-line));
  border-radius: 8px;
  background: var(--tide-bg);
  box-shadow: 0 10px 30px -10px rgb(20 18 24 / 28%);
  animation: tide-pop-in 0.13s ease;
  transform-origin: top;
`;

const CodeEditorMenuItem = styled.button`
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-text);
  cursor: pointer;
  font: 13px/1 -apple-system, system-ui, sans-serif;
  text-align: left;
  transition: background-color 0.12s ease, color 0.12s ease;

  &:hover:not(:disabled) {
    background: var(--tide-selection);
  }

  &:disabled {
    cursor: default;
    opacity: 0.4;
  }
`;

const CodeEditorMenuSeparator = styled.div`
  height: 1px;
  margin: 4px 8px;
  background: var(--tide-line);
`;
