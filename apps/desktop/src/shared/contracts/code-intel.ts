// Language-intelligence query DTOs for the Editor Pane (spec:
// workbench-editor-language-intelligence). Positions are 0-based
// line/character (UTF-16 columns — the LSP convention) in BOTH directions.

export type WorkspaceCodeIntelKindDto =
  | "completion"
  | "hover"
  | "highlights"
  | "signature"
  | "diagnostics"
  | "definition"
  | "references";

// A resolved source location (go-to-definition target / one reference site).
export interface WorkspaceCodeLocationDto {
  relativePath: string;
  line: number;
  character: number;
  length?: number;
  label?: string;
}

export interface WorkspaceCodeReferencesDto {
  items: WorkspaceCodeLocationDto[];
  truncated: boolean;
}

export interface WorkspaceCodeCompletionDto {
  label: string;
  // Provider-native completion kind name ("function", "variable", …) used to
  // pick an icon; free-form, never interpreted.
  kind?: string;
  detail?: string;
  insertText?: string;
  sortText?: string;
}

export interface WorkspaceCodeRangeDto {
  line: number;
  character: number;
  length: number;
  // "write" marks mutating occurrences (LSP DocumentHighlightKind.Write).
  kind?: string;
}

export interface WorkspaceCodeHoverDto {
  contents: string;
  line?: number;
  character?: number;
  length?: number;
}

export interface WorkspaceCodeSignatureHelpDto {
  signatures: Array<{ label: string; parameters: Array<{ label: string }> }>;
  activeSignature: number;
  activeParameter: number;
}

export interface WorkspaceCodeDiagnosticDto {
  line: number;
  character: number;
  length: number;
  message: string;
  severity: "error" | "warning" | "info";
}
