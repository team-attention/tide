// ACP `session/request_permission` mapping, extracted from acp-client.ts (it was pushing
// the client past the file-size cap). Owns the pure shape work — turning a permission
// request's option `kind` and `toolCall` content into Tide's PromptChoiceKind / PromptDetail
// — so the client keeps only the thin surface-and-emit method. Pure functions (no `this`),
// which also makes them directly unit-testable (see prompt-full-fidelity-fields.test.ts).
import type { PromptChoiceKind, PromptDetail } from "../../../../application/domains/thread/thread.ts";
import { isRecord, stringField } from "./claude-stream-json-shared.ts";

function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

// Map an ACP permission option's native `kind` to our PromptChoiceKind (identical strings;
// validated so an unexpected value degrades to undefined rather than a bad cast).
export function acpOptionKind(option: Record<string, unknown>): PromptChoiceKind | undefined {
  const kind = stringField(option, "kind");
  return kind === "allow_once" ||
    kind === "allow_always" ||
    kind === "reject_once" ||
    kind === "reject_always"
    ? kind
    : undefined;
}

// Build an approval-card detail from an ACP `session/request_permission` toolCall: a unified
// diff from any diff content items (oldText/newText), else the text content, plus the
// affected file paths from `toolCall.locations`. Returns undefined when there is nothing to
// preview. Kept separate from acpToolOutput (which is text-only, for tool RESULTS, and must
// not start emitting diffs).
export function buildAcpPermissionDetail(toolCall: Record<string, unknown>): PromptDetail | undefined {
  const locations: string[] = Array.isArray(toolCall.locations)
    ? Array.from(
        new Set(
          toolCall.locations
            .map((loc) => (isRecord(loc) ? stringField(loc, "path") : undefined))
            .filter((path): path is string => path !== undefined),
        ),
      )
    : [];
  const content = Array.isArray(toolCall.content) ? toolCall.content : [];
  const diffParts: string[] = [];
  const textParts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }
    const oldText = stringField(item, "oldText");
    const newText = stringField(item, "newText");
    if (oldText !== undefined || newText !== undefined) {
      const path = stringField(item, "path");
      if (path !== undefined && !locations.includes(path)) {
        locations.push(path);
      }
      // Only emit lines for a side that is actually present — a pure addition/deletion has
      // the other side undefined, and `"".split("\n")` would otherwise inject a spurious
      // empty "- "/"+ " line (Gemini review). stringField already maps "" → undefined.
      const body = [
        ...(oldText !== undefined ? oldText.split("\n").map((line) => `- ${line}`) : []),
        ...(newText !== undefined ? newText.split("\n").map((line) => `+ ${line}`) : []),
      ].join("\n");
      diffParts.push(path !== undefined ? `# ${path}\n${body}` : body);
      continue;
    }
    const inner = isRecord(item.content) ? item.content : undefined;
    const text = inner !== undefined ? stringField(inner, "text") : stringField(item, "text");
    if (text !== undefined) {
      textParts.push(text);
    }
  }
  const locationsField = locations.length > 0 ? { locations } : {};
  if (diffParts.length > 0) {
    return { format: "diff", body: bounded(diffParts.join("\n\n")), ...locationsField };
  }
  if (textParts.length > 0) {
    return { format: "text", body: bounded(textParts.join("\n")), ...locationsField };
  }
  if (locations.length > 0) {
    return { format: "text", body: locations.join("\n"), locations };
  }
  return undefined;
}
