import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { css, styled } from "styled-components";

type HighlightHostWindow = Window & {
  Highlight?: new (...ranges: Range[]) => unknown;
  CSS?: {
    highlights?: {
      set(name: string, highlight: unknown): void;
      delete(name: string): void;
    };
  };
};

const FIND_MATCH_HIGHLIGHT = "tide-find-match";
const FIND_ACTIVE_HIGHLIGHT = "tide-find-active";
let lastInteractedFindRoot: HTMLElement | null = null;

export interface InPaneFindState {
  open: boolean;
  query: string;
  activeIndex: number;
  openFind: () => void;
  closeFind: () => void;
  setQuery: (query: string) => void;
  setActiveIndex: (index: number) => void;
  next: (matchCount: number) => void;
  previous: (matchCount: number) => void;
}

export function useInPaneFindState(): InPaneFindState {
  const [open, setOpen] = useState(false);
  const [query, setQueryValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const openFind = useCallback(() => setOpen(true), []);
  const closeFind = useCallback(() => setOpen(false), []);
  const setQuery = useCallback((next: string) => {
    setQueryValue(next);
    setActiveIndex(0);
  }, []);
  const next = useCallback((matchCount: number) => {
    setActiveIndex((index) => (matchCount > 0 ? (index + 1) % matchCount : 0));
  }, []);
  const previous = useCallback((matchCount: number) => {
    setActiveIndex((index) => (matchCount > 0 ? (index + matchCount - 1) % matchCount : 0));
  }, []);
  return { open, query, activeIndex, openFind, closeFind, setQuery, setActiveIndex, next, previous };
}

export function usePaneFindIntent(
  rootRef: RefObject<HTMLElement | null>,
  params: {
    enabled: boolean;
    open: boolean;
    onOpen: () => void;
    onClose: () => void;
    onNext: () => void;
    onPrevious: () => void;
  },
): void {
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return undefined;
    }
    const rememberRoot = (): void => {
      lastInteractedFindRoot = root;
    };
    root.addEventListener("pointerdown", rememberRoot, true);
    root.addEventListener("mousedown", rememberRoot, true);
    root.addEventListener("focusin", rememberRoot, true);
    return () => {
      root.removeEventListener("pointerdown", rememberRoot, true);
      root.removeEventListener("mousedown", rememberRoot, true);
      root.removeEventListener("focusin", rememberRoot, true);
      if (lastInteractedFindRoot === root) {
        lastInteractedFindRoot = null;
      }
    };
  }, [rootRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const current = latest.current;
      if (!current.enabled || !focusIsInside(rootRef.current)) {
        return;
      }
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && !event.shiftKey && key === "f") {
        event.preventDefault();
        event.stopPropagation();
        current.onOpen();
      } else if (mod && !event.altKey && key === "g") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          current.onPrevious();
        } else {
          current.onNext();
        }
      } else if (event.key === "Escape" && current.open) {
        event.preventDefault();
        event.stopPropagation();
        current.onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [rootRef]);

  useEffect(() => {
    const off = window.tide?.onFindIntent?.(() => {
      const current = latest.current;
      if (current.enabled && focusIsInside(rootRef.current)) {
        current.onOpen();
      }
    });
    return off;
  }, [rootRef]);
}

export function InPaneFindBar(props: {
  query: string;
  matchCount: number;
  activeIndex: number;
  placeholder?: string;
  scopeLabel?: string;
  placement?: "pane" | "chat";
  tone?: "default" | "dark";
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const hasQuery = props.query.trim().length > 0;
  const count =
    !hasQuery
      ? ""
      : props.matchCount === 0
        ? "No results"
        : `${Math.min(props.activeIndex + 1, props.matchCount)} / ${props.matchCount}`;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        props.onPrevious();
      } else {
        props.onNext();
      }
    }
  };
  return (
    <InPaneFindFrame
      data-in-pane-find
      data-tone={props.tone ?? "default"}
      data-placement={props.placement ?? "pane"}
      role="search"
      aria-label="Find in pane"
      $placement={props.placement ?? "pane"}
      $tone={props.tone ?? "default"}
    >
      <Search size={14} strokeWidth={1.9} aria-hidden />
      {props.scopeLabel ? (
        <InPaneFindScope $placement={props.placement ?? "pane"} $tone={props.tone ?? "default"}>
          {props.scopeLabel}
        </InPaneFindScope>
      ) : null}
      <InPaneFindInput
        ref={inputRef}
        data-in-pane-find-input
        value={props.query}
        placeholder={props.placeholder ?? "Find"}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event: { currentTarget: { value: string } }) => props.onQueryChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <InPaneFindCount data-in-pane-find-count $placement={props.placement ?? "pane"} aria-live="polite">
        {count}
      </InPaneFindCount>
      <InPaneFindButton
        type="button"
        title="Previous match"
        aria-label="Previous match"
        disabled={props.matchCount === 0}
        onClick={props.onPrevious}
      >
        <ChevronUp size={14} strokeWidth={2} aria-hidden />
      </InPaneFindButton>
      <InPaneFindButton
        type="button"
        title="Next match"
        aria-label="Next match"
        disabled={props.matchCount === 0}
        onClick={props.onNext}
      >
        <ChevronDown size={14} strokeWidth={2} aria-hidden />
      </InPaneFindButton>
      <InPaneFindButton
        type="button"
        title="Close find"
        aria-label="Close find"
        onClick={props.onClose}
      >
        <X size={14} strokeWidth={2} aria-hidden />
      </InPaneFindButton>
    </InPaneFindFrame>
  );
}

export function useDomTextFind(params: {
  rootRef: RefObject<HTMLElement | null>;
  open: boolean;
  query: string;
  activeIndex: number;
  refreshKey: unknown;
  onActiveIndexChange: (index: number) => void;
}): number {
  const [matchCount, setMatchCount] = useState(0);
  useEffect(() => {
    clearDomFindHighlights();
    const root = params.rootRef.current;
    const query = params.query.trim();
    if (!params.open || root === null || query.length === 0) {
      setMatchCount(0);
      return clearDomFindHighlights;
    }
    const ranges = collectDomTextMatches(root, query);
    setMatchCount(ranges.length);
    if (ranges.length === 0) {
      return clearDomFindHighlights;
    }
    const activeIndex = Math.max(0, Math.min(params.activeIndex, ranges.length - 1));
    if (activeIndex !== params.activeIndex) {
      params.onActiveIndexChange(activeIndex);
    }
    applyDomFindHighlights(ranges, activeIndex);
    scrollRangeIntoView(ranges[activeIndex]);
    return clearDomFindHighlights;
  }, [params.rootRef, params.open, params.query, params.activeIndex, params.refreshKey, params.onActiveIndexChange]);
  return matchCount;
}

export function clearDomFindHighlights(): void {
  const host = window as HighlightHostWindow;
  host.CSS?.highlights?.delete(FIND_MATCH_HIGHLIGHT);
  host.CSS?.highlights?.delete(FIND_ACTIVE_HIGHLIGHT);
}

function applyDomFindHighlights(ranges: Range[], activeIndex: number): void {
  const host = window as HighlightHostWindow;
  if (host.CSS?.highlights === undefined || host.Highlight === undefined) {
    return;
  }
  host.CSS.highlights.set(FIND_MATCH_HIGHLIGHT, new host.Highlight(...ranges));
  host.CSS.highlights.set(FIND_ACTIVE_HIGHLIGHT, new host.Highlight(ranges[activeIndex]));
}

function collectDomTextMatches(root: HTMLElement, query: string): Range[] {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const nodeFilter = win?.NodeFilter;
  const accept = nodeFilter?.FILTER_ACCEPT ?? 1;
  const reject = nodeFilter?.FILTER_REJECT ?? 2;
  const walker = doc.createTreeWalker(root, nodeFilter?.SHOW_TEXT ?? 4, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent === null || (node.textContent ?? "").trim().length === 0) {
        return reject;
      }
      if (parent.closest("[data-in-pane-find],script,style,noscript,textarea,input,select,button") !== null) {
        return reject;
      }
      return accept;
    },
  });
  const ranges: Range[] = [];
  const needle = query.toLocaleLowerCase();
  let node = walker.nextNode();
  while (node !== null) {
    const text = node.textContent ?? "";
    const haystack = text.toLocaleLowerCase();
    let offset = haystack.indexOf(needle);
    while (offset !== -1) {
      const range = doc.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + query.length);
      ranges.push(range);
      offset = haystack.indexOf(needle, offset + Math.max(query.length, 1));
    }
    node = walker.nextNode();
  }
  return ranges;
}

function scrollRangeIntoView(range: Range | undefined): void {
  if (range === undefined) {
    return;
  }
  const element =
    range.startContainer.nodeType === 1
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  if (typeof element?.scrollIntoView === "function") {
    element.scrollIntoView({ block: "center", inline: "nearest" });
  }
}

function focusIsInside(root: HTMLElement | null): boolean {
  if (root === null) {
    return false;
  }
  const doc = root.ownerDocument;
  const active = doc.activeElement;
  if (active !== null && root.contains(active)) {
    return true;
  }
  if (active !== null && active !== doc.body && active !== doc.documentElement) {
    return false;
  }
  const selection = doc.defaultView?.getSelection?.();
  const anchor = selection?.anchorNode;
  if (anchor !== undefined && anchor !== null && root.contains(anchor)) {
    return true;
  }
  return lastInteractedFindRoot === root;
}

const InPaneFindFrame = styled.div<{
  $placement: "pane" | "chat";
  $tone: "default" | "dark";
}>`
  min-width: 0;
  min-height: 32px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  border-bottom: 1px solid
    ${({ $tone }) => ($tone === "dark" ? "rgba(255, 255, 255, 0.12)" : "var(--tide-line)")};
  padding: 5px 8px;
  background: ${({ $tone }) => ($tone === "dark" ? "#222226" : "var(--tide-surface)")};
  color: ${({ $tone }) => ($tone === "dark" ? "#b9b9bf" : "var(--tide-muted)")};

  ${({ $placement }) =>
    $placement === "chat"
      ? css`
          width: 100%;
          min-height: 38px;
          border: 1px solid var(--tide-line);
          border-radius: 8px;
          padding: 6px 8px;
          background: color-mix(in srgb, var(--tide-surface) 92%, var(--tide-bg));
          box-shadow: 0 1px 2px rgba(33, 31, 36, 0.04);
        `
      : ""}
`;

const InPaneFindInput = styled.input`
  min-width: 72px;
  height: 24px;
  flex: 1 1 auto;
  border: 1px solid var(--tide-line);
  border-radius: 6px;
  outline: none;
  padding: 0 7px;
  background: var(--tide-bg);
  color: var(--tide-text);
  font: 12px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;

  &:focus {
    border-color: var(--tide-action);
  }

  ${InPaneFindFrame}[data-placement="chat"] & {
    height: 26px;
  }

  ${InPaneFindFrame}[data-tone="dark"] & {
    border-color: rgba(255, 255, 255, 0.16);
    background: #19191b;
    color: #ededf0;
  }

  ${InPaneFindFrame}[data-tone="dark"] &:focus {
    border-color: #7aa2ff;
  }
`;

const InPaneFindScope = styled.span<{
  $placement: "pane" | "chat";
  $tone: "default" | "dark";
}>`
  min-width: 0;
  max-width: 14ch;
  height: 20px;
  flex: 0 0 auto;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  border: 1px solid
    ${({ $tone }) => ($tone === "dark" ? "rgba(255, 255, 255, 0.16)" : "var(--tide-line)")};
  border-radius: ${({ $placement }) => ($placement === "chat" ? "6px" : "5px")};
  padding: ${({ $placement }) => ($placement === "chat" ? "2px 6px" : "0 6px")};
  background: ${({ $tone }) => ($tone === "dark" ? "rgba(255, 255, 255, 0.05)" : "var(--tide-bg)")};
  color: ${({ $tone }) => ($tone === "dark" ? "#b9b9bf" : "var(--tide-muted)")};
  font: ${({ $placement }) =>
    $placement === "chat"
      ? "11px/1.25 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
      : "11px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"};
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const InPaneFindCount = styled.span<{ $placement: "pane" | "chat" }>`
  min-width: ${({ $placement }) => ($placement === "chat" ? "64px" : "58px")};
  flex: 0 0 auto;
  color: var(--tide-muted);
  font: 11px/1.2 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  text-align: right;
  white-space: nowrap;
`;

const InPaneFindButton = styled.button`
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--tide-selection);
    color: var(--tide-text);
  }

  &:disabled {
    opacity: 0.34;
    cursor: default;
  }

  ${InPaneFindFrame}[data-tone="dark"] &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.09);
    color: #ededf0;
  }
`;
