import MarkdownIt from "markdown-it";
import {
  headingAnchorPlugin,
  renderMarkdownCached,
  taskListPlugin,
} from "../../support/markdown-rendering.ts";
import { guessLanguage, highlightToHtml } from "../../support/code-highlight.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { styled } from "styled-components";
import { CornerDownRight, Crosshair } from "lucide-react";
import { WorkbenchCodeEditor } from "./code-editor.tsx";
import { MarkdownBodySurface } from "../../support/markdown-body.parts.tsx";
import {
  InPaneFindBar,
  useDomTextFind,
  useInPaneFindState,
  usePaneFindIntent,
} from "../../support/in-pane-find.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Markdown rendering for the Editor Pane Preview. `html: false` escapes raw HTML
// in file content so rendering local/agent-authored files cannot execute markup.
// Tables + strikethrough come from markdown-it's default preset; task lists are
// added by the shared plugin; fenced code is highlighted by the bundled
// CodeMirror/Lezer highlighter (no new highlighter dependency).
// Spec: docs_v2/specs/workbench-markdown-preview-editor.md (D5, D6).
const markdownRenderer = new MarkdownIt({ html: false, linkify: true, typographer: false });

markdownRenderer.use(taskListPlugin);
markdownRenderer.use(headingAnchorPlugin);

markdownRenderer.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index];
  const lang = (token.info.trim().split(/\s+/)[0] ?? "") || guessLanguage(token.content) || "";
  // Only emit a language identifier for safe identifiers (avoids attribute
  // injection from an arbitrary fence info string).
  const safeLang = /^[\w-]+$/.test(lang) ? lang : "";
  const langClass = safeLang ? ` class="language-${safeLang}"` : "";
  const langData = safeLang ? ` data-tide-lang="${safeLang}"` : "";
  // Emit PLAIN escaped code synchronously (cheap) and mark the fence pending.
  // Highlighting a fence is a full Lezer parse; doing every fence inline made
  // opening a code-heavy markdown file stutter. WorkbenchMarkdownView upgrades a
  // fence to highlighted spans after paint and only once it scrolls into view
  // (the IntersectionObserver effect below). The code's textContent round-trips
  // the original source, so the highlighter re-reads it straight from the DOM.
  return `<pre class="md-fence" data-tide-fence${langData}><code${langClass}>${markdownRenderer.utils.escapeHtml(token.content)}</code></pre>`;
};

// Markdown Editor Pane: a pretty rendered Preview (Obsidian-style reading view)
// by default, toggleable to a raw-source Edit mode that saves on Cmd/Ctrl+S.
export function WorkbenchMarkdownView(props: {
  paneId: string;
  value: string;
  readOnly: boolean;
  dirty: boolean;
  revision: string;
  relativePath?: string;
  gitDiffText?: string;
  // The file-path breadcrumb, rendered INLINE in the markdown header row so the
  // Preview/Edit/Pick controls sit in the path bar (one row) instead of a separate
  // floating toolbar — mirroring the Browser Pane's address-bar row.
  breadcrumb?: ReactElement;
  handlers: ProductShellHandlers;
}): ReactElement {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const find = useInPaneFindState();
  // Floating "Add to chat" for a drag-selection inside the rendered preview.
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number; text: string } | null>(null);
  // "Pick block" mode: hover-highlight rendered blocks; click toggles each into a
  // multi-selection, and a confirm attaches them all.
  const [pickBlock, setPickBlock] = useState(false);
  const pickedRef = useRef<Set<HTMLElement>>(new Set());
  const [pickedCount, setPickedCount] = useState(0);
  const path = props.relativePath ?? "preview.md";
  const baseName = path.slice(path.lastIndexOf("/") + 1);
  const attach = (text: string, label: string) =>
    props.handlers.onAddContentToChat({
      kind: "code",
      label,
      text: `From \`${path}\` (preview):\n\n${text.trim().split("\n").map((l) => `> ${l}`).join("\n")}`,
    });
  // Drag-selection toolbar (host DOM — no injection needed). Off while picking
  // blocks (that drag selects blocks, not text).
  useEffect(() => {
    if (mode !== "preview" || pickBlock) {
      setSelToolbar(null);
      return undefined;
    }
    const onUp = () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      const root = previewRef.current;
      if (text.trim().length > 0 && sel !== null && root !== null && root.contains(sel.anchorNode)) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setSelToolbar({ x: rect.left, y: rect.top, text });
      } else {
        setSelToolbar(null);
      }
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [mode, pickBlock]);
  const clearPickedBlocks = () => {
    pickedRef.current.forEach((el) => el.removeAttribute("data-md-pick-selected"));
    pickedRef.current.clear();
    setPickedCount(0);
  };
  // Block-pick mode: hover-highlight blocks; click toggles one, and dragging
  // across blocks selects (or deselects) them all at once. A confirm attaches
  // every picked block.
  useEffect(() => {
    const root = previewRef.current;
    if (!pickBlock || root === null) {
      return undefined;
    }
    let last: HTMLElement | null = null;
    let dragging = false;
    // A press is "pending" until the pointer moves past a small threshold — only
    // THEN does it become a multi-block sweep. Without this, a click that drifts
    // a few px swept across adjacent short blocks (list items), picking 10+ at
    // once. A clean click toggles exactly the one block under the pointer.
    let pending = false;
    let pressX = 0;
    let pressY = 0;
    const DRAG_THRESHOLD_SQ = 36; // 6px
    // While dragging, whether we are adding blocks or removing them (decided by
    // the first block under the pointer).
    let dragAdds = true;
    const blockOf = (target: EventTarget | null): HTMLElement | null => {
      let node = target as HTMLElement | null;
      while (node !== null && node.parentElement !== root && node !== root) {
        node = node.parentElement;
      }
      return node !== null && node !== root ? node : null;
    };
    const apply = (block: HTMLElement, add: boolean) => {
      if (add) {
        pickedRef.current.add(block);
        block.setAttribute("data-md-pick-selected", "true");
      } else {
        pickedRef.current.delete(block);
        block.removeAttribute("data-md-pick-selected");
      }
      setPickedCount(pickedRef.current.size);
    };
    const onDown = (event: MouseEvent) => {
      const block = blockOf(event.target);
      if (block === null) return;
      event.preventDefault();
      pending = true;
      dragging = false;
      pressX = event.clientX;
      pressY = event.clientY;
      // The pressed block toggles immediately; a sweep (below) only starts once
      // the pointer crosses the threshold.
      dragAdds = !pickedRef.current.has(block);
      apply(block, dragAdds);
    };
    const onOver = (event: MouseEvent) => {
      const block = blockOf(event.target);
      if (last !== null) last.removeAttribute("data-md-pick-hover");
      last = block;
      if (block !== null && !pickedRef.current.has(block)) {
        block.setAttribute("data-md-pick-hover", "true");
      }
      if (pending && !dragging) {
        const dx = event.clientX - pressX;
        const dy = event.clientY - pressY;
        if (dx * dx + dy * dy > DRAG_THRESHOLD_SQ) {
          dragging = true;
        }
      }
      if (dragging && block !== null) {
        apply(block, dragAdds);
      }
    };
    const onUp = () => {
      pending = false;
      dragging = false;
    };
    // Suppress the native click/selection so picking never also selects text.
    const swallow = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    root.addEventListener("mousedown", onDown);
    root.addEventListener("mouseover", onOver);
    document.addEventListener("mouseup", onUp);
    root.addEventListener("click", swallow, true);
    return () => {
      if (last !== null) last.removeAttribute("data-md-pick-hover");
      root.removeEventListener("mousedown", onDown);
      root.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseup", onUp);
      root.removeEventListener("click", swallow, true);
    };
  }, [pickBlock]);
  // Render once per source string (cached), so unrelated re-renders don't
  // re-parse the whole file. Spec D8.
  const previewHtml = useMemo(() => renderMarkdownCached(markdownRenderer, props.value), [props.value]);
  const previewFindEnabled = mode === "preview" || props.readOnly;
  const previewMatchCount = useDomTextFind({
    rootRef: previewRef,
    open: find.open && previewFindEnabled,
    query: find.query,
    activeIndex: find.activeIndex,
    refreshKey: previewHtml,
    onActiveIndexChange: find.setActiveIndex,
  });
  usePaneFindIntent(rootRef, {
    enabled: previewFindEnabled,
    open: find.open,
    onOpen: find.openFind,
    onClose: find.closeFind,
    onNext: () => find.next(previewMatchCount),
    onPrevious: () => find.previous(previewMatchCount),
  });
  // Memoize the preview ELEMENT (not just its html): when the drag-select
  // "Add to chat" toolbar toggles (a setSelToolbar state change), a re-created
  // preview element gets reconciled and its text nodes detach — collapsing the
  // live selection on mouse-release (same bug fixed in the chat transcript). A
  // stable element reference makes React skip the subtree, so the selection
  // survives. Deps: only previewHtml (ref/className are stable).
  const previewBody = useMemo(
    () => (
      <MarkdownPreviewBody
        ref={previewRef}
        data-md-preview="true"
        aria-label="Markdown preview"
        dangerouslySetInnerHTML={{ __html: previewHtml }}
      />
    ),
    [previewHtml],
  );
  // Lazy fence highlighting: fences render as plain escaped code first (so a
  // code-heavy file opens without paying every fence's Lezer parse up front),
  // then each is upgraded to highlighted spans once it scrolls into view. Pairs
  // with content-visibility on the preview blocks, so fences the reader never
  // reaches stay plain and cost nothing. Re-runs when the rendered source
  // changes (a fresh render re-emits plain, pending fences). Mutating innerHTML
  // here is safe: React owns the preview div via dangerouslySetInnerHTML and
  // only re-commits it when previewHtml changes — which also re-runs this effect.
  useEffect(() => {
    const root = previewRef.current;
    if (mode !== "preview" || root === null) {
      return undefined;
    }
    const pending = Array.from(
      root.querySelectorAll<HTMLElement>("pre.md-fence[data-tide-fence]"),
    );
    if (pending.length === 0) {
      return undefined;
    }
    const upgrade = (pre: HTMLElement): void => {
      if (!pre.hasAttribute("data-tide-fence")) {
        return;
      }
      const code = pre.querySelector("code");
      pre.removeAttribute("data-tide-fence");
      if (code !== null) {
        code.innerHTML = highlightToHtml(code.textContent ?? "", pre.getAttribute("data-tide-lang") ?? undefined);
      }
    };
    if (typeof IntersectionObserver !== "function") {
      // No IntersectionObserver (e.g. a non-browser test DOM): highlight inline.
      pending.forEach(upgrade);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            upgrade(entry.target as HTMLElement);
            observer.unobserve(entry.target);
          }
        }
      },
      { root, rootMargin: "300px 0px" },
    );
    pending.forEach((pre) => observer.observe(pre));
    return () => observer.disconnect();
  }, [previewHtml, mode]);
  const toggle = (target: "preview" | "edit", label: string) => (
    <MarkdownModeButton
      type="button"
      data-md-mode-option="true"
      data-active={mode === target ? "true" : "false"}
      aria-pressed={mode === target}
      onClick={() => setMode(target)}
    >
      {label}
    </MarkdownModeButton>
  );
  return (
    <MarkdownViewFrame
      ref={rootRef}
      data-md-mode={mode}
      data-md-picking={pickBlock ? "true" : "false"}
    >
      <MarkdownHeader data-md-header="true">
        {props.breadcrumb ?? null}
        <MarkdownControls>
          <MarkdownModeToggle data-md-toggle="true" role="group" aria-label="Markdown view mode">
            {toggle("preview", "Preview")}
            {props.readOnly ? null : toggle("edit", "Edit")}
          </MarkdownModeToggle>
          {mode === "preview" && pickBlock && pickedCount > 0 ? (
            <MarkdownPickButton
              type="button"
              data-md-pick-action="add"
              title="Add the selected blocks to chat"
              onClick={() => {
                const blocks = Array.from(
                  previewRef.current?.querySelectorAll("[data-md-pick-selected]") ?? [],
                ) as HTMLElement[];
                const text = blocks
                  .map((el) => (el.innerText || el.textContent || "").trim())
                  .filter((t) => t.length > 0)
                  .join("\n\n");
                if (text.length > 0) {
                  attach(text, `${baseName} · ${pickedCount} block${pickedCount === 1 ? "" : "s"}`);
                }
                clearPickedBlocks();
                setPickBlock(false);
              }}
            >
              <CornerDownRight size={12} strokeWidth={1.8} aria-hidden />
              {`Add ${pickedCount} to chat`}
            </MarkdownPickButton>
          ) : null}
          {mode === "preview" ? (
            <MarkdownPickButton
              type="button"
              data-active={pickBlock ? "true" : "false"}
              aria-pressed={pickBlock}
              title={pickBlock ? "Cancel block pick" : "Pick blocks to add to chat"}
              onClick={() =>
                setPickBlock((prev) => {
                  if (prev) {
                    clearPickedBlocks();
                  }
                  return !prev;
                })
              }
            >
              <Crosshair size={12} strokeWidth={1.8} aria-hidden />
              {pickBlock ? "Cancel" : "Pick block"}
            </MarkdownPickButton>
          ) : null}
        </MarkdownControls>
      </MarkdownHeader>
      {find.open && previewFindEnabled ? (
        <InPaneFindBar
          query={find.query}
          matchCount={previewMatchCount}
          activeIndex={find.activeIndex}
          scopeLabel="Preview"
          placeholder="Find in preview"
          onQueryChange={find.setQuery}
          onNext={() => find.next(previewMatchCount)}
          onPrevious={() => find.previous(previewMatchCount)}
          onClose={find.closeFind}
        />
      ) : null}
      {mode === "preview" || props.readOnly ? (
        <>
          {previewBody}
          {selToolbar === null ? null : (
            <MarkdownSelectionToolbar
              type="button"
              style={{
                left: `${selToolbar.x}px`,
                top: `${Math.max(selToolbar.y - 36, 8)}px`,
              } as CSSProperties}
              onMouseDown={(event: { preventDefault: () => void }) => {
                event.preventDefault();
                const oneLine = selToolbar.text.trim().replace(/\s+/g, " ");
                attach(selToolbar.text, `${baseName} · ${oneLine.slice(0, 28)}${oneLine.length > 28 ? "…" : ""}`);
                setSelToolbar(null);
              }}
            >
              <CornerDownRight size={13} strokeWidth={1.9} aria-hidden />
              Add to chat
            </MarkdownSelectionToolbar>
          )}
        </>
      ) : (
        <WorkbenchCodeEditor
          paneId={props.paneId}
          value={props.value}
          readOnly={props.readOnly}
          dirty={props.dirty}
          language="markdown"
          revision={props.revision}
          gitDiffText={props.gitDiffText}
          navigationTarget={undefined}
          handlers={props.handlers}
        />
      )}
    </MarkdownViewFrame>
  );
}

const MarkdownViewFrame = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;

  &[data-md-picking="true"] [data-md-preview] {
    cursor: crosshair;
    user-select: none;
  }

  &[data-md-picking="true"] [data-md-preview] * {
    cursor: crosshair !important;
  }

  [data-md-pick-hover] {
    border-radius: 3px;
    outline: 2px dashed #3b82f6;
    outline-offset: 2px;
  }

  [data-md-pick-selected] {
    border-radius: 3px;
    background: rgba(37, 99, 235, 0.16) !important;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.16);
    outline: 2px solid #2563eb !important;
    outline-offset: 2px;
  }
`;

const MarkdownPreviewBody = styled(MarkdownBodySurface)`
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  padding: 26px clamp(20px, 5vw, 56px) 56px;
  color: var(--tide-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 14.5px;
  line-height: 1.62;
  text-rendering: optimizeLegibility;

  ::selection,
  *::selection {
    background: rgba(57, 112, 240, 0.30);
  }

  [data-theme="dark"] &::selection,
  [data-theme="dark"] & *::selection {
    background: rgba(96, 150, 255, 0.36);
  }

  h1 {
    margin-bottom: 18px;
    padding-bottom: 10px;
    font-size: 32px;
    line-height: 40px;
    letter-spacing: 0;
  }

  h2 {
    margin-top: 30px;
    margin-bottom: 14px;
    font-size: 22px;
    line-height: 30px;
    letter-spacing: 0;
  }

  h3 {
    margin-top: 22px;
    margin-bottom: 10px;
    font-size: 18px;
    line-height: 26px;
    letter-spacing: 0;
  }

  p,
  ul,
  ol {
    margin-bottom: 14px;
  }

  a {
    color: var(--tide-text);
    text-decoration-color: color-mix(in srgb, var(--tide-text) 55%, transparent);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }

  a:hover {
    color: var(--tide-action);
    text-decoration-color: currentColor;
  }

  img {
    border-radius: 4px;
    vertical-align: text-bottom;
  }

  hr {
    margin-top: 28px;
    margin-bottom: 30px;
  }

  > * {
    max-width: min(100%, 780px);
    margin-right: auto;
    margin-left: auto;
    content-visibility: auto;
    contain-intrinsic-size: auto 40px;
  }
`;

const MarkdownHeader = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--tide-line);

  [data-editor-breadcrumb] {
    min-height: 28px;
    flex: 1 1 160px;
    padding: 0;
  }
`;

const MarkdownControls = styled.div`
  flex: 0 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
`;

const MarkdownModeToggle = styled.div`
  flex: 0 0 auto;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: var(--tide-surface);
`;

const MarkdownModeButton = styled.button`
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  font: 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;

  &[data-active="true"] {
    background: var(--tide-bg);
    color: var(--tide-text);
    box-shadow: 0 1px 2px rgb(52 48 56 / 8%);
  }
`;

const MarkdownPickButton = styled.button`
  height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--tide-line);
  border-radius: 6px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  font: 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }

  &[data-active="true"],
  &[data-md-pick-action="add"] {
    border-color: var(--tide-action, var(--tide-text));
    background: var(--tide-action, var(--tide-text));
    color: var(--tide-on-action);
  }

  &[data-active="true"] svg,
  &[data-md-pick-action="add"] svg {
    color: var(--tide-on-action);
  }
`;

const MarkdownSelectionToolbar = styled.button`
  position: fixed;
  z-index: 80;
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: var(--tide-action);
  color: var(--tide-on-action, var(--tide-bg));
  box-shadow: 0 8px 20px rgb(52 48 56 / 18%);
  cursor: pointer;
  font: 600 12px/1 Inter, ui-sans-serif, system-ui, sans-serif;
  opacity: 0.98;

  svg {
    color: var(--tide-bg);
    opacity: 0.85;
  }

  &:hover {
    opacity: 0.92;
  }
`;
