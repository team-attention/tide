// Language-intelligence queries for Workbench Editor Panes (spec:
// workbench-editor-language-intelligence). One port, multiple engines behind a
// router adapter: a persistent in-process TypeScript language service for
// TS/JS, and generic LSP stdio clients (rust-analyzer, gopls, …) for languages
// with a server on PATH. All positions are 0-based line/character (UTF-16).
// `content` carries the live (possibly unsaved) editor buffer; engines must
// answer against it, not the on-disk text.

export type WorkspaceCodeIntelligenceErrorCode =
  | "workspace_code_intelligence_unavailable"
  | "workspace_code_definition_not_found"
  | "workspace_code_references_not_found";

export interface WorkspaceCodeIntelligenceError {
  code: WorkspaceCodeIntelligenceErrorCode;
  message: string;
}

export interface WorkspaceCodeLocation {
  root: string;
  path: string;
  relativePath: string;
  line: number;
  character: number;
  length?: number;
  label?: string;
}

export type WorkspaceCodeDefinitionResult =
  | { ok: true; location: WorkspaceCodeLocation }
  | { ok: false; error: WorkspaceCodeIntelligenceError };

export type WorkspaceCodeReferencesResult =
  | { ok: true; locations: WorkspaceCodeLocation[]; truncated: boolean }
  | { ok: false; error: WorkspaceCodeIntelligenceError };

export interface WorkspaceCodeQueryInput {
  root: string;
  path: string;
  line: number;
  character: number;
  // Live editor buffer; overlays the on-disk content for this query (and, for
  // LSP engines, becomes the synced document state).
  content?: string;
}

export interface WorkspaceCodeCompletionItem {
  label: string;
  kind?: string;
  detail?: string;
  insertText?: string;
  sortText?: string;
}

export interface WorkspaceCodeRange {
  line: number;
  character: number;
  length: number;
  kind?: string;
}

export interface WorkspaceCodeHover {
  contents: string;
  line?: number;
  character?: number;
  length?: number;
}

export interface WorkspaceCodeSignatureHelp {
  signatures: Array<{ label: string; parameters: Array<{ label: string }> }>;
  activeSignature: number;
  activeParameter: number;
}

export interface WorkspaceCodeDiagnostic {
  line: number;
  character: number;
  length: number;
  message: string;
  severity: "error" | "warning" | "info";
}

export type WorkspaceCodeCompletionsResult =
  | { ok: true; completions: WorkspaceCodeCompletionItem[] }
  | { ok: false; error: WorkspaceCodeIntelligenceError };

export type WorkspaceCodeHoverResult =
  | { ok: true; hover: WorkspaceCodeHover | null }
  | { ok: false; error: WorkspaceCodeIntelligenceError };

export type WorkspaceCodeHighlightsResult =
  | { ok: true; highlights: WorkspaceCodeRange[] }
  | { ok: false; error: WorkspaceCodeIntelligenceError };

export type WorkspaceCodeSignatureHelpResult =
  | { ok: true; signature: WorkspaceCodeSignatureHelp | null }
  | { ok: false; error: WorkspaceCodeIntelligenceError };

export type WorkspaceCodeDiagnosticsResult =
  | { ok: true; diagnostics: WorkspaceCodeDiagnostic[] }
  | { ok: false; error: WorkspaceCodeIntelligenceError };

export interface WorkspaceCodeIntelligencePort {
  findDefinition(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeDefinitionResult>;
  findReferences(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeReferencesResult>;
  getCompletions(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeCompletionsResult>;
  getHover(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeHoverResult>;
  getDocumentHighlights(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeHighlightsResult>;
  getSignatureHelp(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeSignatureHelpResult>;
  // Diagnostics are per-document: line/character are ignored.
  getDiagnostics(
    input: Omit<WorkspaceCodeQueryInput, "line" | "character">,
  ): Promise<WorkspaceCodeDiagnosticsResult>;
  // Releases engine resources (LSP child processes). Safe to call repeatedly.
  dispose?(): Promise<void>;
}
