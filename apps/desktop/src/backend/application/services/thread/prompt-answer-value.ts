import type { PromptState } from "../../domains/thread/thread.ts";
import type { AnswerPromptInput } from "./thread-runtime-api.ts";

// Resolves what gets written to the provider for a prompt answer: explicit
// free text wins (the "Other…" reply), otherwise the chosen choice's
// provider-native value, otherwise the raw choiceId. Extracted from
// thread-runtime-service.ts (file-size ratchet).
export function promptAnswerValue(
  promptState: PromptState,
  input: AnswerPromptInput,
): string {
  if (input.value !== undefined && input.value.length > 0) {
    return input.value;
  }

  const choiceId = input.choiceId;
  if (choiceId === undefined) {
    return input.value ?? "";
  }

  return promptState.choices?.find((choice) => choice.choiceId === choiceId)?.providerValue ??
    choiceId;
}
