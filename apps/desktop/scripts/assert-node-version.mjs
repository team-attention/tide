#!/usr/bin/env node

// Shared node-version preflight. The test runner and build rely on
// `--experimental-strip-types`, which needs node >= 22.6. Under nvm the shell
// silently drifts to an older default (20), and the failure surfaces as
// confusing syntax errors deep in type-stripped files. Fail fast with the cause.

export function assertNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const ok = major > 22 || (major === 22 && minor >= 6);
  if (!ok) {
    console.error(
      `Tide v2 needs Node >= 22.6 (for --experimental-strip-types); you are on ${process.version}.\n` +
        "Run `nvm use` (an .nvmrc pins 22) or install Node 22.6+.",
    );
    process.exit(1);
  }
}

// Run directly (e.g. `pretest` hook) as well as importable.
if (import.meta.url === `file://${process.argv[1]}`) {
  assertNodeVersion();
}
