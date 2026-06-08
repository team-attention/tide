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

export interface CodexApprovalOption {
  // 1-based index as codex numbers the option.
  index: number;
  // The selectable label (e.g. "Allow", "Always allow", "Cancel").
  label: string;
  // The option's description column when present.
  detail?: string;
}

export interface CodexApprovalPrompt {
  // The question codex asks (ends with "?"), e.g. an "Allow … to run tool …?".
  question: string;
  options: CodexApprovalOption[];
  // Index into `options` codex has the cursor on (its default), 0 when unmarked.
  defaultIndex: number;
}

// Parses codex's boxed interactive approval/choice menu from hidden-PTY output.
// codex raises these for shell-command and (non-Tide) MCP tool approval; they have
// no hook, so they only exist in the live TUI. Shape (ANSI-stripped):
//   Allow the <server> MCP server to run tool "<tool>"?
//   > 1. Allow                  Run the tool and continue.
//     2. Allow for this session ...
//     3. Always allow           ...
//     4. Cancel                 Cancel this tool call
//   enter to submit | esc to cancel
// Returns null for ordinary output. The "esc to cancel"/"to submit" footer is the
// reliable signal that this is an interactive prompt (vs a numbered list in prose).
export function parseCodexApprovalPrompt(raw: string): CodexApprovalPrompt | null {
  const text = stripTerminalSequences(raw);
  if (!/esc to cancel|to submit/i.test(text)) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  const options: CodexApprovalOption[] = [];
  let defaultIndex = 0;
  let firstOptionLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*([>❯])?\s*(\d+)\.\s+(.+?)\s*$/);
    if (match === null) {
      continue;
    }
    const rest = match[3].trim();
    const parts = rest.split(/\s{2,}/);
    const label = parts[0].trim();
    if (label.length === 0) {
      continue;
    }
    if (match[1] !== undefined) {
      defaultIndex = options.length;
    }
    options.push({
      index: Number(match[2]),
      label,
      detail: parts.length > 1 ? parts.slice(1).join(" ").trim() : undefined,
    });
    if (firstOptionLine === -1) {
      firstOptionLine = i;
    }
  }
  if (options.length < 2 || firstOptionLine === -1) {
    return null;
  }

  // The question is the nearest line above the options that ends with "?".
  let question = "";
  for (let i = firstOptionLine - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line.endsWith("?")) {
      question = line;
      break;
    }
  }
  if (question.length === 0) {
    return null;
  }

  return { question, options, defaultIndex };
}
