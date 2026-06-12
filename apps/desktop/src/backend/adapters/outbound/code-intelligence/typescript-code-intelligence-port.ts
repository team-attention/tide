// Persistent in-process TypeScript engine (spec:
// workbench-editor-language-intelligence). One ts.LanguageService per Thread
// root, kept alive across queries — rebuilding the service per query was the
// perf bug this replaces. Dirty editor buffers arrive as `content` and overlay
// the on-disk text via versioned script snapshots, so answers track what the
// user sees, not what was last saved.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";

import type {
  WorkspaceCodeCompletionsResult,
  WorkspaceCodeDefinitionResult,
  WorkspaceCodeDiagnostic,
  WorkspaceCodeDiagnosticsResult,
  WorkspaceCodeHighlightsResult,
  WorkspaceCodeHoverResult,
  WorkspaceCodeIntelligencePort,
  WorkspaceCodeLocation,
  WorkspaceCodeQueryInput,
  WorkspaceCodeRange,
  WorkspaceCodeReferencesResult,
  WorkspaceCodeSignatureHelpResult,
} from "../../../application/ports/outbound/workspace-code-intelligence-port.ts";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
]);
const MAX_SOURCE_FILES = 2000;
const MAX_REFERENCES = 200;
const MAX_COMPLETIONS = 80;
// A project's file list is trusted until a queried file is unknown or the
// last scan is this old; avoids walking the tree on every keystroke.
const RESCAN_INTERVAL_MS = 30_000;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

// Stable identity matters: the language service deep-compares options between
// builds, and a fresh object per call defeats its program-reuse fast path.
const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
};

interface ProjectState {
  root: string;
  service: ts.LanguageService;
  fileNames: string[];
  // Monotonic per-file counters; bumped whenever the effective content of a
  // file changes (overlay set, changed, or removed) so the service re-reads it.
  fileVersions: Map<string, number>;
  // path → live (unsaved) buffer; wins over disk in getScriptSnapshot.
  overlays: Map<string, string>;
  lastScanAt: number;
}

type PrepareFailure = "outside_root" | "unsupported_extension" | "missing_file";

interface PreparedQuery {
  ok: true;
  project: ProjectState;
  root: string;
  path: string;
  relativePath: string;
  // Effective text the service sees (overlay if provided, else disk).
  text: string;
}

export function createTypeScriptCodeIntelligencePort(): WorkspaceCodeIntelligencePort {
  return new TypeScriptCodeIntelligencePort();
}

class TypeScriptCodeIntelligencePort implements WorkspaceCodeIntelligencePort {
  private readonly projects = new Map<string, ProjectState>();

  async findDefinition(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeDefinitionResult> {
    const prepared = this.prepare(input);
    if (!prepared.ok) {
      return definitionError(definitionMessageFor(prepared.reason));
    }
    const offset = lineCharacterToOffset(prepared.text, input.line, input.character);
    if (offset === undefined) {
      return definitionError("Definition source position is outside the file.");
    }

    const definitions =
      prepared.project.service.getDefinitionAtPosition(prepared.path, offset) ?? [];
    const program = prepared.project.service.getProgram();
    for (const definition of definitions) {
      const target = resolveInsideRoot(prepared.root, definition.fileName);
      if (!target.ok) {
        continue;
      }
      const sourceFile = program?.getSourceFile(definition.fileName);
      const targetText =
        sourceFile?.text ?? this.effectiveText(prepared.project, definition.fileName);
      if (targetText === undefined) {
        continue;
      }
      const position = offsetToLineCharacter(targetText, definition.textSpan.start);
      return {
        ok: true,
        location: {
          root: target.root,
          path: target.path,
          relativePath: target.relativePath,
          line: position.line,
          character: position.character,
          length: definition.textSpan.length,
          label: definition.name,
        },
      };
    }

    return definitionError("Definition target was not found.");
  }

  async findReferences(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeReferencesResult> {
    const prepared = this.prepare(input);
    if (!prepared.ok) {
      return referencesError(referencesMessageFor(prepared.reason));
    }
    const offset = lineCharacterToOffset(prepared.text, input.line, input.character);
    if (offset === undefined) {
      return referencesError("Reference source position is outside the file.");
    }

    const entries =
      prepared.project.service.getReferencesAtPosition(prepared.path, offset) ?? [];
    const program = prepared.project.service.getProgram();
    const locations: WorkspaceCodeLocation[] = [];
    let truncated = false;
    for (const entry of entries) {
      if (locations.length >= MAX_REFERENCES) {
        truncated = true;
        break;
      }
      const target = resolveInsideRoot(prepared.root, entry.fileName);
      if (!target.ok) {
        continue;
      }
      const sourceFile = program?.getSourceFile(entry.fileName);
      const targetText =
        sourceFile?.text ?? this.effectiveText(prepared.project, entry.fileName);
      if (targetText === undefined) {
        continue;
      }
      const position = offsetToLineCharacter(targetText, entry.textSpan.start);
      locations.push({
        root: target.root,
        path: target.path,
        relativePath: target.relativePath,
        line: position.line,
        character: position.character,
        length: entry.textSpan.length,
        label: lineTextAt(targetText, position.line),
      });
    }

    if (locations.length === 0) {
      return referencesError("No references were found for the selected symbol.");
    }
    return { ok: true, locations, truncated };
  }

  async getCompletions(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeCompletionsResult> {
    const prepared = this.prepare(input);
    if (!prepared.ok) {
      return unavailableError(prepared.reason);
    }
    const offset = lineCharacterToOffset(prepared.text, input.line, input.character);
    if (offset === undefined) {
      return { ok: true, completions: [] };
    }
    const info = prepared.project.service.getCompletionsAtPosition(
      prepared.path,
      offset,
      undefined,
    );
    if (info === undefined) {
      return { ok: true, completions: [] };
    }
    return {
      ok: true,
      completions: info.entries.slice(0, MAX_COMPLETIONS).map((entry) => ({
        label: entry.name,
        kind: entry.kind,
        detail: undefined,
        insertText: entry.insertText ?? undefined,
        sortText: entry.sortText,
      })),
    };
  }

  async getHover(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeHoverResult> {
    const prepared = this.prepare(input);
    if (!prepared.ok) {
      return unavailableError(prepared.reason);
    }
    const offset = lineCharacterToOffset(prepared.text, input.line, input.character);
    if (offset === undefined) {
      return { ok: true, hover: null };
    }
    const info = prepared.project.service.getQuickInfoAtPosition(prepared.path, offset);
    if (info === undefined) {
      return { ok: true, hover: null };
    }
    const display = ts.displayPartsToString(info.displayParts ?? []);
    const documentation = ts.displayPartsToString(info.documentation ?? []);
    const start = offsetToLineCharacter(prepared.text, info.textSpan.start);
    return {
      ok: true,
      hover: {
        contents: documentation.length > 0 ? `${display}\n${documentation}` : display,
        line: start.line,
        character: start.character,
        length: info.textSpan.length,
      },
    };
  }

  async getDocumentHighlights(
    input: WorkspaceCodeQueryInput,
  ): Promise<WorkspaceCodeHighlightsResult> {
    const prepared = this.prepare(input);
    if (!prepared.ok) {
      return unavailableError(prepared.reason);
    }
    const offset = lineCharacterToOffset(prepared.text, input.line, input.character);
    if (offset === undefined) {
      return { ok: true, highlights: [] };
    }
    const entries =
      prepared.project.service.getDocumentHighlights(prepared.path, offset, [prepared.path]) ??
      [];
    const highlights: WorkspaceCodeRange[] = [];
    for (const fileHighlights of entries) {
      // The query is scoped to the open document; ignore stray other-file hits.
      if (fileHighlights.fileName !== prepared.path) {
        continue;
      }
      for (const span of fileHighlights.highlightSpans) {
        const start = offsetToLineCharacter(prepared.text, span.textSpan.start);
        highlights.push({
          line: start.line,
          character: start.character,
          length: span.textSpan.length,
          kind: span.kind === ts.HighlightSpanKind.writtenReference ? "write" : "read",
        });
      }
    }
    return { ok: true, highlights };
  }

  async getSignatureHelp(
    input: WorkspaceCodeQueryInput,
  ): Promise<WorkspaceCodeSignatureHelpResult> {
    const prepared = this.prepare(input);
    if (!prepared.ok) {
      return unavailableError(prepared.reason);
    }
    const offset = lineCharacterToOffset(prepared.text, input.line, input.character);
    if (offset === undefined) {
      return { ok: true, signature: null };
    }
    const help = prepared.project.service.getSignatureHelpItems(
      prepared.path,
      offset,
      undefined,
    );
    if (help === undefined) {
      return { ok: true, signature: null };
    }
    const signatures = help.items.map((item) => {
      const separator = ts.displayPartsToString(item.separatorDisplayParts);
      const parameterLabels = item.parameters.map((parameter) =>
        ts.displayPartsToString(parameter.displayParts),
      );
      return {
        label:
          ts.displayPartsToString(item.prefixDisplayParts) +
          parameterLabels.join(separator) +
          ts.displayPartsToString(item.suffixDisplayParts),
        parameters: parameterLabels.map((label) => ({ label })),
      };
    });
    return {
      ok: true,
      signature: {
        signatures,
        activeSignature: help.selectedItemIndex,
        activeParameter: help.argumentIndex,
      },
    };
  }

  async getDiagnostics(
    input: Omit<WorkspaceCodeQueryInput, "line" | "character">,
  ): Promise<WorkspaceCodeDiagnosticsResult> {
    const prepared = this.prepare(input);
    if (!prepared.ok) {
      return unavailableError(prepared.reason);
    }
    const { service } = prepared.project;
    const raw = [
      ...service.getSyntacticDiagnostics(prepared.path),
      ...service.getSemanticDiagnostics(prepared.path),
    ];
    const diagnostics: WorkspaceCodeDiagnostic[] = [];
    for (const diagnostic of raw) {
      if (diagnostic.start === undefined) {
        continue;
      }
      const start = offsetToLineCharacter(prepared.text, diagnostic.start);
      diagnostics.push({
        line: start.line,
        character: start.character,
        length: diagnostic.length ?? 0,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        severity: severityFor(diagnostic.category),
      });
    }
    return { ok: true, diagnostics };
  }

  async dispose(): Promise<void> {
    for (const project of this.projects.values()) {
      project.service.dispose();
    }
    this.projects.clear();
  }

  // Resolves and validates the query target, applies (or clears) the content
  // overlay, and makes sure the project tracks the file — the shared front
  // door for every port method.
  private prepare(input: {
    root: string;
    path: string;
    content?: string;
  }): PreparedQuery | { ok: false; reason: PrepareFailure } {
    const resolved = resolveInsideRoot(input.root, input.path);
    if (!resolved.ok) {
      return { ok: false, reason: "outside_root" };
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(resolved.path))) {
      return { ok: false, reason: "unsupported_extension" };
    }
    const project = this.projectFor(resolved.root);
    this.applyOverlay(project, resolved.path, input.content);
    this.ensureFileKnown(project, resolved.path);
    const text = input.content ?? safeReadText(resolved.path);
    if (text === undefined) {
      return { ok: false, reason: "missing_file" };
    }
    return {
      ok: true,
      project,
      root: resolved.root,
      path: resolved.path,
      relativePath: resolved.relativePath,
      text,
    };
  }

  private projectFor(root: string): ProjectState {
    const existing = this.projects.get(root);
    if (existing !== undefined) {
      return existing;
    }
    const project = createProject(root);
    this.projects.set(root, project);
    return project;
  }

  private applyOverlay(
    project: ProjectState,
    filePath: string,
    content: string | undefined,
  ): void {
    if (content === undefined) {
      // A query without content means the buffer matches disk again; the bump
      // forces the service to drop the stale overlay snapshot.
      if (project.overlays.delete(filePath)) {
        bumpVersion(project, filePath);
      }
      return;
    }
    if (project.overlays.get(filePath) !== content) {
      project.overlays.set(filePath, content);
      bumpVersion(project, filePath);
    }
  }

  private ensureFileKnown(project: ProjectState, filePath: string): void {
    const known = project.fileNames.includes(filePath);
    const stale = Date.now() - project.lastScanAt > RESCAN_INTERVAL_MS;
    if (known && !stale) {
      return;
    }
    project.fileNames = collectSourceFiles(project.root);
    project.lastScanAt = Date.now();
    if (!project.fileNames.includes(filePath)) {
      project.fileNames.push(filePath);
    }
  }

  private effectiveText(project: ProjectState, fileName: string): string | undefined {
    return project.overlays.get(fileName) ?? safeReadText(fileName);
  }
}

function createProject(root: string): ProjectState {
  const project: ProjectState = {
    root,
    // Assigned right below; the host closes over `project` so the service can
    // observe live file-list/overlay/version state.
    service: undefined as unknown as ts.LanguageService,
    fileNames: collectSourceFiles(root),
    fileVersions: new Map(),
    overlays: new Map(),
    lastScanAt: Date.now(),
  };
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => COMPILER_OPTIONS,
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => project.fileNames,
    getScriptSnapshot: (fileName) => {
      const overlay = project.overlays.get(fileName);
      if (overlay !== undefined) {
        return ts.ScriptSnapshot.fromString(overlay);
      }
      const text = safeReadText(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getScriptVersion: (fileName) => String(project.fileVersions.get(fileName) ?? 0),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  project.service = ts.createLanguageService(host);
  return project;
}

function bumpVersion(project: ProjectState, filePath: string): void {
  project.fileVersions.set(filePath, (project.fileVersions.get(filePath) ?? 0) + 1);
}

function definitionMessageFor(reason: PrepareFailure): string {
  switch (reason) {
    case "outside_root":
      return "Definition target is outside the Thread root.";
    case "unsupported_extension":
      return "Definition lookup is only available for TypeScript and JavaScript files.";
    case "missing_file":
      return "Definition source file was not found.";
  }
}

function referencesMessageFor(reason: PrepareFailure): string {
  switch (reason) {
    case "outside_root":
      // Mirrors the pre-persistent behavior: the boundary message came from
      // the shared resolver, worded for definitions.
      return "Definition target is outside the Thread root.";
    case "unsupported_extension":
      return "Reference lookup is only available for TypeScript and JavaScript files.";
    case "missing_file":
      return "Reference source file was not found.";
  }
}

function definitionError(message: string): WorkspaceCodeDefinitionResult {
  return {
    ok: false,
    error: { code: "workspace_code_definition_not_found", message },
  };
}

function referencesError(message: string): WorkspaceCodeReferencesResult {
  return {
    ok: false,
    error: { code: "workspace_code_references_not_found", message },
  };
}

function unavailableError(reason: PrepareFailure): {
  ok: false;
  error: { code: "workspace_code_intelligence_unavailable"; message: string };
} {
  const message =
    reason === "outside_root"
      ? "Query target is outside the Thread root."
      : reason === "missing_file"
        ? "Source file was not found."
        : "Language intelligence is only available for TypeScript and JavaScript files.";
  return {
    ok: false,
    error: { code: "workspace_code_intelligence_unavailable", message },
  };
}

function severityFor(category: ts.DiagnosticCategory): "error" | "warning" | "info" {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    default:
      return "info";
  }
}

function lineTextAt(text: string, line: number): string {
  const lines = text.split("\n");
  return (lines[line] ?? "").trim().slice(0, 200);
}

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    if (files.length >= MAX_SOURCE_FILES) {
      return;
    }
    let children;
    try {
      children = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (files.length >= MAX_SOURCE_FILES) {
        return;
      }
      const childPath = path.join(directory, child.name);
      if (child.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(child.name)) {
          visit(childPath);
        }
        continue;
      }
      if (child.isFile() && SOURCE_EXTENSIONS.has(path.extname(child.name))) {
        files.push(childPath);
      }
    }
  };
  visit(root);
  return files;
}

function lineCharacterToOffset(
  text: string,
  line: number,
  character: number,
): number | undefined {
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) {
    return undefined;
  }
  const lines = text.split("\n");
  if (line >= lines.length || character > lines[line].length) {
    return undefined;
  }
  let offset = character;
  for (let index = 0; index < line; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset;
}

function offsetToLineCharacter(
  text: string,
  offset: number,
): { line: number; character: number } {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < boundedOffset; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return {
    line,
    character: boundedOffset - lineStart,
  };
}

function safeReadText(fileName: string): string | undefined {
  try {
    return readFileSync(fileName, "utf8");
  } catch {
    return undefined;
  }
}

function resolveInsideRoot(
  rootInput: string,
  fileInput: string,
): { ok: true; root: string; path: string; relativePath: string } | { ok: false } {
  const root = path.resolve(rootInput);
  const candidate = path.isAbsolute(fileInput)
    ? path.resolve(fileInput)
    : path.resolve(root, fileInput);

  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return { ok: false };
  }

  return {
    ok: true,
    root,
    path: candidate,
    relativePath: path.relative(root, candidate) || ".",
  };
}
