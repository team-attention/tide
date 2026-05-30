// Spec: docs_v2/specs/workbench-terminal-pane-session.md

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createPythonPtyProcessLauncher } from "../src/backend/adapters/outbound/pty/python-pty-process-launcher.ts";
import { createPtyWorkbenchTerminalPort } from "../src/backend/adapters/outbound/pty/workbench-terminal-pty-port.ts";

test("workbench_terminal_pty_port_runs_a_live_command_and_reports_exit", async () => {
  // The Terminal Pane is backed by a real PTY session: it launches a command,
  // streams its output, and reports process exit.
  const port = createPtyWorkbenchTerminalPort({
    launcher: createPythonPtyProcessLauncher(),
  });
  const cwd = mkdtempSync(path.join(tmpdir(), "tide-terminal-"));

  let output = "";
  const exit = await new Promise<{ exitCode: number | null; signal: string | null }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("terminal did not exit in time")), 15000);
      void port
        .start({
          threadId: "thread-terminal",
          paneId: "pane-terminal",
          command: "echo",
          args: ["tide-terminal-live"],
          cwd,
          onOutput: (chunk) => {
            output += chunk.body;
          },
          onExit: (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
        })
        .catch(reject);
    },
  );

  assert.ok(
    output.includes("tide-terminal-live"),
    `expected live terminal output to include the echoed token, got: ${JSON.stringify(output)}`,
  );
  assert.equal(exit.exitCode, 0);
});

test("workbench_terminal_pty_port_accepts_interactive_input", async () => {
  // Composer/terminal input is written to the same live PTY session.
  const port = createPtyWorkbenchTerminalPort({
    launcher: createPythonPtyProcessLauncher(),
  });
  const cwd = mkdtempSync(path.join(tmpdir(), "tide-terminal-"));

  let output = "";
  const handle = await port.start({
    threadId: "thread-terminal",
    paneId: "pane-terminal-cat",
    command: "cat",
    args: [],
    cwd,
    onOutput: (chunk) => {
      output += chunk.body;
    },
  });

  await handle.write("tide-input-roundtrip\n");
  // Give the PTY a moment to echo input back.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await handle.stop();

  assert.ok(
    output.includes("tide-input-roundtrip"),
    `expected the live terminal to echo written input, got: ${JSON.stringify(output)}`,
  );
});
