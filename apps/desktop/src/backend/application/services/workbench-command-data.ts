import {
  arrayOfStrings,
  recordField,
  recordOfStrings,
  stringField,
} from "./record-helpers.ts";
import {
  boundedBrowserTextPreview,
  optionalRawString,
  optionalString,
} from "./service-value-helpers.ts";

// Parsers that coerce untyped Tide MCP / workbench command `data` payloads into
// the typed shapes the service acts on. Pure: depend only on leaf value/record
// helpers. Extracted from thread-runtime-service.ts to keep the service focused
// on behavior.

export interface ProviderSetupSurfaceActionInput {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  expectedCompletion: "process_exit" | "retry_preflight";
}

export function providerSetupSurfaceActionFromData(
  data: Record<string, unknown> | undefined,
): ProviderSetupSurfaceActionInput | undefined {
  const setup = recordField(data, "setup");
  const command = stringField(setup, "command");
  const cwd = stringField(setup, "cwd");
  const expectedCompletion = stringField(setup, "expectedCompletion");
  if (
    command === undefined ||
    cwd === undefined ||
    (expectedCompletion !== "process_exit" && expectedCompletion !== "retry_preflight")
  ) {
    return undefined;
  }
  return {
    command,
    args: arrayOfStrings(setup?.args),
    env: recordOfStrings(setup?.env),
    cwd,
    expectedCompletion,
  };
}

export function providerSetupSurfaceInputFromData(
  data: Record<string, unknown> | undefined,
): string | undefined {
  const input = data?.input ?? data?.bytes;
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

export function editorPaneSaveFromData(
  data: Record<string, unknown> | undefined,
): { baseRevision: string; content: string } | undefined {
  const baseRevision = stringField(data, "baseRevision");
  const content = data?.content;
  if (baseRevision === undefined || typeof content !== "string") {
    return undefined;
  }
  return { baseRevision, content };
}

export function editorPanePositionFromData(
  data: Record<string, unknown> | undefined,
): { line: number; character: number } | undefined {
  const line = data?.line;
  const character = data?.character;
  if (
    typeof line !== "number" ||
    typeof character !== "number" ||
    !Number.isInteger(line) ||
    !Number.isInteger(character) ||
    line < 0 ||
    character < 0
  ) {
    return undefined;
  }
  return { line, character };
}

export function browserPaneSnapshotFromData(
  data: Record<string, unknown> | undefined,
):
  | {
      revision: string;
      url?: string;
      pageTitle?: string;
      bodyTextPreview?: string;
      loading?: boolean;
    }
  | undefined {
  const revision = optionalString(data?.revision);
  if (revision === undefined) {
    return undefined;
  }
  const bodyTextPreview =
    typeof data?.bodyTextPreview === "string"
      ? boundedBrowserTextPreview(data.bodyTextPreview)
      : undefined;
  return {
    revision,
    url: optionalString(data?.url),
    pageTitle: optionalString(data?.pageTitle),
    bodyTextPreview,
    loading: typeof data?.loading === "boolean" ? data.loading : undefined,
  };
}

export function browserPaneActionResultFromData(
  data: Record<string, unknown> | undefined,
):
  | {
      revision: string;
      actionId: string;
      status: "completed" | "failed";
      message: string;
      url?: string;
      pageTitle?: string;
      bodyTextPreview?: string;
      loading?: boolean;
    }
  | undefined {
  const revision = optionalString(data?.revision);
  const actionId = optionalString(data?.actionId);
  const status =
    data?.status === "completed" || data?.status === "failed" ? data.status : undefined;
  const message = optionalRawString(data?.message);
  if (
    revision === undefined ||
    actionId === undefined ||
    status === undefined ||
    message === undefined
  ) {
    return undefined;
  }
  const bodyTextPreview =
    typeof data?.bodyTextPreview === "string"
      ? boundedBrowserTextPreview(data.bodyTextPreview)
      : undefined;
  return {
    revision,
    actionId,
    status,
    message,
    url: optionalString(data?.url),
    pageTitle: optionalString(data?.pageTitle),
    bodyTextPreview,
    loading: typeof data?.loading === "boolean" ? data.loading : undefined,
  };
}
