import type { AgentChatChoiceSurfaceRowView } from "./choice-surface-row-types.ts";
import type { AgentChatOpencodeModelProviderStep } from "./opencode-model-provider-types.ts";

export interface AgentChatOpencodeModelProviderProviderView {
  rowId: string;
  id: string;
  label: string;
  detail: string;
  monogram: string;
  connected: boolean;
  needsReconnect: boolean;
  selected: boolean;
}

export interface AgentChatOpencodeModelProviderModelView {
  rowId: string;
  value: string;
  label: string;
  detail?: string;
  monogram: string;
  selected: boolean;
  meta?: string;
}

export interface AgentChatOpencodeModelProviderConnectionView {
  rowId: string;
  label: string;
  detail: string;
}

export interface AgentChatOpencodeModelProviderMethodView {
  browserRowId?: string;
  browserLabel?: string;
  browserDetail?: string;
  apiKeyRowId?: string;
  apiKeyLabel?: string;
  apiKeyDetail?: string;
}

export interface AgentChatOpencodeModelProviderSearchProviderView {
  rowId: string;
  id: string;
  label: string;
  detail: string;
  monogram: string;
  connected: boolean;
  needsReconnect: boolean;
  modelCount: number;
  env: string[];
}

export interface AgentChatOpencodeModelProviderView {
  step: AgentChatOpencodeModelProviderStep;
  version?: string;
  zenFreeCount: number;
  connectedCount: number;
  providerId?: string;
  providerLabel?: string;
  providerMonogram?: string;
  providerStatus?: string;
  currentModel?: string;
  currentEffort?: string;
  providers: AgentChatOpencodeModelProviderProviderView[];
  searchProviders?: AgentChatOpencodeModelProviderSearchProviderView[];
  models: AgentChatOpencodeModelProviderModelView[];
  effortRows: AgentChatChoiceSurfaceRowView[];
  connection?: AgentChatOpencodeModelProviderConnectionView;
  method?: AgentChatOpencodeModelProviderMethodView;
}
