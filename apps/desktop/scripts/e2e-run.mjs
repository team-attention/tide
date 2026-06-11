#!/usr/bin/env node

// The one end-to-end gate. Builds once, then runs the canonical verification
// battery per agent and prints ONE summary table (agent × scenario →
// PASS/FAIL/SKIP). Exit code is non-zero iff any cell FAILED.
//
// SKIP-honest: an agent that is not installed / not signed in / not trusted is
// SKIPPED (with a reason), never FAILED — so the gate is runnable on a dev machine
// with partial auth. In a fully-authed environment pass --require-live to turn
// every SKIP into a FAIL.
//
// Usage:
//   node scripts/e2e-run.mjs [--agent <id|all>] [--scenario <name|all>]
//                            [--require-live] [--include-app-e2e]
//                            [--no-build] [--dry-run] [--verbose]
//
// See docs_v2/implementation/codebase-issues-and-remediation-plan.md (Phase 2).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertNodeVersion } from "./assert-node-version.mjs";
import { PROVIDER_CLI_AGENT_IDS } from "../src/shared/contracts/agent-descriptors.ts";

assertNodeVersion();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function flag(name) {
  return args.includes(name);
}
function value(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const options = {
  agent: value("--agent", "all"),
  scenario: value("--scenario", "all"),
  requireLive: flag("--require-live"),
  includeAppE2e: flag("--include-app-e2e"),
  noBuild: flag("--no-build"),
  dryRun: flag("--dry-run"),
  verbose: flag("--verbose"),
  help: flag("--help") || flag("-h"),
};

if (options.help) {
  printHelp();
  process.exit(0);
}

const ALL_AGENTS = [...PROVIDER_CLI_AGENT_IDS];
const agents = options.agent === "all" ? ALL_AGENTS : [options.agent];
for (const agent of agents) {
  if (!ALL_AGENTS.includes(agent)) {
    console.error(`Unknown --agent "${agent}". Known: ${ALL_AGENTS.join(", ")}, all`);
    process.exit(2);
  }
}

// Each scenario is a script invocation. `gate: true` marks the readiness gate
// (smoke): if it SKIPs (provider not ready) the rest of the agent's row is
// skipped; if it FAILs the rest is skipped too. `node` scripts run under the
// type-stripping runtime; `cjs` scripts are plain node.
function scenariosFor(agent) {
  const list = [
    { name: "smoke", gate: true, kind: "node", script: "v2-provider-smoke.mjs", argv: ["--agent", agent] },
    { name: "permission", kind: "node", script: "v2-provider-permission-flow.mjs", argv: ["--agent", agent] },
    { name: "state:trust", kind: "node", script: "v2-provider-state-matrix.mjs", argv: ["--case", "trust", "--agent", agent] },
    { name: "state:concurrency", kind: "node", script: "v2-provider-state-matrix.mjs", argv: ["--case", "concurrency", "--agent", agent] },
    { name: "state:followup", kind: "node", script: "v2-provider-state-matrix.mjs", argv: ["--case", "followup", "--agent", agent] },
  ];
  if (options.includeAppE2e) {
    list.push({ name: "app-e2e", kind: "cjs", script: "pw-provider-e2e.cjs", argv: [agent] });
  }
  if (options.scenario === "all") {
    return list;
  }
  return list.filter((scenario) => scenario.name === options.scenario);
}

// Exit-code contract (from the canonical scripts): 0 = PASS; 2 = provider not
// ready (→ SKIP); anything else = FAIL.
function classify(status) {
  if (status === 0) return "PASS";
  if (status === 2) return "SKIP";
  return "FAIL";
}

function runScenario(scenario) {
  const file = path.join(repoRoot, "scripts", scenario.script);
  const command = scenario.kind === "node"
    ? ["node", ["--experimental-strip-types", file, ...scenario.argv]]
    : ["node", [file, ...scenario.argv]];
  if (options.dryRun) {
    return { result: "DRY", detail: `${command[0]} ${command[1].join(" ")}` };
  }
  const proc = spawnSync(command[0], command[1], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180_000,
  });
  const result = classify(proc.status ?? 1);
  if ((result === "FAIL" || options.verbose) && (proc.stdout || proc.stderr)) {
    process.stdout.write(`\n--- ${scenario.script} ${scenario.argv.join(" ")} (${result}) ---\n`);
    if (proc.stdout) process.stdout.write(proc.stdout);
    if (proc.stderr) process.stderr.write(proc.stderr);
  }
  return { result, detail: result === "SKIP" ? "provider not ready" : "" };
}

async function main() {
  if (!options.noBuild && !options.dryRun) {
    process.stdout.write("Building (npm run build)…\n");
    const build = spawnSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
    if ((build.status ?? 1) !== 0) {
      console.error("Build failed — aborting e2e gate.");
      process.exit(1);
    }
  }

  const rows = [];
  let anyFail = false;

  for (const agent of agents) {
    const scenarios = scenariosFor(agent);
    let gateSkipped = false;
    let gateFailed = false;
    for (const scenario of scenarios) {
      let cell;
      if (gateSkipped) {
        cell = { result: "SKIP", detail: "gate skipped (provider not ready)" };
      } else if (gateFailed) {
        cell = { result: "SKIP", detail: "gate failed" };
      } else {
        cell = runScenario(scenario);
      }
      if (scenario.gate) {
        if (cell.result === "SKIP") gateSkipped = true;
        if (cell.result === "FAIL") gateFailed = true;
      }
      let effective = cell.result;
      if (options.requireLive && cell.result === "SKIP") {
        effective = "FAIL";
        cell.detail = `${cell.detail} (--require-live)`;
      }
      if (effective === "FAIL") anyFail = true;
      rows.push({ agent, scenario: scenario.name, result: effective, detail: cell.detail });
    }
  }

  printSummary(rows);
  if (options.dryRun) {
    process.exit(0);
  }
  process.exit(anyFail ? 1 : 0);
}

function printSummary(rows) {
  const icon = { PASS: "✔", FAIL: "✖", SKIP: "•", DRY: "·" };
  const agentWidth = Math.max(8, ...rows.map((row) => row.agent.length));
  const scenarioWidth = Math.max(10, ...rows.map((row) => row.scenario.length));
  process.stdout.write("\n=== e2e gate summary ===\n");
  for (const row of rows) {
    const mark = icon[row.result] ?? "?";
    const detail = row.detail ? `  ${row.detail}` : "";
    process.stdout.write(
      `${mark} ${row.agent.padEnd(agentWidth)}  ${row.scenario.padEnd(scenarioWidth)}  ${row.result}${detail}\n`,
    );
  }
  const fails = rows.filter((row) => row.result === "FAIL").length;
  const skips = rows.filter((row) => row.result === "SKIP").length;
  const passes = rows.filter((row) => row.result === "PASS").length;
  process.stdout.write(`\n${passes} pass · ${fails} fail · ${skips} skip\n`);
}

function printHelp() {
  process.stdout.write(
    [
      "Tide v2 e2e gate — runs the canonical verification battery per agent.",
      "",
      "  --agent <id|all>       provider-CLI agent (default all)",
      "  --scenario <name|all>  smoke | permission | state:trust | state:concurrency |",
      "                         state:followup | app-e2e (default all)",
      "  --require-live         turn SKIP (not-ready) into FAIL (authed CI)",
      "  --include-app-e2e      also run the real-app Playwright e2e (needs built app + auth)",
      "  --no-build             skip the up-front npm run build",
      "  --dry-run              print the plan, run nothing",
      "  --verbose              print each scenario's output, not just failures",
      "",
      "Exit: non-zero iff any cell FAILED. SKIP = provider not installed/authed/trusted.",
    ].join("\n") + "\n",
  );
}

await main();
