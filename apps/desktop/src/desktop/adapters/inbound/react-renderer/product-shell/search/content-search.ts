import type { ProductShellContentSearch } from "../../../../../application/domains/product-shell/product-shell-state.ts";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { Search } from "lucide-react";
import { fileIconFor } from "../../file-icons.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Cmd+Shift+F project content search: a centered panel that debounces the query
// to a backend grep and renders matches grouped by file. Clicking a match opens
// the file in the Workbench editor. Mirrors VS Code's search.
export function ContentSearchPanel(props: {
  results: ProductShellContentSearch | null;
  onSearch: (query: string) => void;
  onOpen: (relativePath: string) => void;
  onClose: () => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return undefined;
    }
    const timer = window.setTimeout(() => props.onSearch(trimmed), 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const groups = useMemo(() => {
    const byFile = new Map<string, ProductShellContentSearch["matches"]>();
    for (const match of props.results?.matches ?? []) {
      const list = byFile.get(match.relativePath) ?? [];
      list.push(match);
      byFile.set(match.relativePath, list);
    }
    return [...byFile.entries()];
  }, [props.results]);

  const total = props.results?.matches.length ?? 0;
  const showResults = (props.results?.query ?? "") === query.trim() && query.trim().length >= 2;

  return createElement(
    "div",
    {
      className: "content-search-backdrop",
      role: "dialog",
      "aria-label": "Search in files",
      onMouseDown: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      },
    },
    createElement(
      "div",
      { className: "content-search" },
      createElement(
        "div",
        { className: "content-search__field" },
        createElement(Search, { size: 15, strokeWidth: 1.9, className: "content-search__icon", "aria-hidden": true }),
        createElement("input", {
          ref: inputRef,
          className: "content-search__input",
          placeholder: "Search in files…",
          value: query,
          spellCheck: false,
          "aria-label": "Search text",
          onChange: (event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value),
          onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            }
          },
        }),
        showResults && total > 0
          ? createElement(
              "span",
              { className: "content-search__count" },
              `${total}${props.results?.truncated ? "+" : ""} in ${groups.length}`,
            )
          : null,
      ),
      createElement(
        "div",
        { className: "content-search__results" },
        query.trim().length < 2
          ? createElement("div", { className: "content-search__empty" }, "Type at least 2 characters")
          : !showResults
          ? createElement("div", { className: "content-search__empty" }, "Searching…")
          : groups.length === 0
          ? createElement("div", { className: "content-search__empty" }, "No matches")
          : groups.map(([relativePath, matches]) => {
              const slash = relativePath.lastIndexOf("/");
              const name = slash === -1 ? relativePath : relativePath.slice(slash + 1);
              const dir = slash === -1 ? "" : relativePath.slice(0, slash);
              return createElement(
                "div",
                { key: relativePath, className: "content-search__group" },
                createElement(
                  "div",
                  { className: "content-search__file" },
                  createElement(
                    "span",
                    { className: "content-search__file-icon", "aria-hidden": true },
                    createElement(fileIconFor(name), { size: 14, strokeWidth: 1.7 }),
                  ),
                  createElement("span", { className: "content-search__file-name" }, name),
                  dir ? createElement("span", { className: "content-search__file-dir" }, dir) : null,
                  createElement("span", { className: "content-search__file-count" }, `${matches.length}`),
                ),
                matches.slice(0, 40).map((match, index) =>
                  createElement(
                    "button",
                    {
                      key: index,
                      type: "button",
                      className: "content-search__match",
                      onClick: () => {
                        props.onOpen(relativePath);
                        props.onClose();
                      },
                    },
                    createElement("span", { className: "content-search__line-no" }, `${match.line + 1}`),
                    createElement("span", { className: "content-search__line" }, match.lineText.trim()),
                  ),
                ),
              );
            }),
      ),
    ),
  );
}
