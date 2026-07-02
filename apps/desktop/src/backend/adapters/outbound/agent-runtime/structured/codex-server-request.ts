import type { PromptState } from "../../../../application/domains/thread/thread.ts";
import type { StructuredProviderEvent } from "./structured-runtime-events.ts";
import { isRecord, stringField } from "./codex-app-server-shared.ts";
import {
  codexApprovalPrompt,
  codexLegacyReviewPrompt,
  codexMcpElicitationPrompt,
  codexRequestUserInputPrompt,
  type PendingServerPrompt,
} from "./codex-server-prompt.ts";

export interface CodexServerRequestContext {
  threadId: string;
  pendingServerPrompts: Map<string, PendingServerPrompt>;
  writeLine: (value: unknown) => void;
  onEvent: (event: StructuredProviderEvent) => void;
}

export function handleCodexServerRequest(
  ctx: CodexServerRequestContext,
  method: string,
  serverRequestId: number | string,
  params: Record<string, unknown>,
): void {
  if (method === "item/commandExecution/requestApproval") {
    const command = stringField(params, "command") ?? "Run command";
    const cwd = stringField(params, "cwd");
    const reason = stringField(params, "reason");
    surface(ctx, codexApprovalPrompt({
      serverRequestId,
      threadId: ctx.threadId,
      message: reason !== undefined ? `Run command — ${reason}` : "Run command",
      detail: { format: "text", body: cwd !== undefined ? `${command}\n\n# cwd: ${cwd}` : command },
    }));
    return;
  }
  if (method === "item/fileChange/requestApproval") {
    const reason = stringField(params, "reason");
    surface(ctx, codexApprovalPrompt({
      serverRequestId,
      threadId: ctx.threadId,
      message: reason !== undefined ? `Apply file changes — ${reason}` : "Apply file changes",
    }));
    return;
  }
  if (method === "item/tool/requestUserInput") {
    const prompt = codexRequestUserInputPrompt({ serverRequestId, threadId: ctx.threadId, params });
    if (prompt === undefined) {
      ctx.writeLine({ id: serverRequestId, result: { answers: {} } });
      notice(ctx, "Codex requested user input with no answerable questions.");
      return;
    }
    surface(ctx, prompt);
    return;
  }
  if (method === "mcpServer/elicitation/request") {
    surface(ctx, codexMcpElicitationPrompt({ serverRequestId, threadId: ctx.threadId, params }));
    return;
  }
  if (method === "applyPatchApproval") {
    const reason = stringField(params, "reason");
    const grantRoot = stringField(params, "grantRoot");
    const files = isRecord(params.fileChanges) ? Object.keys(params.fileChanges) : [];
    const lines = [
      ...(reason !== undefined ? [`reason: ${reason}`] : []),
      ...(grantRoot !== undefined ? [`grant root: ${grantRoot}`] : []),
      ...(files.length > 0 ? [`files:\n${files.map((file) => `- ${file}`).join("\n")}`] : []),
    ];
    surface(ctx, codexLegacyReviewPrompt({
      serverRequestId,
      threadId: ctx.threadId,
      message: reason !== undefined ? `Apply patch — ${reason}` : "Apply patch",
      ...(lines.length > 0 ? { detail: { format: "text", body: lines.join("\n\n") } } : {}),
    }));
    return;
  }
  if (method === "execCommandApproval") {
    const command = Array.isArray(params.command)
      ? params.command.filter((part): part is string => typeof part === "string").join(" ")
      : "Run command";
    const cwd = stringField(params, "cwd");
    const reason = stringField(params, "reason");
    surface(ctx, codexLegacyReviewPrompt({
      serverRequestId,
      threadId: ctx.threadId,
      message: reason !== undefined ? `Run command — ${reason}` : "Run command",
      detail: { format: "text", body: cwd !== undefined ? `${command}\n\n# cwd: ${cwd}` : command },
    }));
    return;
  }
  if (method === "item/tool/call") {
    const tool = stringField(params, "tool") ?? "tool";
    ctx.writeLine({
      id: serverRequestId,
      result: {
        contentItems: [{ type: "inputText", text: `Tide does not support Codex dynamic tool call "${tool}".` }],
        success: false,
      },
    });
    notice(ctx, `Codex dynamic tool call "${tool}" was declined by Tide.`);
    return;
  }
  if (method === "item/permissions/requestApproval") {
    ctx.writeLine({
      id: serverRequestId,
      result: { permissions: {}, scope: "turn", strictAutoReview: true },
    });
    notice(ctx, "Codex requested unsupported environment permissions; Tide granted no extra permissions.");
    return;
  }
  const message = `Tide does not support Codex server request "${method}".`;
  ctx.writeLine({ id: serverRequestId, error: { code: -32601, message } });
  notice(ctx, message);
}

function surface(
  ctx: CodexServerRequestContext,
  prompt: { promptState: PromptState; pending: PendingServerPrompt },
): void {
  ctx.pendingServerPrompts.set(prompt.promptState.promptId, prompt.pending);
  ctx.onEvent({ kind: "prompt", promptState: prompt.promptState });
}

function notice(ctx: CodexServerRequestContext, message: string): void {
  ctx.onEvent({ kind: "runtime_notice", level: "info", message });
}
