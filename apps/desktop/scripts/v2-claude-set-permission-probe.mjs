#!/usr/bin/env node
// Live probe: does the stream-json `set_permission_mode` control request
// actually change a RUNNING claude session's permission behavior mid-thread?
// (The Tide UI path: permission menu on an active thread → thread.setLaunchOptions
// → applySessionConfig → ClaudeStreamJsonClient.applyConfig → this request.)
//
// Sequence (real claude CLI, temp cwd, no Tide involved):
//   1. spawn claude --permission-mode default --permission-prompt-tool stdio
//   2. turn 1: ask for a Write tool use → EXPECT can_use_tool (default mode asks)
//      → deny it.
//   3. send control_request {subtype:"set_permission_mode", mode:"acceptEdits"}
//      → EXPECT a success control_response.
//   4. turn 2: ask for another Write → EXPECT NO can_use_tool (acceptEdits
//      auto-approves file edits) and the file to exist on disk.
//
// PASS prints a summary and exits 0; any unexpected shape exits 1.
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const cwd = mkdtempSync(join(tmpdir(), "tide-perm-probe-"));
const args = [
  "--print",
  "--input-format", "stream-json",
  "--output-format", "stream-json",
  "--verbose",
  "--permission-prompt-tool", "stdio",
  "--permission-mode", "default",
  "--session-id", randomUUID(),
];

const child = spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
const writeLine = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
const userTurn = (text) =>
  writeLine({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });

let phase = "turn1"; // turn1 → reconfigure → turn2 → done
const seen = { turn1CanUse: 0, turn2CanUse: 0, setModeResponse: null };
const SET_MODE_REQUEST_ID = `cfg-${randomUUID()}`;

const fail = (why) => {
  console.error(`FAIL: ${why}`);
  console.error(`phase=${phase} seen=${JSON.stringify(seen)}`);
  child.kill("SIGKILL");
  process.exit(1);
};
const timer = setTimeout(() => fail("timed out after 180s"), 180_000);

userTurn(
  "Use the Write tool to create the file probe1.txt with content 'one'. " +
    "If the permission is denied, do NOT retry — just reply with the single word: denied.",
);

let buffer = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (c) => process.stderr.write(`[stderr] ${c}`));
child.on("exit", (code) => {
  if (phase !== "done") fail(`claude exited early (code ${code})`);
});
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
    console.log(`[probe] can_use_tool(${msg.request.tool_name}) during ${phase}`);
    if (phase === "turn1") {
      seen.turn1CanUse += 1;
      writeLine({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: msg.request_id,
          response: { behavior: "deny", message: "The user denied this tool use.", interrupt: false },
        },
      });
    } else if (phase === "turn2") {
      seen.turn2CanUse += 1;
      // Shouldn't happen — answer deny so the probe still settles and reports.
      writeLine({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: msg.request_id,
          response: { behavior: "deny", message: "probe: unexpected prompt", interrupt: false },
        },
      });
    }
    return;
  }
  if (msg.type === "control_response" && msg.response?.request_id === SET_MODE_REQUEST_ID) {
    seen.setModeResponse = msg.response?.subtype ?? "unknown";
    console.log(`[probe] set_permission_mode control_response: ${seen.setModeResponse}`);
    if (seen.setModeResponse !== "success") fail("set_permission_mode was not acknowledged with success");
    phase = "turn2";
    userTurn("Now use the Write tool to create the file probe2.txt with content 'two'. Then reply: done.");
    return;
  }
  if (msg.type === "result") {
    console.log(`[probe] result (${msg.subtype}) during ${phase}`);
    if (phase === "turn1") {
      if (seen.turn1CanUse === 0) fail("turn 1 produced no can_use_tool — default mode should have asked");
      phase = "reconfigure";
      writeLine({
        type: "control_request",
        request_id: SET_MODE_REQUEST_ID,
        request: { subtype: "set_permission_mode", mode: "acceptEdits" },
      });
      return;
    }
    if (phase === "turn2") {
      if (seen.turn2CanUse > 0) fail("turn 2 still prompted — set_permission_mode did not apply");
      if (!existsSync(join(cwd, "probe2.txt"))) fail("probe2.txt was not written in acceptEdits mode");
      phase = "done";
      clearTimeout(timer);
      console.log("PASS: set_permission_mode live-applied (asked in default → silent Write in acceptEdits)");
      console.log(`summary: ${JSON.stringify(seen)}`);
      child.kill("SIGTERM");
      process.exit(0);
    }
  }
}
