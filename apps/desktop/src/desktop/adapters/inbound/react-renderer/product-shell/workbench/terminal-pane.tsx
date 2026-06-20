import * as xtermModule from "@xterm/xterm";
import type { Terminal as XtermTerminalInstance } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { CornerDownRight } from "lucide-react";
import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { InPaneFindBar, useInPaneFindState, usePaneFindIntent } from "../../support/in-pane-find.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// `@xterm/xterm` is CommonJS, and its export shape differs across loaders: the
// `Terminal` class is a named export under Vite's ESM interop and Node's ESM
// loader, but lives under `.default` in some bundling paths. Default-importing
// the module gave `undefined` under Vite (dev optimizeDeps), white-screening
// the whole shell. Resolve the constructor defensively so the same source works
// in the Vite dev server, the Vite/rollup production build, and Node ESM tests.
const xtermNamespace = xtermModule as unknown as {
  Terminal?: typeof import("@xterm/xterm").Terminal;
  default?: { Terminal?: typeof import("@xterm/xterm").Terminal };
};

const XtermTerminal =
  xtermNamespace.Terminal ?? xtermNamespace.default?.Terminal;

// Live terminal byte sinks keyed by paneId. Terminal output is a hot path, so
// it is written straight to the GPU terminal and never funneled through React
// state (which would re-render the whole shell per chunk).
export const terminalOutputSinks = new Map<string, (chunk: string) => void>();

// Per-pane readers for the current xterm text selection, so "Add to chat" can
// grab the selected terminal output.
const terminalSelectionGetters = new Map<string, () => string>();

export function routeProductShellTerminalOutput(paneId: string, chunk: string): boolean {
  const sink = terminalOutputSinks.get(paneId);
  if (sink === undefined) {
    return false;
  }
  sink(chunk);
  return true;
}

// Real GPU-accelerated terminal: xterm.js with the WebGL addon (MIT). Drawing
// many cells is a simple, parallel job — like v1's WGPU cell rendering — so it
// belongs on the GPU, not per-cell DOM. Falls back to xterm's default renderer
// when WebGL is unavailable (headless/jsdom/no-GPU).
function WorkbenchTerminalView(props: {
  paneId: string;
  initialText: string;
  onInput?: (paneId: string, bytes: string) => void;
  onResize?: (paneId: string, cols: number, rows: number) => void;
  onAddSelection?: (text: string) => void;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XtermTerminalInstance | null>(null);
  const findOpenRef = useRef(false);
  const [bufferVersion, setBufferVersion] = useState(0);
  const find = useInPaneFindState();
  useEffect(() => {
    findOpenRef.current = find.open;
    if (find.open) {
      setBufferVersion((version) => version + 1);
    }
  }, [find.open]);
  const terminalMatches = useMemo(
    () => readTerminalMatches(termRef.current, find.query),
    [find.query, bufferVersion],
  );
  const terminalMatchCount = terminalMatches.length;
  usePaneFindIntent(rootRef, {
    enabled: true,
    open: find.open,
    onOpen: find.openFind,
    onClose: find.closeFind,
    onNext: () => find.next(terminalMatchCount),
    onPrevious: () => find.previous(terminalMatchCount),
  });
  useEffect(() => {
    const term = termRef.current;
    if (!find.open || find.query.trim().length === 0 || terminalMatches.length === 0 || term === null) {
      return;
    }
    const index = Math.max(0, Math.min(find.activeIndex, terminalMatches.length - 1));
    if (index !== find.activeIndex) {
      find.setActiveIndex(index);
    }
    const match = terminalMatches[index];
    const searchable = term as SearchableTerminal;
    searchable.scrollToLine?.(Math.max(0, match.row - 2));
    searchable.select?.(match.column, match.row, Math.max(1, match.length));
  }, [find.open, find.query, find.activeIndex, find.setActiveIndex, terminalMatches]);
  useEffect(() => {
    if (!find.open) {
      (termRef.current as SearchableTerminal | null)?.clearSelection?.();
    }
  }, [find.open]);
  // Floating "Add to chat" button that follows the terminal text selection.
  const [selToolbar, setSelToolbar] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || XtermTerminal === undefined) {
      return;
    }
    // xterm core mounts synchronously so the terminal is visible immediately.
    const term = new XtermTerminal({
      convertEol: true,
      fontSize: 12,
      // Roboto Mono first for the brand look, then Nerd Fonts (if the user has
      // one installed for their shell prompt) and the macOS system monospaces,
      // which cover the powerline/box glyphs Roboto Mono lacks (they fell back
      // to ○). Per-glyph browser fallback only kicks in for missing glyphs.
      fontFamily:
        '"Roboto Mono", "MesloLGS NF", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", "Hack Nerd Font", Menlo, Monaco, ui-monospace, SFMono-Regular, Consolas, monospace',
      scrollback: 5000,
      theme: {
        background: "#1b1b1d",
        foreground: "#e4e4e6",
        cursor: "#e4e4e6",
        cursorAccent: "#1b1b1d",
        selectionBackground: "#3a3a40",
        // A full ANSI palette (One Dark-aligned, matching the editor syntax
        // theme) — without it, colored CLI output fell back to xterm's stock
        // colors, which clashed on the dark background ("colors look off").
        black: "#3b4048",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#d7dae0",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#ffffff",
      },
    });
    termRef.current = term;
    term.open(host);
    if (props.initialText.length > 0) {
      term.write(props.initialText);
    }
    const dataSub =
      props.onInput === undefined
        ? undefined
        : term.onData((data) => props.onInput?.(props.paneId, data));
    terminalOutputSinks.set(props.paneId, (chunk) => {
      term.write(chunk);
      if (findOpenRef.current) {
        setBufferVersion((version) => version + 1);
      }
    });
    const readSelection = () => {
      const withSel = term as unknown as { getSelection?: () => string };
      return typeof withSel.getSelection === "function" ? withSel.getSelection() : "";
    };
    terminalSelectionGetters.set(props.paneId, readSelection);
    // Show the floating "Add to chat" near where the drag-selection ended; hide
    // it as soon as the selection is cleared.
    const onHostMouseUp = (event: MouseEvent) => {
      window.setTimeout(() => {
        setSelToolbar(readSelection().trim().length > 0 ? { x: event.clientX, y: event.clientY } : null);
      }, 0);
    };
    host.addEventListener("mouseup", onHostMouseUp);
    const withSelEvents = term as unknown as { onSelectionChange?: (cb: () => void) => { dispose: () => void } };
    const selSub = withSelEvents.onSelectionChange?.(() => {
      if (readSelection().trim().length === 0) {
        setSelToolbar(null);
      }
    });

    let active = true;
    let fitAddon: { fit: () => void } | undefined;
    let observer: ResizeObserver | undefined;
    // Attach the fit + GPU (WebGL) addons asynchronously; they only upgrade an
    // already-visible terminal, so there is no first-open delay.
    void (async () => {
      try {
        const fitMod = (await import("@xterm/addon-fit")) as {
          FitAddon?: new () => { fit: () => void };
          default?: { FitAddon: new () => { fit: () => void } };
        };
        const FitAddonCtor = fitMod.FitAddon ?? fitMod.default?.FitAddon;
        if (active && FitAddonCtor !== undefined) {
          fitAddon = new FitAddonCtor();
          term.loadAddon(fitAddon as never);
          // After fitting, tell the backend the real grid size so the PTY/shell
          // matches the rendered terminal (otherwise prompts wrap/redraw wrong).
          const emitResize = () => {
            const dims = term as { cols?: number; rows?: number };
            if (typeof dims.cols === "number" && typeof dims.rows === "number") {
              props.onResize?.(props.paneId, dims.cols, dims.rows);
            }
          };
          fitAddon.fit();
          emitResize();
          if (typeof ResizeObserver !== "undefined" && hostRef.current !== null) {
            observer = new ResizeObserver(() => {
              try {
                fitAddon?.fit();
                emitResize();
              } catch {
                // measurement unavailable
              }
            });
            observer.observe(hostRef.current);
          }
        }
      } catch {
        // fit addon unavailable (headless/jsdom) — terminal still renders.
      }
      try {
        const webglMod = (await import("@xterm/addon-webgl")) as {
          WebglAddon?: new () => { onContextLoss: (cb: () => void) => void; dispose: () => void };
          default?: { WebglAddon: new () => { onContextLoss: (cb: () => void) => void; dispose: () => void } };
        };
        const WebglAddonCtor = webglMod.WebglAddon ?? webglMod.default?.WebglAddon;
        if (active && WebglAddonCtor !== undefined) {
          const webgl = new WebglAddonCtor();
          webgl.onContextLoss(() => webgl.dispose());
          term.loadAddon(webgl as never);
        }
      } catch {
        // No WebGL (headless/jsdom/no-GPU) — xterm uses its default renderer.
      }
    })();

    return () => {
      active = false;
      terminalOutputSinks.delete(props.paneId);
      terminalSelectionGetters.delete(props.paneId);
      host.removeEventListener("mouseup", onHostMouseUp);
      selSub?.dispose();
      dataSub?.dispose();
      observer?.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [props.paneId]);
  return (
    <div className="workbench-terminal-view" ref={rootRef}>
      {find.open ? (
        <InPaneFindBar
          query={find.query}
          matchCount={terminalMatchCount}
          activeIndex={find.activeIndex}
          placeholder="Find in terminal"
          tone="dark"
          onQueryChange={find.setQuery}
          onNext={() => find.next(terminalMatchCount)}
          onPrevious={() => find.previous(terminalMatchCount)}
          onClose={find.closeFind}
        />
      ) : null}
      <div className="workbench-terminal-xterm" data-terminal-xterm={props.paneId} ref={hostRef} />
      {selToolbar === null ? null : (
        <button
          type="button"
          className="editor-selection-toolbar"
          style={{ left: `${selToolbar.x + 6}px`, top: `${Math.max(selToolbar.y - 36, 8)}px` } as CSSProperties}
          onMouseDown={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            const text = terminalSelectionGetters.get(props.paneId)?.() ?? "";
            if (text.trim().length > 0) {
              props.onAddSelection?.(text);
            }
            setSelToolbar(null);
          }}
        >
          <CornerDownRight size={13} strokeWidth={1.9} aria-hidden />
          Add to chat
        </button>
      )}
    </div>
  );
}

type SearchableTerminal = XtermTerminalInstance & {
  buffer?: {
    active?: {
      length?: number;
      getLine?: (index: number) => { translateToString: (trimRight?: boolean) => string } | undefined;
    };
  };
  select?: (column: number, row: number, length: number) => void;
  scrollToLine?: (line: number) => void;
  clearSelection?: () => void;
};

function readTerminalMatches(
  term: XtermTerminalInstance | null,
  query: string,
): { row: number; column: number; length: number }[] {
  const needle = query.trim().toLocaleLowerCase();
  if (term === null || needle.length === 0) {
    return [];
  }
  const active = (term as SearchableTerminal).buffer?.active;
  const length = active?.length ?? 0;
  const matches: { row: number; column: number; length: number }[] = [];
  for (let row = 0; row < length; row += 1) {
    const line = active?.getLine?.(row)?.translateToString(true) ?? "";
    const haystack = line.toLocaleLowerCase();
    let column = haystack.indexOf(needle);
    while (column !== -1) {
      matches.push({ row, column, length: query.trim().length });
      column = haystack.indexOf(needle, column + Math.max(needle.length, 1));
    }
  }
  return matches;
}

export function WorkbenchTerminalPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  // A real dark terminal: the xterm surface fills the pane and takes keystrokes
  // directly (xterm.onData routes to onTerminalInput). Selecting text shows a
  // floating "Add to chat" anchored to the selection (no always-on button).
  const interactive = props.pane.terminalRole !== "command_result";
  return (
    <div
      className="workbench-terminal"
      data-terminal-role={props.pane.terminalRole ?? "session"}
      data-terminal-status={props.pane.status ?? "ready"}
    >
      <WorkbenchTerminalView
        paneId={props.pane.paneId}
        initialText={props.pane.transcriptPreview ?? ""}
        onInput={interactive ? props.handlers.onTerminalInput : undefined}
        onResize={interactive ? props.handlers.onTerminalResize : undefined}
        onAddSelection={(text: string) =>
          props.handlers.onAddContentToChat({
            kind: "terminal",
            label: text.trim().replace(/\s+/g, " ").slice(0, 40) || "Terminal output",
            text: `\`\`\`\n${text}\n\`\`\``,
          })
        }
      />
    </div>
  );
}
