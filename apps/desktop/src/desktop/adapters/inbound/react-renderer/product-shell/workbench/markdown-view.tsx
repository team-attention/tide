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
import { CornerDownRight, Crosshair } from "lucide-react";
import { WorkbenchCodeEditor } from "./code-editor.tsx";
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
  // The file-path breadcrumb, rendered INLINE in the markdown header row so the
  // Preview/Edit/Pick controls sit in the path bar (one row) instead of a separate
  // floating toolbar — mirroring the Browser Pane's address-bar row.
  breadcrumb?: ReactElement;
  handlers: ProductShellHandlers;
}): ReactElement {
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const previewRef = useRef<HTMLDivElement | null>(null);
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
    pickedRef.current.forEach((el) => el.classList.remove("workbench-md-pick-selected"));
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
        block.classList.add("workbench-md-pick-selected");
      } else {
        pickedRef.current.delete(block);
        block.classList.remove("workbench-md-pick-selected");
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
      if (last !== null) last.classList.remove("workbench-md-pick-hover");
      last = block;
      if (block !== null && !pickedRef.current.has(block)) {
        block.classList.add("workbench-md-pick-hover");
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
      if (last !== null) last.classList.remove("workbench-md-pick-hover");
      root.removeEventListener("mousedown", onDown);
      root.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseup", onUp);
      root.removeEventListener("click", swallow, true);
    };
  }, [pickBlock]);
  // Render once per source string (cached), so unrelated re-renders don't
  // re-parse the whole file. Spec D8.
  const previewHtml = useMemo(() => renderMarkdownCached(markdownRenderer, props.value), [props.value]);
  // Memoize the preview ELEMENT (not just its html): when the drag-select
  // "Add to chat" toolbar toggles (a setSelToolbar state change), a re-created
  // preview element gets reconciled and its text nodes detach — collapsing the
  // live selection on mouse-release (same bug fixed in the chat transcript). A
  // stable element reference makes React skip the subtree, so the selection
  // survives. Deps: only previewHtml (ref/className are stable).
  const previewBody = useMemo(
    () => (
      <div
        ref={previewRef}
        className="workbench-md-preview markdown-body"
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
    <button
      type="button"
      className="workbench-md-toggle__option"
      data-active={mode === target ? "true" : "false"}
      aria-pressed={mode === target}
      onClick={() => setMode(target)}
    >
      {label}
    </button>
  );
  return (
    <div className="workbench-md" data-md-mode={mode} data-md-picking={pickBlock ? "true" : "false"}>
      <div className="workbench-md-header">
        {props.breadcrumb ?? null}
        <div className="workbench-md-controls">
          <div className="workbench-md-toggle" role="group" aria-label="Markdown view mode">
            {toggle("preview", "Preview")}
            {props.readOnly ? null : toggle("edit", "Edit")}
          </div>
          {mode === "preview" && pickBlock && pickedCount > 0 ? (
            <button
              type="button"
              className="workbench-md-toggle__pick workbench-md-toggle__pick--add"
              title="Add the selected blocks to chat"
              onClick={() => {
                const blocks = Array.from(
                  previewRef.current?.querySelectorAll(".workbench-md-pick-selected") ?? [],
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
            </button>
          ) : null}
          {mode === "preview" ? (
            <button
              type="button"
              className="workbench-md-toggle__pick"
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
            </button>
          ) : null}
        </div>
      </div>
      {mode === "preview" || props.readOnly ? (
        <>
          {previewBody}
          {selToolbar === null ? null : (
            <button
              type="button"
              className="editor-selection-toolbar"
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
            </button>
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
          navigationTarget={undefined}
          handlers={props.handlers}
        />
      )}
    </div>
  );
}
