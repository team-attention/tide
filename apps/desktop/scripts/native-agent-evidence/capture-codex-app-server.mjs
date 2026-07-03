#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const codex = args.codex ?? "codex";
if (!args.out) {
  fail("usage: capture-codex-app-server.mjs --codex <codex> --out <dir> [--review-start --allow-provider-review --cwd <repo>]");
}
const reviewStart = args["review-start"] === true;
if (reviewStart && args["allow-provider-review"] !== true) {
  fail("refusing to run review/start without --allow-provider-review");
}

const version = run(codex, ["--version"]);
const help = run(codex, ["app-server", "--help"]);
const capture = reviewStart
  ? await captureReviewStart({
      codex,
      cwd: args.cwd ?? process.cwd(),
      target: reviewTargetFromArgs(args),
      delivery: reviewDeliveryFromArgs(args),
      timeoutMs: Number(args["timeout-ms"] ?? 15000),
      postReviewWaitMs: Number(args["post-review-wait-ms"] ?? 500),
    })
  : undefined;
mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "runtime-help.txt"), help.stdout);
writeFileSync(join(args.out, "provider.json"), JSON.stringify({
  provider: "codex",
  executable: "codex",
  version: firstLine(version.stdout),
  surfaces: ["app-server"],
  helpSha256: sha256(help.stdout),
  capturedAt: new Date().toISOString(),
  redaction: capture?.redaction ?? "help_only",
  ...(capture !== undefined ? { reviewStartStatus: capture.summary.status } : {}),
}, null, 2));
if (capture !== undefined) {
  writeFileSync(join(args.out, "codex-review-start-summary.json"), JSON.stringify(capture.summary, null, 2));
  writeFileSync(
    join(args.out, "app-server-review-start.protocol.jsonl"),
    `${capture.frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`,
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--review-start" || arg === "--allow-provider-review") {
      out[arg.slice(2)] = true;
      continue;
    }
    if (
      arg === "--codex" ||
      arg === "--out" ||
      arg === "--cwd" ||
      arg === "--target" ||
      arg === "--base-branch" ||
      arg === "--commit-sha" ||
      arg === "--commit-title" ||
      arg === "--delivery" ||
      arg === "--timeout-ms" ||
      arg === "--post-review-wait-ms"
    ) {
      out[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function captureReviewStart(input) {
  const frames = [];
  const notificationMethods = [];
  const child = spawn(input.codex, ["app-server"], {
    cwd: input.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdin.on("error", () => {});

  let buffer = "";
  let stderrBytes = 0;
  let nextId = 1;
  let settled = false;
  const pending = new Map();
  const summary = {
    status: "started",
    targetType: input.target.type,
    delivery: input.delivery,
    cwdRedacted: true,
    threadIdRedacted: false,
    reviewThreadIdRedacted: false,
    turnIdRedacted: false,
    notificationMethods,
    protocolFrameCount: 0,
    stderrBytes: 0,
  };
  const cleanup = () => {
    try {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    } catch {
      // process already gone
    }
  };

  const timeout = setTimeout(() => {
    summary.status = "timeout";
    finish();
    for (const entry of pending.values()) {
      entry.reject(new Error("timed out waiting for codex app-server response"));
    }
    pending.clear();
  }, input.timeoutMs);

  child.stderr.on("data", (chunk) => {
    stderrBytes += Buffer.byteLength(chunk);
  });
  child.on("error", () => {
    summary.status = "spawn_error";
    finish();
  });
  child.on("exit", (code) => {
    if (!settled && summary.status === "started") {
      summary.status = `exited_${code ?? "null"}`;
      finish();
    }
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (line.length > 0) {
        handleProtocolLine(line);
      }
    }
  });

  try {
    await request("initialize", {
      clientInfo: { name: "tide-evidence", title: "Tide Evidence", version: "1.0" },
      capabilities: null,
    });
    notify("initialized", {});
    const threadStart = await request("thread/start", {
      cwd: input.cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
    });
    const threadId = stringField(recordField(threadStart, "thread"), "id");
    if (threadId === undefined) {
      summary.status = "thread_start_missing_id";
      return finish();
    }
    summary.threadIdRedacted = true;
    const review = await request("review/start", {
      threadId,
      target: input.target,
      delivery: input.delivery,
    });
    if (stringField(review, "reviewThreadId") !== undefined) {
      summary.reviewThreadIdRedacted = true;
    }
    const turnId = stringField(recordField(review, "turn"), "id");
    if (turnId !== undefined) {
      summary.turnIdRedacted = true;
    }
    summary.status = "review_started";
    await new Promise((resolve) => setTimeout(resolve, input.postReviewWaitMs));
  } catch (error) {
    summary.status = "error";
    summary.error = error instanceof Error ? error.message : String(error);
  }
  return finish();

  function request(method, params) {
    const id = nextId;
    nextId += 1;
    frames.push(redactProtocolFrame({ direction: "out", id, method, params }));
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
    });
  }

  function notify(method, params) {
    frames.push(redactProtocolFrame({ direction: "out", method, params }));
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  function handleProtocolLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      frames.push({ direction: "in", parseError: true });
      return;
    }
    if (message.id !== undefined && message.method === undefined) {
      const id = Number(message.id);
      const pendingRequest = pending.get(id);
      if (pendingRequest !== undefined) {
        pending.delete(id);
        frames.push(redactProtocolFrame({
          direction: "in",
          id,
          responseTo: pendingRequest.method,
          result: message.result,
          error: message.error,
        }));
        if (message.error !== undefined) {
          pendingRequest.reject(new Error(errorMessage(message) ?? `${pendingRequest.method} failed`));
        } else {
          pendingRequest.resolve(isRecord(message.result) ? message.result : {});
        }
      }
      return;
    }
    if (typeof message.method === "string") {
      notificationMethods.push(message.method);
      frames.push(redactProtocolFrame({
        direction: "in",
        id: message.id,
        method: message.method,
        params: message.params,
      }));
      if (message.id !== undefined) {
        child.stdin.write(`${JSON.stringify({ id: message.id, result: { decision: "decline" } })}\n`);
      }
    }
  }

  function finish() {
    if (settled) {
      return { summary, frames, redaction: "reduced_review_start" };
    }
    settled = true;
    clearTimeout(timeout);
    summary.stderrBytes = stderrBytes;
    summary.protocolFrameCount = frames.length;
    cleanup();
    return { summary: stripUndefined(summary), frames, redaction: "reduced_review_start" };
  }
}

function reviewTargetFromArgs(parsed) {
  const target = parsed.target ?? "uncommitted";
  if (target === "uncommitted") {
    return { type: "uncommittedChanges" };
  }
  if (target === "base") {
    if (typeof parsed["base-branch"] !== "string" || parsed["base-branch"].length === 0) {
      fail("--target base requires --base-branch <branch>");
    }
    return { type: "baseBranch", branch: parsed["base-branch"] };
  }
  if (target === "commit") {
    if (typeof parsed["commit-sha"] !== "string" || parsed["commit-sha"].length === 0) {
      fail("--target commit requires --commit-sha <sha>");
    }
    return {
      type: "commit",
      sha: parsed["commit-sha"],
      ...(typeof parsed["commit-title"] === "string" ? { title: parsed["commit-title"] } : {}),
    };
  }
  fail("--target must be one of: uncommitted, base, commit");
}

function reviewDeliveryFromArgs(parsed) {
  const delivery = parsed.delivery ?? "detached";
  if (delivery !== "inline" && delivery !== "detached") {
    fail("--delivery must be inline or detached");
  }
  return delivery;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} failed: ${result.stderr || result.error?.message || result.status}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function firstLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function redactProtocolFrame(frame) {
  return stripUndefined(redactValue(frame));
}

function redactValue(value, key = "") {
  if (value === null || typeof value !== "object") {
    return isSensitiveKey(key) ? redactedValueForKey(key) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }
  const out = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = isSensitiveKey(childKey)
      ? redactedValueForKey(childKey)
      : redactValue(childValue, childKey);
  }
  return out;
}

function isSensitiveKey(key) {
  const normalized = key.toLowerCase();
  return (
    normalized === "cwd" ||
    normalized.endsWith("path") ||
    normalized === "threadid" ||
    normalized === "reviewthreadid" ||
    normalized === "turnid" ||
    normalized === "id" ||
    normalized === "sha" ||
    normalized === "branch" ||
    normalized === "title" ||
    normalized === "instructions" ||
    normalized === "diff" ||
    normalized === "text" ||
    normalized === "content" ||
    normalized === "body" ||
    normalized === "output" ||
    normalized === "stdout" ||
    normalized === "stderr" ||
    normalized === "env"
  );
}

function redactedValueForKey(key) {
  const normalized = key.toLowerCase();
  if (normalized === "cwd" || normalized.endsWith("path")) {
    return "[REDACTED_PATH]";
  }
  if (normalized === "branch") {
    return "[REDACTED_BRANCH]";
  }
  if (normalized === "sha") {
    return "[REDACTED_SHA]";
  }
  if (normalized.endsWith("id") || normalized === "id") {
    return "[REDACTED_ID]";
  }
  return "[REDACTED]";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordField(record, key) {
  if (!isRecord(record)) return undefined;
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

function stringField(record, key) {
  if (!isRecord(record)) return undefined;
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorMessage(message) {
  const error = recordField(message, "error");
  return stringField(error, "message");
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (!isRecord(value)) {
    return value;
  }
  const out = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (fieldValue !== undefined) {
      out[key] = stripUndefined(fieldValue);
    }
  }
  return out;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
