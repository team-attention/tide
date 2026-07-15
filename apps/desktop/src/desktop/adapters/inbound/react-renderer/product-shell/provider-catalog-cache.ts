import type { AgentChatProviderCatalog } from "../../../../application/domains/agent-chat/agent-chat.ts";
import { providerCatalogFromPayload } from "../../../../application/domains/product-shell/state/provider-catalog-payload.ts";
import { getStoredPref, setStoredPref } from "../support/ui-prefs-store.ts";

export const PROVIDER_CATALOG_CACHE_STORAGE_KEY = "tide.providerCatalogs";

const PROVIDER_CATALOG_CACHE_SCHEMA = 1;

interface PersistedProviderCatalogs {
  schema: number;
  catalogs: Record<string, unknown>;
}

// Provider catalogs belong to Product Shell state at runtime. This is only the
// last-known-successful boot seed: the normal provider.catalog.get request still
// refreshes it on every launch. See provider-catalog-last-known-snapshot.md.
export function loadPersistedProviderCatalogs(): Record<string, AgentChatProviderCatalog> {
  try {
    const raw = getStoredPref(PROVIDER_CATALOG_CACHE_STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<PersistedProviderCatalogs>;
    if (parsed.schema !== PROVIDER_CATALOG_CACHE_SCHEMA || !isRecord(parsed.catalogs)) {
      return {};
    }
    const catalogs: Record<string, AgentChatProviderCatalog> = {};
    for (const [agentId, payload] of Object.entries(parsed.catalogs)) {
      const catalog = providerCatalogFromPayload({ catalog: payload });
      if (catalog !== null && catalog.agentId === agentId && isPersistableCatalog(catalog)) {
        catalogs[agentId] = catalogWithoutScope(catalog);
      }
    }
    return catalogs;
  } catch {
    return {};
  }
}

// Merge only successful results. A transient error must never wipe the last
// usable snapshot for the next app launch.
export function persistReadyProviderCatalogs(
  catalogs: Record<string, AgentChatProviderCatalog>,
): void {
  try {
    const persisted = loadPersistedProviderCatalogs();
    let changed = false;
    for (const catalog of Object.values(catalogs)) {
      if (!isPersistableCatalog(catalog)) {
        continue;
      }
      const next = catalogWithoutScope(catalog);
      if (JSON.stringify(persisted[catalog.agentId]) !== JSON.stringify(next)) {
        persisted[catalog.agentId] = next;
        changed = true;
      }
    }
    if (changed) {
      setStoredPref(
        PROVIDER_CATALOG_CACHE_STORAGE_KEY,
        JSON.stringify({ schema: PROVIDER_CATALOG_CACHE_SCHEMA, catalogs: persisted }),
      );
    }
  } catch {
    // Persistence is a best-effort UI optimization; the live catalog flow remains usable.
  }
}

function isPersistableCatalog(catalog: AgentChatProviderCatalog): boolean {
  return catalog.status === "ready" && catalog.models.length > 0;
}

function catalogWithoutScope(catalog: AgentChatProviderCatalog): AgentChatProviderCatalog {
  const { scope: _scope, error: _error, ...persisted } = catalog;
  return persisted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
