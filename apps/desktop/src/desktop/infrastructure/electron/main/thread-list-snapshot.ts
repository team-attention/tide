import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAppDataRoot } from "./backend-bridge.ts";
import {
  isJsonObject,
  type AgentBindingDto,
  type AgentRuntimeSourceDto,
  type JsonObject,
  type ProviderCliAgentId,
  type ThreadSummaryDto,
} from "../../../../shared/contracts/index.ts";

const THREAD_STORAGE_VERSION = 1;

interface IndexedThreadStorageRecord {
  storageVersion: typeof THREAD_STORAGE_VERSION;
  threadId: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  agentBinding: {
    agentId: ProviderCliAgentId;
    runtimeSource?: AgentRuntimeSourceDto;
    providerSessionRef?: ProviderSessionRefRecord;
  };
  scope:
    | { kind: "project"; projectId: string; cwd: string }
    | { kind: "scratch"; scratchCwd: string };
  launchOptions?: JsonObject;
  executionContext: { cwd: string };
  providerSessionRef?: ProviderSessionRefRecord;
  lastKnownState: ThreadSummaryDto["lastKnownState"];
}

interface ProviderSessionRefRecord {
  kind: NonNullable<AgentBindingDto["providerSessionRef"]>["kind"];
  value: string;
  transcriptPath?: string;
  logPath?: string;
}

export interface InitialThreadListSnapshot {
  threads: ThreadSummaryDto[];
}

// Synchronous, index-only snapshot for the first React render (spec:
// thread-list-first-paint-snapshot.md). This intentionally never scans
// threads/*/thread.json; if the index is missing/legacy/corrupt, the renderer shows the
// normal skeleton until the backend's authoritative thread.listed.
export function readInitialThreadListSnapshot(): InitialThreadListSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(resolveAppDataRoot(), "threads", "index.json"), "utf8")) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const index = parsed as { storageVersion?: unknown; threads?: unknown };
  if (index.storageVersion !== THREAD_STORAGE_VERSION || !Array.isArray(index.threads)) {
    return null;
  }

  const records: IndexedThreadStorageRecord[] = [];
  for (const entry of index.threads) {
    if (typeof entry !== "object" || entry === null || !("record" in entry)) {
      return null;
    }
    const record = (entry as { record?: unknown }).record;
    if (!isThreadStorageRecord(record)) {
      return null;
    }
    records.push(record);
  }

  records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { threads: records.map(threadSummaryFromRecord) };
}

function threadSummaryFromRecord(record: IndexedThreadStorageRecord): ThreadSummaryDto {
  const archived = record.archived || record.lastKnownState === "archived";
  const summary: ThreadSummaryDto = {
    threadId: record.threadId,
    title: record.title,
    agentBinding: agentBindingFromRecord(record),
    scope: { ...record.scope },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pinned: record.pinned,
    archived,
    lastKnownState: archived ? "archived" : record.lastKnownState,
  };
  if (record.launchOptions !== undefined) {
    summary.launchOptions = { ...record.launchOptions };
  }
  return summary;
}

function agentBindingFromRecord(record: IndexedThreadStorageRecord): AgentBindingDto {
  const providerSessionRef = record.providerSessionRef ?? record.agentBinding.providerSessionRef;
  const agentId = record.agentBinding.agentId;
  const binding: AgentBindingDto = {
    agentId,
  };
  binding.runtimeSource = record.agentBinding.runtimeSource ?? defaultRuntimeSourceForAgent(agentId);
  if (providerSessionRef !== undefined) {
    binding.providerSessionRef = {
      kind: providerSessionRef.kind,
      value: providerSessionRef.value,
    };
    if (providerSessionRef.transcriptPath !== undefined) {
      binding.providerSessionRef.transcriptPath = providerSessionRef.transcriptPath;
    }
    if (providerSessionRef.logPath !== undefined) {
      binding.providerSessionRef.logPath = providerSessionRef.logPath;
    }
  }
  return binding;
}

function defaultRuntimeSourceForAgent(agentId: ProviderCliAgentId): AgentRuntimeSourceDto {
  return { kind: "provider_cli", integrationId: agentId };
}

function isProviderCliAgentId(value: string): value is ProviderCliAgentId {
  return value === "codex" || value === "claude" || value === "gemini" || value === "opencode";
}

function isThreadStorageRecord(value: unknown): value is IndexedThreadStorageRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<IndexedThreadStorageRecord>;
  if (
    record.storageVersion !== THREAD_STORAGE_VERSION ||
    typeof record.threadId !== "string" ||
    typeof record.title !== "string" ||
    typeof record.pinned !== "boolean" ||
    typeof record.archived !== "boolean" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.agentBinding !== "object" ||
    record.agentBinding === null ||
    !isProviderCliAgentId(record.agentBinding.agentId) ||
    typeof record.scope !== "object" ||
    record.scope === null ||
    typeof record.executionContext !== "object" ||
    record.executionContext === null ||
    typeof record.executionContext.cwd !== "string" ||
    !isLastKnownState(record.lastKnownState)
  ) {
    return false;
  }
  if (record.launchOptions !== undefined && !isJsonObject(record.launchOptions)) {
    return false;
  }
  if (record.scope.kind === "project") {
    return typeof record.scope.projectId === "string" && typeof record.scope.cwd === "string";
  }
  return record.scope.kind === "scratch" && typeof record.scope.scratchCwd === "string";
}

function isLastKnownState(value: unknown): value is ThreadSummaryDto["lastKnownState"] {
  return (
    value === "idle" ||
    value === "running" ||
    value === "waiting_for_input" ||
    value === "waiting_for_approval" ||
    value === "failed" ||
    value === "archived"
  );
}
