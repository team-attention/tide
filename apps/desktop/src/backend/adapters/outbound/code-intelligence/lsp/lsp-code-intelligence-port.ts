// Generic LSP engine behind WorkspaceCodeIntelligencePort (spec:
// workbench-editor-language-intelligence). One stdio client per Thread root,
// created lazily and kept alive across queries; every query first syncs the
// live (possibly unsaved) buffer, then translates LSP shapes into the port
// contract. A server that fails to spawn or dies flips the whole engine into
// a permanent unavailable state — no respawn storms (spec invariant).
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  WorkspaceCodeCompletionItem,
  WorkspaceCodeCompletionsResult,
  WorkspaceCodeDefinitionResult,
  WorkspaceCodeDiagnostic,
  WorkspaceCodeDiagnosticsResult,
  WorkspaceCodeHighlightsResult,
  WorkspaceCodeHover,
  WorkspaceCodeHoverResult,
  WorkspaceCodeIntelligencePort,
  WorkspaceCodeLocation,
  WorkspaceCodeQueryInput,
  WorkspaceCodeRange,
  WorkspaceCodeReferencesResult,
  WorkspaceCodeSignatureHelpResult,
} from "../../../../application/ports/outbound/workspace-code-intelligence-port.ts";
import { LspClient } from "./lsp-client.ts";
import type { BackendOwnedProcessSpawner } from "../../../../infrastructure/node/process/backend-owned-process.ts";

export interface LspServerSpec {
  id: string;
  command: string;
  args: string[];
  extensions: string[];
  languageId: (extension: string) => string;
}

export const LSP_SERVER_REGISTRY: LspServerSpec[] = [
  {
    id: "rust-analyzer",
    command: "rust-analyzer",
    args: [],
    extensions: [".rs"],
    languageId: () => "rust",
  },
  {
    id: "gopls",
    command: "gopls",
    args: [],
    extensions: [".go"],
    languageId: () => "go",
  },
];

// Common install dirs that a GUI-launched Electron often misses from PATH.
const FALLBACK_BIN_DIRECTORIES = [
  path.join(os.homedir(), ".cargo", "bin"),
  path.join(os.homedir(), "go", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

export function resolveLspServerExecutable(spec: LspServerSpec): string | undefined {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((entry) => entry.length > 0);
  for (const directory of [...pathEntries, ...FALLBACK_BIN_DIRECTORIES]) {
    const candidate = path.join(directory, spec.command);
    try {
      if (!statSync(candidate).isFile()) {
        continue;
      }
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

const MAX_REFERENCES = 200;
const MAX_COMPLETIONS = 80;
const MAX_LABEL_LENGTH = 200;
const DIAGNOSTICS_WAIT_MS = 1_500;
const DIAGNOSTICS_POLL_MS = 100;

// LSP CompletionItemKind numbers → port kind names.
const COMPLETION_ITEM_KINDS: Record<number, string> = {
  1: "text",
  2: "method",
  3: "function",
  4: "constructor",
  5: "field",
  6: "variable",
  7: "class",
  8: "interface",
  9: "module",
  10: "property",
  11: "unit",
  12: "value",
  13: "enum",
  14: "keyword",
  15: "snippet",
  16: "color",
  17: "file",
  18: "reference",
  19: "folder",
  20: "enum-member",
  21: "constant",
  22: "struct",
  23: "event",
  24: "operator",
  25: "type-parameter",
};

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface LspLocation {
  uri: string;
  range: LspRange;
}

type PreparedQuery =
  | {
      ok: true;
      client: LspClient;
      root: string;
      uri: string;
      text: string;
      synced: boolean;
      generationBefore: number;
    }
  | { ok: false; message: string };

export function createLspCodeIntelligencePort(input: {
  spec: LspServerSpec;
  executable: string;
  processSpawner?: BackendOwnedProcessSpawner;
}): WorkspaceCodeIntelligencePort {
  return new LspCodeIntelligencePort(input.spec, input.executable, input.processSpawner);
}

class LspCodeIntelligencePort implements WorkspaceCodeIntelligencePort {
  private readonly spec: LspServerSpec;
  private readonly executable: string;
  private readonly processSpawner?: BackendOwnedProcessSpawner;
  // root → live client. A spawn failure or unexpected exit flips `failed` for
  // the backend lifetime — every later query degrades to a clean miss.
  private readonly clients = new Map<string, LspClient>();
  private failed = false;

  constructor(spec: LspServerSpec, executable: string, processSpawner?: BackendOwnedProcessSpawner) {
    this.spec = spec;
    this.executable = executable;
    this.processSpawner = processSpawner;
  }

  async findDefinition(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeDefinitionResult> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) {
      return {
        ok: false,
        error: { code: "workspace_code_definition_not_found", message: prepared.message },
      };
    }
    const result = await prepared.client.request("textDocument/definition", {
      textDocument: { uri: prepared.uri },
      position: { line: input.line, character: input.character },
    });
    for (const candidate of normalizeDefinitionTargets(result)) {
      const fsPath = uriToPath(candidate.uri);
      if (fsPath === undefined) {
        continue;
      }
      // Same boundary rule as the TS engine: targets outside the Thread root
      // are rejected, not surfaced.
      const target = resolveInsideRoot(prepared.root, fsPath);
      if (!target.ok) {
        continue;
      }
      return {
        ok: true,
        location: {
          root: target.root,
          path: target.path,
          relativePath: target.relativePath,
          line: candidate.range.start.line,
          character: candidate.range.start.character,
          length:
            candidate.range.end.line === candidate.range.start.line
              ? Math.max(0, candidate.range.end.character - candidate.range.start.character)
              : undefined,
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

  async findReferences(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeReferencesResult> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) {
      return {
        ok: false,
        error: { code: "workspace_code_references_not_found", message: prepared.message },
      };
    }
    const result = await prepared.client.request("textDocument/references", {
      textDocument: { uri: prepared.uri },
      position: { line: input.line, character: input.character },
      context: { includeDeclaration: true },
    });
    const entries = Array.isArray(result) ? result : [];
    const locations: WorkspaceCodeLocation[] = [];
    let truncated = false;
    const lineCache = new Map<string, string[]>();
    for (const entry of entries) {
      if (locations.length >= MAX_REFERENCES) {
        truncated = true;
        break;
      }
      if (!isLspLocation(entry)) {
        continue;
      }
      const fsPath = uriToPath(entry.uri);
      if (fsPath === undefined) {
        continue;
      }
      const target = resolveInsideRoot(prepared.root, fsPath);
      if (!target.ok) {
        continue;
      }
      locations.push({
        root: target.root,
        path: target.path,
        relativePath: target.relativePath,
        line: entry.range.start.line,
        character: entry.range.start.character,
        length:
          entry.range.end.line === entry.range.start.line
            ? Math.max(0, entry.range.end.character - entry.range.start.character)
            : undefined,
        label: this.lineLabel(prepared.client, lineCache, target.path, entry.range.start.line),
      });
    }
    if (locations.length === 0) {
      return {
        ok: false,
        error: {
          code: "workspace_code_references_not_found",
          message: "No references were found for the selected symbol.",
        },
      };
    }
    return { ok: true, locations, truncated };
  }

  async getCompletions(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeCompletionsResult> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) {
      return this.unavailable(prepared.message);
    }
    const result = await prepared.client.request("textDocument/completion", {
      textDocument: { uri: prepared.uri },
      position: { line: input.line, character: input.character },
    });
    const items = Array.isArray(result)
      ? result
      : isRecord(result) && Array.isArray(result.items)
        ? result.items
        : [];
    const completions: WorkspaceCodeCompletionItem[] = [];
    for (const item of items) {
      if (completions.length >= MAX_COMPLETIONS) {
        break;
      }
      if (!isRecord(item) || typeof item.label !== "string") {
        continue;
      }
      const completion: WorkspaceCodeCompletionItem = { label: item.label };
      const kind = typeof item.kind === "number" ? COMPLETION_ITEM_KINDS[item.kind] : undefined;
      if (kind !== undefined) {
        completion.kind = kind;
      }
      if (typeof item.detail === "string") {
        completion.detail = item.detail;
      }
      const editText =
        isRecord(item.textEdit) && typeof item.textEdit.newText === "string"
          ? item.textEdit.newText
          : undefined;
      completion.insertText =
        editText ?? (typeof item.insertText === "string" ? item.insertText : undefined) ?? item.label;
      if (typeof item.sortText === "string") {
        completion.sortText = item.sortText;
      }
      completions.push(completion);
    }
    return { ok: true, completions };
  }

  async getHover(input: WorkspaceCodeQueryInput): Promise<WorkspaceCodeHoverResult> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) {
      return this.unavailable(prepared.message);
    }
    const result = await prepared.client.request("textDocument/hover", {
      textDocument: { uri: prepared.uri },
      position: { line: input.line, character: input.character },
    });
    if (!isRecord(result)) {
      return { ok: true, hover: null };
    }
    const contents = hoverContentsToText(result.contents);
    if (contents === "") {
      return { ok: true, hover: null };
    }
    const hover: WorkspaceCodeHover = { contents };
    if (isLspRange(result.range)) {
      const range = convertRange(result.range, prepared.text);
      hover.line = range.line;
      hover.character = range.character;
      hover.length = range.length;
    }
    return { ok: true, hover };
  }

  async getDocumentHighlights(
    input: WorkspaceCodeQueryInput,
  ): Promise<WorkspaceCodeHighlightsResult> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) {
      return this.unavailable(prepared.message);
    }
    const result = await prepared.client.request("textDocument/documentHighlight", {
      textDocument: { uri: prepared.uri },
      position: { line: input.line, character: input.character },
    });
    const entries = Array.isArray(result) ? result : [];
    const highlights: WorkspaceCodeRange[] = [];
    for (const entry of entries) {
      if (!isRecord(entry) || !isLspRange(entry.range)) {
        continue;
      }
      const range = convertRange(entry.range, prepared.text);
      // LSP DocumentHighlightKind: 3 = Write; Text/Read both render as reads.
      highlights.push({ ...range, kind: entry.kind === 3 ? "write" : "read" });
    }
    return { ok: true, highlights };
  }

  async getSignatureHelp(
    input: WorkspaceCodeQueryInput,
  ): Promise<WorkspaceCodeSignatureHelpResult> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) {
      return this.unavailable(prepared.message);
    }
    const result = await prepared.client.request("textDocument/signatureHelp", {
      textDocument: { uri: prepared.uri },
      position: { line: input.line, character: input.character },
    });
    if (!isRecord(result) || !Array.isArray(result.signatures)) {
      return { ok: true, signature: null };
    }
    const signatures: Array<{ label: string; parameters: Array<{ label: string }> }> = [];
    for (const entry of result.signatures) {
      if (!isRecord(entry) || typeof entry.label !== "string") {
        continue;
      }
      const parameters: Array<{ label: string }> = [];
      if (Array.isArray(entry.parameters)) {
        for (const parameter of entry.parameters) {
          if (!isRecord(parameter)) {
            continue;
          }
          if (typeof parameter.label === "string") {
            parameters.push({ label: parameter.label });
            continue;
          }
          // LSP also allows [start, end] offsets into the signature label.
          if (
            Array.isArray(parameter.label) &&
            parameter.label.length === 2 &&
            typeof parameter.label[0] === "number" &&
            typeof parameter.label[1] === "number"
          ) {
            parameters.push({ label: entry.label.slice(parameter.label[0], parameter.label[1]) });
          }
        }
      }
      signatures.push({ label: entry.label, parameters });
    }
    if (signatures.length === 0) {
      return { ok: true, signature: null };
    }
    return {
      ok: true,
      signature: {
        signatures,
        activeSignature: typeof result.activeSignature === "number" ? result.activeSignature : 0,
        activeParameter: typeof result.activeParameter === "number" ? result.activeParameter : 0,
      },
    };
  }

  async getDiagnostics(
    input: Omit<WorkspaceCodeQueryInput, "line" | "character">,
  ): Promise<WorkspaceCodeDiagnosticsResult> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) {
      return this.unavailable(prepared.message);
    }
    // Diagnostics are push-based: give the server a bounded window to publish
    // for the sync we just sent, then return the latest cache regardless.
    const deadline = Date.now() + DIAGNOSTICS_WAIT_MS;
    while (Date.now() < deadline) {
      const generation = prepared.client.diagnosticsGeneration(prepared.uri);
      if (prepared.synced ? generation > prepared.generationBefore : generation > 0) {
        break;
      }
      await sleep(DIAGNOSTICS_POLL_MS);
    }
    const raw = prepared.client.getDiagnostics(prepared.uri) ?? [];
    const diagnostics: WorkspaceCodeDiagnostic[] = [];
    for (const entry of raw) {
      if (!isRecord(entry) || !isLspRange(entry.range) || typeof entry.message !== "string") {
        continue;
      }
      const range = convertRange(entry.range, prepared.text);
      diagnostics.push({
        line: range.line,
        character: range.character,
        length: range.length,
        message: entry.message,
        severity: entry.severity === 1 ? "error" : entry.severity === 2 ? "warning" : "info",
      });
    }
    return { ok: true, diagnostics };
  }

  async dispose(): Promise<void> {
    // Post-dispose queries must not respawn servers during backend teardown.
    this.failed = true;
    const clients = [...this.clients.values()];
    this.clients.clear();
    for (const client of clients) {
      await client.dispose();
    }
  }

  private async prepare(input: {
    root: string;
    path: string;
    content?: string;
  }): Promise<PreparedQuery> {
    const resolved = resolveInsideRoot(input.root, input.path);
    if (!resolved.ok) {
      return { ok: false, message: resolved.message };
    }
    // The live editor buffer overrides disk content for this file.
    const text = input.content ?? safeReadText(resolved.path);
    if (text === undefined) {
      return { ok: false, message: "Source file was not found." };
    }
    const client = await this.clientFor(resolved.root);
    if (client === undefined) {
      return {
        ok: false,
        message: `${this.spec.command} is not running — language intelligence for this file is off.`,
      };
    }
    const uri = pathToFileURL(resolved.path).href;
    const generationBefore = client.diagnosticsGeneration(uri);
    const languageId = this.spec.languageId(path.extname(resolved.path).toLowerCase());
    const synced = client.syncDocument(uri, languageId, text);
    return { ok: true, client, root: resolved.root, uri, text, synced, generationBefore };
  }

  private async clientFor(root: string): Promise<LspClient | undefined> {
    if (this.failed) {
      return undefined;
    }
    const existing = this.clients.get(root);
    if (existing !== undefined) {
      // ALWAYS gate on readiness — a concurrent first query may still be in
      // the initialize handshake, and didOpen before `initialized` is a
      // protocol violation servers may ignore or punish.
      const existingReady = await existing.whenReady();
      return existingReady && existing.isAlive() ? existing : undefined;
    }
    const client = new LspClient({
      executable: this.executable,
      args: this.spec.args,
      root,
      processSpawner: this.processSpawner,
      onUnexpectedExit: () => {
        this.markFailed();
      },
    });
    this.clients.set(root, client);
    const ready = await client.whenReady();
    if (!ready) {
      this.markFailed();
      return undefined;
    }
    return client;
  }

  // Flipping `failed` must also TEAR DOWN every live server — a slow-to-
  // initialize or half-dead rust-analyzer would otherwise keep running for the
  // whole backend lifetime while the engine never sends it another query.
  private markFailed(): void {
    if (this.failed) {
      return;
    }
    this.failed = true;
    for (const client of this.clients.values()) {
      void client.dispose();
    }
    this.clients.clear();
  }

  private unavailable(message: string): {
    ok: false;
    error: { code: "workspace_code_intelligence_unavailable"; message: string };
  } {
    return {
      ok: false,
      error: { code: "workspace_code_intelligence_unavailable", message },
    };
  }

  // Reference labels come from the synced overlay when the file is open, else
  // a cheap disk read; absent text simply yields no label.
  private lineLabel(
    client: LspClient,
    cache: Map<string, string[]>,
    fsPath: string,
    line: number,
  ): string | undefined {
    let lines = cache.get(fsPath);
    if (lines === undefined) {
      const text = client.documentText(pathToFileURL(fsPath).href) ?? safeReadText(fsPath);
      lines = text === undefined ? [] : text.split("\n");
      cache.set(fsPath, lines);
    }
    const lineText = lines[line];
    if (lineText === undefined) {
      return undefined;
    }
    const trimmed = lineText.trim().slice(0, MAX_LABEL_LENGTH);
    return trimmed === "" ? undefined : trimmed;
  }
}

function normalizeDefinitionTargets(result: unknown): LspLocation[] {
  // textDocument/definition may answer Location, Location[], or
  // LocationLink[] depending on the server.
  const raw = Array.isArray(result) ? result : result === null || result === undefined ? [] : [result];
  const targets: LspLocation[] = [];
  for (const entry of raw) {
    if (isLspLocation(entry)) {
      targets.push({ uri: entry.uri, range: entry.range });
      continue;
    }
    if (isRecord(entry) && typeof entry.targetUri === "string") {
      const range = isLspRange(entry.targetSelectionRange)
        ? entry.targetSelectionRange
        : isLspRange(entry.targetRange)
          ? entry.targetRange
          : undefined;
      if (range !== undefined) {
        targets.push({ uri: entry.targetUri, range });
      }
    }
  }
  return targets;
}

function hoverContentsToText(contents: unknown): string {
  // MarkupContent | MarkedString | MarkedString[] → plain text.
  const parts = Array.isArray(contents) ? contents : [contents];
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      if (part.trim() !== "") {
        texts.push(part);
      }
      continue;
    }
    if (isRecord(part) && typeof part.value === "string" && part.value.trim() !== "") {
      texts.push(part.value);
    }
  }
  return texts.join("\n\n").trim();
}

// The contract speaks in single-line {line, character, length} spans;
// multi-line LSP ranges clamp to the start line's remainder.
function convertRange(
  range: LspRange,
  documentText: string,
): { line: number; character: number; length: number } {
  if (range.end.line === range.start.line) {
    return {
      line: range.start.line,
      character: range.start.character,
      length: Math.max(0, range.end.character - range.start.character),
    };
  }
  const lineText = documentText.split("\n")[range.start.line] ?? "";
  return {
    line: range.start.line,
    character: range.start.character,
    length: Math.max(0, lineText.length - range.start.character),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLspPosition(value: unknown): value is LspPosition {
  return isRecord(value) && typeof value.line === "number" && typeof value.character === "number";
}

function isLspRange(value: unknown): value is LspRange {
  return isRecord(value) && isLspPosition(value.start) && isLspPosition(value.end);
}

function isLspLocation(value: unknown): value is LspLocation {
  return isRecord(value) && typeof value.uri === "string" && isLspRange(value.range);
}

function uriToPath(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function safeReadText(fileName: string): string | undefined {
  try {
    return readFileSync(fileName, "utf8");
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Same root-boundary rule as the TypeScript engine: anything outside the
// Thread root is a clean miss, never a surfaced location.
function resolveInsideRoot(
  rootInput: string,
  fileInput: string,
):
  | { ok: true; root: string; path: string; relativePath: string }
  | { ok: false; message: string } {
  const root = path.resolve(rootInput);
  const candidate = path.isAbsolute(fileInput)
    ? path.resolve(fileInput)
    : path.resolve(root, fileInput);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return { ok: false, message: "Target is outside the Thread root." };
  }
  return {
    ok: true,
    root,
    path: candidate,
    relativePath: path.relative(root, candidate) || ".",
  };
}
