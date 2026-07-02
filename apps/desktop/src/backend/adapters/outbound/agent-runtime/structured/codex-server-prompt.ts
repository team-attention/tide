import type { PromptDetail, PromptState } from "../../../../application/domains/thread/thread.ts";
import { bounded, isRecord, stringField } from "./codex-app-server-shared.ts";

export const CODEX_ACCEPT_TOKEN = "structured:accept";
export const CODEX_DECLINE_TOKEN = "structured:decline";
// "Allow for this session": codex's native session-scoped approval - the same command/files
// are not re-prompted for the rest of the session (decision: "acceptForSession").
// See docs_v2/specs/codex-permission-allow-for-session.md.
export const CODEX_ACCEPT_FOR_SESSION_TOKEN = "structured:accept_for_session";

export type PendingServerPrompt =
  | { kind: "approval"; serverRequestId: number | string }
  | {
      kind: "mcp_elicitation";
      serverRequestId: number | string;
      acceptContent: Record<string, unknown> | null;
    };

export function codexServerPromptResult(
  pending: PendingServerPrompt,
  value: string,
): Record<string, unknown> {
  if (pending.kind === "mcp_elicitation") {
    const action = value === CODEX_ACCEPT_TOKEN || value === CODEX_ACCEPT_FOR_SESSION_TOKEN
      ? "accept"
      : "decline";
    return {
      action,
      content: action === "accept" ? pending.acceptContent : null,
      _meta: null,
    };
  }
  // codex v2 decision enum: accept / acceptForSession (don't re-prompt this session) /
  // decline. Secure-by-default: only an EXPLICIT allow token approves; the Skip button
  // (value ""), a dismissed card, or any unrecognized answer DECLINES.
  return {
    decision: value === CODEX_ACCEPT_TOKEN
      ? "accept"
      : value === CODEX_ACCEPT_FOR_SESSION_TOKEN
        ? "acceptForSession"
        : "decline",
  };
}

export function codexApprovalPrompt(input: {
  serverRequestId: number | string;
  threadId: string;
  message: string;
  detail?: PromptDetail;
}): { promptState: PromptState; pending: PendingServerPrompt } {
  const promptId = `codex-perm-${String(input.serverRequestId)}`;
  return {
    pending: { kind: "approval", serverRequestId: input.serverRequestId },
    promptState: {
      promptId,
      threadId: input.threadId,
      agentId: "codex",
      kind: "approval",
      message: input.message,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      choices: [
        { choiceId: "allow", label: "Allow", providerValue: CODEX_ACCEPT_TOKEN },
        {
          choiceId: "allow_session",
          label: "Allow for this session",
          providerValue: CODEX_ACCEPT_FOR_SESSION_TOKEN,
          kind: "allow_always",
        },
        { choiceId: "deny", label: "Deny", providerValue: CODEX_DECLINE_TOKEN },
      ],
      defaultChoiceId: "allow",
      source: "provider_hook",
    },
  };
}

export function codexMcpElicitationPrompt(input: {
  serverRequestId: number | string;
  threadId: string;
  params: Record<string, unknown>;
}): { promptState: PromptState; pending: PendingServerPrompt } {
  const promptId = `codex-mcp-elicit-${String(input.serverRequestId)}`;
  const mode = stringField(input.params, "mode");
  const detail = mcpElicitationDetail(input.params);
  return {
    pending: {
      kind: "mcp_elicitation",
      serverRequestId: input.serverRequestId,
      acceptContent: mode === "form" ? {} : null,
    },
    promptState: {
      promptId,
      threadId: input.threadId,
      agentId: "codex",
      kind: "approval",
      message: stringField(input.params, "message") ?? "Allow MCP request",
      ...(detail !== undefined ? { detail } : {}),
      choices: [
        { choiceId: "allow", label: "Allow", providerValue: CODEX_ACCEPT_TOKEN },
        { choiceId: "deny", label: "Deny", providerValue: CODEX_DECLINE_TOKEN },
      ],
      defaultChoiceId: "allow",
      source: "provider_hook",
    },
  };
}

function mcpElicitationDetail(params: Record<string, unknown>): PromptDetail | undefined {
  const meta = isRecord(params._meta) ? params._meta : undefined;
  const lines: string[] = [];
  const serverName = stringField(params, "serverName");
  if (serverName !== undefined) {
    lines.push(`server: ${serverName}`);
  }
  const toolTitle = meta !== undefined
    ? stringField(meta, "tool_title") ?? stringField(meta, "tool_name") ?? stringField(meta, "tool")
    : undefined;
  if (toolTitle !== undefined) {
    lines.push(`tool: ${toolTitle}`);
  }
  const toolArguments = meta !== undefined ? meta.tool_arguments : undefined;
  if (toolArguments !== undefined) {
    lines.push(`arguments: ${bounded(jsonDetail(toolArguments))}`);
  }
  if (lines.length === 0) {
    return undefined;
  }
  return { format: "text", body: lines.join("\n") };
}

function jsonDetail(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
