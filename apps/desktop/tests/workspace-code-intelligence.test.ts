// Persistent TypeScript engine behind WorkspaceCodeIntelligencePort (spec:
// workbench-editor-language-intelligence). One shared port instance across all
// tests on a real temp-dir fixture project — the persistence across queries is
// itself part of what's under test.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import { createTypeScriptCodeIntelligencePort } from "../src/backend/adapters/outbound/code-intelligence/typescript-code-intelligence-port.ts";

const UTIL_SOURCE = `export function add(first: number, second: number): number {
  return first + second;
}

export const greeting = "hello";

export function tally(values: number[]): number {
  let sum = 0;
  for (const value of values) {
    sum = sum + value;
  }
  return sum;
}
`;

// NodeNext resolution maps the ".js" specifier onto util.ts, keeping the
// on-disk fixture diagnostics-clean.
const MAIN_SOURCE = `import { add, greeting } from "./util.js";

export const total = add(1, 2);
export const upper = greeting.toUpperCase();
`;

const root = mkdtempSync(path.join(os.tmpdir(), "tide-code-intel-"));
const utilPath = path.join(root, "util.ts");
const mainPath = path.join(root, "main.ts");
writeFileSync(utilPath, UTIL_SOURCE);
writeFileSync(mainPath, MAIN_SOURCE);

const port = createTypeScriptCodeIntelligencePort();

after(async () => {
  await port.dispose?.();
  rmSync(root, { recursive: true, force: true });
});

// 0-based line/character of the nth occurrence of `needle` in `text`.
function positionOf(
  text: string,
  needle: string,
  occurrence = 0,
): { line: number; character: number } {
  let offset = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = text.indexOf(needle, offset + 1);
    assert.notEqual(offset, -1, `fixture is missing occurrence ${occurrence} of ${needle}`);
  }
  const before = text.slice(0, offset).split("\n");
  return { line: before.length - 1, character: before[before.length - 1].length };
}

test("completions at a member access include the member symbols", async () => {
  const position = positionOf(MAIN_SOURCE, "toUpperCase");
  const result = await port.getCompletions({ root, path: mainPath, ...position });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.completions.length <= 80, true);
  const labels = result.ok ? result.completions.map((entry) => entry.label) : [];
  assert.equal(labels.includes("toUpperCase"), true);
});

test("completions reflect the dirty-buffer overlay without touching disk", async () => {
  const overlay = `${MAIN_SOURCE}\nconst freshLocalSymbol = 1;\nfreshLocalSymbol;\n`;
  const usage = positionOf(overlay, "freshLocalSymbol;");
  const result = await port.getCompletions({
    root,
    path: mainPath,
    content: overlay,
    line: usage.line,
    character: usage.character + "freshLo".length,
  });
  assert.equal(result.ok, true);
  const labels = result.ok ? result.completions.map((entry) => entry.label) : [];
  assert.equal(labels.includes("freshLocalSymbol"), true);
  assert.equal(readFileSync(mainPath, "utf8"), MAIN_SOURCE);
});

test("hover on a const reports its inferred type", async () => {
  const position = positionOf(MAIN_SOURCE, "total");
  const result = await port.getHover({ root, path: mainPath, ...position });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.hover !== null, true);
  if (result.ok && result.hover !== null) {
    assert.match(result.hover.contents, /const total: number/);
    assert.equal(result.hover.line, position.line);
    assert.equal(result.hover.length, "total".length);
  }
});

test("document highlights cover every occurrence with read/write kinds", async () => {
  const position = positionOf(UTIL_SOURCE, "sum");
  const result = await port.getDocumentHighlights({ root, path: utilPath, ...position });
  assert.equal(result.ok, true);
  if (result.ok) {
    // let sum = 0 (write), sum = sum + value (write + read), return sum (read).
    assert.equal(result.highlights.length, 4);
    const kinds = result.highlights.map((highlight) => highlight.kind);
    assert.equal(kinds.filter((kind) => kind === "write").length, 2);
    assert.equal(kinds.filter((kind) => kind === "read").length, 2);
    for (const highlight of result.highlights) {
      assert.equal(highlight.length, "sum".length);
    }
  }
});

test("signature help inside a call reports parameters and the active one", async () => {
  const firstArgument = positionOf(MAIN_SOURCE, "1, 2");
  const atFirst = await port.getSignatureHelp({ root, path: mainPath, ...firstArgument });
  assert.equal(atFirst.ok, true);
  assert.equal(atFirst.ok && atFirst.signature !== null, true);
  if (atFirst.ok && atFirst.signature !== null) {
    const signature = atFirst.signature.signatures[atFirst.signature.activeSignature];
    assert.match(signature.label, /add\(first: number, second: number\): number/);
    assert.deepEqual(
      signature.parameters.map((parameter) => parameter.label),
      ["first: number", "second: number"],
    );
    assert.equal(atFirst.signature.activeParameter, 0);
  }

  const secondArgument = positionOf(MAIN_SOURCE, "2)");
  const atSecond = await port.getSignatureHelp({ root, path: mainPath, ...secondArgument });
  assert.equal(atSecond.ok && atSecond.signature?.activeParameter, 1);
});

test("diagnostics flag an overlay type error and stay empty for clean disk", async () => {
  const clean = await port.getDiagnostics({ root, path: mainPath });
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.ok ? clean.diagnostics : undefined, []);

  const overlay = `${MAIN_SOURCE}\nconst wrong: number = "text";\n`;
  const broken = await port.getDiagnostics({ root, path: mainPath, content: overlay });
  assert.equal(broken.ok, true);
  if (broken.ok) {
    assert.equal(broken.diagnostics.length >= 1, true);
    const mismatch = broken.diagnostics.find((diagnostic) =>
      diagnostic.message.includes("not assignable"),
    );
    assert.notEqual(mismatch, undefined);
    assert.equal(mismatch?.severity, "error");
    assert.equal(mismatch?.line, positionOf(overlay, "wrong").line);
  }
});

test("cross-file definition resolves the imported symbol", async () => {
  const callSite = positionOf(MAIN_SOURCE, "add(1");
  const result = await port.findDefinition({ root, path: mainPath, ...callSite });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.location.path, utilPath);
    assert.equal(result.location.relativePath, "util.ts");
    assert.equal(result.location.label, "add");
    assert.equal(result.location.line, positionOf(UTIL_SOURCE, "add").line);
  }
});

test("references find use sites across files", async () => {
  const declaration = positionOf(UTIL_SOURCE, "greeting");
  const result = await port.findReferences({ root, path: utilPath, ...declaration });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.truncated, false);
    assert.equal(result.locations.length >= 2, true);
    assert.equal(result.locations.some((location) => location.path === mainPath), true);
    assert.equal(result.locations.some((location) => location.path === utilPath), true);
  }
});

test("the persistent service answers repeat queries and isolates overlays", async () => {
  // Same query twice against the same root: the second answer must be just as
  // correct (the service is reused, not rebuilt from a clean slate).
  const position = positionOf(MAIN_SOURCE, "total");
  for (let round = 0; round < 2; round += 1) {
    const result = await port.getHover({ root, path: mainPath, ...position });
    assert.equal(result.ok && result.hover !== null, true);
    if (result.ok && result.hover !== null) {
      assert.match(result.hover.contents, /const total: number/);
    }
  }

  // Overlay applies for the query that carries it…
  const overlay = `${MAIN_SOURCE}\nconst wrong: number = "text";\n`;
  const withOverlay = await port.getDiagnostics({ root, path: mainPath, content: overlay });
  assert.equal(withOverlay.ok && withOverlay.diagnostics.length >= 1, true);

  // …and the next query WITHOUT content sees the on-disk text again.
  const withoutOverlay = await port.getDiagnostics({ root, path: mainPath });
  assert.equal(withoutOverlay.ok, true);
  assert.deepEqual(withoutOverlay.ok ? withoutOverlay.diagnostics : undefined, []);
});

test("non-TypeScript extensions get a clean unavailable error", async () => {
  const result = await port.getHover({ root, path: path.join(root, "notes.md"), line: 0, character: 0 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "workspace_code_intelligence_unavailable");
    assert.match(result.error.message, /TypeScript and JavaScript files\.$/);
  }
});

test("a root tsconfig drives diagnostics (ts-extension imports stay clean)", async () => {
  // Tide's own repo style: explicit .ts import specifiers, legal only with
  // allowImportingTsExtensions — hardcoded compiler options flagged TS5097 on
  // every import line of a real project.
  const configuredRoot = mkdtempSync(path.join(os.tmpdir(), "tide-code-intel-cfg-"));
  try {
    writeFileSync(
      path.join(configuredRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          allowImportingTsExtensions: true,
          noEmit: true,
        },
      }),
    );
    writeFileSync(path.join(configuredRoot, "util.ts"), UTIL_SOURCE);
    writeFileSync(
      path.join(configuredRoot, "main.ts"),
      'import { add } from "./util.ts";\n\nexport const total = add(1, 2);\n',
    );
    const configuredPort = createTypeScriptCodeIntelligencePort();
    try {
      const result = await configuredPort.getDiagnostics({
        root: configuredRoot,
        path: path.join(configuredRoot, "main.ts"),
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.ok ? result.diagnostics : undefined, []);
    } finally {
      await configuredPort.dispose?.();
    }
  } finally {
    rmSync(configuredRoot, { recursive: true, force: true });
  }
});

test("a SUB-PACKAGE tsconfig drives diagnostics when the scope is the monorepo root", async () => {
  // Tide itself is a monorepo opened at the repo root, with each package's tsconfig in
  // a sub-dir (apps/<pkg>/tsconfig.json). Compiler options must come from the config
  // NEAREST THE FILE — an upward search from the scope root never sees the sub-package
  // config, so .ts-suffixed imports squiggled TS5097 across the whole tree. Two
  // packages with opposite settings prove the resolution is per-file, not the scope's.
  const monorepo = mkdtempSync(path.join(os.tmpdir(), "tide-code-intel-mono-"));
  const lenientDir = path.join(monorepo, "apps", "lenient");
  const strictDir = path.join(monorepo, "apps", "strict");
  mkdirSync(lenientDir, { recursive: true });
  mkdirSync(strictDir, { recursive: true });
  const baseOptions = {
    module: "nodenext",
    moduleResolution: "nodenext",
    target: "es2022",
    noEmit: true,
  };
  writeFileSync(
    path.join(lenientDir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { ...baseOptions, allowImportingTsExtensions: true } }),
  );
  writeFileSync(
    path.join(strictDir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: baseOptions }),
  );
  for (const dir of [lenientDir, strictDir]) {
    writeFileSync(path.join(dir, "dep.ts"), "export const dep = 1;\n");
    writeFileSync(
      path.join(dir, "main.ts"),
      'import { dep } from "./dep.ts";\n\nexport const value = dep;\n',
    );
  }

  const monorepoPort = createTypeScriptCodeIntelligencePort();
  const flagsTsExtensionImport = (diagnostics: { message: string }[]): boolean =>
    diagnostics.some((diagnostic) => diagnostic.message.includes("allowImportingTsExtensions"));
  try {
    // Both files are queried with the SAME scope = the monorepo root (no tsconfig there).
    const lenient = await monorepoPort.getDiagnostics({
      root: monorepo,
      path: path.join(lenientDir, "main.ts"),
    });
    assert.equal(lenient.ok, true);
    assert.equal(
      lenient.ok && flagsTsExtensionImport(lenient.diagnostics),
      false,
      "the lenient package's tsconfig (allowImportingTsExtensions) must silence TS5097",
    );

    const strict = await monorepoPort.getDiagnostics({
      root: monorepo,
      path: path.join(strictDir, "main.ts"),
    });
    assert.equal(strict.ok, true);
    assert.equal(
      strict.ok && flagsTsExtensionImport(strict.diagnostics),
      true,
      "the strict package (no allowImportingTsExtensions) still flags the .ts import — proving per-file resolution",
    );
  } finally {
    await monorepoPort.dispose?.();
    rmSync(monorepo, { recursive: true, force: true });
  }
});

test("on-disk edits made outside the editor invalidate stale answers", async () => {
  // Agents edit files directly on disk (the core Tide flow). The persistent
  // service must observe the change — hover after renaming util's export type
  // must reflect the NEW disk content without any overlay involved.
  const before = await port.getHover({ root, path: mainPath, ...positionOf(MAIN_SOURCE, "total") });
  assert.equal(before.ok && before.hover !== null, true);
  if (before.ok && before.hover !== null) {
    assert.match(before.hover.contents, /const total: number/);
  }

  const rewritten = UTIL_SOURCE.replace(
    "export function add(first: number, second: number): number {\n  return first + second;\n}",
    'export function add(first: number, second: number): string {\n  return String(first + second);\n}',
  );
  assert.notEqual(rewritten, UTIL_SOURCE);
  writeFileSync(utilPath, rewritten);
  try {
    const after_ = await port.getHover({ root, path: mainPath, ...positionOf(MAIN_SOURCE, "total") });
    assert.equal(after_.ok && after_.hover !== null, true);
    if (after_.ok && after_.hover !== null) {
      assert.match(after_.hover.contents, /const total: string/);
    }
  } finally {
    writeFileSync(utilPath, UTIL_SOURCE);
  }
});
