import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import * as ts from "typescript";

import type {
  WorkspaceCodeDefinitionResult,
  WorkspaceCodeIntelligencePort,
  WorkspaceCodeLocation,
  WorkspaceCodeReferencesResult,
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

export function createTypeScriptCodeIntelligencePort(): WorkspaceCodeIntelligencePort {
  return new TypeScriptCodeIntelligencePort();
}

class TypeScriptCodeIntelligencePort implements WorkspaceCodeIntelligencePort {
  async findDefinition(input: {
    root: string;
    path: string;
    line: number;
    character: number;
  }): Promise<WorkspaceCodeDefinitionResult> {
    const resolved = resolveInsideRoot(input.root, input.path);
    if (!resolved.ok) {
      return resolved;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(resolved.path))) {
      return {
        ok: false,
        error: {
          code: "workspace_code_definition_not_found",
          message: "Definition lookup is only available for TypeScript and JavaScript files.",
        },
      };
    }
    if (!existsSync(resolved.path) || !statSync(resolved.path).isFile()) {
      return {
        ok: false,
        error: {
          code: "workspace_code_definition_not_found",
          message: "Definition source file was not found.",
        },
      };
    }

    const sourceFiles = collectSourceFiles(resolved.root);
    if (!sourceFiles.includes(resolved.path)) {
      sourceFiles.push(resolved.path);
    }
    const host = createLanguageServiceHost(resolved.root, sourceFiles);
    const service = ts.createLanguageService(host);
    const sourceText = readFileSync(resolved.path, "utf8");
    const offset = lineCharacterToOffset(sourceText, input.line, input.character);
    if (offset === undefined) {
      service.dispose();
      return {
        ok: false,
        error: {
          code: "workspace_code_definition_not_found",
          message: "Definition source position is outside the file.",
        },
      };
    }

    const definitions = service.getDefinitionAtPosition(resolved.path, offset) ?? [];
    const program = service.getProgram();
    service.dispose();
    for (const definition of definitions) {
      const target = resolveInsideRoot(resolved.root, definition.fileName);
      if (!target.ok) {
        continue;
      }
      const sourceFile = program?.getSourceFile(definition.fileName);
      const targetText = sourceFile?.text ?? safeReadText(definition.fileName);
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

    return {
      ok: false,
      error: {
        code: "workspace_code_definition_not_found",
        message: "Definition target was not found.",
      },
    };
  }

  async findReferences(input: {
    root: string;
    path: string;
    line: number;
    character: number;
  }): Promise<WorkspaceCodeReferencesResult> {
    const resolved = resolveInsideRoot(input.root, input.path);
    if (!resolved.ok) {
      return referencesError(resolved.error.message);
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(resolved.path))) {
      return referencesError(
        "Reference lookup is only available for TypeScript and JavaScript files.",
      );
    }
    if (!existsSync(resolved.path) || !statSync(resolved.path).isFile()) {
      return referencesError("Reference source file was not found.");
    }

    const sourceFiles = collectSourceFiles(resolved.root);
    if (!sourceFiles.includes(resolved.path)) {
      sourceFiles.push(resolved.path);
    }
    const host = createLanguageServiceHost(resolved.root, sourceFiles);
    const service = ts.createLanguageService(host);
    const sourceText = readFileSync(resolved.path, "utf8");
    const offset = lineCharacterToOffset(sourceText, input.line, input.character);
    if (offset === undefined) {
      service.dispose();
      return referencesError("Reference source position is outside the file.");
    }

    const entries = service.getReferencesAtPosition(resolved.path, offset) ?? [];
    const program = service.getProgram();
    const locations: WorkspaceCodeLocation[] = [];
    let truncated = false;
    for (const entry of entries) {
      if (locations.length >= MAX_REFERENCES) {
        truncated = true;
        break;
      }
      const target = resolveInsideRoot(resolved.root, entry.fileName);
      if (!target.ok) {
        continue;
      }
      const sourceFile = program?.getSourceFile(entry.fileName);
      const targetText = sourceFile?.text ?? safeReadText(entry.fileName);
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
    service.dispose();

    if (locations.length === 0) {
      return referencesError("No references were found for the selected symbol.");
    }
    return { ok: true, locations, truncated };
  }
}

function referencesError(message: string): WorkspaceCodeReferencesResult {
  return {
    ok: false,
    error: { code: "workspace_code_references_not_found", message },
  };
}

function lineTextAt(text: string, line: number): string {
  const lines = text.split("\n");
  return (lines[line] ?? "").trim().slice(0, 200);
}

function createLanguageServiceHost(
  root: string,
  sourceFiles: string[],
): ts.LanguageServiceHost {
  return {
    getCompilationSettings: () => ({
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
    }),
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => sourceFiles,
    getScriptSnapshot: (fileName) => {
      const text = safeReadText(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getScriptVersion: () => "0",
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
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
):
  | { ok: true; root: string; path: string; relativePath: string }
  | {
      ok: false;
      error: {
        code: "workspace_code_definition_not_found";
        message: string;
      };
    } {
  const root = path.resolve(rootInput);
  const candidate = path.isAbsolute(fileInput)
    ? path.resolve(fileInput)
    : path.resolve(root, fileInput);

  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return {
      ok: false,
      error: {
        code: "workspace_code_definition_not_found",
        message: "Definition target is outside the Thread root.",
      },
    };
  }

  return {
    ok: true,
    root,
    path: candidate,
    relativePath: path.relative(root, candidate) || ".",
  };
}
