import type { AgentChatProviderCatalog } from "../../../../application/domains/agent-chat/agent-chat.ts";
import { providerCatalogFromPayload } from "../../../../application/domains/product-shell/state/provider-catalog-payload.ts";
import { getStoredPref, setStoredPref } from "../support/ui-prefs-store.ts";

export const PROVIDER_CATALOG_CACHE_STORAGE_KEY = "tide.providerCatalogs";

const PROVIDER_CATALOG_CACHE_SCHEMA = 1;

let lastPersistedCatalogs: Record<string, AgentChatProviderCatalog> = {};
let lastWrittenSerialized: string | null = null;

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
      lastPersistedCatalogs = {};
      lastWrittenSerialized = null;
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<PersistedProviderCatalogs>;
    if (parsed.schema !== PROVIDER_CATALOG_CACHE_SCHEMA || !isRecord(parsed.catalogs)) {
      lastPersistedCatalogs = {};
      lastWrittenSerialized = null;
      return {};
    }
    const catalogs: Record<string, AgentChatProviderCatalog> = {};
    for (const [agentId, payload] of Object.entries(parsed.catalogs)) {
      const catalog = providerCatalogFromPayload({ catalog: payload });
      if (catalog !== null && catalog.agentId === agentId && isPersistableCatalog(catalog)) {
        catalogs[agentId] = catalogWithoutScope(catalog);
      }
    }
    lastPersistedCatalogs = catalogs;
    lastWrittenSerialized = raw;
    return catalogs;
  } catch {
    lastPersistedCatalogs = {};
    lastWrittenSerialized = null;
    return {};
  }
}

// Merge only successful results. The in-memory mirror is initialized by the
// synchronous boot read, so updates do not need to synchronously read/parse the
// preferences file again. A transient error therefore cannot erase an earlier
// success before the next app launch.
export function persistReadyProviderCatalogs(
  catalogs: Record<string, AgentChatProviderCatalog>,
): void {
  try {
    const nextCatalogs = { ...lastPersistedCatalogs };
    for (const catalog of Object.values(catalogs)) {
      if (isPersistableCatalog(catalog)) {
        nextCatalogs[catalog.agentId] = catalogWithoutScope(catalog);
      }
    }
    if (Object.keys(nextCatalogs).length === 0 && lastWrittenSerialized === null) {
      return;
    }
    const serialized = JSON.stringify({
      schema: PROVIDER_CATALOG_CACHE_SCHEMA,
      catalogs: nextCatalogs,
    });
    if (serialized === lastWrittenSerialized) {
      return;
    }
    setStoredPref(PROVIDER_CATALOG_CACHE_STORAGE_KEY, serialized);
    lastPersistedCatalogs = nextCatalogs;
    lastWrittenSerialized = serialized;
  } catch {
    // Persistence is a best-effort UI optimization; the live catalog flow remains usable.
  }
}

function isPersistableCatalog(catalog: AgentChatProviderCatalog): boolean {
  return catalog.status === "ready" && catalog.models.length > 0;
}

function catalogWithoutScope(catalog: AgentChatProviderCatalog): AgentChatProviderCatalog {
  const persisted = { ...catalog };
  delete persisted.scope;
  delete persisted.error;
  return persisted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
