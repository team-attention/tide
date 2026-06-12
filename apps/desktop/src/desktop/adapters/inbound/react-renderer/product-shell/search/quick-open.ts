import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { Search } from "lucide-react";
import { fileIconFor } from "../../file-icons.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Fuzzy subsequence score for Quick Open (Cmd+P). Returns null when `query` is
// not a subsequence of `target`; higher is a better match. Contiguous runs, a
// match inside the basename, and shorter paths all rank higher (VS Code-like).
function quickOpenScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  if (q.length === 0) {
    return -target.length * 0.01;
  }
  const t = target.toLowerCase();
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) {
      return null;
    }
    if (found === ti && ti > 0) {
      streak += 1;
      score += 3 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    ti = found + 1;
  }
  const base = target.slice(target.lastIndexOf("/") + 1).toLowerCase();
  if (base.includes(q)) {
    score += 12;
    if (base.startsWith(q)) {
      score += 6;
    }
  }
  return score - target.length * 0.01;
}

export interface QuickOpenFile {
  relativePath: string;
  name: string;
}

// Cmd+P file finder: a centered command palette that fuzzy-filters the loaded
// file list and opens the picked file in the Workbench editor. Manages its own
// query, selection, and keyboard (↑/↓/Enter/Esc). Mirrors VS Code's Quick Open.
export function QuickOpenPalette(props: {
  files: QuickOpenFile[];
  onOpen: (relativePath: string) => void;
  onClose: () => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const scored: { file: QuickOpenFile; score: number }[] = [];
    for (const file of props.files) {
      const score = quickOpenScore(query, file.relativePath);
      if (score !== null) {
        scored.push({ file, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 50).map((entry) => entry.file);
  }, [props.files, query]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    const node = listRef.current?.querySelector('[data-selected="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [selected, results]);

  const choose = (index: number) => {
    const file = results[index];
    if (file) {
      props.onOpen(file.relativePath);
      props.onClose();
    }
  };

  return createElement(
    "div",
    {
      className: "quick-open-backdrop",
      role: "dialog",
      "aria-label": "Quick Open",
      onMouseDown: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      },
    },
    createElement(
      "div",
      { className: "quick-open" },
      createElement(
        "div",
        { className: "quick-open__field" },
        createElement(Search, { size: 15, strokeWidth: 1.9, className: "quick-open__icon", "aria-hidden": true }),
        createElement("input", {
          ref: inputRef,
          className: "quick-open__input",
          placeholder: "Search files by name…",
          value: query,
          spellCheck: false,
          "aria-label": "Search files",
          onChange: (event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value),
          onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((value) => Math.min(value + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(selected);
            } else if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            }
          },
        }),
        createElement("span", { className: "quick-open__count" }, results.length > 0 ? `${results.length}` : ""),
      ),
      createElement(
        "div",
        { className: "quick-open__results", ref: listRef },
        results.length === 0
          ? createElement("div", { className: "quick-open__empty" }, query.length === 0 ? "Type to search files" : "No matching files")
          : results.map((file, index) => {
              const slash = file.relativePath.lastIndexOf("/");
              const dir = slash === -1 ? "" : file.relativePath.slice(0, slash);
              return createElement(
                "button",
                {
                  key: file.relativePath,
                  type: "button",
                  className: "quick-open__row",
                  "data-selected": index === selected ? "true" : "false",
                  onMouseEnter: () => setSelected(index),
                  onClick: () => choose(index),
                },
                createElement(
                  "span",
                  { className: "quick-open__row-icon", "aria-hidden": true },
                  createElement(fileIconFor(file.name), { size: 14, strokeWidth: 1.7 }),
                ),
                createElement("span", { className: "quick-open__row-name" }, file.name),
                dir ? createElement("span", { className: "quick-open__row-dir" }, dir) : null,
              );
            }),
      ),
    ),
  );
}
