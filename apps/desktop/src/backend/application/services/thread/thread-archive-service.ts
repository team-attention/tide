import type { AgentRuntimePort } from "../../ports/outbound/agent-runtime-port.ts";
import type { TerminalPaneState } from "../../domains/workbench/workbench.ts";
import type { ThreadRecord } from "../../domains/thread/thread.ts";
import { boundedTranscriptPreview } from "../support/service-value-helpers.ts";
import { BrowserCaptureCoordinator } from "../workbench/browser-capture-coordinator.ts";
import { WorkbenchRuntime } from "../workbench/workbench-runtime.ts";

export interface ThreadArchiveServiceInput {
  agentRuntimePort: AgentRuntimePort;
  workbenchRuntime: WorkbenchRuntime;
  browserCapture: BrowserCaptureCoordinator;
  clock: () => string;
}

export class ThreadArchiveService {
  private readonly agentRuntimePort: AgentRuntimePort;
  private readonly workbenchRuntime: WorkbenchRuntime;
  private readonly browserCapture: BrowserCaptureCoordinator;
  private readonly clock: () => string;

  constructor(input: ThreadArchiveServiceInput) {
    this.agentRuntimePort = input.agentRuntimePort;
    this.workbenchRuntime = input.workbenchRuntime;
    this.browserCapture = input.browserCapture;
    this.clock = input.clock;
  }

  async teardownThreadForArchive(thread: ThreadRecord): Promise<void> {
    const archivedAt = this.clock();
    const runtimeHandle = thread.activeRuntimeHandle;
    thread.activeRuntimeHandle = undefined;
    thread.pendingRuntimeRestart = false;
    thread.pendingInput = undefined;
    thread.pendingInputQueue = undefined;
    thread.promptState = undefined;
    thread.promptQueue = undefined;
    thread.promptAnsweredPendingSettle = false;
    thread.streamingBlocks = [];
    thread.runtimeState = "stopped";
    thread.lifecycleState = "archived";
    thread.lastKnownState = "archived";
    thread.runtimeStartedAt = undefined;
    thread.updatedAt = archivedAt;

    for (const pane of thread.workbench.panes) {
      if (pane.kind === "browser") {
        if (pane.pendingCapture !== undefined) {
          this.browserCapture.cancel(pane.pendingCapture.captureId);
          delete pane.pendingCapture;
        }
        delete pane.pendingAction;
        pane.agentDriving = false;
        delete pane.agentCursor;
        delete pane.userControlled;
        pane.updatedAt = archivedAt;
      }
      if (pane.kind === "terminal") {
        if (pane.status === "running" || pane.status === "ready") {
          pane.status = "completed";
          pane.signal = "SIGTERM";
          pane.completedAt = archivedAt;
          pane.transcriptPreview = boundedTranscriptPreview(
            `${pane.transcriptPreview ?? ""}\n[terminal stopped: thread archived]\n`,
          );
        }
        pane.updatedAt = archivedAt;
      }
    }

    await Promise.all(
      thread.workbench.panes
        .filter((pane): pane is TerminalPaneState => pane.kind === "terminal")
        .map((pane) => this.workbenchRuntime.stopTerminalPane(pane).catch(() => {})),
    );

    if (runtimeHandle !== undefined) {
      await this.agentRuntimePort.stop(runtimeHandle).catch(() => {});
    }
  }

  resetThreadAfterUnarchive(thread: ThreadRecord): boolean {
    if (thread.lastKnownState !== "archived") {
      return false;
    }
    thread.runtimeState = "idle";
    thread.lastKnownState = "idle";
    thread.updatedAt = this.clock();
    return true;
  }
}
