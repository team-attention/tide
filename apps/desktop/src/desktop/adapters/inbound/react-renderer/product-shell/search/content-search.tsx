import type { ProductShellContentSearch } from "../../../../../application/domains/product-shell/product-shell.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { keyframes, styled } from "styled-components";
import { Search } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Cmd+Shift+F project content search: a centered panel that debounces the query
// to a backend grep and renders matches grouped by file. Clicking a match opens
// the file in the Workbench editor. Mirrors VS Code's search.
export function ContentSearchPanel(props: {
  results: ProductShellContentSearch | null;
  onSearch: (query: string) => void;
  onOpen: (
    relativePath: string,
    target: { line: number; character: number; length?: number; label?: string },
  ) => void;
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

  return (
    <ContentSearchBackdrop
      role="dialog"
      aria-label="Search in files"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <ContentSearchSurface>
        <ContentSearchField>
          <ContentSearchIcon size={15} strokeWidth={1.9} aria-hidden />
          <ContentSearchScope>Files</ContentSearchScope>
          <ContentSearchInput
            ref={inputRef}
            placeholder="Search in files…"
            value={query}
            spellCheck={false}
            aria-label="Search text"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Escape") {
                event.preventDefault();
                props.onClose();
              }
            }}
          />
          {showResults && total > 0 ? (
            <ContentSearchCount>
              {`${total}${props.results?.truncated ? "+" : ""} in ${groups.length}`}
            </ContentSearchCount>
          ) : null}
        </ContentSearchField>
        <ContentSearchResults>
          {query.trim().length < 2 ? (
            <ContentSearchEmpty>Type at least 2 characters</ContentSearchEmpty>
          ) : !showResults ? (
            <ContentSearchEmpty>Searching…</ContentSearchEmpty>
          ) : groups.length === 0 ? (
            <ContentSearchEmpty>No matches</ContentSearchEmpty>
          ) : (
            groups.map(([relativePath, matches]) => {
              const slash = relativePath.lastIndexOf("/");
              const name = slash === -1 ? relativePath : relativePath.slice(slash + 1);
              const dir = slash === -1 ? "" : relativePath.slice(0, slash);
              const Icon = fileIconFor(name);
              return (
                <ContentSearchGroup key={relativePath}>
                  <ContentSearchFile>
                    <ContentSearchFileIcon aria-hidden>
                      <Icon size={14} strokeWidth={1.7} />
                    </ContentSearchFileIcon>
                    <ContentSearchFileName>{name}</ContentSearchFileName>
                    {dir ? <ContentSearchFileDir>{dir}</ContentSearchFileDir> : null}
                    <ContentSearchFileCount>{`${matches.length}`}</ContentSearchFileCount>
                  </ContentSearchFile>
                  {matches.slice(0, 40).map((match, index) => {
                    const lineText = match.lineText ?? "";
                    return (
                      <ContentSearchMatch
                        key={index}
                        type="button"
                        onClick={() => {
                          props.onOpen(relativePath, {
                            line: match.line,
                            character: match.column,
                            length: query.trim().length,
                            label: lineText.trim(),
                          });
                          props.onClose();
                        }}
                      >
                        <ContentSearchLineNumber>{`${match.line + 1}:${match.column + 1}`}</ContentSearchLineNumber>
                        <ContentSearchLine>
                          {renderSearchPreview(lineText, match.column, query.trim().length)}
                        </ContentSearchLine>
                      </ContentSearchMatch>
                    );
                  })}
                </ContentSearchGroup>
              );
            })
          )}
        </ContentSearchResults>
      </ContentSearchSurface>
    </ContentSearchBackdrop>
  );
}

function renderSearchPreview(
  lineText: string | null | undefined,
  column: number,
  length: number,
): ReactElement | string {
  if (!lineText) {
    return "";
  }
  if (length <= 0 || column < 0 || column >= lineText.length) {
    return lineText;
  }
  const end = Math.min(lineText.length, column + length);
  return (
    <>
      {lineText.slice(0, column)}
      <ContentSearchHit>{lineText.slice(column, end)}</ContentSearchHit>
      {lineText.slice(end)}
    </>
  );
}

const contentSearchOverlayIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`;

const contentSearchSheetIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(-8px);
  }

  to {
    opacity: 1;
    transform: none;
  }
`;

const ContentSearchBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  background: rgba(36, 33, 38, 0.28);
  animation: ${contentSearchOverlayIn} 0.12s ease;
`;

const ContentSearchSurface = styled.div`
  width: min(680px, calc(100vw - 48px));
  max-height: 70vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--tide-line-strong, var(--tide-line));
  border-radius: 12px;
  background: var(--tide-bg);
  box-shadow: 0 24px 60px -12px rgba(36, 33, 38, 0.35);
  animation: ${contentSearchSheetIn} 0.16s ease;
`;

const ContentSearchField = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--tide-line);
  padding: 10px 12px;
  background: var(--tide-bg);
`;

const ContentSearchIcon = styled(Search)`
  flex: 0 0 auto;
  color: var(--tide-muted);
`;

const ContentSearchScope = styled.span`
  height: 22px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--tide-line);
  border-radius: 6px;
  padding: 0 7px;
  background: var(--tide-surface);
  color: var(--tide-muted);
  font: 520 11px/1 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
`;

const ContentSearchInput = styled.input`
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--tide-text);
  font-size: 15px;

  &::placeholder {
    color: var(--tide-muted);
  }
`;

const ContentSearchCount = styled.span`
  flex: 0 0 auto;
  color: var(--tide-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
`;

const ContentSearchResults = styled.div`
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 4px 6px 8px;
`;

const ContentSearchEmpty = styled.div`
  padding: 18px;
  color: var(--tide-muted);
  font-size: 13px;
  text-align: center;
`;

const ContentSearchGroup = styled.div`
  margin-bottom: 6px;
`;

const ContentSearchFile = styled.div`
  position: sticky;
  top: 0;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px 3px;
  background: var(--tide-bg);
`;

const ContentSearchFileIcon = styled.span`
  flex: 0 0 auto;
  display: inline-flex;
  color: var(--tide-muted);
`;

const ContentSearchFileName = styled.span`
  flex: 0 0 auto;
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 600;
`;

const ContentSearchFileDir = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ContentSearchFileCount = styled.span`
  flex: 0 0 auto;
  color: var(--tide-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
`;

const ContentSearchMatch = styled.button`
  width: 100%;
  min-height: 30px;
  display: flex;
  align-items: baseline;
  gap: 9px;
  border: 0;
  border-radius: 6px;
  padding: 3px 10px 3px 28px;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
  }
`;

const ContentSearchLineNumber = styled.span`
  width: 48px;
  flex: 0 0 auto;
  color: var(--tide-muted);
  font: 11.5px/1.4 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

const ContentSearchLine = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--tide-text);
  font-family: "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ContentSearchHit = styled.mark`
  border-radius: 3px;
  padding: 0 1px;
  background: color-mix(in srgb, var(--tide-action) 12%, transparent);
  color: var(--tide-text);
`;
