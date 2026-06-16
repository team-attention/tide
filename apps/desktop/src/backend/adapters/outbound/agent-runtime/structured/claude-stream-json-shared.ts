// Primitives shared by the claude stream-json client and its AskUserQuestion handler.
// Neutral on purpose (imports nothing from either) so both can depend on it without an
// import cycle.

// Tokens carried in a prompt-answer `value` to route a structured response back to the
// control protocol WITHOUT keystrokes: an Allow/Deny decision, or a picked option
// (STRUCTURED_OPTION_PREFIX + the option label). Any other non-empty value is verbatim
// free text ("Other…").
export const STRUCTURED_ALLOW_TOKEN = "structured:allow";
export const STRUCTURED_DENY_TOKEN = "structured:deny";
export const STRUCTURED_OPTION_PREFIX = "structured:option:";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
