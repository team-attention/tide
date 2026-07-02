import { failure, type ServiceResult } from "../support/service-result.ts";
import type { AgentRuntimeHandle } from "../../domains/agent-runtime/agent-runtime.ts";
import type { AgentRuntimePort } from "../../ports/outbound/agent-runtime-port.ts";
import type { SetThreadGoalInput, SetThreadGoalResult, ThreadCrudService } from "./thread-crud-service.ts";
import type {
  RecordProviderGoalStateInput,
  RecordProviderGoalStateResult,
  RecordProviderTurnStartedInput,
  RecordProviderTurnStartedResult,
} from "./thread-runtime-api.ts";
import { snapshotThread } from "./thread-snapshot.ts";
import type { ThreadStore } from "./thread-store.ts";

export async function setThreadGoalWithRuntime(input: {
  command: SetThreadGoalInput;
  threadCrud: ThreadCrudService;
  threads: ThreadStore;
  agentRuntimePort: AgentRuntimePort;
  activeOrResumedHandle: (thread: NonNullable<ReturnType<ThreadStore["get"]>>) => Promise<AgentRuntimeHandle>;
  clock: () => string;
}): Promise<ServiceResult<SetThreadGoalResult>> {
  const result = await input.threadCrud.setGoal(input.command);
  if (!result.ok) {
    return result;
  }
  const thread = input.threads.get(input.command.threadId);
  if (thread === undefined) {
    return result;
  }
  if (thread.goal === undefined) {
    if (thread.activeRuntimeHandle !== undefined) {
      await input.agentRuntimePort.writeInput(thread.activeRuntimeHandle, {
        kind: "goal_set",
        value: "",
        submittedAt: input.clock(),
      });
    }
    return { ok: true, thread: snapshotThread(thread) };
  }
  const handle = await input.activeOrResumedHandle(thread);
  await input.agentRuntimePort.writeInput(handle, {
    kind: "goal_set",
    value: thread.goal,
    submittedAt: input.clock(),
  });
  return { ok: true, thread: snapshotThread(thread) };
}

export class ThreadGoalStateService {
  private readonly threads: ThreadStore;
  private readonly clock: () => string;

  constructor(input: { threads: ThreadStore; clock: () => string }) {
    this.threads = input.threads;
    this.clock = input.clock;
  }

  recordProviderGoalState(
    input: RecordProviderGoalStateInput,
  ): ServiceResult<RecordProviderGoalStateResult> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    const now = this.clock();
    const goalState = input.goalState;
    if (goalState === undefined) {
      thread.goal = undefined;
      thread.goalState = undefined;
      thread.updatedAt = now;
      return { ok: true, thread: snapshotThread(thread), runtimeState: thread.runtimeState };
    }

    const objective = goalState.objective.trim();
    if (objective.length === 0) {
      thread.goal = undefined;
      thread.goalState = undefined;
      thread.updatedAt = now;
      return { ok: true, thread: snapshotThread(thread), runtimeState: thread.runtimeState };
    }

    thread.goal = objective;
    thread.goalState = {
      ...goalState,
      objective,
      createdAt: goalState.createdAt ?? thread.goalState?.createdAt ?? now,
      updatedAt: goalState.updatedAt ?? now,
    };
    thread.updatedAt = now;
    return { ok: true, thread: snapshotThread(thread), runtimeState: thread.runtimeState };
  }

  recordProviderTurnStarted(
    input: RecordProviderTurnStartedInput,
  ): ServiceResult<RecordProviderTurnStartedResult> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    thread.runtimeState = "running";
    thread.runtimeStartedAt = this.clock();
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = thread.runtimeStartedAt;
    return { ok: true, thread: snapshotThread(thread), runtimeState: thread.runtimeState };
  }
}
