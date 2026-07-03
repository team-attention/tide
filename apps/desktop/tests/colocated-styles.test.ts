// Spec: semantic-styled-components-migration — renderer styling has migrated
// from colocated legacy CSS to same-file semantic styled-components.
// Current policy:
//   1. renderer .css is limited to documented global/platform styles
//   2. styles/index.css imports only those global files
//   3. component modules never import CSS (node --test has no CSS loader)
//   4. styled component helper files are semantic parts, not mechanical
//      .styles.tsx dumps
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
const allowedCss = new Set([
  path.join(stylesDir, "base.css"),
  path.join(stylesDir, "highlight-api.css"),
  indexCss,
].map((file) => path.normalize(file)));

function walk(dir: string, extensions: string | string[]): string[] {
  const allowed = Array.isArray(extensions) ? extensions : [extensions];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, allowed));
    } else if (entry.isFile() && allowed.some((extension) => entry.name.endsWith(extension))) {
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

test("renderer css is limited to global files imported by styles/index.css", () => {
  const imports = indexImports();
  const counts = new Map<string, number>();
  for (const file of imports) {
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const file of walk(renderer, ".css")) {
    if (!allowedCss.has(path.normalize(file))) {
      problems.push(`${path.relative(renderer, file)}: component CSS is not allowed`);
    }
  }
  for (const [file, count] of counts) {
    if (count > 1) {
      problems.push(`${path.relative(renderer, file)}: imported ${count} times`);
    }
    if (!fs.existsSync(file)) {
      problems.push(`${path.relative(renderer, file)}: imported but missing`);
    }
    if (!allowedCss.has(path.normalize(file))) {
      problems.push(`${path.relative(renderer, file)}: imported but not globally allowed`);
    }
  }
  for (const file of allowedCss) {
    if (file !== path.normalize(indexCss) && !counts.has(file)) {
      problems.push(`${path.relative(renderer, file)}: global CSS is not imported by styles/index.css`);
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join("\n")}`);
});

test("renderer component modules never import css themselves", () => {
  const offenders: string[] = [];
  for (const file of walk(renderer, [".ts", ".tsx"])) {
    const text = fs.readFileSync(file, "utf8");
    if (/import\s+["'][^"']+\.css["']/.test(text)) {
      offenders.push(path.relative(renderer, file));
    }
  }
  assert.deepEqual(offenders, [], `\n${offenders.join("\n")}`);
});

test("styled component helper files use semantic parts naming", () => {
  const problems: string[] = [];
  for (const file of walk(renderer, ".tsx")) {
    const basename = path.basename(file);
    const relative = path.relative(renderer, file);
    if (basename.endsWith(".styles.tsx")) {
      problems.push(`${relative}: use same-file styled declarations or a semantic .parts.tsx file`);
      continue;
    }
    if (!basename.endsWith(".parts.tsx")) {
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    const genericExportPattern =
      /export\s+const\s+(?:Wrapper|Container|StyledDiv|StyledSpan|StyledButton|Row|Root|S)\b/;
    if (genericExportPattern.test(text)) {
      problems.push(`${relative}: exports generic styled component names`);
    }
    if (!/from\s+["']styled-components["']/.test(text)) {
      problems.push(`${relative}: .parts.tsx files are reserved for styled component parts`);
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join("\n")}`);
});

test("styled-components keyframes are not interpolated into raw conditional strings", () => {
  const problems: string[] = [];
  for (const file of walk(renderer, ".tsx")) {
    const text = fs.readFileSync(file, "utf8");
    const keyframeNames = [...text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*keyframes`/g)]
      .map((match) => match[1]);
    if (keyframeNames.length === 0) {
      continue;
    }
    for (const name of keyframeNames) {
      const templateTick = "`";
      const rawTemplateBody = String.raw`(?:[^` + templateTick + String.raw`\\]|\\[\s\S])*?`;
      const rawConditionalAnimation = new RegExp(
        String.raw`\?\s*` +
          templateTick +
          rawTemplateBody +
          String.raw`animation\s*:\s*\$\{${name}\}`,
        "g",
      );
      for (const match of text.matchAll(rawConditionalAnimation)) {
        const line = text.slice(0, match.index ?? 0).split("\n").length;
        problems.push(
          `${path.relative(renderer, file)}:${line}: wrap conditional keyframe CSS in the styled-components css helper`,
        );
      }
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join("\n")}`);
});
