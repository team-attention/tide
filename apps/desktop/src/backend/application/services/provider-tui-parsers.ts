// Parsers that turn a provider CLI's interactive TUI output (captured from the
// hidden PTY) into structured option lists Tide can render as native menus.
//
// These are intentionally tolerant: the TUI stream is full of ANSI control
// sequences and the layout can shift between CLI versions, so each parser strips
// control sequences first and then matches the stable, human-readable tokens
// (model names, the current marker) rather than fixed column positions.

export interface ScrapedModelOption {
  // The selectable label as shown in the picker (e.g. "Default", "Opus").
  label: string;
  // A short descriptor when the TUI provides one (e.g. "Sonnet 4.6").
  detail?: string;
  // True for the model the picker marks as currently active/default.
  current: boolean;
}

// Removes ANSI/OSC/cursor control sequences from raw PTY output, leaving the
// visible text. Also collapses the no-break spaces some TUIs use for layout.
export function stripTerminalSequences(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC ... BEL / ST
    .replace(/\x1b[@-Z\\-_]/g, "") // single-char escapes
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
    .replace(/\x1b[PX^_].*?\x1b\\/g, "") // DCS/PM/APC/SOS strings
    .replace(/[ ]/g, " "); // no-break space -> space
}

// Parses Claude Code's `/model` picker. Rows look like:
//   "1. Default (recommended)  Sonnet 4.6 · Best for everyday tasks"
//   "❯2. Opus ✔  Opus 4.8 · Most capable for complex work · ~2× usage"
//   "3. Haiku  Haiku 4.5 · Fastest for quick answers"
// The ✔ marks the current default; ❯ is only the cursor position.
export function parseClaudeModelPicker(raw: string): ScrapedModelOption[] {
  const text = stripTerminalSequences(raw);
  // Only look at the picker region (after the "Select model" heading) so we
  // don't pick up unrelated numbered text from the conversation.
  const headingIndex = text.lastIndexOf("Select model");
  const region = headingIndex === -1 ? text : text.slice(headingIndex);

  const options: ScrapedModelOption[] = [];
  const seen = new Set<string>();
  for (const rawLine of region.split(/\r?\n/)) {
    const line = rawLine.trim();
    // A model row starts with an optional cursor (❯), then "<n>." then the model
    // token (a single word like Default/Opus/Haiku).
    const match = line.match(/^[❯>\s]*\d+\.\s*([A-Za-z][\w.+\-]*)/);
    if (match === null) {
      continue;
    }
    const label = match[1].trim();
    if (label.length === 0 || seen.has(label)) {
      continue;
    }
    seen.add(label);
    // The ✔/✓ marker (anywhere on the row) flags the current default.
    options.push({ label, current: /[✔✓]/.test(line) });
  }
  return options;
}
