// Primitives shared by the claude stream-json client and its AskUserQuestion handler.
// Neutral on purpose (imports nothing from either) so both can depend on it without an
// import cycle.

// Tokens carried in a prompt-answer `value` to route a structured response back to the
// control protocol WITHOUT keystrokes: an Allow/Deny decision, or a picked option
// (STRUCTURED_OPTION_PREFIX + the option label). Any other non-empty value is verbatim
// free text ("Other…").
export const STRUCTURED_ALLOW_TOKEN = "structured:allow";
export const STRUCTURED_DENY_TOKEN = "structured:deny";
// "Allow always": allow this call AND persist the rule the CLI suggested, so it stops asking.
// See docs_v2/specs/claude-permission-allow-always.md.
export const STRUCTURED_ALLOW_ALWAYS_TOKEN = "structured:allow_always";
export const STRUCTURED_OPTION_PREFIX = "structured:option:";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Cap a previewed text/diff body so a huge command/diff/output doesn't bloat the card or event.
export function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

// claude's can_use_tool request carries `permission_suggestions`: a PermissionUpdate[] the CLI
// computed for "don't ask again". This slice surfaces ONLY the pure-`addRules` variant
// (persistent allow-rules, e.g. Bash(npm test *) at localSettings) as an Allow-always choice;
// mode-changing suggestions (setMode/addDirectories, the Write/Edit "accept edits this session"
// case) are deferred — they overlap the permission-mode control. Returns the array VERBATIM (to
// echo as updatedPermissions) when every entry is `addRules`, else undefined (no Allow-always
// choice). See docs_v2/specs/claude-permission-allow-always.md.
export function addRulesOnlySuggestions(suggestions: unknown): unknown[] | undefined {
  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return undefined;
  }
  if (!suggestions.every((entry) => isRecord(entry) && entry.type === "addRules")) {
    return undefined;
  }
  return suggestions;
}

// The Allow-always choice label, built from the CLI's own rule(s):
// "Always allow Bash(npm test *) · this project". Mirrors the CLI's `toolName(ruleContent)`
// formatting and appends a read-only scope hint derived from the suggestion `destination`.
export function buildAllowAlwaysLabel(suggestions: readonly unknown[]): string {
  const ruleLabels: string[] = [];
  let destination: string | undefined;
  for (const entry of suggestions) {
    if (!isRecord(entry)) {
      continue;
    }
    if (destination === undefined) {
      destination = stringField(entry, "destination");
    }
    const rules = entry.rules;
    if (!Array.isArray(rules)) {
      continue;
    }
    for (const rule of rules) {
      if (!isRecord(rule)) {
        continue;
      }
      const toolName = stringField(rule, "toolName");
      if (toolName === undefined) {
        continue;
      }
      const ruleContent = stringField(rule, "ruleContent");
      ruleLabels.push(ruleContent !== undefined ? `${toolName}(${ruleContent})` : toolName);
    }
  }
  const head = ruleLabels[0] ?? "this action";
  const more = ruleLabels.length > 1 ? ` (+${ruleLabels.length - 1} more)` : "";
  return `Always allow ${head}${more}${allowAlwaysScopeSuffix(destination)}`;
}

function allowAlwaysScopeSuffix(destination: string | undefined): string {
  switch (destination) {
    case "localSettings":
    case "projectSettings":
      return " · this project";
    case "userSettings":
      return " · all projects";
    case "session":
      return " · this session";
    default:
      return "";
  }
}
