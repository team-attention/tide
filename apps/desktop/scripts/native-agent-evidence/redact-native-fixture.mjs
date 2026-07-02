#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.in || !args.out) {
  fail("usage: redact-native-fixture.mjs --in <input.json|jsonl> --out <output.json|jsonl>");
}

const input = readFileSync(args.in, "utf8");
const redacted = input
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => JSON.stringify(redact(JSON.parse(line))))
  .join("\n");

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, `${redacted}\n`);

function redact(value, key = "") {
  if (value === null || typeof value !== "object") {
    return isSensitiveKey(key) ? "[REDACTED]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, key));
  }
  const out = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = isSensitiveKey(childKey) ? "[REDACTED]" : redact(childValue, childKey);
  }
  return out;
}

function isSensitiveKey(key) {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("key") ||
    normalized.includes("password") ||
    normalized.includes("credential") ||
    normalized === "prompt" ||
    normalized === "body" ||
    normalized === "content" ||
    normalized === "text" ||
    normalized === "diff" ||
    normalized === "output" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "env" ||
    normalized.endsWith("path")
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--in" || arg === "--out") {
      out[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
