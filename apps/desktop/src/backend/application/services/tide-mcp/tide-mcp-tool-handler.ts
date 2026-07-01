import type { AgentId, ThreadId, ThreadRecord, ThreadSnapshot } from "../../domains/thread/thread.ts";
import type {
  BrowserPaneScreenshot,
  BrowserPaneState,
  TideMcpToolDefinition,
  TideMcpToolName,
} from "../../domains/workbench/workbench.ts";
import { TIDE_MCP_WORKBENCH_TOOL_NAMES } from "../../domains/workbench/workbench.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import { snapshotThread } from "../thread/thread-snapshot.ts";
import type { ThreadRuntimeAsyncEvent } from "../thread/thread-runtime-events.ts";
import type { ThreadStore } from "../thread/thread-store.ts";
import { BrowserCaptureCoordinator } from "../workbench/browser-capture-coordinator.ts";
import {
  actBrowserOutput,
  observeBrowserOutput,
  openBrowserOutput,
} from "../workbench/workbench-browser-operations.ts";
import type { WorkbenchExecOperations } from "../workbench/workbench-exec-operations.ts";
import type { WorkbenchFileOperations } from "../workbench/workbench-file-operations.ts";
import { snapshotWorkbench } from "../workbench/workbench-snapshot.ts";
import type {
  TideMcpToolOutput,
  TideObserveThreadOutput,
  TideObserveWorkbenchOutput,
} from "./tide-mcp-output.ts";

// The Tide MCP tool surface dispatcher: resolves the calling MCP session to its
// Thread, dispatches each tool to the workbench operation collaborators, and
// surfaces a workbench change. Thin — all pane operations live in the
// browser/file/exec collaborators. Extracted from thread-runtime-service.ts.
// See docs_v2/specs/thread-runtime-service-decomposition.md.

// Ceiling for the observe-time capture round-trip (renderer capturePage + IPC both ways).
// Longer than the renderer's own 2s capturePage race so a slow-but-arriving capture still wins;
// past it, observe degrades to the cached screenshot / DOM text instead of hanging the agent.
const BROWSER_CAPTURE_PULL_TIMEOUT_MS = 3000;

export interface TideMcpSessionRef {
  runtimeId: string;
  agentId: AgentId;
  threadId?: ThreadId;
}

export interface TideMcpToolCallInput {
  session: TideMcpSessionRef;
  toolName: TideMcpToolName;
  input?: Record<string, unknown>;
}

export interface TideMcpToolCallResult {
  handledByService: true;
  thread: ThreadSnapshot;
  toolName: TideMcpToolName;
  output: TideMcpToolOutput;
  mcpToolCallCount: number;
}

export interface TideMcpToolHandlerDeps {
  store: ThreadStore;
  clock: () => string;
  idGenerator: () => string;
  emitAsyncEvent: (event: ThreadRuntimeAsyncEvent) => void;
  workbenchFileOps: WorkbenchFileOperations;
  workbenchExec: WorkbenchExecOperations;
  browserCapture: BrowserCaptureCoordinator;
  // Ceiling for the observe-time capture round-trip. Defaults to BROWSER_CAPTURE_PULL_TIMEOUT_MS;
  // a backend-only test (no renderer to reply) injects a tiny value so observe degrades at once.
  browserCapturePullTimeoutMs?: number;
}

export class TideMcpToolHandler {
  private readonly store: ThreadStore;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly emitAsyncEvent: (event: ThreadRuntimeAsyncEvent) => void;
  private readonly workbenchFileOps: WorkbenchFileOperations;
  private readonly workbenchExec: WorkbenchExecOperations;
  private readonly browserCapture: BrowserCaptureCoordinator;
  private readonly browserCapturePullTimeoutMs: number;

  constructor(deps: TideMcpToolHandlerDeps) {
    this.store = deps.store;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
    this.emitAsyncEvent = deps.emitAsyncEvent;
    this.workbenchFileOps = deps.workbenchFileOps;
    this.workbenchExec = deps.workbenchExec;
    this.browserCapture = deps.browserCapture;
    this.browserCapturePullTimeoutMs =
      deps.browserCapturePullTimeoutMs ?? BROWSER_CAPTURE_PULL_TIMEOUT_MS;
  }

  listTools(): TideMcpToolDefinition[] {
    return TIDE_MCP_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { ...tool.inputSchema },
    }));
  }

  async handleToolCall(
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>> {
    if (!isTideMcpToolName(input.toolName)) {
      return failure(
        "unsupported_tide_mcp_tool",
        "Tide MCP tool is not supported by this slice.",
      );
    }

    const resolved = this.resolveMcpThread(input.session);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    const thread = resolved.thread;

    thread.mcpToolCallCount += 1;
    thread.updatedAt = this.clock();

    const output = await this.dispatch(thread, input);
    if (!output.ok) {
      return { ok: false, error: output.error };
    }
    if (isWorkbenchMutatingTideMcpTool(input.toolName)) {
      this.emitAsyncEvent({
        kind: "workbench_changed",
        thread: snapshotThread(thread),
      });
    }

    return {
      ok: true,
      handledByService: true,
      thread: snapshotThread(thread),
      toolName: input.toolName,
      output: output.value,
      mcpToolCallCount: thread.mcpToolCallCount,
    };
  }

  // Observe-time pixel-capture pull: mark the pane's pendingCapture, push it to the renderer
  // host (which captures the live <webview> for this captureId and replies via
  // update_browser_capture_result), and await the reply. Returns the fresh screenshot, or
  // undefined on timeout (pane closed / not painting) so observe falls back to the cache.
  // Spec: docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
  private async pullBrowserScreenshot(
    thread: ThreadRecord,
    pane: BrowserPaneState,
  ): Promise<BrowserPaneScreenshot | undefined> {
    const captureId = this.idGenerator();
    pane.pendingCapture = { captureId, requestedAt: this.clock() };
    try {
      this.emitAsyncEvent({ kind: "workbench_changed", thread: snapshotThread(thread) });
      return await this.browserCapture.request(captureId, this.browserCapturePullTimeoutMs);
    } finally {
      // On the happy path the result command already cleared pendingCapture; clear it here for
      // the timeout path (and an unexpected emit/await throw) and re-broadcast so the renderer
      // host stops offering to capture this id — never leave a stale pendingCapture on the pane.
      if (pane.pendingCapture?.captureId === captureId) {
        delete pane.pendingCapture;
        this.emitAsyncEvent({ kind: "workbench_changed", thread: snapshotThread(thread) });
      }
    }
  }

  private resolveMcpThread(
    session: TideMcpSessionRef,
  ): ServiceResult<{ thread: ThreadRecord }> {
    if (session.threadId !== undefined) {
      const thread = this.store.get(session.threadId);
      if (thread === undefined) {
        return failure("thread_not_found", "Thread was not found.");
      }
      if (!threadMatchesMcpSession(thread, session)) {
        return failure(
          "agent_runtime_unavailable",
          "MCP Session does not match the Thread's active Agent Runtime.",
        );
      }
      return { ok: true, thread };
    }

    for (const thread of this.store.values()) {
      if (threadMatchesMcpSession(thread, session)) {
        return { ok: true, thread };
      }
    }

    return failure(
      "agent_runtime_unavailable",
      "MCP Session did not match an active Agent Runtime.",
    );
  }

  private async dispatch(
    thread: ThreadRecord,
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<{ value: TideMcpToolOutput }>> {
    switch (input.toolName) {
      case "tide_observe_thread":
        return { ok: true, value: observeThreadOutput(thread) };
      case "tide_observe_workbench":
        return { ok: true, value: observeWorkbenchOutput(thread) };
      case "tide_open_browser":
        return {
          ok: true,
          value: openBrowserOutput(thread, input.input, this.idGenerator, this.clock),
        };
      case "tide_observe_browser":
        return observeBrowserOutput(
          thread,
          input.input,
          (pane) => this.pullBrowserScreenshot(thread, pane),
          this.clock,
        );
      case "tide_act_browser":
        return actBrowserOutput(thread, input.input, this.idGenerator, this.clock);
      case "tide_read_file":
        return this.workbenchFileOps.readFileOutput(thread, input.input);
      case "tide_open_file":
        return this.workbenchFileOps.openFileOutput(thread, input.input);
      case "tide_edit_file":
        return this.workbenchFileOps.editFileOutput(thread, input.input);
      case "tide_go_to_definition":
        return this.workbenchExec.goToDefinitionOutput(thread, input.input);
      case "tide_go_to_references":
        return this.workbenchExec.goToReferencesOutput(thread, input.input);
      case "tide_open_terminal":
        return this.workbenchExec.openTerminalOutput(thread, input.input);
      case "tide_run_terminal_command":
        return this.workbenchExec.runTerminalCommandOutput(thread, input.input);
      case "tide_focus_pane":
        return this.workbenchExec.focusPaneOutput(thread, input.input);
      case "tide_close_pane":
        return this.workbenchExec.closePaneOutput(thread, input.input);
      case "tide_set_workbench_layout":
        return this.workbenchExec.setWorkbenchLayoutOutput(thread, input.input);
    }
  }
}

function observeThreadOutput(thread: ThreadRecord): TideObserveThreadOutput {
  return {
    kind: "observe_thread",
    threadId: thread.threadId,
    agentId: thread.agentBinding.agentId,
    agentChatState: thread.runtimeState,
    promptActive: thread.promptState !== undefined,
    workbenchOpen: thread.workbench.panes.length > 0,
    availableTools: [...TIDE_MCP_WORKBENCH_TOOL_NAMES],
  };
}

function observeWorkbenchOutput(thread: ThreadRecord): TideObserveWorkbenchOutput {
  return {
    kind: "observe_workbench",
    threadId: thread.threadId,
    ...snapshotWorkbench(thread.workbench),
  };
}

function threadMatchesMcpSession(
  thread: ThreadRecord,
  session: TideMcpSessionRef,
): boolean {
  const handle = thread.activeRuntimeHandle;
  return (
    handle !== undefined &&
    handle.runtimeId === session.runtimeId &&
    handle.agentId === session.agentId &&
    handle.threadId === thread.threadId
  );
}

function isTideMcpToolName(toolName: string): toolName is TideMcpToolName {
  return TIDE_MCP_WORKBENCH_TOOL_NAMES.includes(toolName as TideMcpToolName);
}

function isWorkbenchMutatingTideMcpTool(toolName: TideMcpToolName): boolean {
  switch (toolName) {
    case "tide_open_browser":
    case "tide_act_browser":
    case "tide_open_file":
    case "tide_edit_file":
    case "tide_go_to_definition":
    case "tide_go_to_references":
    case "tide_open_terminal":
    case "tide_run_terminal_command":
    case "tide_focus_pane":
    case "tide_close_pane":
    case "tide_set_workbench_layout":
      return true;
    case "tide_observe_thread":
    case "tide_observe_workbench":
    case "tide_observe_browser":
    case "tide_read_file":
      return false;
  }
}

const TIDE_MCP_TOOL_DEFINITIONS: TideMcpToolDefinition[] = [
  {
    name: "tide_observe_thread",
    description: "Observe bounded Thread and Agent Chat state for the owning MCP Session.",
    inputSchema: {
      type: "object",
      properties: {
        detail: { type: "string", enum: ["compact", "full"] },
      },
    },
  },
  {
    name: "tide_observe_workbench",
    description: "Observe Workbench Pane refs for the owning Thread without mutating state.",
    inputSchema: {
      type: "object",
      properties: {
        detail: { type: "string", enum: ["compact", "full"] },
      },
    },
  },
  {
    name: "tide_open_browser",
    description: "Create, reveal, or navigate an open Tide Browser Pane in the owning Thread Workbench.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        disposition: {
          type: "string",
          enum: ["reuse_active_browser", "new_browser_pane"],
        },
      },
    },
  },
  {
    name: "tide_observe_browser",
    description:
      "Observe bounded Browser Pane state after validating Thread ownership and revision. mode=both (default) returns BOTH a pixel screenshot of the rendered page as an image block (see it like a human) AND the DOM text; mode=text returns DOM text only (cheaper); mode=screenshot drops the text.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
        revision: { type: "string" },
        detail: { type: "string", enum: ["compact", "full"] },
        mode: { type: "string", enum: ["text", "screenshot", "both"] },
      },
      required: ["paneId"],
    },
  },
  {
    name: "tide_act_browser",
    description:
      "Operate an open Tide Browser Pane like a human (hybrid). Coordinate computer-use actions move the cursor and drive the live page via real input events: move_to/click_at (x,y; click_at takes optional button and clickCount), drag (x,y,toX,toY; useful for bottom sheets/sliders), scroll (x,y,deltaX,deltaY), key (keys like \"Enter\" or \"Cmd+A\"), and type (text into the focused element). Selector actions click/type_text (selector, text) are the reliability fallback. Coordinates are screenshot pixels from the latest tide_observe_browser image; Tide converts them to webview CSS pixels.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
        revision: { type: "string" },
        action: {
          type: "string",
          enum: ["click", "type_text", "move_to", "click_at", "drag", "scroll", "key", "type"],
        },
        selector: { type: "string", description: "Required for click / type_text." },
        text: { type: "string", description: "Required for type_text and type." },
        x: { type: "number", description: "Required for move_to / click_at / drag / scroll." },
        y: { type: "number", description: "Required for move_to / click_at / drag / scroll." },
        toX: { type: "number", description: "Required for drag." },
        toY: { type: "number", description: "Required for drag." },
        durationMs: { type: "number", description: "Optional for drag; clamped to 0-2000ms." },
        steps: { type: "number", description: "Optional for drag; clamped to 1-60." },
        button: { type: "string", enum: ["left", "right", "middle"] },
        clickCount: { type: "number", enum: [1, 2] },
        deltaX: { type: "number", description: "Wheel delta for scroll." },
        deltaY: { type: "number", description: "Wheel delta for scroll." },
        keys: { type: "string", description: "Required for key (e.g. \"Enter\", \"Cmd+A\")." },
      },
      required: ["paneId", "revision", "action"],
    },
  },
  {
    name: "tide_read_file",
    description: "Read bounded text file content inside the owning Thread root without mutating Workbench state.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        byteLimit: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "tide_open_file",
    description: "Create, reveal, or refresh an open Tide Editor Pane for a text file in the owning Thread root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        byteLimit: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "tide_edit_file",
    description: "Replace exact text inside a Thread-root text file and expose a bounded Diff Pane.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
        expectedOccurrences: { type: "number" },
        byteLimit: { type: "number" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "tide_go_to_definition",
    description: "Navigate from an existing Editor Pane cursor position to an open definition Editor Pane.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
        line: { type: "number" },
        character: { type: "number" },
      },
      required: ["paneId", "line", "character"],
    },
  },
  {
    name: "tide_go_to_references",
    description: "List every Thread-root use site of the symbol at an Editor Pane cursor position as an open references list on that Pane.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
        line: { type: "number" },
        character: { type: "number" },
      },
      required: ["paneId", "line", "character"],
    },
  },
  {
    name: "tide_open_terminal",
    description: "Open or reveal an interactive Terminal Pane in the owning Thread Workbench.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: {
          type: "array",
          items: { type: "string" },
        },
        cwd: { type: "string" },
      },
    },
  },
  {
    name: "tide_run_terminal_command",
    description: "Run a bounded non-interactive command in the owning Thread Execution Context and expose a Terminal Pane.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: {
          type: "array",
          items: { type: "string" },
        },
        cwd: { type: "string" },
        timeoutMs: { type: "number" },
        byteLimit: { type: "number" },
      },
      required: ["command"],
    },
  },
  {
    name: "tide_focus_pane",
    description: "Reveal and activate an existing Workbench Pane (browser/editor/terminal/diff) so the user sees it.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
      },
      required: ["paneId"],
    },
  },
  {
    name: "tide_close_pane",
    description: "Close a Workbench Pane in the owning Thread (stops the PTY for a Terminal Pane).",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
      },
      required: ["paneId"],
    },
  },
  {
    name: "tide_set_workbench_layout",
    description: "Switch the owning Thread Workbench between Stacked (one active pane) and Split (tiled panes) presentation.",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["stacked", "split"] },
      },
      required: ["mode"],
    },
  },
];
