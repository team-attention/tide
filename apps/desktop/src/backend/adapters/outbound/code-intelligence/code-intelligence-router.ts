// Routes language-intelligence queries to the right engine by file extension
// (spec: workbench-editor-language-intelligence):
//   - TS/JS → the persistent in-process TypeScript language service.
//   - Languages with a known LSP server on PATH (rust-analyzer, gopls) → a
//     generic LSP stdio client, created lazily per server and kept alive.
//   - Anything else → workspace_code_intelligence_unavailable (a quiet miss).
import path from "node:path";

import type {
  WorkspaceCodeDefinitionResult,
  WorkspaceCodeDiagnosticsResult,
  WorkspaceCodeCompletionsResult,
  WorkspaceCodeHighlightsResult,
  WorkspaceCodeHoverResult,
  WorkspaceCodeIntelligencePort,
  WorkspaceCodeQueryInput,
  WorkspaceCodeReferencesResult,
  WorkspaceCodeSignatureHelpResult,
} from "../../../application/ports/outbound/workspace-code-intelligence-port.ts";
import { createTypeScriptCodeIntelligencePort } from "./typescript-code-intelligence-port.ts";
import {
  LSP_SERVER_REGISTRY,
  createLspCodeIntelligencePort,
  resolveLspServerExecutable,
  type LspServerSpec,
} from "./lsp/lsp-code-intelligence-port.ts";
import type { BackendOwnedProcessSpawner } from "../../../infrastructure/node/process/backend-owned-process.ts";

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

export function createWorkspaceCodeIntelligenceRouter(input: {
  processSpawner?: BackendOwnedProcessSpawner;
} = {}): WorkspaceCodeIntelligencePort {
  return new WorkspaceCodeIntelligenceRouter(input.processSpawner);
}

class WorkspaceCodeIntelligenceRouter implements WorkspaceCodeIntelligencePort {
  private readonly processSpawner?: BackendOwnedProcessSpawner;

  constructor(processSpawner?: BackendOwnedProcessSpawner) {
    this.processSpawner = processSpawner;
  }
  private readonly typescript = createTypeScriptCodeIntelligencePort();
  // serverId → live engine. Created on first query for a matching file; a
  // failed executable lookup is remembered so we never spawn-retry per query.
  private readonly lspEngines = new Map<string, WorkspaceCodeIntelligencePort>();
  private readonly unavailableServers = new Set<string>();

  private engineFor(filePath: string): WorkspaceCodeIntelligencePort | undefined {
    const extension = path.extname(filePath).toLowerCase();
    if (TYPESCRIPT_EXTENSIONS.has(extension)) {
      return this.typescript;
    }
    const spec = LSP_SERVER_REGISTRY.find((candidate) => candidate.extensions.includes(extension));
    if (spec === undefined || this.unavailableServers.has(spec.id)) {
      return undefined;
    }
    const existing = this.lspEngines.get(spec.id);
    if (existing !== undefined) {
      return existing;
    }
    const executable = resolveLspServerExecutable(spec);
    if (executable === undefined) {
      this.unavailableServers.add(spec.id);
      return undefined;
    }
    const engine = createLspCodeIntelligencePort({ spec, executable, processSpawner: this.processSpawner });
    this.lspEngines.set(spec.id, engine);
    return engine;
  }

  private unavailable(filePath: string): {
    ok: false;
    error: { code: "workspace_code_intelligence_unavailable"; message: string };
  } {
    const extension = path.extname(filePath).toLowerCase();
    const spec = LSP_SERVER_REGISTRY.find((candidate) => candidate.extensions.includes(extension));
    return {
      ok: false,
      error: {
        code: "workspace_code_intelligence_unavailable",
        message:
          spec !== undefined
            ? `No ${spec.command} on PATH — language intelligence for ${extension} is off.`
            : `No language intelligence is available for ${extension || "this file"}.`,
      },
    };
  }

  async findDefinition(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeDefinitionResult> {
    const engine = this.engineFor(input.path);
    if (engine === undefined) {
      const miss = this.unavailable(input.path);
      return { ok: false, error: { ...miss.error, code: "workspace_code_definition_not_found" } };
    }
    return engine.findDefinition(input);
  }

  async findReferences(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeReferencesResult> {
    const engine = this.engineFor(input.path);
    if (engine === undefined) {
      const miss = this.unavailable(input.path);
      return { ok: false, error: { ...miss.error, code: "workspace_code_references_not_found" } };
    }
    return engine.findReferences(input);
  }

  async getCompletions(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeCompletionsResult> {
    const engine = this.engineFor(input.path);
    return engine === undefined ? this.unavailable(input.path) : engine.getCompletions(input);
  }

  async getHover(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeHoverResult> {
    const engine = this.engineFor(input.path);
    return engine === undefined ? this.unavailable(input.path) : engine.getHover(input);
  }

  async getDocumentHighlights(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeHighlightsResult> {
    const engine = this.engineFor(input.path);
    return engine === undefined ? this.unavailable(input.path) : engine.getDocumentHighlights(input);
  }

  async getSignatureHelp(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeSignatureHelpResult> {
    const engine = this.engineFor(input.path);
    return engine === undefined ? this.unavailable(input.path) : engine.getSignatureHelp(input);
  }

  async getDiagnostics(
    input: Omit<WorkspaceCodeQueryInput, "line" | "character">,
  ): Promise<WorkspaceCodeDiagnosticsResult> {
    const engine = this.engineFor(input.path);
    return engine === undefined
      ? this.unavailable(input.path)
      : engine.getDiagnostics(input);
  }

  async dispose(): Promise<void> {
    await this.typescript.dispose?.();
    for (const engine of this.lspEngines.values()) {
      await engine.dispose?.();
    }
    this.lspEngines.clear();
  }
}

export type { LspServerSpec };
