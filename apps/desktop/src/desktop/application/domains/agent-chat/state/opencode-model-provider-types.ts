export type AgentChatOpencodeModelProviderStep =
  | "provider_list"
  | "provider_search"
  | "model_list"
  | "connect_vendor"
  | "vendor_method"
  | "api_key";

export type AgentChatOpencodeModelProviderMethodReturnStep =
  | "provider_list"
  | "provider_search"
  | "model_list"
  | "connect_vendor";

export interface AgentChatOpencodeModelProviderFlowState {
  step: AgentChatOpencodeModelProviderStep | null;
  selectedProviderId?: string;
  methodReturnStep: AgentChatOpencodeModelProviderMethodReturnStep;
}
