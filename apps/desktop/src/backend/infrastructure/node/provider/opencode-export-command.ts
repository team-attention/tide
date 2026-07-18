import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { resolveExecutable } from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";

const OPENCODE_EXPORT_TIMEOUT_MS = 8_000;
const OPENCODE_EXPORT_MAX_BYTES = 8 * 1024 * 1024;

// opencode 1.18.x can exit before a large process.stdout.write() has drained
// into a captured pipe. Attaching stdout directly to a regular file makes the
// provider's write synchronous and preserves the complete unsanitized export.
export function runOpencodeExport(sessionId: string): string | undefined {
  const executablePath = resolveExecutable("opencode");
  if (executablePath === undefined) {
    return undefined;
  }
  return runFileBackedStdoutCommand({
    executablePath,
    args: ["export", sessionId],
    timeoutMs: OPENCODE_EXPORT_TIMEOUT_MS,
    maxOutputBytes: OPENCODE_EXPORT_MAX_BYTES,
  });
}

export function runFileBackedStdoutCommand(input: {
  executablePath: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  tempRoot?: string;
}): string | undefined {
  let tempDirectory: string | undefined;
  let outputPath: string | undefined;
  let outputFd: number | undefined;
  try {
    tempDirectory = mkdtempSync(join(input.tempRoot ?? tmpdir(), "tide-opencode-export-"));
    outputPath = join(tempDirectory, "stdout.json");
    outputFd = openSync(outputPath, "wx", 0o600);
    const result = spawnSync(input.executablePath, input.args, {
      encoding: "utf8",
      timeout: input.timeoutMs,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", outputFd, "pipe"],
    });
    closeSync(outputFd);
    outputFd = undefined;
    if (result.status !== 0 || result.error !== undefined) {
      return undefined;
    }
    const size = statSync(outputPath).size;
    if (size > input.maxOutputBytes) {
      return undefined;
    }
    return readFileSync(outputPath, "utf8");
  } catch {
    return undefined;
  } finally {
    if (outputFd !== undefined) {
      try {
        closeSync(outputFd);
      } catch {
        // Continue exact-path cleanup after a failed close.
      }
    }
    if (outputPath !== undefined) {
      try {
        unlinkSync(outputPath);
      } catch {
        // The output file may not have been created.
      }
    }
    if (tempDirectory !== undefined) {
      try {
        rmdirSync(tempDirectory);
      } catch {
        // Nothing else is created in this private directory.
      }
    }
  }
}
