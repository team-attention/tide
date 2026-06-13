// Spec: colocated-component-styles — every component's CSS lives NEXT TO its
// module, and styles/index.css is the single ordered @import index that pins
// the cascade. These guards keep the structure mechanical:
//   1. every renderer .css outside styles/ is imported exactly once by index.css
//   2. index.css imports point at files that exist (no dangling cascade slots)
//   3. component .ts modules never import CSS (node --test has no CSS loader)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.resolve(
  here,
  "..",
  "src/desktop/adapters/inbound/react-renderer",
);
const stylesDir = path.join(renderer, "styles");
const indexCss = path.join(stylesDir, "index.css");

function walk(dir: string, extension: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      out.push(full);
    }
  }
  return out;
}

function indexImports(): string[] {
  const text = fs.readFileSync(indexCss, "utf8");
  return [...text.matchAll(/@import "(.+?)";/g)].map((match) =>
    path.normalize(path.resolve(stylesDir, match[1])),
  );
}

test("every colocated renderer css is imported exactly once by styles/index.css", () => {
  const imports = indexImports();
  const counts = new Map<string, number>();
  for (const file of imports) {
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const [file, count] of counts) {
    if (count > 1) {
      problems.push(`${path.relative(renderer, file)}: imported ${count} times`);
    }
    if (!fs.existsSync(file)) {
      problems.push(`${path.relative(renderer, file)}: imported but missing`);
    }
  }
  for (const file of walk(renderer, ".css")) {
    if (file === indexCss) {
      continue;
    }
    if (!counts.has(path.normalize(file))) {
      problems.push(`${path.relative(renderer, file)}: not imported by styles/index.css`);
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join("\n")}`);
});

test("renderer component modules never import css themselves", () => {
  const offenders: string[] = [];
  for (const file of walk(renderer, ".ts")) {
    const text = fs.readFileSync(file, "utf8");
    if (/import\s+["'][^"']+\.css["']/.test(text)) {
      offenders.push(path.relative(renderer, file));
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join("\n")}`);
});
