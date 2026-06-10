// Provider history parsing lives with each provider's Agent Integration; this
// module re-exports the pieces the infra-side conversation rebuilders still use.
// See docs_v2/specs/provider-history-connector.md.

export {
  boundedToolText,
  joinTextContent,
} from "../../adapters/outbound/agent-integrations/shared/provider-record-json.ts";
export {
  codexReasoningText,
  codexToolFramePayload,
  codexToolOutputText,
} from "../../adapters/outbound/agent-integrations/codex/codex-history-connector.ts";
export {
  claudeToolResultItems,
  claudeToolUseItems,
} from "../../adapters/outbound/agent-integrations/claude/claude-history-connector.ts";
