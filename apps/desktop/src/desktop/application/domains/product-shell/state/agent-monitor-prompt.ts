import type { AgentChatPromptState } from "../../agent-chat/agent-chat.ts";
import type { ProductShellAgentMonitorPromptSnapshot, ProductShellAgentMonitorSession } from "./types.ts";

export function monitorPromptKindFromPrompt(
  promptKind: AgentChatPromptState["kind"],
): ProductShellAgentMonitorSession["pendingPromptKind"] | undefined {
  if (promptKind === "approval" || promptKind === "permission") {
    return "approval";
  }
  if (promptKind === "question" || promptKind === "choice") {
    return "question";
  }
  return promptKind === "command_picker" ? "mcp_elicitation" : undefined;
}

export function monitorPromptSnapshot(
  prompt: AgentChatPromptState | null | undefined,
): ProductShellAgentMonitorPromptSnapshot | undefined {
  if (prompt === null || prompt === undefined || prompt.steps !== undefined || prompt.multiSelect === true) {
    return undefined;
  }
  const kind = monitorPromptKindFromPrompt(prompt.kind);
  if (kind === undefined || prompt.choices === undefined || prompt.choices.length === 0) {
    return undefined;
  }
  return {
    promptId: prompt.promptId,
    kind,
    message: prompt.message,
    choices: prompt.choices.map((choice) => ({
      choiceId: choice.choiceId,
      label: choice.label,
      providerValue: choice.providerValue,
      ...(choice.kind !== undefined ? { kind: choice.kind } : {}),
    })),
    ...(prompt.defaultChoiceId !== undefined ? { defaultChoiceId: prompt.defaultChoiceId } : {}),
  };
}
