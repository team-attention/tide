import type { AgentSessionBlock } from "../domains/agent-session/agent-session-block.ts";
import type {
  AgentRuntimeHandle,
  AgentRuntimeState,
} from "../domains/agent-runtime/agent-runtime.ts";
import type {
  AgentBinding,
  AgentSessionBlockReference,
  PendingInput,
  PromptState,
  ProviderSessionRef,
  ThreadScope,
} from "../domains/thread/thread.ts";
import type {
  WorkbenchFileTreeView,
  WorkbenchState,
} from "../domains/workbench/workbench.ts";
import type { WorkspaceFileTree } from "../ports/outbound/workspace-file-port.ts";

// Pure deep-clone and small mapping helpers for Thread/Workbench domain state.
// Extracted from thread-runtime-service.ts to keep the service focused on
// behavior rather than structural copying. These functions are leaf-pure: they
// depend only on domain types, never on the service or its private state.

export function toAgentSessionBlockReference(
  block: AgentSessionBlock,
): AgentSessionBlockReference {
  return {
    blockId: block.blockId,
    agentId: block.agentId,
    kind: block.kind,
    role: block.role,
    sourceFrameIds: [...block.sourceFrameIds],
    localProvenance:
      block.localProvenance === undefined ? undefined : { ...block.localProvenance },
    status: block.status,
    title: block.title,
    body: block.body,
    data: block.data === undefined ? undefined : { ...block.data },
    rawFallback: block.rawFallback,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

export function cloneAgentBinding(binding: AgentBinding): AgentBinding {
  return {
    agentId: binding.agentId,
    runtimeSource:
      binding.runtimeSource === undefined ? undefined : { ...binding.runtimeSource },
    providerSessionRef:
      binding.providerSessionRef === undefined
        ? undefined
        : { ...binding.providerSessionRef },
  };
}

export function providerSessionRefsEqual(
  left: ProviderSessionRef,
  right: ProviderSessionRef,
): boolean {
  return (
    left.kind === right.kind &&
    left.value === right.value &&
    left.transcriptPath === right.transcriptPath &&
    left.logPath === right.logPath
  );
}

export function cloneScope(scope: ThreadScope | undefined): ThreadScope | undefined {
  if (scope === undefined) {
    return undefined;
  }
  return { ...scope };
}

export function cloneBlocks(
  blocks: AgentSessionBlockReference[],
): AgentSessionBlockReference[] {
  return blocks.map((block) => ({
    ...block,
    sourceFrameIds:
      block.sourceFrameIds === undefined ? undefined : [...block.sourceFrameIds],
    localProvenance:
      block.localProvenance === undefined ? undefined : { ...block.localProvenance },
    data: block.data === undefined ? undefined : { ...block.data },
  }));
}

export function clonePendingInput(
  pendingInput: PendingInput | undefined,
): PendingInput | undefined {
  return pendingInput === undefined
    ? undefined
    : {
        ...pendingInput,
        launchOptions: cloneLaunchOptions(pendingInput.launchOptions),
        attachments: pendingInput.attachments?.map((ref) => ({ ...ref })),
      };
}

export function cloneLaunchOptions(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return launchOptions === undefined ? undefined : { ...launchOptions };
}

export function clonePromptState(
  promptState: PromptState | undefined,
): PromptState | undefined {
  if (promptState === undefined) {
    return undefined;
  }
  return {
    ...promptState,
    choices: promptState.choices?.map((choice) => ({ ...choice })),
  };
}

export function runtimeStateForPromptKind(
  kind: PromptState["kind"],
): AgentRuntimeState {
  return kind === "approval" || kind === "permission"
    ? "waiting_for_approval"
    : "waiting_for_input";
}

export function cloneRuntimeHandle(
  handle: AgentRuntimeHandle | undefined,
): AgentRuntimeHandle | undefined {
  return handle === undefined ? undefined : { ...handle };
}

export function cloneWorkbenchState(workbench: WorkbenchState): WorkbenchState {
  return {
    panes: workbench.panes.map(cloneWorkbenchPaneState),
    activePaneId: workbench.activePaneId,
    focusOwner: workbench.focusOwner,
    fileTree:
      workbench.fileTree === undefined
        ? undefined
        : cloneFileTreeView(workbench.fileTree),
  };
}

export function cloneWorkbenchPaneState(
  pane: WorkbenchState["panes"][number],
): WorkbenchState["panes"][number] {
  if (pane.kind === "launcher") {
    return {
      ...pane,
      actions: pane.actions.map((action) => ({ ...action })),
    };
  }
  return { ...pane };
}

export function defaultWorkbenchState(): WorkbenchState {
  return {
    panes: [],
    focusOwner: "composer",
  };
}

export function cloneFileTreeView(
  fileTree: WorkbenchFileTreeView | WorkspaceFileTree,
): WorkbenchFileTreeView {
  return {
    root: fileTree.root,
    cwdLabel: fileTree.cwdLabel,
    revision: fileTree.revision,
    updatedAt: fileTree.updatedAt,
    entries: fileTree.entries.map((entry) => ({ ...entry })),
    truncated: fileTree.truncated,
  };
}
