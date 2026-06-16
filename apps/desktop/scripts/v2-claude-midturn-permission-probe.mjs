#!/usr/bin/env node
// Does a LIVE permission change land on the turn that is ALREADY RUNNING — not
// just the next one? Tide writes set_permission_mode to the CLI immediately, with
// no turn-state gate, so this probes the PROVIDER semantics: claude's stream-json
// control protocol mid-turn.
//
// One turn, two sequential Write tools (default mode asks for each):
//   1. ask for a.txt → ALLOW it, and IN THE SAME MOMENT send
//      set_permission_mode acceptEdits (the turn is still running, b.txt not done).
//   2. b.txt: if the live change reached the running turn → NO prompt (acceptEdits
//      auto-approves the edit). If it only applies next turn → b.txt still prompts.
//
// Verdict: prompts-for-b == 0 ⇒ the running turn DID pick up the change.
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const cwd = mkdtempSync(join(tmpdir(), "tide-midturn-probe-"));
const child = spawn(
  "claude",
  [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-prompt-tool", "stdio",
    "--permission-mode", "default",
    "--session-id", randomUUID(),
  ],
  { cwd, stdio: ["pipe", "pipe", "pipe"] },
);
const writeLine = (v) => child.stdin.write(`${JSON.stringify(v)}\n`);
const SET_MODE_ID = `cfg-${randomUUID()}`;
const seen = { askA: 0, askB: 0, otherAsk: 0, setModeAck: null, flippedAt: null };
let flipped = false;

const fail = (why) => {
  console.error(`FAIL: ${why}\nseen=${JSON.stringify(seen)}`);
  child.kill("SIGKILL");
  process.exit(1);
};
const timer = setTimeout(() => fail("timed out after 180s"), 180_000);

// A single turn that needs TWO permissioned tools in sequence.
writeLine({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "text",
        text:
          "Do these in order in this same turn: (1) use the Write tool to create a.txt with content 'a'; " +
          "(2) then use the Write tool to create b.txt with content 'b'; (3) then reply DONE. " +
          "Do not stop between steps.",
      },
    ],
  },
});

let buffer = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (c) => process.stderr.write(`[stderr] ${c}`));
child.on("exit", (code) => {
  if (seen.askA === 0) fail(`claude exited (code ${code}) before asking for a.txt`);
});

// The turn is over when claude emits a `result` (in stream-json input mode the
// process then idles for the next message — it does NOT exit), so render the
// verdict here, not on child exit.
function renderVerdict() {
  clearTimeout(timer);
  const wroteA = existsSync(join(cwd, "a.txt"));
  const wroteB = existsSync(join(cwd, "b.txt"));
  console.log(`summary: ${JSON.stringify({ ...seen, wroteA, wroteB })}`);
  if (seen.setModeAck !== "success") fail("set_permission_mode was not acknowledged mid-turn");
  if (!wroteB) fail("b.txt was never written — turn did not complete the second tool");
  if (seen.askB === 0) {
    console.log(
      "RESULT: LIVE permission change DID reach the running turn — b.txt was auto-approved (no prompt) after the mid-turn flip to acceptEdits.",
    );
  } else {
    console.log(
      "RESULT: the running turn did NOT pick up the change — b.txt still prompted; the new mode only applies from the NEXT turn.",
    );
  }
  child.kill("SIGTERM");
  process.exit(0);
}

child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (line.length === 0) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});

function handle(msg) {
  if (msg.type === "control_request" && msg.request?.subtype === "can_use_tool") {
    const input = msg.request.input ?? {};
    const path = String(input.file_path ?? input.path ?? "");
    const isA = path.endsWith("a.txt");
    const isB = path.endsWith("b.txt");
    if (isA) seen.askA += 1;
    else if (isB) seen.askB += 1;
    else seen.otherAsk += 1;
    console.log(`[probe] can_use_tool(${msg.request.tool_name}) path=${path || "?"} flipped=${flipped}`);
    // Allow every tool so the turn always completes; the SIGNAL is whether b.txt
    // prompts at all, not how we answer it.
    writeLine({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: msg.request_id,
        response: { behavior: "allow", updatedInput: input },
      },
    });
    // The instant we approve a.txt — while the turn keeps running toward b.txt —
    // flip the permission mode live.
    if (isA && !flipped) {
      flipped = true;
      seen.flippedAt = "after-a-approval";
      writeLine({
        type: "control_request",
        request_id: SET_MODE_ID,
        request: { subtype: "set_permission_mode", mode: "acceptEdits" },
      });
      console.log("[probe] flipped permission → acceptEdits mid-turn (b.txt not yet done)");
    }
    return;
  }
  if (msg.type === "control_response" && msg.response?.request_id === SET_MODE_ID) {
    seen.setModeAck = msg.response?.subtype ?? "unknown";
    console.log(`[probe] set_permission_mode ack: ${seen.setModeAck}`);
    return;
  }
  if (msg.type === "result" && flipped) {
    console.log(`[probe] result (${msg.subtype}) — turn ended`);
    renderVerdict();
  }
}
