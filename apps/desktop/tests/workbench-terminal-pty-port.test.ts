// Spec: docs_v2/specs/workbench-terminal-pane-session.md

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createPythonPtyProcessLauncher } from "../src/backend/adapters/outbound/pty/python-pty-process-launcher.ts";
import { createPtyWorkbenchTerminalPort } from "../src/backend/adapters/outbound/pty/workbench-terminal-pty-port.ts";
import { SKIP_REAL_PTY_IN_CI } from "./pty-ci-gate.ts";

test("workbench_terminal_pty_port_runs_a_live_command_and_reports_exit", { skip: SKIP_REAL_PTY_IN_CI }, async () => {
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

test("workbench_terminal_pty_port_accepts_interactive_input", { skip: SKIP_REAL_PTY_IN_CI }, async () => {
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
  // Poll for the echoed input instead of a fixed sleep (avoids flakiness under
  // load); the live PTY echoes typed input back.
  const deadline = Date.now() + 5000;
  while (!output.includes("tide-input-roundtrip") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await handle.stop();

  assert.ok(
    output.includes("tide-input-roundtrip"),
    `expected the live terminal to echo written input, got: ${JSON.stringify(output)}`,
  );
});

test("workbench_terminal_pty_port_leaves_terminal_query_replies_to_xterm", { skip: SKIP_REAL_PTY_IN_CI }, async () => {
  // Visible Workbench terminals have xterm.js attached. The backend bridge must
  // not also synthesize CPR/DA/color replies, or interactive CLIs can read those
  // duplicate bytes as typed answers.
  const port = createPtyWorkbenchTerminalPort({
    launcher: createPythonPtyProcessLauncher(),
  });
  const cwd = mkdtempSync(path.join(tmpdir(), "tide-terminal-"));

  let output = "";
  const exit = await new Promise<{ exitCode: number | null; signal: string | null }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("terminal query test did not exit")), 5000);
      void port
        .start({
          threadId: "thread-terminal",
          paneId: "pane-terminal-query",
          command: "python3",
          args: [
            "-c",
            [
              "import os, select, sys, time, tty",
              "tty.setraw(sys.stdin.fileno())",
              "sys.stdout.buffer.write(b'\\x1b[6n')",
              "sys.stdout.buffer.flush()",
              "deadline = time.time() + 0.5",
              "data = b''",
              "while time.time() < deadline:",
              "    ready, _, _ = select.select([sys.stdin], [], [], 0.05)",
              "    if ready:",
              "        data += os.read(sys.stdin.fileno(), 128)",
              "print('\\nreply=' + data.decode('latin1').encode('unicode_escape').decode(), flush=True)",
            ].join("\n"),
          ],
          cwd,
          onOutput: (chunk) => {
            output += chunk.body;
          },
          onExit: (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
        })
        .catch((error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        });
    },
  );

  assert.equal(exit.exitCode, 0);
  assert.match(output, /reply=/);
  assert.doesNotMatch(output, /\\x1b\[1;1R/);
});
