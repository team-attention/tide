// Spec: docs_v2/specs/workbench-editor-language-intelligence.md — generic LSP
// stdio engine. A scripted fake LSP server (spawned as a node child) exercises
// Content-Length framing under split AND merged chunks, the initialize
// handshake, didOpen/didChange document sync, the publishDiagnostics cache,
// server-initiated requests, the root boundary, and child reaping — with no
// real language server installed.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LSP_SERVER_REGISTRY,
  createLspCodeIntelligencePort,
  resolveLspServerExecutable,
  type LspServerSpec,
} from "../src/backend/adapters/outbound/code-intelligence/lsp/lsp-code-intelligence-port.ts";
import type { WorkspaceCodeIntelligencePort } from "../src/backend/application/ports/outbound/workspace-code-intelligence-port.ts";

// The fake answers every request with the response split into two stdout
// chunks (and merges a notification frame into the initialize response write)
// so a client that cannot reassemble split frames or peel merged frames never
// completes the handshake. The first hover is answered only after the client
// replies to the server-initiated client/registerCapability request — a
// client that ignores server requests times out there. Hover responses embed
// the synced document state (version/text) so tests can observe didOpen v1
// and didChange v2 through the port surface alone.
const FAKE_SERVER_SOURCE = String.raw`
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let buffer = Buffer.alloc(0);
let rootUri = "";
let registerAcked = false;
let pendingHovers = [];
const docs = new Map();

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n"), body]);
}

function writeSplit(buffers) {
  const full = Buffer.concat(buffers);
  const half = Math.ceil(full.length / 2);
  process.stdout.write(full.subarray(0, half));
  setTimeout(() => { process.stdout.write(full.subarray(half)); }, 5);
}

function respond(id, result) {
  writeSplit([frame({ jsonrpc: "2.0", id: id, result: result })]);
}

function range(startLine, startCharacter, endLine, endCharacter) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

function pushDiagnostics(uri, version) {
  process.stdout.write(frame({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri: uri,
      diagnostics: [{
        range: range(0, 0, 0, 2),
        severity: version > 1 ? 2 : 1,
        message: "diag v" + version,
      }],
    },
  }));
}

function answerHover(id, uri) {
  const doc = docs.get(uri);
  respond(id, {
    contents: {
      kind: "markdown",
      value: JSON.stringify({
        version: doc ? doc.version : 0,
        text: doc ? doc.text : "",
        acked: registerAcked,
      }),
    },
    range: range(0, 3, 0, 8),
  });
}

function handle(message) {
  const id = message.id;
  const method = message.method;
  const params = message.params;
  if (method === undefined) {
    // Response from the client to our server-initiated request.
    if (id === 9001) {
      registerAcked = true;
      const queued = pendingHovers;
      pendingHovers = [];
      for (const item of queued) { answerHover(item.id, item.uri); }
    }
    return;
  }
  if (method === "initialize") {
    rootUri = params.rootUri;
    writeFileSync(path.join(fileURLToPath(rootUri), "fake-lsp.pid"), String(process.pid), "utf8");
    // Merged frames: a notification and the response in one write, then split.
    writeSplit([
      frame({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 3, message: "hello" } }),
      frame({ jsonrpc: "2.0", id: id, result: { capabilities: { textDocumentSync: 1 } } }),
    ]);
    return;
  }
  if (method === "initialized") {
    process.stdout.write(frame({
      jsonrpc: "2.0",
      id: 9001,
      method: "client/registerCapability",
      params: { registrations: [] },
    }));
    return;
  }
  if (method === "textDocument/didOpen") {
    const document = params.textDocument;
    docs.set(document.uri, { version: document.version, text: document.text });
    pushDiagnostics(document.uri, document.version);
    return;
  }
  if (method === "textDocument/didChange") {
    const document = params.textDocument;
    docs.set(document.uri, { version: document.version, text: params.contentChanges[0].text });
    pushDiagnostics(document.uri, document.version);
    return;
  }
  if (method === "textDocument/hover") {
    if (!registerAcked) {
      pendingHovers.push({ id: id, uri: params.textDocument.uri });
      return;
    }
    answerHover(id, params.textDocument.uri);
    return;
  }
  if (method === "textDocument/definition") {
    if (params.position.line >= 50) {
      // Sentinel: a bare Location outside the workspace root.
      respond(id, { uri: "file:///definitely-outside/escape.rs", range: range(0, 0, 0, 4) });
    } else {
      // LocationLink[] flavor, inside the root.
      respond(id, [{
        targetUri: rootUri + "/lib.rs",
        targetRange: range(0, 0, 4, 0),
        targetSelectionRange: range(2, 4, 2, 9),
      }]);
    }
    return;
  }
  if (method === "textDocument/references") {
    const uri = params.textDocument.uri;
    respond(id, [
      { uri: uri, range: range(0, 3, 0, 8) },
      { uri: uri, range: range(2, 4, 2, 9) },
      { uri: "file:///definitely-outside/escape.rs", range: range(0, 0, 0, 4) },
    ]);
    return;
  }
  if (method === "textDocument/completion") {
    respond(id, {
      isIncomplete: false,
      items: [
        { label: "alpha", kind: 3, detail: "fn alpha()", insertText: "alpha()", sortText: "0001" },
        { label: "beta", kind: 6, textEdit: { range: range(0, 0, 0, 0), newText: "beta_edit" } },
      ],
    });
    return;
  }
  if (method === "textDocument/documentHighlight") {
    respond(id, [
      { range: range(0, 3, 0, 8), kind: 3 },
      { range: range(2, 4, 3, 2), kind: 2 },
    ]);
    return;
  }
  if (method === "textDocument/signatureHelp") {
    respond(id, {
      signatures: [{
        label: "fn add(a: i32, b: i32)",
        parameters: [{ label: "a: i32" }, { label: [15, 21] }],
      }],
      activeSignature: 0,
      activeParameter: 1,
    });
    return;
  }
  if (method === "shutdown") {
    respond(id, null);
    return;
  }
  if (method === "exit") {
    process.exit(0);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) { return; }
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (match === null) { buffer = buffer.subarray(headerEnd + 4); continue; }
    const length = Number(match[1]);
    if (buffer.length < headerEnd + 4 + length) { return; }
    const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
    buffer = buffer.subarray(headerEnd + 4 + length);
    handle(JSON.parse(body));
  }
});
process.stdin.on("end", () => process.exit(0));
`;

// Known fixture content the fake's reference/highlight ranges line up with.
const MAIN_RS = [
  "fn helper() {}",
  "",
  "fn main() {",
  "    helper();",
  "}",
  "",
].join("\n");

function setup(): { root: string; port: WorkspaceCodeIntelligencePort } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-lsp-"));
  fs.writeFileSync(path.join(root, "main.rs"), MAIN_RS, "utf8");
  fs.writeFileSync(path.join(root, "lib.rs"), "fn lib_helper() {}\n", "utf8");
  const serverPath = path.join(root, "fake-lsp-server.mjs");
  fs.writeFileSync(serverPath, FAKE_SERVER_SOURCE, "utf8");
  const spec: LspServerSpec = {
    id: "fake-lsp",
    command: "fake-lsp",
    args: [serverPath],
    extensions: [".rs"],
    languageId: () => "rust",
  };
  return { root, port: createLspCodeIntelligencePort({ spec, executable: process.execPath }) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("lsp_port_definition_round_trips_location_links_under_split_and_merged_framing", async () => {
  const { root, port } = setup();
  try {
    const result = await port.findDefinition({ root, path: "main.rs", line: 3, character: 4 });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.location.relativePath, "lib.rs");
    assert.equal(result.location.line, 2);
    assert.equal(result.location.character, 4);
    assert.equal(result.location.length, 5);
  } finally {
    await port.dispose?.();
  }
});

test("lsp_port_references_filter_to_root_and_carry_line_labels", async () => {
  const { root, port } = setup();
  try {
    const result = await port.findReferences({ root, path: "main.rs", line: 3, character: 4 });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    // The fake returns 3 locations; the out-of-root one must be dropped.
    assert.equal(result.locations.length, 2);
    assert.equal(result.truncated, false);
    assert.deepEqual(
      result.locations.map((location) => location.label),
      ["fn helper() {}", "fn main() {"],
    );
    assert.deepEqual(
      result.locations.map((location) => [location.line, location.character, location.length]),
      [[0, 3, 5], [2, 4, 5]],
    );
  } finally {
    await port.dispose?.();
  }
});

test("lsp_port_hover_returns_plain_text_and_overlay_content_drives_didchange_v2", async () => {
  const { root, port } = setup();
  try {
    // First query: didOpen with the on-disk text, version 1. The fake answers
    // hover only after the client acked client/registerCapability, so a
    // client that drops server-initiated requests fails here.
    const first = await port.getHover({ root, path: "main.rs", line: 0, character: 4 });
    assert.equal(first.ok, true);
    if (!first.ok) {
      return;
    }
    assert.notEqual(first.hover, null);
    const firstState = JSON.parse(first.hover!.contents) as {
      version: number;
      text: string;
      acked: boolean;
    };
    assert.equal(firstState.version, 1);
    assert.equal(firstState.text, MAIN_RS);
    assert.equal(firstState.acked, true);
    assert.equal(first.hover!.line, 0);
    assert.equal(first.hover!.character, 3);
    assert.equal(first.hover!.length, 5);

    // Overlay content overrides disk → didChange bumps to version 2.
    const overlay = MAIN_RS.replace("fn helper() {}", "fn helper() { 1; }");
    const second = await port.getHover({
      root,
      path: "main.rs",
      line: 0,
      character: 4,
      content: overlay,
    });
    assert.equal(second.ok, true);
    if (!second.ok) {
      return;
    }
    const secondState = JSON.parse(second.hover!.contents) as { version: number; text: string };
    assert.equal(secondState.version, 2);
    assert.equal(secondState.text, overlay);

    // Same overlay again: no spurious didChange, version stays 2.
    const third = await port.getHover({
      root,
      path: "main.rs",
      line: 0,
      character: 4,
      content: overlay,
    });
    assert.equal(third.ok, true);
    if (!third.ok) {
      return;
    }
    const thirdState = JSON.parse(third.hover!.contents) as { version: number };
    assert.equal(thirdState.version, 2);
  } finally {
    await port.dispose?.();
  }
});

test("lsp_port_completions_map_kind_names_and_text_edit_insert_text", async () => {
  const { root, port } = setup();
  try {
    const result = await port.getCompletions({ root, path: "main.rs", line: 3, character: 4 });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepEqual(result.completions, [
      {
        label: "alpha",
        kind: "function",
        detail: "fn alpha()",
        insertText: "alpha()",
        sortText: "0001",
      },
      // textEdit.newText wins over label when insertText is absent.
      { label: "beta", kind: "variable", insertText: "beta_edit" },
    ]);
  } finally {
    await port.dispose?.();
  }
});

test("lsp_port_document_highlights_convert_ranges_and_clamp_multiline", async () => {
  const { root, port } = setup();
  try {
    const result = await port.getDocumentHighlights({
      root,
      path: "main.rs",
      line: 3,
      character: 4,
    });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    // Second range spans lines 2→3: clamp to line 2's remainder
    // ("fn main() {".length 11 − character 4 = 7).
    assert.deepEqual(result.highlights, [
      { line: 0, character: 3, length: 5, kind: "write" },
      { line: 2, character: 4, length: 7, kind: "read" },
    ]);
  } finally {
    await port.dispose?.();
  }
});

test("lsp_port_signature_help_resolves_offset_parameter_labels", async () => {
  const { root, port } = setup();
  try {
    const result = await port.getSignatureHelp({ root, path: "main.rs", line: 3, character: 11 });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.notEqual(result.signature, null);
    assert.equal(result.signature!.signatures.length, 1);
    assert.equal(result.signature!.signatures[0].label, "fn add(a: i32, b: i32)");
    assert.deepEqual(
      result.signature!.signatures[0].parameters.map((parameter) => parameter.label),
      ["a: i32", "b: i32"],
    );
    assert.equal(result.signature!.activeSignature, 0);
    assert.equal(result.signature!.activeParameter, 1);
  } finally {
    await port.dispose?.();
  }
});

test("lsp_port_diagnostics_return_pushed_cache_and_refresh_after_overlay_sync", async () => {
  const { root, port } = setup();
  try {
    // didOpen v1 → fake pushes severity 1.
    const first = await port.getDiagnostics({ root, path: "main.rs" });
    assert.equal(first.ok, true);
    if (!first.ok) {
      return;
    }
    assert.deepEqual(first.diagnostics, [
      { line: 0, character: 0, length: 2, message: "diag v1", severity: "error" },
    ]);

    // Overlay → didChange v2 → fake pushes severity 2 for the new version.
    const second = await port.getDiagnostics({
      root,
      path: "main.rs",
      content: `${MAIN_RS}// dirty\n`,
    });
    assert.equal(second.ok, true);
    if (!second.ok) {
      return;
    }
    assert.deepEqual(second.diagnostics, [
      { line: 0, character: 0, length: 2, message: "diag v2", severity: "warning" },
    ]);
  } finally {
    await port.dispose?.();
  }
});

test("lsp_port_rejects_definition_targets_outside_the_root", async () => {
  const { root, port } = setup();
  try {
    // Line 99 is the fake's sentinel for an out-of-root Location answer.
    const result = await port.findDefinition({ root, path: "main.rs", line: 99, character: 0 });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.error.code, "workspace_code_definition_not_found");
  } finally {
    await port.dispose?.();
  }
});

test("lsp_port_dispose_kills_the_server_child", async () => {
  const { root, port } = setup();
  const warmup = await port.getHover({ root, path: "main.rs", line: 0, character: 4 });
  assert.equal(warmup.ok, true);
  const pid = Number(fs.readFileSync(path.join(root, "fake-lsp.pid"), "utf8"));
  assert.ok(Number.isInteger(pid) && pid > 0);

  await port.dispose?.();

  // No orphans (memory note v2-agy-process-leak): the child must be gone
  // within 2s of dispose.
  const deadline = Date.now() + 2_000;
  let gone = false;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      gone = true;
      break;
    }
    await sleep(50);
  }
  assert.equal(gone, true, `fake LSP server pid ${pid} survived dispose`);
});

test("lsp_port_flips_permanently_unavailable_when_the_server_cannot_spawn", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-lsp-"));
  fs.writeFileSync(path.join(root, "main.rs"), MAIN_RS, "utf8");
  const spec: LspServerSpec = {
    id: "fake-lsp",
    command: "fake-lsp",
    args: [],
    extensions: [".rs"],
    languageId: () => "rust",
  };
  const port = createLspCodeIntelligencePort({
    spec,
    executable: path.join(root, "no-such-binary"),
  });
  try {
    const hover = await port.getHover({ root, path: "main.rs", line: 0, character: 4 });
    assert.equal(hover.ok, false);
    if (hover.ok) {
      return;
    }
    assert.equal(hover.error.code, "workspace_code_intelligence_unavailable");

    // Definition/references degrade with their own not_found codes — and the
    // failure is remembered, so this resolves without another spawn attempt.
    const definition = await port.findDefinition({ root, path: "main.rs", line: 3, character: 4 });
    assert.equal(definition.ok, false);
    if (definition.ok) {
      return;
    }
    assert.equal(definition.error.code, "workspace_code_definition_not_found");
  } finally {
    await port.dispose?.();
  }
});

// A rustup shim can sit on PATH with the actual component missing; it spawns
// fine and immediately exits with an error, which the engine treats as a
// clean permanent miss. Live smokes must skip that case, not fail on it.
function executableActuallyRuns(executable: string, probeArgs: string[]): boolean {
  try {
    execFileSync(executable, probeArgs, { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

// Gated live smoke: a real rust-analyzer against a MINIMAL CARGO PROJECT —
// rust-analyzer does not analyze detached .rs files outside a Cargo workspace,
// so the fixture must carry a Cargo.toml. Not part of the default suite
// (TIDE_LSP_LIVE=1 to enable); skips silently when rust-analyzer is missing.
test(
  "lsp_live_rust_analyzer_finds_helper_definition",
  { skip: process.env.TIDE_LSP_LIVE !== "1", timeout: 60_000 },
  async (t) => {
    const spec = LSP_SERVER_REGISTRY.find((candidate) => candidate.id === "rust-analyzer");
    assert.ok(spec !== undefined);
    const executable = resolveLspServerExecutable(spec);
    if (executable === undefined || !executableActuallyRuns(executable, ["--version"])) {
      t.skip("rust-analyzer is not installed");
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-lsp-live-"));
    fs.writeFileSync(
      path.join(root, "Cargo.toml"),
      ['[package]', 'name = "tide-lsp-probe"', 'version = "0.1.0"', 'edition = "2021"', ""].join("\n"),
      "utf8",
    );
    fs.mkdirSync(path.join(root, "src"));
    const source = [
      "fn helper() -> i32 {",
      "    7",
      "}",
      "",
      "fn main() {",
      "    let value = helper();",
      "    let _ = value;",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(root, "src", "main.rs"), source, "utf8");
    const port = createLspCodeIntelligencePort({ spec, executable });
    try {
      // rust-analyzer indexes asynchronously; retry until it answers or the
      // generous deadline passes.
      const deadline = Date.now() + 30_000;
      let result = await port.findDefinition({ root, path: "src/main.rs", line: 5, character: 16 });
      while (!result.ok && Date.now() < deadline) {
        await sleep(1_000);
        result = await port.findDefinition({ root, path: "src/main.rs", line: 5, character: 16 });
      }
      assert.equal(result.ok, true);
      if (!result.ok) {
        return;
      }
      assert.equal(result.location.relativePath, "src/main.rs");
      assert.equal(result.location.line, 0);
    } finally {
      await port.dispose?.();
    }
  },
);

// Same gated live smoke against gopls — second registry entry, same generic
// engine, so a pass here covers the LSP path even when rust-analyzer is a
// broken rustup shim on the host.
test(
  "lsp_live_gopls_finds_helper_definition",
  { skip: process.env.TIDE_LSP_LIVE !== "1", timeout: 60_000 },
  async (t) => {
    const spec = LSP_SERVER_REGISTRY.find((candidate) => candidate.id === "gopls");
    assert.ok(spec !== undefined);
    const executable = resolveLspServerExecutable(spec);
    // gopls has no --version flag; "version" is a subcommand.
    if (executable === undefined || !executableActuallyRuns(executable, ["version"])) {
      t.skip("gopls is not installed");
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-lsp-live-go-"));
    const source = [
      "package main",
      "",
      "func helper() int {",
      "\treturn 7",
      "}",
      "",
      "func main() {",
      "\tvalue := helper()",
      "\t_ = value",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(root, "main.go"), source, "utf8");
    fs.writeFileSync(path.join(root, "go.mod"), "module tide.local/lspsmoke\n\ngo 1.21\n", "utf8");
    const port = createLspCodeIntelligencePort({ spec, executable });
    try {
      const deadline = Date.now() + 30_000;
      // "helper" call site: line 7, character 10 (after a tab + "value := ").
      let result = await port.findDefinition({ root, path: "main.go", line: 7, character: 10 });
      while (!result.ok && Date.now() < deadline) {
        await sleep(1_000);
        result = await port.findDefinition({ root, path: "main.go", line: 7, character: 10 });
      }
      assert.equal(result.ok, true);
      if (!result.ok) {
        return;
      }
      assert.equal(result.location.relativePath, "main.go");
      assert.equal(result.location.line, 2);
    } finally {
      await port.dispose?.();
    }
  },
);
