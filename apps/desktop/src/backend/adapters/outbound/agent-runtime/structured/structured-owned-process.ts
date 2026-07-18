import type { SpawnOptions } from "node:child_process";

import {
  createStandaloneOwnedProcessSpawner,
  type BackendOwnedProcessKind,
  type BackendOwnedProcessScope,
  type BackendOwnedProcessSpawner,
  type ManagedBackendOwnedProcess,
} from "../../../../infrastructure/node/process/backend-owned-process.ts";

export interface StructuredProcessOwnershipInput {
  processSpawner?: BackendOwnedProcessSpawner;
  processKind?: BackendOwnedProcessKind;
  processScope?: BackendOwnedProcessScope;
}

export function spawnStructuredOwnedProcess(input: StructuredProcessOwnershipInput & {
  providerId: string;
  threadId: string;
  runtimeId: string;
  command: string;
  args: string[];
  options: SpawnOptions;
  beforeSignal: () => Promise<void> | void;
}): ManagedBackendOwnedProcess {
  const kind = input.processKind ?? "agent_runtime";
  return (input.processSpawner ?? createStandaloneOwnedProcessSpawner()).spawn({
    resourceId: `${kind}:${input.runtimeId}`,
    kind,
    scope: input.processScope ?? {
      kind: "runtime",
      threadId: input.threadId,
      runtimeId: input.runtimeId,
      agentId: input.providerId,
    },
    command: input.command,
    args: input.args,
    options: input.options,
    beforeSignal: input.beforeSignal,
  });
}

export type { ManagedBackendOwnedProcess };
