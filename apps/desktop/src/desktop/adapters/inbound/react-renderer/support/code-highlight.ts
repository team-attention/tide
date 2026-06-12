// Lightweight syntax highlighting for code shown in the agent session (tool
// bodies, markdown code fences). Reuses the CodeMirror language parsers already
// bundled for the editor (+ @lezer/highlight) so no new highlighter dependency
// is needed. Produces an HTML string of <span class="tok-…"> tokens.
import { classHighlighter, highlightCode } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import { cssLanguage } from "@codemirror/lang-css";
import { jsonLanguage } from "@codemirror/lang-json";
import { tsxLanguage } from "@codemirror/lang-javascript";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { rustLanguage } from "@codemirror/lang-rust";
import { pythonLanguage } from "@codemirror/lang-python";
import { goLanguage } from "@codemirror/lang-go";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { htmlLanguage } from "@codemirror/lang-html";
import { StandardSQL } from "@codemirror/lang-sql";
import { xmlLanguage } from "@codemirror/lang-xml";
import { cppLanguage } from "@codemirror/lang-cpp";
import { javaLanguage } from "@codemirror/lang-java";

const PARSERS: Record<string, Parser> = {
  ts: tsxLanguage.parser,
  tsx: tsxLanguage.parser,
  js: tsxLanguage.parser,
  jsx: tsxLanguage.parser,
  mjs: tsxLanguage.parser,
  cjs: tsxLanguage.parser,
  json: jsonLanguage.parser,
  jsonc: jsonLanguage.parser,
  css: cssLanguage.parser,
  scss: cssLanguage.parser,
  less: cssLanguage.parser,
  rust: rustLanguage.parser,
  rs: rustLanguage.parser,
  md: markdownLanguage.parser,
  markdown: markdownLanguage.parser,
  python: pythonLanguage.parser,
  py: pythonLanguage.parser,
  go: goLanguage.parser,
  golang: goLanguage.parser,
  yaml: yamlLanguage.parser,
  yml: yamlLanguage.parser,
  html: htmlLanguage.parser,
  htm: htmlLanguage.parser,
  sql: StandardSQL.language.parser,
  xml: xmlLanguage.parser,
  svg: xmlLanguage.parser,
  cpp: cppLanguage.parser,
  cxx: cppLanguage.parser,
  cc: cppLanguage.parser,
  c: cppLanguage.parser,
  h: cppLanguage.parser,
  hpp: cppLanguage.parser,
  java: javaLanguage.parser,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Best-effort language guess from content when no explicit language is given.
export function guessLanguage(code: string): string | undefined {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && /[:[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // not valid JSON; fall through
    }
  }
  if (/\b(const|let|export|import|function|interface|class|=>|async|await|return)\b/.test(code)) {
    return "ts";
  }
  if (/\b(fn |let mut|impl |pub fn|use std)\b/.test(code)) {
    return "rust";
  }
  return undefined;
}

// Highlights code to an HTML string. Returns escaped plain HTML when no parser
// matches the language.
export function highlightToHtml(code: string, language?: string): string {
  const lang = (language ?? guessLanguage(code))?.toLowerCase();
  const parser = lang ? PARSERS[lang] : undefined;
  if (parser === undefined) {
    return escapeHtml(code);
  }
  let html = "";
  try {
    highlightCode(
      code,
      parser.parse(code),
      classHighlighter,
      (text, classes) => {
        html += classes ? `<span class="${classes}">${escapeHtml(text)}</span>` : escapeHtml(text);
      },
      () => {
        html += "\n";
      },
    );
  } catch {
    return escapeHtml(code);
  }
  return html;
}
