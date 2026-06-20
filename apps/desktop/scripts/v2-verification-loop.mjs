#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertNodeVersion } from "./assert-node-version.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gitRoot = resolveGitRoot(appRoot);
const DEFAULT_REPORT_DIR = "dist/verification";
const OUTPUT_TAIL_LIMIT = 16_000;

const BASELINE_FOCUSED_TESTS = [
  "tests/build-and-package.test.ts",
  "tests/file-size-ratchet.test.ts",
  "tests/shared-contracts.test.ts",
];

const TEST_GROUPS = [
  {
    label: "mcp-tool-surface",
    patterns: [
      /^src\/backend\/adapters\/inbound\/tide-mcp-/,
      /^src\/backend\/adapters\/inbound\/tide-mcp-tool-surface\//,
      /^src\/backend\/application\/services\/tide-mcp\//,
    ],
    tests: [
      "tests/tide-mcp-stdio-bridge.test.ts",
      "tests/tide-mcp-workbench-observe-open-browser.test.ts",
      "tests/browser-pane-agent-pixel-vision.test.ts",
    ],
  },
  {
    label: "thread-runtime",
    patterns: [
      /^src\/backend\/application\/domains\/agent-runtime\//,
      /^src\/backend\/application\/services\/thread\//,
      /^src\/backend\/application\/services\/provider\//,
      /^src\/backend\/application\/ports\/outbound\/agent-runtime-/,
    ],
    tests: [
      "tests/backend-thread-agent-runtime-lifecycle.test.ts",
      "tests/agent-runtime-event-spine.test.ts",
      "tests/runtime-spine-boundary.test.ts",
      "tests/tide-api-agent-runtime.test.ts",
    ],
  },
  {
    label: "terminal-and-command-runtime",
    patterns: [
      /^src\/backend\/adapters\/outbound\/pty\//,
      /^src\/backend\/adapters\/outbound\/workspace-command\//,
      /^src\/backend\/application\/ports\/outbound\/workbench-terminal-port\.ts$/,
      /^src\/backend\/application\/ports\/outbound\/workspace-command-port\.ts$/,
    ],
    tests: [
      "tests/runtime-environment-wiring.test.ts",
      "tests/backend-agent-runtime-port-wiring.test.ts",
      "tests/workbench-terminal-pty-port.test.ts",
      "tests/tide-mcp-workbench-observe-open-browser.test.ts",
    ],
  },
  {
    label: "workbench-backend",
    patterns: [
      /^src\/backend\/application\/domains\/workbench\//,
      /^src\/backend\/application\/services\/workbench\//,
    ],
    tests: [
      "tests/backend-thread-agent-runtime-lifecycle.test.ts",
      "tests/tide-mcp-workbench-observe-open-browser.test.ts",
      "tests/browser-capture-coordinator.test.ts",
      "tests/browser-pane-action-liveness.test.ts",
    ],
  },
  {
    label: "browser-pane-renderer",
    patterns: [
      /^src\/desktop\/adapters\/inbound\/react-renderer\/product-shell\/workbench\/browser-/,
      /^src\/desktop\/adapters\/inbound\/react-renderer\/product-shell\/workbench\/background-browser-/,
      /^src\/desktop\/application\/domains\/product-shell\/state\/view-model\.ts$/,
    ],
    tests: [
      "tests/browser-pane-action-liveness.test.ts",
      "tests/background-browser-host.test.tsx",
      "tests/browser-webview-actions.test.ts",
      "tests/browser-agent-overlay.test.tsx",
      "tests/desktop-product-shell-visual-foundation.test.tsx",
    ],
  },
  {
    label: "terminal-renderer",
    patterns: [
      /^src\/desktop\/adapters\/inbound\/react-renderer\/product-shell\/workbench\/terminal-/,
    ],
    tests: [
      "tests/workbench-terminal-view.test.tsx",
      "tests/desktop-product-shell-visual-foundation.test.tsx",
      "tests/composer-draft-thread.test.ts",
    ],
  },
  {
    label: "product-shell",
    patterns: [
      /^src\/desktop\/application\/domains\/product-shell\//,
      /^src\/desktop\/adapters\/inbound\/react-renderer\/product-shell\//,
    ],
    tests: [
      "tests/desktop-agent-chat-composer-shell.test.tsx",
      "tests/desktop-product-shell-visual-foundation.test.tsx",
      "tests/product-shell-store.test.ts",
      "tests/product-shell-selectors.test.ts",
    ],
  },
  {
    label: "app-chrome",
    patterns: [
      /^src\/desktop\/application\/domains\/app-chrome\//,
      /^src\/desktop\/adapters\/inbound\/react-renderer\/app-chrome\//,
    ],
    tests: [
      "tests/app-chrome-workbench-tab-strip.test.tsx",
      "tests/host-zoom-ladder.test.ts",
      "tests/left-rail-manual-ordering.test.ts",
    ],
  },
  {
    label: "live-backend",
    patterns: [
      /^src\/backend\/infrastructure\/node\/live\//,
      /^src\/backend\/adapters\/inbound\/contract-message-adapter\//,
    ],
    tests: [
      "tests/backend-desktop-process-connection.test.ts",
      "tests/backend-thread-agent-runtime-lifecycle.test.ts",
      "tests/persistence.test.ts",
      "tests/persistence-coalescing.test.ts",
    ],
  },
  {
    label: "workspace-files-and-code-intel",
    patterns: [
      /^src\/backend\/adapters\/outbound\/workspace-/,
      /^src\/backend\/application\/services\/workspace-/,
      /^src\/desktop\/adapters\/inbound\/react-renderer\/product-shell\/file-/,
    ],
    tests: [
      "tests/workspace-fs.test.ts",
      "tests/workspace-file-port.test.ts",
      "tests/workspace-code-intelligence.test.ts",
      "tests/workspace-code-intelligence-port.test.ts",
      "tests/workspace-content-search.test.ts",
    ],
  },
  {
    label: "build-scripts-and-config",
    patterns: [
      /^package\.json$/,
      /^tsconfig/,
      /^electron/,
      /^scripts\//,
      /^..\/..\/\.github\//,
    ],
    tests: [
      "tests/build-and-package.test.ts",
      "tests/file-size-ratchet.test.ts",
      "tests/shared-contracts.test.ts",
    ],
  },
];

assertNodeVersion();

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const startedAt = new Date();
const runId = startedAt.toISOString().replace(/[:.]/g, "-");
const reportDir = path.resolve(appRoot, options.reportDir);
const runDir = path.join(reportDir, "runs", runId);
const logDir = path.join(runDir, "logs");
fs.mkdirSync(logDir, { recursive: true });

const changedFiles = listChangedFiles(options.changedFrom);
const affectedTests = selectAffectedTests(changedFiles);
const gates = buildGates({ options, affectedTests });
const results = [];

console.log(`Tide verification loop started (${options.quick ? "quick" : "standard"} mode).`);
console.log(`Changed files: ${changedFiles.length}`);
console.log(`Focused tests: ${affectedTests.length}`);
console.log(`Reports: ${displayPath(reportDir)}`);

for (const gate of gates) {
  if (gate.skip) {
    const skipped = skippedResult(gate);
    results.push(skipped);
    printGateResult(skipped);
    continue;
  }

  console.log(`\n==> ${gate.title}`);
  console.log(`$ ${formatCommand(gate.command, gate.args)}`);
  const result = await runGate(gate, logDir);
  results.push(result);
  printGateResult(result);
  if (result.status === "fail" && !options.keepGoing) {
    console.log("\nStopping on first failed gate. Re-run with --keep-going to collect more evidence.");
    break;
  }
}

const completedAt = new Date();
const status = results.every((result) => result.status !== "fail") ? "pass" : "fail";
const report = {
  schemaVersion: 1,
  status,
  mode: options.quick ? "quick" : "standard",
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  durationMs: completedAt.getTime() - startedAt.getTime(),
  options,
  git: readGitMetadata(changedFiles),
  focusedTests: affectedTests,
  gates: results,
  failureSummary: failureSummary(results),
};

writeReport({ report, runDir, reportDir });
printSummary(report);

process.exit(status === "pass" ? 0 : 1);

function buildGates(input) {
  const gates = [
    {
      id: "diff-check",
      title: "Git diff whitespace and conflict-marker check",
      category: "hygiene",
      cwd: gitRoot,
      command: "git",
      args: ["diff", "--check"],
    },
    {
      id: "typecheck",
      title: "Desktop TypeScript typecheck",
      category: "compiler",
      cwd: appRoot,
      command: npmCommand(),
      args: ["run", "typecheck"],
    },
  ];

  if (input.affectedTests.length > 0) {
    gates.push({
      id: "focused-tests",
      title: "Focused affected test set",
      category: "tests",
      cwd: appRoot,
      command: process.execPath,
      args: ["--import", "tsx", "--test", ...input.affectedTests],
      env: { TSX_TSCONFIG_PATH: "tsconfig.test.json" },
      evidence: {
        selectedTests: input.affectedTests,
      },
    });
  } else {
    gates.push({
      id: "focused-tests",
      title: "Focused affected test set",
      category: "tests",
      skip: true,
      skipReason: "No matching tests were selected.",
    });
  }

  if (!input.options.quick) {
    gates.push({
      id: "full-tests",
      title: "Full desktop test suite",
      category: "tests",
      cwd: appRoot,
      command: npmCommand(),
      args: ["run", "test:v2"],
    });
  }

  if (input.options.build || input.options.smoke) {
    gates.push({
      id: "build",
      title: "Electron build",
      category: "build",
      cwd: appRoot,
      command: npmCommand(),
      args: ["run", "build"],
    });
  }

  if (input.options.smoke) {
    gates.push({
      id: "electron-smoke",
      title: "Electron runtime smoke with provider CLI",
      category: "smoke",
      cwd: appRoot,
      command: npmCommand(),
      args: ["run", "test:smoke:electron"],
    });
  }

  return gates;
}

function runGate(gate, logDir) {
  const startedAtMs = Date.now();
  const logPath = path.join(logDir, `${gate.id}.log`);
  const logStream = fs.createWriteStream(logPath, { encoding: "utf8" });
  const env = {
    ...process.env,
    ...(gate.env ?? {}),
  };

  return new Promise((resolve) => {
    const child = spawn(gate.command, gate.args, {
      cwd: gate.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutTail = "";
    let stderrTail = "";
    let settled = false;

    function append(kind, chunk) {
      const text = String(chunk);
      if (kind === "stdout") {
        process.stdout.write(text);
        stdoutTail = tail(stdoutTail + text);
      } else {
        process.stderr.write(text);
        stderrTail = tail(stderrTail + text);
      }
      logStream.write(text);
    }

    function finish(status, exitCode, signal, errorMessage) {
      if (settled) {
        return;
      }
      settled = true;
      const durationMs = Date.now() - startedAtMs;
      const result = {
        id: gate.id,
        title: gate.title,
        category: gate.category,
        status,
        command: formatCommand(gate.command, gate.args),
        cwd: path.relative(appRoot, gate.cwd) || ".",
        durationMs,
        exitCode,
        signal,
        logPath: displayPath(logPath),
        stdoutTail,
        stderrTail,
        evidence: gate.evidence ?? {},
      };
      if (errorMessage !== undefined) {
        result.errorMessage = errorMessage;
      }
      result.hints = classifyFailure(result);
      logStream.end(() => {
        resolve(result);
      });
    }

    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => {
      finish("fail", null, null, error.message);
    });
    child.on("close", (exitCode, signal) => {
      finish(exitCode === 0 ? "pass" : "fail", exitCode, signal, undefined);
    });
  });
}

function skippedResult(gate) {
  return {
    id: gate.id,
    title: gate.title,
    category: gate.category,
    status: "skip",
    command: "",
    cwd: ".",
    durationMs: 0,
    exitCode: null,
    signal: null,
    logPath: null,
    stdoutTail: "",
    stderrTail: "",
    evidence: {},
    skipReason: gate.skipReason,
    hints: [],
  };
}

function selectAffectedTests(changedFiles) {
  const selected = new Set(BASELINE_FOCUSED_TESTS);
  const normalized = changedFiles.map((file) => ({
    gitPath: file,
    appPath: appRelativePath(file),
  }));

  for (const file of normalized) {
    if (/^tests\/.*\.test\.tsx?$/.test(file.appPath)) {
      selected.add(file.appPath);
    }

    for (const group of TEST_GROUPS) {
      if (group.patterns.some((pattern) => pattern.test(file.appPath) || pattern.test(file.gitPath))) {
        for (const testFile of group.tests) {
          selected.add(testFile);
        }
      }
    }
  }

  return [...selected]
    .filter((testFile) => fs.existsSync(path.join(appRoot, testFile)))
    .sort();
}

function listChangedFiles(changedFrom) {
  const tracked = gitLines([
    "diff",
    "--name-only",
    "--diff-filter=ACMRTUXB",
    changedFrom,
  ]);
  const untracked = gitLines([
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  return [...new Set([...tracked, ...untracked])].sort();
}

function readGitMetadata(changedFiles) {
  return {
    root: gitRoot,
    head: gitText(["rev-parse", "--short", "HEAD"]),
    branch: gitText(["branch", "--show-current"]) || "(detached)",
    changedFrom: options.changedFrom,
    changedFiles,
  };
}

function failureSummary(results) {
  return results
    .filter((result) => result.status === "fail")
    .map((result) => ({
      gate: result.id,
      category: result.category,
      exitCode: result.exitCode,
      signal: result.signal,
      hints: result.hints,
      logPath: result.logPath,
    }));
}

function classifyFailure(result) {
  if (result.status !== "fail") {
    return [];
  }
  const text = `${result.errorMessage ?? ""}\n${result.stdoutTail}\n${result.stderrTail}`;
  const hints = [];

  if (result.category === "compiler") {
    hints.push("TypeScript contract drift or missing type update.");
  }
  if (/AssertionError|not equal|deepEqual/.test(text)) {
    hints.push("A deterministic assertion failed; inspect the named test before broad refactors.");
  }
  if (/Timed out|timeout|did not exit/i.test(text)) {
    hints.push("Timeout or leaked async resource; check lifecycle cleanup and unref timers.");
  }
  if (/ECONNREFUSED|EPIPE|socket|MCP/i.test(text)) {
    hints.push("Transport boundary failure; inspect backend utility process, MCP bridge, or socket lifecycle.");
  }
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|ENOENT/.test(text)) {
    hints.push("Missing build artifact or dependency; run build or verify node_modules/workspace paths.");
  }
  if (/webview|Browser|screenshot|capture/i.test(text)) {
    hints.push("Browser pane regression; check pending action/capture and cold-host policy.");
  }
  if (/terminal|PTY|xterm|shell/i.test(text)) {
    hints.push("Terminal pane regression; check role, PTY lifecycle, and runtime environment wiring.");
  }

  return hints.length > 0 ? [...new Set(hints)] : ["Inspect the gate log and add a focused regression before fixing."];
}

function writeReport(input) {
  const json = `${JSON.stringify(input.report, null, 2)}\n`;
  const markdown = renderMarkdownReport(input.report);
  fs.mkdirSync(input.runDir, { recursive: true });
  fs.writeFileSync(path.join(input.runDir, "report.json"), json);
  fs.writeFileSync(path.join(input.runDir, "report.md"), markdown);
  fs.writeFileSync(path.join(input.reportDir, "latest.json"), json);
  fs.writeFileSync(path.join(input.reportDir, "latest.md"), markdown);
}

function renderMarkdownReport(report) {
  const lines = [
    `# Tide Verification Report`,
    "",
    `Status: **${report.status.toUpperCase()}**`,
    `Mode: \`${report.mode}\``,
    `Started: \`${report.startedAt}\``,
    `Duration: \`${formatDuration(report.durationMs)}\``,
    `Git: \`${report.git.branch}\` @ \`${report.git.head}\` from \`${report.git.changedFrom}\``,
    `Changed files: \`${report.git.changedFiles.length}\``,
    "",
    "## Gates",
    "",
    "| Gate | Status | Duration | Log |",
    "|---|---:|---:|---|",
  ];

  for (const gate of report.gates) {
    lines.push(
      `| ${escapeTable(gate.title)} | ${gate.status.toUpperCase()} | ${formatDuration(gate.durationMs)} | ${gate.logPath ?? gate.skipReason ?? ""} |`,
    );
  }

  lines.push("", "## Focused Tests", "");
  for (const testFile of report.focusedTests) {
    lines.push(`- \`${testFile}\``);
  }

  if (report.failureSummary.length > 0) {
    lines.push("", "## Failure Hints", "");
    for (const failure of report.failureSummary) {
      lines.push(`### ${failure.gate}`);
      lines.push(`Log: \`${failure.logPath}\``);
      for (const hint of failure.hints) {
        lines.push(`- ${hint}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function printGateResult(result) {
  const label = result.status.toUpperCase();
  const duration = formatDuration(result.durationMs);
  if (result.status === "skip") {
    console.log(`SKIP ${result.id} (${result.skipReason})`);
    return;
  }
  console.log(`${label} ${result.id} (${duration})`);
}

function printSummary(report) {
  console.log("\n== Tide verification summary ==");
  console.log(`Status: ${report.status.toUpperCase()}`);
  console.log(`Duration: ${formatDuration(report.durationMs)}`);
  console.log(`Report: ${displayPath(path.join(reportDir, "latest.md"))}`);
  if (report.failureSummary.length > 0) {
    console.log("Failure hints:");
    for (const failure of report.failureSummary) {
      console.log(`- ${failure.gate}: ${failure.hints.join(" ")}`);
    }
  }
}

function parseArgs(args) {
  const parsed = {
    help: false,
    quick: false,
    keepGoing: false,
    build: false,
    smoke: false,
    changedFrom: "HEAD",
    reportDir: DEFAULT_REPORT_DIR,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--quick":
        parsed.quick = true;
        break;
      case "--full":
        parsed.quick = false;
        break;
      case "--keep-going":
        parsed.keepGoing = true;
        break;
      case "--build":
        parsed.build = true;
        break;
      case "--smoke":
        parsed.smoke = true;
        parsed.build = true;
        break;
      case "--changed-from":
        parsed.changedFrom = readArgValue(args, ++index, arg);
        break;
      case "--report-dir":
        parsed.reportDir = readArgValue(args, ++index, arg);
        break;
      default:
        throw new Error(`Unknown verification option: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run verify:tide -- [options]

Runs Tide's deterministic verification loop and writes reports under dist/verification.

Options:
  --quick               Run hygiene, typecheck, and focused affected tests only.
  --full                Run the standard full loop. This is the default.
  --keep-going          Continue after a failed gate to collect more evidence.
  --build               Add an Electron build gate.
  --smoke               Add build plus Electron runtime smoke with fake OpenAI.
  --changed-from <ref>  Select affected tests from diff against ref. Default: HEAD.
  --report-dir <path>   Report output directory. Default: dist/verification.
`);
}

function appRelativePath(gitPath) {
  const prefix = "apps/desktop/";
  if (gitPath.startsWith(prefix)) {
    return gitPath.slice(prefix.length);
  }
  return path.relative(appRoot, path.join(gitRoot, gitPath)).replaceAll(path.sep, "/");
}

function resolveGitRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });
  if (result.status === 0) {
    return result.stdout.trim();
  }
  return path.resolve(cwd, "../..");
}

function gitLines(args) {
  const text = gitText(args);
  return text.length === 0 ? [] : text.split(/\r?\n/).filter(Boolean);
}

function gitText(args) {
  const result = spawnSync("git", args, {
    cwd: gitRoot,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function readArgValue(args, index, flag) {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function tail(value) {
  return value.length > OUTPUT_TAIL_LIMIT ? value.slice(-OUTPUT_TAIL_LIMIT) : value;
}

function formatCommand(command, args) {
  return [command, ...args].map(quoteArg).join(" ");
}

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function displayPath(targetPath) {
  const relative = path.relative(appRoot, targetPath);
  if (relative.length === 0) {
    return ".";
  }
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return targetPath;
  }
  return relative.replaceAll(path.sep, "/");
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|");
}
