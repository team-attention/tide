import { useEffect } from "react";
import type { AgentChatProviderCatalog } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { persistReadyProviderCatalogs } from "../provider-catalog-cache.ts";

// Keep the Product Shell composition root under its source-size ceiling while
// making persistence follow the provider-catalog state slice, not UI gestures.
export function useProviderCatalogCache(
  catalogs: Record<string, AgentChatProviderCatalog>,
): void {
  useEffect(() => {
    persistReadyProviderCatalogs(catalogs);
  }, [catalogs]);
}
