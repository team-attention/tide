import { buildPermissionPrompt } from "./claude-permission-prompt.ts";
import type { AskUserQuestionContext, PendingPermission } from "./claude-ask-user-question.ts";
import { surfaceAskUserQuestion, surfaceAskUserQuestionWizard } from "./claude-ask-user-question.ts";
import { writeUnsupportedClaudeControlRequest } from "./claude-control-request.ts";
import { addRulesOnlySuggestions, isRecord, stringField } from "./claude-stream-json-shared.ts";

export function handleClaudeControlRequest(input: {
  message: Record<string, unknown>;
  context: AskUserQuestionContext;
  pendingPermissions: Map<string, PendingPermission>;
}): void {
  const requestId = stringField(input.message, "request_id");
  if (requestId === undefined) return;
  const request = isRecord(input.message.request) ? input.message.request : undefined;
  if (request?.subtype !== "can_use_tool") {
    writeUnsupportedClaudeControlRequest({
      requestId,
      subtype: request === undefined ? "malformed" : String(request.subtype ?? "unknown"),
      writeLine: input.context.writeLine,
      onEvent: input.context.onEvent,
    });
    return;
  }
  const toolName = stringField(request, "tool_name") ?? "tool";
  const toolInput = isRecord(request.input) ? request.input : {};
  const promptId = `claude-perm-${requestId}`;
  if (toolName === "AskUserQuestion") {
    const questions = Array.isArray(toolInput.questions) ? toolInput.questions : [];
    if (questions.length > 1 && surfaceAskUserQuestionWizard(input.context, requestId, toolInput, questions)) return;
    if (questions.length > 0 && surfaceAskUserQuestion(input.context, requestId, toolInput, questions, {}, 0, {})) return;
  }
  const ruleUpdates = addRulesOnlySuggestions(request.permission_suggestions);
  input.pendingPermissions.set(promptId, {
    requestId,
    toolInput,
    ...(ruleUpdates !== undefined ? { permissionRuleUpdates: ruleUpdates } : {}),
  });
  input.context.onEvent({
    kind: "prompt",
    promptState: buildPermissionPrompt({
      promptId,
      threadId: input.context.threadId,
      agentId: input.context.agentId,
      toolName,
      toolInput,
      ruleUpdates,
    }),
  });
}
