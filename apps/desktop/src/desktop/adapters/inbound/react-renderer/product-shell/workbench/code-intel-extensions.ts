import type { ProductShellHandlers } from "../support/types.ts";
import { Decoration, EditorView, ViewPlugin, hoverTooltip, keymap, showTooltip } from "@codemirror/view";
import type { DecorationSet, Tooltip, ViewUpdate } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import type { Extension, Text } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { syntaxHighlighting } from "@codemirror/language";
import { classHighlighter } from "@lezer/highlight";
import {
  hasCodeIntelligence,
  payloadCompletionsToCm,
  payloadDiagnosticsToCm,
  payloadHighlightsToRanges,
  payloadHoverContents,
  signatureRenderModel,
  wordRangeInLine,
} from "./code-intel-mappers.ts";
// The CodeMirror language-intelligence extensions for the Editor Pane —
// autocomplete, hover, diagnostics, occurrence highlighting, signature help,
// and the Cmd+hover link affordance — all answered by the backend through
// onEditorCodeIntel. Split from code-editor.ts (file-size cap): this module
// owns extension behavior, code-editor.ts owns the React component.
// Spec: workbench-editor-language-intelligence.

// Buffers past this size stay un-queried: every query ships the WHOLE buffer
// over IPC (full-text sync), and the save path enforces a comparable limit.
const MAX_INTEL_BUFFER_CHARS = 1_500_000;

// Shared gate for every query source. Read-only (truncated) panes must NOT
// query: their TRUNCATED text would be pushed as the file's overlay/document
// state and poison cross-file intelligence with garbage content.
export function codeIntelQueryAllowed(
  ctx: Pick<CodeIntelContext, "language" | "readOnly">,
  docLength: number,
): boolean {
  return !ctx.readOnly && hasCodeIntelligence(ctx.language) && docLength <= MAX_INTEL_BUFFER_CHARS;
}

// What the intel extensions need from the component at query time. Read through
// a getter (a ref to the latest props) because the shell re-renders per
// keystroke while the extensions are built once per mounted editor.
export interface CodeIntelContext {
  paneId: string;
  language: string;
  readOnly: boolean;
  handlers: ProductShellHandlers;
}

// 0-based contract line/character → doc offset (null = line out of range), with
// the character clamped into the line so a result computed against a slightly
// older buffer can never produce an invalid position.
function docPositionToOffset(doc: Text): (line: number, character: number) => number | null {
  return (line, character) => {
    if (line < 0 || line >= doc.lines) {
      return null;
    }
    const info = doc.line(line + 1);
    return Math.min(info.from + Math.max(character, 0), info.to);
  };
}

// ---- Occurrence highlighting (all uses of the symbol under the cursor) ----
// Module-level StateEffect/StateField instances: @uiw/react-codemirror
// reconfigures on every render's new extensions array, and reconfiguring with
// the SAME field instance preserves its value (a fresh instance would reset it).

const setOccurrenceDecorations = StateEffect.define<DecorationSet>();
const occurrenceField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setOccurrenceDecorations)) {
        return effect.value;
      }
    }
    // Stale once the doc changes; the plugin re-queries on the next cursor idle.
    if (tr.docChanged) {
      return Decoration.none;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const occurrenceMark = Decoration.mark({ class: "cm-tide-occurrence" });
const occurrenceWriteMark = Decoration.mark({
  class: "cm-tide-occurrence cm-tide-occurrence--write",
});

function createOccurrencePlugin(getContext: () => CodeIntelContext) {
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private readonly view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet) {
          this.schedule();
        }
      }
      destroy(): void {
        this.cancel();
      }
      private cancel(): void {
        if (this.timer !== null) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }
      private schedule(): void {
        this.cancel();
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.query();
        }, 150);
      }
      private async query(): Promise<void> {
        const ctx = getContext();
        if (!codeIntelQueryAllowed(ctx, this.view.state.doc.length)) {
          return;
        }
        const selection = this.view.state.selection.main;
        // A real (non-empty) selection already highlights itself — occurrence
        // marks underneath would just add noise.
        if (!selection.empty) {
          this.apply(Decoration.none);
          return;
        }
        const doc = this.view.state.doc;
        const line = doc.lineAt(selection.head);
        const payload = await ctx.handlers.onEditorCodeIntel({
          paneId: ctx.paneId,
          kind: "highlights",
          content: doc.toString(),
          line: line.number - 1,
          character: selection.head - line.from,
        });
        // The buffer moved while the query was in flight — offsets would drift.
        if (this.view.state.doc !== doc) {
          return;
        }
        const ranges =
          payload === null
            ? []
            : payloadHighlightsToRanges(payload, docPositionToOffset(doc), doc.length);
        this.apply(
          ranges.length === 0
            ? Decoration.none
            : Decoration.set(
                ranges.map((range) =>
                  (range.write ? occurrenceWriteMark : occurrenceMark).range(range.from, range.to),
                ),
                true,
              ),
        );
      }
      private apply(decorations: DecorationSet): void {
        if (decorations === Decoration.none && this.view.state.field(occurrenceField, false) === Decoration.none) {
          return;
        }
        this.view.dispatch({ effects: setOccurrenceDecorations.of(decorations) });
      }
    },
  );
}

// ---- Signature help (tooltip above the cursor while typing call arguments) ----

const setSignatureTooltip = StateEffect.define<Tooltip | null>();
const signatureField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSignatureTooltip)) {
        return effect.value;
      }
    }
    if (value === null) {
      return null;
    }
    if (tr.docChanged) {
      // A whole-document replacement is a pane being reused for ANOTHER file
      // (unkeyed editor + new value) — call-site help cannot survive that.
      let fullReplace = false;
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA === 0 && toA >= tr.startState.doc.length) {
          fullReplace = true;
        }
      });
      if (fullReplace) {
        return null;
      }
      value = { ...value, pos: tr.changes.mapPos(value.pos) };
    }
    // Leaving the call's line dismisses the help (VS Code behavior).
    if (tr.selection !== undefined || tr.docChanged) {
      const head = tr.state.selection.main.head;
      if (tr.state.doc.lineAt(head).number !== tr.state.doc.lineAt(value.pos).number) {
        return null;
      }
    }
    return value;
  },
  provide: (field) => showTooltip.from(field),
});

const signatureDismissKeymap = keymap.of([
  {
    key: "Escape",
    run: (view) => {
      const current = view.state.field(signatureField, false);
      if (current === null || current === undefined) {
        return false;
      }
      view.dispatch({ effects: setSignatureTooltip.of(null) });
      return true;
    },
  },
]);

function createSignaturePlugin(getContext: () => CodeIntelContext) {
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private readonly view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
      }
      update(update: ViewUpdate): void {
        if (!update.docChanged) {
          return;
        }
        let triggered = false;
        update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
          const text = inserted.toString();
          if (text.endsWith("(") || text.endsWith(",")) {
            triggered = true;
          }
        });
        if (triggered) {
          this.schedule();
        }
      }
      destroy(): void {
        this.cancel();
      }
      private cancel(): void {
        if (this.timer !== null) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }
      private schedule(): void {
        this.cancel();
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.query();
        }, 200);
      }
      private async query(): Promise<void> {
        const ctx = getContext();
        if (!codeIntelQueryAllowed(ctx, this.view.state.doc.length)) {
          return;
        }
        const doc = this.view.state.doc;
        const head = this.view.state.selection.main.head;
        const line = doc.lineAt(head);
        const payload = await ctx.handlers.onEditorCodeIntel({
          paneId: ctx.paneId,
          kind: "signature",
          content: doc.toString(),
          line: line.number - 1,
          character: head - line.from,
        });
        if (this.view.state.doc !== doc) {
          return;
        }
        const model = payload === null ? null : signatureRenderModel(payload);
        const tooltip: Tooltip | null =
          model === null
            ? null
            : {
                pos: head,
                above: true,
                create: () => {
                  const dom = document.createElement("div");
                  dom.className = "cm-tide-signature";
                  dom.append(model.before);
                  if (model.active.length > 0) {
                    const strong = document.createElement("strong");
                    strong.textContent = model.active;
                    dom.append(strong);
                  }
                  dom.append(model.after);
                  return { dom };
                },
              };
        if (tooltip === null && (this.view.state.field(signatureField, false) ?? null) === null) {
          return;
        }
        this.view.dispatch({ effects: setSignatureTooltip.of(tooltip) });
      }
    },
  );
}

// ---- Cmd/Ctrl+hover link affordance for the existing Cmd+Click definition ----

const setCmdLinkDecorations = StateEffect.define<DecorationSet>();
const cmdLinkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCmdLinkDecorations)) {
        return effect.value;
      }
    }
    if (tr.docChanged) {
      return Decoration.none;
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const cmdLinkMark = Decoration.mark({ class: "cm-tide-cmdlink" });

function createCmdLinkPlugin() {
  return ViewPlugin.fromClass(
    class {
      private current: { from: number; to: number } | null = null;
      private readonly win: Window | null;
      private readonly onMouseMove = (event: MouseEvent): void => {
        if (!event.metaKey && !event.ctrlKey) {
          this.clear();
          return;
        }
        const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) {
          this.clear();
          return;
        }
        const line = this.view.state.doc.lineAt(pos);
        const word = wordRangeInLine(line.text, pos - line.from);
        if (word === null) {
          this.clear();
          return;
        }
        const range = { from: line.from + word.start, to: line.from + word.end };
        if (this.current !== null && this.current.from === range.from && this.current.to === range.to) {
          return;
        }
        this.current = range;
        this.view.dispatch({
          effects: setCmdLinkDecorations.of(
            Decoration.set([cmdLinkMark.range(range.from, range.to)]),
          ),
        });
      };
      // Releasing the modifier (or leaving the editor / the window losing
      // focus) drops the affordance even when the pointer stays put.
      private readonly onKeyUp = (event: KeyboardEvent): void => {
        if (event.key === "Meta" || event.key === "Control") {
          this.clear();
        }
      };
      private readonly onLeave = (): void => this.clear();
      private readonly view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        this.win = view.dom.ownerDocument.defaultView;
        view.dom.addEventListener("mousemove", this.onMouseMove);
        view.dom.addEventListener("mouseleave", this.onLeave);
        this.win?.addEventListener("keyup", this.onKeyUp);
        this.win?.addEventListener("blur", this.onLeave);
      }
      destroy(): void {
        this.view.dom.removeEventListener("mousemove", this.onMouseMove);
        this.view.dom.removeEventListener("mouseleave", this.onLeave);
        this.win?.removeEventListener("keyup", this.onKeyUp);
        this.win?.removeEventListener("blur", this.onLeave);
      }
      private clear(): void {
        if (this.current === null) {
          return;
        }
        this.current = null;
        this.view.dispatch({ effects: setCmdLinkDecorations.of(Decoration.none) });
      }
    },
  );
}

// ---- Query-backed sources (completion / hover / diagnostics) ----

function createCompletionSource(getContext: () => CodeIntelContext) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const ctx = getContext();
    if (!codeIntelQueryAllowed(ctx, context.state.doc.length)) {
      return null;
    }
    const word = context.matchBefore(/[\w$]*/);
    const wordEmpty = word === null || word.from === word.to;
    const charBefore = context.pos > 0 ? context.state.sliceDoc(context.pos - 1, context.pos) : "";
    // Activate while typing an identifier or right after a member dot; bare
    // cursor positions only complete on explicit Ctrl+Space.
    if (!context.explicit && wordEmpty && charBefore !== ".") {
      return null;
    }
    const doc = context.state.doc;
    const line = doc.lineAt(context.pos);
    const payload = await ctx.handlers.onEditorCodeIntel({
      paneId: ctx.paneId,
      kind: "completion",
      content: doc.toString(),
      line: line.number - 1,
      character: context.pos - line.from,
    });
    if (payload === null) {
      return null;
    }
    const options = payloadCompletionsToCm(payload);
    if (options.length === 0) {
      return null;
    }
    return {
      from: word?.from ?? context.pos,
      options: options.map((option) => ({
        label: option.label,
        type: option.type,
        detail: option.detail,
        apply: option.apply,
      })),
      validFor: /^[\w$]*$/,
    };
  };
}

function createHoverExtension(getContext: () => CodeIntelContext) {
  return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
    const ctx = getContext();
    if (!codeIntelQueryAllowed(ctx, view.state.doc.length)) {
      return null;
    }
    const doc = view.state.doc;
    const line = doc.lineAt(pos);
    const payload = await ctx.handlers.onEditorCodeIntel({
      paneId: ctx.paneId,
      kind: "hover",
      content: doc.toString(),
      line: line.number - 1,
      character: pos - line.from,
    });
    const hover = payload === null ? null : payloadHoverContents(payload);
    if (hover === null) {
      return null;
    }
    const toOffset = docPositionToOffset(doc);
    const start =
      hover.line !== undefined && hover.character !== undefined
        ? toOffset(hover.line, hover.character)
        : null;
    const end =
      start !== null && hover.length !== undefined
        ? Math.min(start + hover.length, doc.length)
        : undefined;
    return {
      pos: start ?? pos,
      end,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-tide-hover";
        dom.textContent = hover.contents;
        return { dom };
      },
    };
  });
}

function createDiagnosticsExtension(getContext: () => CodeIntelContext) {
  return linter(
    async (view): Promise<Diagnostic[]> => {
      const ctx = getContext();
      if (!codeIntelQueryAllowed(ctx, view.state.doc.length)) {
        return [];
      }
      const doc = view.state.doc;
      const payload = await ctx.handlers.onEditorCodeIntel({
        paneId: ctx.paneId,
        kind: "diagnostics",
        content: doc.toString(),
      });
      if (payload === null) {
        return [];
      }
      return payloadDiagnosticsToCm(payload, docPositionToOffset(doc), doc.length);
    },
    { delay: 600 },
  );
}


// Everything the Editor Pane needs to enable language intelligence, built once
// per mounted editor (module-level StateFields keep their value across
// react-codemirror reconfigures; fresh instances would reset them).
export function codeIntelligenceExtensions(getContext: () => CodeIntelContext): Extension[] {
  return [
    // Same themed tok-* classes the chat transcript uses (styles/base.css),
    // replacing CodeMirror's visibly poorer default highlight style.
    syntaxHighlighting(classHighlighter),
    autocompletion({ override: [createCompletionSource(getContext)], defaultKeymap: true }),
    createHoverExtension(getContext),
    createDiagnosticsExtension(getContext),
    occurrenceField,
    createOccurrencePlugin(getContext),
    signatureField,
    signatureDismissKeymap,
    createSignaturePlugin(getContext),
    cmdLinkField,
    createCmdLinkPlugin(),
  ];
}
