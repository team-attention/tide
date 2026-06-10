// Provider CLIs (claude / codex / gemini / opencode and their npm/brew wrappers)
// print "a newer version is available" banners to STDERR — not into their machine
// protocol. Tide runs them in structured mode, so those banners would otherwise
// be swallowed. This is the ONE shared, conservative detector every structured
// client runs over its stderr; a hit becomes a single non-blocking "update
// available" notice (surfaced as a native OS notification). It is deliberately
// informational: a false positive is a dismissible note, a miss just shows
// nothing — so a heuristic on the real banner text is acceptable here.

const UPDATE_LINE = new RegExp(
  [
    "update available",
    "new version available",
    "a new release of",
    "a newer version",
    "new major version",
    "npm notice.*new",
    "please update",
    "is out of date",
    "to update,? run",
    "run .{0,40}(update|upgrade)",
  ].join("|"),
  "i",
);

// Lines that merely mention a version but are NOT update banners — skip to keep
// false positives down.
const NOISE = /tip:|changelog|what's new since|already up to date|up-to-date/i;

// A stderr scanner that fires `onNotice` at most ONCE per runtime (the banner
// usually prints at startup; we don't want to renotify on every chunk).
export function createUpdateNoticeScanner(
  onNotice: (message: string) => void,
): (chunk: string) => void {
  let fired = false;
  return (chunk: string) => {
    if (fired) {
      return;
    }
    const notice = detectAgentUpdateNotice(chunk);
    if (notice !== null) {
      fired = true;
      onNotice(notice);
    }
  };
}

export function detectAgentUpdateNotice(text: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripAnsi(rawLine).trim();
    if (line.length === 0 || line.length > 240) {
      continue;
    }
    if (UPDATE_LINE.test(line) && !NOISE.test(line)) {
      return line;
    }
  }
  return null;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, "");
}
