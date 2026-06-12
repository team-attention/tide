// Pure mapping helpers for the Editor Pane's language-intelligence extensions
// (spec: workbench-editor-language-intelligence). Kept free of CodeMirror view
// state so they are unit-testable without mounting an editor in jsdom.

// Languages with a real engine behind workspace.codeIntel (TS in-process,
// rust-analyzer / gopls over LSP). Everything else gets grammar highlighting
// only — querying would just round-trip to an `unavailable` error.
export const CODE_INTEL_LANGUAGES: ReadonlySet<string> = new Set(["ts", "rust", "go"]);

export function hasCodeIntelligence(language: string): boolean {
  return CODE_INTEL_LANGUAGES.has(language);
}

// root = filePath minus the trailing relativePath (the same derivation the
// editor breadcrumb uses); falls back to the file's directory when the two
// disagree (e.g. a pane seeded without a relativePath).
export function deriveEditorRoot(filePath: string, relativePath: string | undefined): string {
  if (relativePath !== undefined && relativePath.length > 0 && filePath.endsWith(relativePath)) {
    const root = filePath.slice(0, filePath.length - relativePath.length).replace(/\/+$/, "");
    if (root.length > 0) {
      return root;
    }
  }
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : "/";
}

// Provider-native completion kind names (tsserver's ScriptElementKind strings,
// LSP CompletionItemKind names) → CodeMirror completion `type` (drives the
// icon). Unknown kinds get no icon rather than a wrong one.
const KIND_TO_CM_TYPE: Record<string, string> = {
  function: "function",
  method: "method",
  constructor: "function",
  var: "variable",
  let: "variable",
  variable: "variable",
  "local var": "variable",
  parameter: "variable",
  const: "constant",
  constant: "constant",
  "enum member": "constant",
  enummember: "constant",
  field: "property",
  property: "property",
  getter: "property",
  setter: "property",
  class: "class",
  struct: "class",
  interface: "interface",
  enum: "enum",
  module: "namespace",
  namespace: "namespace",
  alias: "type",
  type: "type",
  "type parameter": "type",
  typeparameter: "type",
  "primitive type": "type",
  keyword: "keyword",
  text: "text",
  string: "text",
  snippet: "text",
};

export function mapCompletionKindToCmType(kind: string | undefined): string | undefined {
  if (kind === undefined) {
    return undefined;
  }
  return KIND_TO_CM_TYPE[kind.toLowerCase()];
}

export interface EditorCompletionOption {
  label: string;
  type?: string;
  detail?: string;
  apply: string;
}

export function payloadCompletionsToCm(payload: Record<string, unknown>): EditorCompletionOption[] {
  const raw = payload.completions;
  if (!Array.isArray(raw)) {
    return [];
  }
  const options: EditorCompletionOption[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.label !== "string" || entry.label.length === 0) {
      continue;
    }
    options.push({
      label: entry.label,
      type: mapCompletionKindToCmType(typeof entry.kind === "string" ? entry.kind : undefined),
      detail: typeof entry.detail === "string" ? entry.detail : undefined,
      apply: typeof entry.insertText === "string" ? entry.insertText : entry.label,
    });
  }
  return options;
}

export interface EditorDiagnostic {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
}

// `positionToOffset` resolves a 0-based contract line/character against the
// CURRENT doc (null = line out of range); ranges are clamped to the doc so a
// result computed against a slightly different buffer can never throw.
export function payloadDiagnosticsToCm(
  payload: Record<string, unknown>,
  positionToOffset: (line: number, character: number) => number | null,
  docLength: number,
): EditorDiagnostic[] {
  const raw = payload.diagnostics;
  if (!Array.isArray(raw)) {
    return [];
  }
  const diagnostics: EditorDiagnostic[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.line !== "number" ||
      typeof entry.character !== "number" ||
      typeof entry.message !== "string"
    ) {
      continue;
    }
    const start = positionToOffset(entry.line, entry.character);
    if (start === null) {
      continue;
    }
    const from = Math.max(0, Math.min(start, docLength));
    const length = typeof entry.length === "number" && entry.length > 0 ? entry.length : 1;
    const to = Math.min(from + length, docLength);
    diagnostics.push({
      from,
      to: Math.max(from, to),
      severity:
        entry.severity === "warning" || entry.severity === "info" ? entry.severity : "error",
      message: entry.message,
    });
  }
  return diagnostics;
}

export interface EditorHighlightRange {
  from: number;
  to: number;
  write: boolean;
}

export function payloadHighlightsToRanges(
  payload: Record<string, unknown>,
  positionToOffset: (line: number, character: number) => number | null,
  docLength: number,
): EditorHighlightRange[] {
  const raw = payload.highlights;
  if (!Array.isArray(raw)) {
    return [];
  }
  const ranges: EditorHighlightRange[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.line !== "number" ||
      typeof entry.character !== "number" ||
      typeof entry.length !== "number"
    ) {
      continue;
    }
    const start = positionToOffset(entry.line, entry.character);
    if (start === null) {
      continue;
    }
    const from = Math.max(0, Math.min(start, docLength));
    const to = Math.min(from + entry.length, docLength);
    if (to <= from) {
      continue;
    }
    ranges.push({ from, to, write: entry.kind === "write" });
  }
  return ranges;
}

export interface EditorHoverInfo {
  contents: string;
  line?: number;
  character?: number;
  length?: number;
}

export function payloadHoverContents(payload: Record<string, unknown>): EditorHoverInfo | null {
  const hover = payload.hover;
  if (typeof hover !== "object" || hover === null) {
    return null;
  }
  const entry = hover as Record<string, unknown>;
  if (typeof entry.contents !== "string" || entry.contents.trim().length === 0) {
    return null;
  }
  return {
    contents: entry.contents,
    line: typeof entry.line === "number" ? entry.line : undefined,
    character: typeof entry.character === "number" ? entry.character : undefined,
    length: typeof entry.length === "number" ? entry.length : undefined,
  };
}

export interface EditorSignatureModel {
  before: string;
  active: string;
  after: string;
}

// Splits the active signature's label around the active parameter so the
// tooltip can emphasize it. Scans past the preceding parameters first, so
// repeated parameter labels (two `x: number`s) resolve to the right occurrence.
export function signatureRenderModel(payload: Record<string, unknown>): EditorSignatureModel | null {
  const signature = payload.signature;
  if (typeof signature !== "object" || signature === null) {
    return null;
  }
  const help = signature as Record<string, unknown>;
  const signatures = Array.isArray(help.signatures) ? help.signatures : [];
  if (signatures.length === 0) {
    return null;
  }
  const activeSignature =
    typeof help.activeSignature === "number"
      ? Math.min(Math.max(help.activeSignature, 0), signatures.length - 1)
      : 0;
  const first = signatures[activeSignature] as Record<string, unknown> | undefined;
  if (first === undefined || typeof first.label !== "string") {
    return null;
  }
  const label = first.label;
  const parameters = Array.isArray(first.parameters) ? first.parameters : [];
  const activeParameter = typeof help.activeParameter === "number" ? help.activeParameter : -1;
  let searchFrom = 0;
  let activeStart = -1;
  let activeEnd = -1;
  for (let index = 0; index < parameters.length && index <= activeParameter; index += 1) {
    const parameter = parameters[index] as Record<string, unknown> | null;
    const parameterLabel = parameter !== null ? parameter.label : undefined;
    if (typeof parameterLabel !== "string" || parameterLabel.length === 0) {
      break;
    }
    const at = label.indexOf(parameterLabel, searchFrom);
    if (at === -1) {
      break;
    }
    if (index === activeParameter) {
      activeStart = at;
      activeEnd = at + parameterLabel.length;
    }
    searchFrom = at + parameterLabel.length;
  }
  if (activeStart === -1) {
    return { before: label, active: "", after: "" };
  }
  return {
    before: label.slice(0, activeStart),
    active: label.slice(activeStart, activeEnd),
    after: label.slice(activeEnd),
  };
}

// The word (identifier) the pointer is over, for the Cmd+hover link underline.
export function wordRangeInLine(
  lineText: string,
  column: number,
): { start: number; end: number } | null {
  if (column < 0 || column > lineText.length) {
    return null;
  }
  const isWordChar = (ch: string): boolean => /[\w$]/.test(ch);
  let start = column;
  let end = column;
  while (start > 0 && isWordChar(lineText[start - 1] as string)) {
    start -= 1;
  }
  while (end < lineText.length && isWordChar(lineText[end] as string)) {
    end += 1;
  }
  return end > start ? { start, end } : null;
}
