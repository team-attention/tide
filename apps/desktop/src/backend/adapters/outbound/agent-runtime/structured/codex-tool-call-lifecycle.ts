import {
  codexToolCallRecordFromItem,
  codexToolItemId,
  codexToolNameFromItem,
  isCodexAppsMcpToolItem,
  isCodexVisibleToolItem,
  type CodexToolCallStatus,
} from "./codex-tool-call-record.ts";

const DEFAULT_CODEX_APPS_STALLED_NOTICE_MS = 120_000;

export interface CodexToolCallLifecycleInput {
  runtimeId: string;
  nextSequence: () => number;
  emitRecord: (sourceRef: string, payload: Record<string, unknown>, body: string) => void;
  onNotice: (message: string) => void;
}

export class CodexToolCallLifecycle {
  private readonly runtimeId: string;
  private readonly nextSequence: () => number;
  private readonly emitRecord: (sourceRef: string, payload: Record<string, unknown>, body: string) => void;
  private readonly onNotice: (message: string) => void;
  private readonly toolItemSequences = new Map<string, number>();
  private readonly pendingToolItems = new Map<string, { item: Record<string, unknown>; sequence: number }>();
  private readonly codexAppsStalledTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly codexAppsStalledNoticeMs = codexAppsStalledNoticeMs();

  constructor(input: CodexToolCallLifecycleInput) {
    this.runtimeId = input.runtimeId;
    this.nextSequence = input.nextSequence;
    this.emitRecord = input.emitRecord;
    this.onNotice = input.onNotice;
  }

  emit(item: Record<string, unknown>, status: CodexToolCallStatus): void {
    if (!isCodexVisibleToolItem(item)) {
      return;
    }
    const itemId = codexToolItemId(item, String(this.toolItemSequences.size));
    const sequence = this.sequenceForToolItem(itemId);
    const record = codexToolCallRecordFromItem({
      item,
      runtimeId: this.runtimeId,
      sequence,
      status,
    });
    if (record === undefined) {
      return;
    }
    this.emitRecord(record.sourceRef, record.payload, record.body);
    if (status === "pending") {
      this.pendingToolItems.set(itemId, { item, sequence });
      this.armCodexAppsStalledNotice(itemId, item);
      return;
    }
    this.pendingToolItems.delete(itemId);
    this.clearStalledTimer(itemId);
    this.toolItemSequences.delete(itemId);
  }

  failPendingForTurnEnd(status: string | undefined): void {
    if (this.pendingToolItems.size === 0) {
      this.clearTimeouts();
      this.toolItemSequences.clear();
      return;
    }
    const reason =
      status === "interrupted"
        ? "the Codex turn was interrupted"
        : status === "failed"
          ? "the Codex turn failed"
          : "the Codex turn ended";
    for (const [itemId, pending] of Array.from(this.pendingToolItems)) {
      this.pendingToolItems.delete(itemId);
      this.clearStalledTimer(itemId);
      const toolName = codexToolNameFromItem(pending.item) ?? "tool";
      this.emitFailedToolCallItem(
        pending.item,
        pending.sequence,
        `${toolName} did not return before ${reason}.`,
      );
    }
    this.toolItemSequences.clear();
  }

  clearTimeouts(): void {
    for (const timer of this.codexAppsStalledTimers.values()) {
      clearTimeout(timer);
    }
    this.codexAppsStalledTimers.clear();
  }

  private armCodexAppsStalledNotice(itemId: string, item: Record<string, unknown>): void {
    if (this.codexAppsStalledNoticeMs <= 0 || !isCodexAppsMcpToolItem(item) || this.codexAppsStalledTimers.has(itemId)) {
      return;
    }
    const timer = setTimeout(() => {
      this.codexAppsStalledTimers.delete(itemId);
      const pending = this.pendingToolItems.get(itemId);
      if (pending === undefined) {
        return;
      }
      const toolName = codexToolNameFromItem(item) ?? "codex_apps tool";
      const message = `${toolName} has not returned after ${formatDuration(this.codexAppsStalledNoticeMs)}. The Codex turn is still waiting for the connector.`;
      this.onNotice(message);
    }, this.codexAppsStalledNoticeMs);
    timer.unref();
    this.codexAppsStalledTimers.set(itemId, timer);
  }

  private emitFailedToolCallItem(item: Record<string, unknown>, sequence: number, message: string): void {
    const record = codexToolCallRecordFromItem({
      item,
      runtimeId: this.runtimeId,
      sequence,
      status: "failed",
    });
    if (record === undefined) {
      return;
    }
    record.payload.body = message;
    record.payload.error = message;
    record.body = message;
    this.emitRecord(record.sourceRef, record.payload, record.body);
  }

  private clearStalledTimer(itemId: string): void {
    const timer = this.codexAppsStalledTimers.get(itemId);
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    this.codexAppsStalledTimers.delete(itemId);
  }

  private sequenceForToolItem(itemId: string): number {
    const existing = this.toolItemSequences.get(itemId);
    if (existing !== undefined) {
      return existing;
    }
    const sequence = this.nextSequence();
    this.toolItemSequences.set(itemId, sequence);
    return sequence;
  }
}

function codexAppsStalledNoticeMs(): number {
  const raw = process.env.TIDE_CODEX_APPS_STALLED_NOTICE_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_CODEX_APPS_STALLED_NOTICE_MS;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}
