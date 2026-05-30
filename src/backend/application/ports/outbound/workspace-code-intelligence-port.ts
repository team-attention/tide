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

export interface WorkspaceCodeIntelligencePort {
  findDefinition(input: {
    root: string;
    path: string;
    line: number;
    character: number;
  }): Promise<WorkspaceCodeDefinitionResult>;
  findReferences(input: {
    root: string;
    path: string;
    line: number;
    character: number;
  }): Promise<WorkspaceCodeReferencesResult>;
}
