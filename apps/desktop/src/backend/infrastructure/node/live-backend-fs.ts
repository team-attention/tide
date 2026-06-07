import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";

// Bounded, failure-tolerant filesystem read primitives used when scanning
// provider-owned history/state files. Each returns undefined/false on any error
// rather than throwing. Extracted from live-backend.ts.

export function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export function readJsonFile(path: string): Record<string, unknown> | undefined {
  const text = readTextFile(path);
  if (text === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// Reads the trailing bytes of a file, bounded so large transcripts stay cheap.
export function readBoundedTail(path: string, maxBytes: number): string | undefined {
  let fileDescriptor: number | undefined;
  try {
    const stat = statSync(path);
    const bytesToRead = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(bytesToRead);
    fileDescriptor = openSync(path, "r");
    readSync(fileDescriptor, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
    return buffer.toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fileDescriptor !== undefined) {
      closeSync(fileDescriptor);
    }
  }
}

// Reads the leading bytes of a file (codex session_meta and the first user turn
// live near the top), bounded so large transcripts stay cheap to scan.
export function readBoundedHead(path: string, maxBytes: number): string | undefined {
  let fileDescriptor: number | undefined;
  try {
    const stat = statSync(path);
    const bytesToRead = Math.min(maxBytes, stat.size);
    const buffer = Buffer.alloc(bytesToRead);
    fileDescriptor = openSync(path, "r");
    readSync(fileDescriptor, buffer, 0, bytesToRead, 0);
    return buffer.toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fileDescriptor !== undefined) {
      closeSync(fileDescriptor);
    }
  }
}
