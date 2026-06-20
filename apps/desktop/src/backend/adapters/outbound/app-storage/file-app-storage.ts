import fs from "node:fs/promises";
import path from "node:path";

import type { AppStoragePort } from "../../../application/ports/outbound/app-storage-port.ts";

// Monotonic across all atomic writes in this process so concurrent writers never
// collide on a temp filename.
let atomicWriteCounter = 0;

export interface CreateFileAppStorageInput {
  appDataRoot: string;
}

export function createFileAppStorage(
  input: CreateFileAppStorageInput,
): AppStoragePort {
  return new FileAppStorage(input.appDataRoot);
}

class FileAppStorage implements AppStoragePort {
  private readonly appDataRoot: string;

  constructor(appDataRoot: string) {
    this.appDataRoot = path.resolve(appDataRoot);
  }

  async readJson(relativePath: string): Promise<unknown | undefined> {
    const filePath = this.resolve(relativePath);
    try {
      return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async writeJsonAtomic(relativePath: string, value: unknown): Promise<void> {
    await this.writeTextAtomic(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async readJsonl(relativePath: string): Promise<unknown[]> {
    const filePath = this.resolve(relativePath);
    let text: string;
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }

    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);
  }

  async writeJsonlAtomic(relativePath: string, rows: unknown[]): Promise<void> {
    const text = rows.map((row) => JSON.stringify(row)).join("\n");
    await this.writeTextAtomic(relativePath, text.length === 0 ? "" : `${text}\n`);
  }

  async writeTextAtomic(relativePath: string, value: string): Promise<void> {
    const filePath = this.resolve(relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // The temp name must be unique per call: two writes to the same file within the
    // same millisecond (concurrent history polls re-persisting the same thread) would
    // otherwise collide on `pid-Date.now()`, and one rename would ENOENT on the temp
    // the other already consumed — crashing the backend. A monotonic counter +
    // randomness makes collisions impossible.
    atomicWriteCounter += 1;
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${atomicWriteCounter}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await fs.writeFile(tempPath, value, "utf8");
    await fs.rename(tempPath, filePath);
  }

  async appendText(relativePath: string, value: string): Promise<void> {
    const filePath = this.resolve(relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, value, "utf8");
  }

  async listDirectories(relativePath: string): Promise<string[]> {
    const directoryPath = this.resolve(relativePath);
    let entries: string[];
    try {
      entries = await fs.readdir(directoryPath);
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }

    const checked = await Promise.all(
      entries.map(async (entry) => {
        try {
          const entryStat = await fs.stat(path.join(directoryPath, entry));
          return entryStat.isDirectory() ? entry : null;
        } catch {
          return null;
        }
      }),
    );
    return checked.filter((entry): entry is string => entry !== null).sort();
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relativePath));
      return true;
    } catch (error) {
      if (isMissingFile(error)) {
        return false;
      }
      throw error;
    }
  }

  async remove(relativePath: string): Promise<void> {
    await fs.rm(this.resolve(relativePath), { force: true, recursive: true });
  }

  private resolve(relativePath: string): string {
    const filePath = path.resolve(this.appDataRoot, relativePath);
    if (filePath !== this.appDataRoot && !filePath.startsWith(`${this.appDataRoot}${path.sep}`)) {
      throw new Error(`Storage path escapes app data root: ${relativePath}`);
    }
    return filePath;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
