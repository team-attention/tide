import { execFile } from "node:child_process";

import { parseReviewFindings, type ReviewFinding } from "../../../application/domains/product-shell/state/review-findings.ts";

export type ReviewProvider = "codex" | "claude" | "opencode";

export type ReviewTarget =
  | { kind: "uncommitted" }
  | { kind: "base_branch"; baseBranch: string }
  | { kind: "commit"; sha: string; title?: string }
  | { kind: "custom"; instructions: string; diff?: string };

export type ReviewRunSource =
  | "codex_cli"
  | "claude_ultrareview"
  | "claude_prompt"
  | "opencode_prompt";

export interface ReviewRunResult {
  ok: boolean;
  provider: ReviewProvider;
  source: ReviewRunSource;
  target: ReviewTarget;
  cwd: string;
  command: string;
  startedAt: string;
  completedAt: string;
  rawText: string;
  findings: ReviewFinding[];
  stderr?: string;
  exitCode?: number | null;
  signal?: string | null;
  message?: string;
}

export interface ReviewCommand {
  command: string;
  args: string[];
  source: ReviewRunSource;
  stdin?: string;
}

const REVIEW_MAX_BUFFER = 12 * 1024 * 1024;
const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
const PROMPT_DIFF_LIMIT = 180 * 1024;

export async function runProviderReview(input: {
  cwd: unknown;
  provider: unknown;
  target: unknown;
}): Promise<ReviewRunResult> {
  const startedAt = new Date().toISOString();
  const cwd = typeof input.cwd === "string" ? input.cwd : "";
  const provider = reviewProviderFromInput(input.provider);
  const target = reviewTargetFromInput(input.target);
  const fail = (
    message: string,
    partial?: Partial<Pick<ReviewRunResult, "source" | "command" | "rawText" | "stderr" | "exitCode" | "signal">>,
  ): ReviewRunResult => ({
    ok: false,
    provider: provider ?? "codex",
    source: partial?.source ?? "codex_cli",
    target: target ?? { kind: "uncommitted" },
    cwd,
    command: partial?.command ?? "",
    startedAt,
    completedAt: new Date().toISOString(),
    rawText: partial?.rawText ?? "",
    findings: parseReviewFindings(partial?.rawText ?? ""),
    stderr: partial?.stderr,
    exitCode: partial?.exitCode,
    signal: partial?.signal,
    message,
  });

  if (cwd.length === 0 || provider === undefined || target === undefined) {
    return fail("Invalid review request.");
  }
  const inside = (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (inside !== "true") {
    return fail("Review requires a git repository.");
  }

  const command = await buildReviewCommand({ cwd, provider, target });
  if (command === null) {
    return fail("This review target is unavailable for the selected provider.");
  }
  const executed = await execFileWithInput(command.command, command.args, {
    cwd,
    stdin: command.stdin,
  });
  const rawText = [executed.stdout, executed.stderr].filter((part) => part.trim().length > 0).join("\n\n");
  const findings = parseReviewFindings(rawText);
  return {
    ok: executed.ok,
    provider,
    source: command.source,
    target,
    cwd,
    command: shellPreview(command.command, command.args),
    startedAt,
    completedAt: new Date().toISOString(),
    rawText,
    findings,
    stderr: executed.stderr.trim().length > 0 ? executed.stderr : undefined,
    exitCode: executed.exitCode,
    signal: executed.signal,
    message: executed.ok ? undefined : reviewErrorMessage(command.command, executed),
  };
}

export async function buildReviewCommand(input: {
  cwd: string;
  provider: ReviewProvider;
  target: ReviewTarget;
}): Promise<ReviewCommand | null> {
  switch (input.provider) {
    case "codex":
      return codexReviewCommand(input.target);
    case "claude":
      return claudeReviewCommand(input.cwd, input.target);
    case "opencode":
      return opencodeReviewCommand(input.cwd, input.target);
  }
}

function codexReviewCommand(target: ReviewTarget): ReviewCommand | null {
  const args = ["review"];
  let stdin: string | undefined;
  switch (target.kind) {
    case "uncommitted":
      args.push("--uncommitted");
      break;
    case "base_branch":
      args.push("--base", target.baseBranch);
      break;
    case "commit":
      args.push("--commit", target.sha);
      if (target.title !== undefined && target.title.length > 0) {
        args.push("--title", target.title);
      }
      break;
    case "custom":
      args.push("-");
      stdin = customInstructions(target);
      break;
  }
  return { command: "codex", args, source: "codex_cli", stdin };
}

async function claudeReviewCommand(cwd: string, target: ReviewTarget): Promise<ReviewCommand | null> {
  if (target.kind === "base_branch") {
    return {
      command: "claude",
      args: ["ultrareview", target.baseBranch, "--timeout", "10"],
      source: "claude_ultrareview",
    };
  }
  const prompt = await promptReviewInstructions(cwd, target, "Claude");
  return {
    command: "claude",
    args: ["-p", "--output-format", "text", "--permission-mode", "plan", prompt],
    source: "claude_prompt",
  };
}

async function opencodeReviewCommand(cwd: string, target: ReviewTarget): Promise<ReviewCommand | null> {
  const prompt = await promptReviewInstructions(cwd, target, "opencode");
  return {
    command: "opencode",
    args: ["run", "--format", "json", "--dir", cwd, "--title", "Tide Review", prompt],
    source: "opencode_prompt",
  };
}

async function promptReviewInstructions(
  cwd: string,
  target: ReviewTarget,
  providerLabel: string,
): Promise<string> {
  const diff = target.kind === "custom" && target.diff !== undefined
    ? target.diff
    : await diffForTarget(cwd, target);
  const instructions = target.kind === "custom" ? target.instructions : "";
  return [
    `You are running a Tide code review through ${providerLabel}.`,
    "Review the diff below for correctness bugs, regressions, missing tests, security risks, and risky edge cases.",
    "Return findings first. For each finding include severity, file/line when possible, and a concise fix recommendation.",
    instructions.length > 0 ? `Additional instructions:\n${instructions}` : "",
    "Diff:",
    fencedText(boundedText(diff, PROMPT_DIFF_LIMIT)),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

async function diffForTarget(cwd: string, target: ReviewTarget): Promise<string> {
  switch (target.kind) {
    case "uncommitted":
      return uncommittedDiff(cwd);
    case "base_branch":
      return runGit(cwd, ["diff", "--no-color", `${target.baseBranch}...HEAD`]);
    case "commit":
      return runGit(cwd, ["show", "--no-color", "--format=fuller", "--stat", "--patch", target.sha]);
    case "custom":
      return target.diff ?? "";
  }
}

async function uncommittedDiff(cwd: string): Promise<string> {
  const root = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim() || cwd;
  const tracked = await runGit(root, ["-c", "core.quotepath=false", "diff", "--no-color", "HEAD"]);
  const untracked = (await runGit(root, ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard"]))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const chunks = [tracked];
  for (const file of untracked) {
    const result = await execGitArgs([
      "-c",
      "core.quotepath=false",
      "-C",
      root,
      "diff",
      "--no-color",
      "--no-index",
      "--",
      "/dev/null",
      file,
    ]);
    if (result.stdout.trim().length > 0) {
      chunks.push(result.stdout);
    }
  }
  return chunks.filter((chunk) => chunk.trim().length > 0).join("\n");
}

function reviewProviderFromInput(value: unknown): ReviewProvider | undefined {
  return value === "codex" || value === "claude" || value === "opencode" ? value : undefined;
}

function reviewTargetFromInput(value: unknown): ReviewTarget | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const target = value as {
    kind?: unknown;
    baseBranch?: unknown;
    sha?: unknown;
    title?: unknown;
    instructions?: unknown;
    diff?: unknown;
  };
  switch (target.kind) {
    case "uncommitted":
      return { kind: "uncommitted" };
    case "base_branch":
      return typeof target.baseBranch === "string" && target.baseBranch.trim().length > 0
        ? { kind: "base_branch", baseBranch: target.baseBranch.trim() }
        : undefined;
    case "commit":
      return typeof target.sha === "string" && target.sha.trim().length > 0
        ? {
            kind: "commit",
            sha: target.sha.trim(),
            ...(typeof target.title === "string" && target.title.trim().length > 0
              ? { title: target.title.trim() }
              : {}),
          }
        : undefined;
    case "custom":
      return typeof target.instructions === "string" && target.instructions.trim().length > 0
        ? {
            kind: "custom",
            instructions: target.instructions.trim(),
            ...(typeof target.diff === "string" && target.diff.trim().length > 0
              ? { diff: target.diff }
              : {}),
          }
        : undefined;
    default:
      return undefined;
  }
}

function customInstructions(target: Extract<ReviewTarget, { kind: "custom" }>): string {
  return [
    target.instructions,
    target.diff !== undefined && target.diff.trim().length > 0
      ? `\nDiff/context:\n${fencedText(boundedText(target.diff, PROMPT_DIFF_LIMIT))}`
      : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function execFileWithInput(
  command: string,
  args: string[],
  options: { cwd: string; stdin?: string },
): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  errorCode?: string;
}> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        maxBuffer: REVIEW_MAX_BUFFER,
        timeout: REVIEW_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        const typedError = error as
          | (Error & { code?: string | number; signal?: string | null; killed?: boolean })
          | null;
        const code = typedError?.code;
        resolve({
          ok: error === null,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: typeof code === "number" ? code : error === null ? 0 : null,
          signal: typedError?.signal ?? null,
          errorCode: typeof code === "string" ? code : undefined,
        });
      },
    );
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }
  });
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

function execGitArgs(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function reviewErrorMessage(
  command: string,
  result: { stderr: string; errorCode?: string; signal: string | null },
): string {
  if (result.errorCode === "ENOENT") {
    return `${command} is not installed or is not on PATH.`;
  }
  if (result.signal !== null) {
    return `${command} review was stopped (${result.signal}).`;
  }
  return result.stderr.trim() || `${command} review failed.`;
}

function shellPreview(command: string, args: string[]): string {
  return [command, ...args.map(shellQuote)].join(" ");
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

function fencedText(value: string): string {
  return `\`\`\`diff\n${value}\n\`\`\``;
}

function boundedText(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}\n\n[truncated ${value.length - maxLength} chars]`;
}
