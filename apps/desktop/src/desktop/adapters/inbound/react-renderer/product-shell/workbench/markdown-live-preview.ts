import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

const MARKER_CLASS = "cm-md-marker-hidden";
const OVERSCAN_LINES = 8;

class ListMarkerWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  eq(other: ListMarkerWidget): boolean {
    return this.label === other.label;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-md-list-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = this.label;
    return marker;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget): boolean {
    return (
      this.checked === other.checked &&
      this.readOnly === other.readOnly
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.className = "cm-md-task-checkbox";
    input.type = "checkbox";
    input.checked = this.checked;
    input.disabled = this.readOnly;
    input.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Mark task complete");
    input.addEventListener("change", () => {
      if (this.readOnly) {
        return;
      }
      const from = view.posAtDOM(input);
      if (!/^\[[ xX]\]$/.test(view.state.sliceDoc(from, from + 3))) {
        return;
      }
      view.dispatch({
        changes: { from: from + 1, to: from + 2, insert: input.checked ? "x" : " " },
        userEvent: "input",
      });
      view.focus();
    });
    return input;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class ImagePreviewWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly alt: string,
  ) {
    super();
  }

  eq(other: ImagePreviewWidget): boolean {
    return this.source === other.source && this.alt === other.alt;
  }

  toDOM(): HTMLElement {
    const preview = document.createElement("div");
    preview.className = "cm-md-image-preview";
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(this.source)) {
      const image = document.createElement("img");
      image.src = this.source;
      image.alt = this.alt;
      image.addEventListener("error", () => {
        preview.textContent = `Image preview unavailable${this.alt ? `: ${this.alt}` : ""}`;
      });
      preview.append(image);
      return preview;
    }
    preview.textContent = `Image preview unavailable${this.alt ? `: ${this.alt}` : ""}`;
    return preview;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

type LineDecoration = {
  classes: Set<string>;
  attributes: Record<string, string>;
};

function selectionTouches(view: EditorView, from: number, to: number): boolean {
  if (!view.hasFocus) {
    return false;
  }
  return view.state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

function viewportBounds(view: EditorView): { from: number; to: number } {
  const ranges = view.visibleRanges;
  const first = view.state.doc.lineAt(ranges[0]?.from ?? 0);
  const last = view.state.doc.lineAt(ranges.at(-1)?.to ?? view.state.doc.length);
  const fromLine = Math.max(1, first.number - OVERSCAN_LINES);
  const toLine = Math.min(view.state.doc.lines, last.number + OVERSCAN_LINES);
  return {
    from: view.state.doc.line(fromLine).from,
    to: view.state.doc.line(toLine).to,
  };
}

function parentRevealRange(
  view: EditorView,
  node: { from: number; to: number; node: { parent: { from: number; to: number; type: { name: string } } | null } },
): { from: number; to: number } {
  const parent = node.node.parent;
  if (parent === null) {
    return { from: node.from, to: node.to };
  }
  if (parent.type.name === "FencedCode") {
    const line = view.state.doc.lineAt(node.from);
    return { from: line.from, to: line.to };
  }
  if (parent.type.name === "Table" || parent.type.name === "TableHeader" || parent.type.name === "TableRow") {
    const line = view.state.doc.lineAt(node.from);
    return { from: line.from, to: line.to };
  }
  return { from: parent.from, to: parent.to };
}

function buildMarkdownDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const lineDecorations = new Map<number, LineDecoration>();
  const imageWidgetLines = new Set<number>();
  const bounds = viewportBounds(view);
  const doc = view.state.doc;

  const addMark = (from: number, to: number, className: string): void => {
    if (from < to) {
      ranges.push(Decoration.mark({ class: className }).range(from, to));
    }
  };
  const addHiddenMarker = (node: {
    from: number;
    to: number;
    node: { parent: { from: number; to: number; type: { name: string } } | null };
  }): void => {
    const reveal = parentRevealRange(view, node);
    if (!selectionTouches(view, reveal.from, reveal.to)) {
      addMark(node.from, node.to, MARKER_CLASS);
    }
  };
  const addLineClass = (
    lineFrom: number,
    className: string,
    attributes: Record<string, string> = {},
  ): void => {
    const current = lineDecorations.get(lineFrom) ?? {
      classes: new Set<string>(),
      attributes: {},
    };
    current.classes.add(className);
    Object.assign(current.attributes, attributes);
    lineDecorations.set(lineFrom, current);
  };
  const addClassToLines = (from: number, to: number, className: string): void => {
    const lastPosition = Math.max(from, to - 1);
    let line = doc.lineAt(from);
    const lastLine = doc.lineAt(lastPosition).number;
    while (line.number <= lastLine) {
      addLineClass(line.from, className);
      if (line.number === doc.lines) {
        break;
      }
      line = doc.line(line.number + 1);
    }
  };

  syntaxTree(view.state).iterate({
    from: bounds.from,
    to: bounds.to,
    enter(node) {
      const name = node.name;
      const heading = /^ATXHeading([1-6])$/.exec(name);
      if (heading !== null) {
        addLineClass(doc.lineAt(node.from).from, `cm-md-heading cm-md-heading-${heading[1]}`);
        return;
      }
      if (name === "SetextHeading1" || name === "SetextHeading2") {
        addClassToLines(node.from, node.to, `cm-md-heading cm-md-heading-${name.endsWith("1") ? "1" : "2"}`);
        return;
      }
      if (name === "HeaderMark") {
        const parent = node.node.parent;
        if (parent !== null && !selectionTouches(view, parent.from, parent.to)) {
          const line = doc.lineAt(node.from);
          const markerEnd = Math.min(line.to, node.to + (doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0));
          addMark(node.from, markerEnd, MARKER_CLASS);
        }
        return;
      }
      if (name === "StrongEmphasis") {
        addMark(node.from, node.to, "cm-md-strong");
        return;
      }
      if (name === "Emphasis") {
        addMark(node.from, node.to, "cm-md-emphasis");
        return;
      }
      if (name === "Strikethrough") {
        addMark(node.from, node.to, "cm-md-strikethrough");
        return;
      }
      if (name === "InlineCode") {
        addMark(node.from, node.to, "cm-md-inline-code");
        return;
      }
      if (name === "Link") {
        addMark(node.from, node.to, "cm-md-link");
        return;
      }
      if (
        name === "EmphasisMark" ||
        name === "StrikethroughMark" ||
        name === "CodeMark" ||
        name === "LinkMark" ||
        name === "URL"
      ) {
        addHiddenMarker(node);
        return;
      }
      if (name === "Blockquote") {
        addClassToLines(node.from, node.to, "cm-md-blockquote");
        return;
      }
      if (name === "QuoteMark") {
        addHiddenMarker(node);
        return;
      }
      if (name === "ListItem") {
        addClassToLines(node.from, node.to, "cm-md-list-line");
        return;
      }
      if (name === "ListMark") {
        const parent = node.node.parent;
        if (parent !== null && !selectionTouches(view, parent.from, parent.to)) {
          const source = doc.sliceString(node.from, node.to);
          const label = /^\d/.test(source) ? source : "•";
          ranges.push(
            Decoration.replace({ widget: new ListMarkerWidget(label) }).range(node.from, node.to),
          );
        }
        return;
      }
      if (name === "TaskMarker") {
        const parent = node.node.parent;
        if (parent !== null && !selectionTouches(view, parent.from, parent.to)) {
          const checked = /x/i.test(doc.sliceString(node.from, node.to));
          ranges.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(checked, !view.state.facet(EditorView.editable)),
            }).range(node.from, node.to),
          );
        }
        return;
      }
      if (name === "HorizontalRule") {
        addLineClass(doc.lineAt(node.from).from, "cm-md-horizontal-rule");
        if (!selectionTouches(view, node.from, node.to)) {
          addMark(node.from, node.to, MARKER_CLASS);
        }
        return;
      }
      if (name === "FencedCode") {
        const first = doc.lineAt(node.from);
        const last = doc.lineAt(Math.max(node.from, node.to - 1));
        const info = node.node.getChild("CodeInfo");
        addLineClass(first.from, "cm-md-fence-boundary cm-md-fence-open", {
          "data-md-language": info === null ? "Code" : doc.sliceString(info.from, info.to),
        });
        for (let lineNumber = first.number + 1; lineNumber < last.number; lineNumber += 1) {
          addLineClass(doc.line(lineNumber).from, "cm-md-fence-code");
        }
        addLineClass(last.from, "cm-md-fence-boundary cm-md-fence-close");
        return;
      }
      if (name === "CodeInfo") {
        addHiddenMarker(node);
        return;
      }
      if (name === "TableHeader") {
        addLineClass(doc.lineAt(node.from).from, "cm-md-table-header");
        return;
      }
      if (name === "TableRow") {
        addLineClass(doc.lineAt(node.from).from, "cm-md-table-row");
        return;
      }
      if (name === "TableCell") {
        addMark(node.from, node.to, "cm-md-table-cell");
        return;
      }
      if (name === "TableDelimiter") {
        const parentName = node.node.parent?.type.name;
        if (parentName === "Table") {
          addLineClass(doc.lineAt(node.from).from, "cm-md-table-separator");
        }
        addHiddenMarker(node);
        return;
      }
      if (name === "Image") {
        if (selectionTouches(view, node.from, node.to)) {
          return;
        }
        const line = doc.lineAt(node.from);
        if (imageWidgetLines.has(line.from) || doc.sliceString(line.from, line.to).trim() !== doc.sliceString(node.from, node.to).trim()) {
          return;
        }
        const url = node.node.getChild("URL");
        if (url === null) {
          return;
        }
        const source = doc.sliceString(url.from, url.to);
        const alt = /^!\[([^\]]*)\]/.exec(doc.sliceString(node.from, node.to))?.[1] ?? "";
        imageWidgetLines.add(line.from);
        ranges.push(
          Decoration.widget({
            widget: new ImagePreviewWidget(source, alt),
            side: 1,
          }).range(line.to),
        );
      }
    },
  });

  for (const [lineFrom, decoration] of lineDecorations) {
    ranges.push(
      Decoration.line({
        class: Array.from(decoration.classes).join(" "),
        attributes: decoration.attributes,
      }).range(lineFrom),
    );
  }
  return Decoration.set(ranges, true);
}

const markdownLivePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.view.composing) {
        if (update.docChanged) {
          this.decorations = this.decorations.map(update.changes);
        }
        return;
      }
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged
      ) {
        this.decorations = buildMarkdownDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export function markdownLivePreviewExtensions(): Extension[] {
  return [markdownLivePreviewPlugin];
}
