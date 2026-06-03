export interface AppStoragePort {
  readJson(relativePath: string): Promise<unknown | undefined>;
  writeJsonAtomic(relativePath: string, value: unknown): Promise<void>;
  readJsonl(relativePath: string): Promise<unknown[]>;
  writeJsonlAtomic(relativePath: string, rows: unknown[]): Promise<void>;
  writeTextAtomic(relativePath: string, value: string): Promise<void>;
  appendText(relativePath: string, value: string): Promise<void>;
  listDirectories(relativePath: string): Promise<string[]>;
  exists(relativePath: string): Promise<boolean>;
  remove(relativePath: string): Promise<void>;
}
