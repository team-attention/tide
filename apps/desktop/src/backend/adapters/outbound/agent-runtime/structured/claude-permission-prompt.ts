// Builds the approval-card PromptState for a claude `can_use_tool` permission request: the
// headline message, the previewable detail (Bash command / Edit diff / Write content), and the
// Allow / Allow always / Deny choices. Extracted from claude-stream-json-client.ts to keep that
// file under the size cap; pure (no I/O, no client state). The Allow-always choice and its rule
// echo are specced in docs_v2/specs/claude-permission-allow-always.md.
import type { PromptChoice, PromptDetail, PromptState } from "../../../../application/domains/thread/thread.ts";
import {
  STRUCTURED_ALLOW_ALWAYS_TOKEN,
  STRUCTURED_ALLOW_TOKEN,
  STRUCTURED_DENY_TOKEN,
  bounded,
  buildAllowAlwaysLabel,
  stringField,
} from "./claude-stream-json-shared.ts";

export interface PermissionPromptArgs {
  promptId: string;
  threadId: PromptState["threadId"];
  agentId: PromptState["agentId"];
  toolName: string;
  toolInput: Record<string, unknown>;
  // The CLI's addRules permission_suggestions when the set is purely addRules (⇒ an Allow-always
  // choice labeled from the rule); undefined otherwise (no Allow-always choice).
  ruleUpdates: unknown[] | undefined;
}

export function buildPermissionPrompt(args: PermissionPromptArgs): PromptState {
  const { promptId, threadId, agentId, toolName, toolInput, ruleUpdates } = args;
  const target =
    stringField(toolInput, "command") ??
    stringField(toolInput, "url") ??
    stringField(toolInput, "query") ??
    stringField(toolInput, "path") ??
    stringField(toolInput, "file_path") ??
    stringField(toolInput, "pattern");
  const message =
    stringField(toolInput, "description") ??
    (target !== undefined ? `${toolName}: ${target}` : `Claude Code permission required for ${toolName}.`);
  // The structured input behind the headline: the Bash command, an Edit's before/after diff, or
  // a Write's content — shown as the approval card's detail.
  const detail = buildPermissionDetail(toolInput);
  // Order: Allow / Allow always / Deny. The always-choice is present only when the CLI sent a
  // pure-addRules suggestion (ruleUpdates); it rides the existing `kind: "allow_always"` styling.
  const choices: PromptChoice[] = [
    { choiceId: "allow", label: "Allow", providerValue: STRUCTURED_ALLOW_TOKEN },
  ];
  if (ruleUpdates !== undefined) {
    choices.push({
      choiceId: "allow_always",
      label: buildAllowAlwaysLabel(ruleUpdates),
      providerValue: STRUCTURED_ALLOW_ALWAYS_TOKEN,
      kind: "allow_always",
    });
  }
  choices.push({ choiceId: "deny", label: "Deny", providerValue: STRUCTURED_DENY_TOKEN });
  return {
    promptId,
    threadId,
    agentId,
    kind: "approval",
    message,
    ...(detail !== undefined ? { detail } : {}),
    choices,
    defaultChoiceId: "allow",
    source: "provider_hook",
  };
}

// Build an approval-card detail from a claude permission request's tool input: the Bash
// `command` (text), an Edit's `old_string`/`new_string` (a simple +/- diff), or a Write's
// `content` (text). Returns undefined when there is nothing worth previewing beyond the
// headline message.
export function buildPermissionDetail(toolInput: Record<string, unknown>): PromptDetail | undefined {
  const command = stringField(toolInput, "command");
  if (command !== undefined) {
    return { format: "text", body: bounded(command) };
  }
  const filePath = stringField(toolInput, "file_path") ?? stringField(toolInput, "path");
  const locations = filePath !== undefined ? { locations: [filePath] } : {};
  const oldString = stringField(toolInput, "old_string");
  const newString = stringField(toolInput, "new_string");
  // Render the diff if EITHER side is present (a pure addition/deletion still previews), and
  // split on /\r?\n/ so CRLF content doesn't leave a stray \r on every line.
  if (oldString !== undefined || newString !== undefined) {
    const body = [
      ...(oldString !== undefined ? oldString.split(/\r?\n/).map((line) => `- ${line}`) : []),
      ...(newString !== undefined ? newString.split(/\r?\n/).map((line) => `+ ${line}`) : []),
    ].join("\n");
    return { format: "diff", body: bounded(body), ...locations };
  }
  const content = stringField(toolInput, "content");
  if (content !== undefined) {
    return { format: "text", body: bounded(content), ...locations };
  }
  return undefined;
}
