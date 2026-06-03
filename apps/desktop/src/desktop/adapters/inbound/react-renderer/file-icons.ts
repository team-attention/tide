// Per-filetype icons mapped to lucide (already a dependency, MIT-licensed) so
// the FileTree and file-edit cards show a meaningful icon per extension instead
// of one generic file glyph.
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileVideo,
  type LucideIcon,
} from "lucide-react";

const BY_EXTENSION: Record<string, LucideIcon> = {
  // Source / markup
  ts: FileCode, tsx: FileCode, js: FileCode, jsx: FileCode, mjs: FileCode, cjs: FileCode,
  rs: FileCode, go: FileCode, py: FileCode, rb: FileCode, java: FileCode, kt: FileCode,
  c: FileCode, cc: FileCode, cpp: FileCode, h: FileCode, hpp: FileCode, swift: FileCode,
  php: FileCode, sql: FileCode, css: FileCode, scss: FileCode, less: FileCode,
  html: FileCode, htm: FileCode, vue: FileCode, svelte: FileCode, astro: FileCode,
  // Data
  json: FileJson, jsonc: FileJson, json5: FileJson,
  // Docs
  md: FileText, mdx: FileText, txt: FileText, rst: FileText, adoc: FileText,
  // Images
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, svg: FileImage,
  webp: FileImage, ico: FileImage, bmp: FileImage, avif: FileImage,
  // Shell
  sh: FileTerminal, bash: FileTerminal, zsh: FileTerminal, fish: FileTerminal,
  // Config
  toml: FileCog, yaml: FileCog, yml: FileCog, ini: FileCog, env: FileCog,
  conf: FileCog, cfg: FileCog, lock: FileCog,
  // Archives
  zip: FileArchive, tar: FileArchive, gz: FileArchive, tgz: FileArchive,
  rar: FileArchive, "7z": FileArchive,
  // Media
  mp3: FileAudio, wav: FileAudio, flac: FileAudio, m4a: FileAudio,
  mp4: FileVideo, mov: FileVideo, webm: FileVideo, mkv: FileVideo,
  // Spreadsheets
  csv: FileSpreadsheet, xlsx: FileSpreadsheet, xls: FileSpreadsheet, tsv: FileSpreadsheet,
};

// Files whose meaning is in the full name, not an extension.
const BY_NAME: Record<string, LucideIcon> = {
  dockerfile: FileCode,
  makefile: FileCog,
  ".gitignore": FileCog,
  ".gitattributes": FileCog,
  ".env": FileCog,
  ".npmrc": FileCog,
};

export function fileIconFor(name: string): LucideIcon {
  const lower = name.toLowerCase();
  if (BY_NAME[lower] !== undefined) {
    return BY_NAME[lower];
  }
  const dot = lower.lastIndexOf(".");
  const ext = dot > 0 ? lower.slice(dot + 1) : "";
  return BY_EXTENSION[ext] ?? File;
}
