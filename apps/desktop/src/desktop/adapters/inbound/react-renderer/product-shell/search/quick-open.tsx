import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { keyframes, styled } from "styled-components";
import { Search } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
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

  return (
    <QuickOpenBackdrop
      role="dialog"
      aria-label="Quick Open"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <QuickOpenSurface>
        <QuickOpenField>
          <QuickOpenIcon size={15} strokeWidth={1.9} aria-hidden />
          <QuickOpenInput
            ref={inputRef}
            data-quick-open-input
            placeholder="Search files by name…"
            value={query}
            spellCheck={false}
            aria-label="Search files"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
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
            }}
          />
          <QuickOpenCount>{results.length > 0 ? `${results.length}` : ""}</QuickOpenCount>
        </QuickOpenField>
        <QuickOpenResults ref={listRef}>
          {results.length === 0 ? (
            <QuickOpenEmpty>
              {query.length === 0 ? "Type to search files" : "No matching files"}
            </QuickOpenEmpty>
          ) : (
            results.map((file, index) => {
              const slash = file.relativePath.lastIndexOf("/");
              const dir = slash === -1 ? "" : file.relativePath.slice(0, slash);
              const Icon = fileIconFor(file.name);
              return (
                <QuickOpenRow
                  key={file.relativePath}
                  type="button"
                  data-quick-open-row
                  data-selected={index === selected ? "true" : "false"}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => choose(index)}
                >
                  <QuickOpenRowIcon aria-hidden>
                    <Icon size={14} strokeWidth={1.7} />
                  </QuickOpenRowIcon>
                  <QuickOpenRowName>{file.name}</QuickOpenRowName>
                  {dir ? <QuickOpenRowDir>{dir}</QuickOpenRowDir> : null}
                </QuickOpenRow>
              );
            })
          )}
        </QuickOpenResults>
      </QuickOpenSurface>
    </QuickOpenBackdrop>
  );
}

const quickOpenOverlayIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`;

const quickOpenSheetIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(-8px);
  }

  to {
    opacity: 1;
    transform: none;
  }
`;

const QuickOpenBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: rgba(36, 33, 38, 0.28);
  animation: ${quickOpenOverlayIn} 0.12s ease;
`;

const QuickOpenSurface = styled.div`
  width: min(620px, calc(100vw - 48px));
  max-height: 60vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--tide-line-strong, var(--tide-line));
  border-radius: 12px;
  background: var(--tide-bg);
  box-shadow: 0 24px 60px -12px rgba(36, 33, 38, 0.35);
  animation: ${quickOpenSheetIn} 0.16s ease;
`;

const QuickOpenField = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  border-bottom: 1px solid var(--tide-line);
  padding: 11px 14px;
`;

const QuickOpenIcon = styled(Search)`
  flex: 0 0 auto;
  color: var(--tide-muted);
`;

const QuickOpenInput = styled.input`
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

const QuickOpenCount = styled.span`
  flex: 0 0 auto;
  color: var(--tide-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
`;

const QuickOpenResults = styled.div`
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 6px;
`;

const QuickOpenRow = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  border-radius: 8px;
  padding: 7px 10px;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;

  &[data-selected="true"] {
    background: var(--tide-selection);
  }
`;

const QuickOpenRowIcon = styled.span`
  flex: 0 0 auto;
  display: inline-flex;
  color: var(--tide-muted);
`;

const QuickOpenRowName = styled.span`
  flex: 0 0 auto;
  color: var(--tide-text);
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
`;

const QuickOpenRowDir = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--tide-muted);
  direction: rtl;
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const QuickOpenEmpty = styled.div`
  padding: 18px;
  color: var(--tide-muted);
  font-size: 13px;
  text-align: center;
`;
