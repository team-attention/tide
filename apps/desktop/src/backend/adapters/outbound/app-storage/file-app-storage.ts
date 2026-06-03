import fs from "node:fs/promises";
import path from "node:path";

import type { AppStoragePort } from "../../../application/ports/outbound/app-storage-port.ts";

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
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
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

    const directories: string[] = [];
    for (const entry of entries) {
      const stat = await fs.stat(path.join(directoryPath, entry));
      if (stat.isDirectory()) {
        directories.push(entry);
      }
    }
    return directories.sort();
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
