import {
  CONTRACT_VERSION,
  sanitizeJsonValue,
  type BackendEventEnvelope,
  type OpencodeEnvironmentDto,
  type OpencodeVendorDto,
  type ProviderCatalogSnapshotDto,
  type ProviderInventoryDto,
  type ProviderModelDto,
  type ProviderUsageSnapshotDto,
} from "../../../../../shared/contracts/index.ts";

export function providerCatalogChangedEvent(input: {
  eventId: string;
  requestId?: string;
  emittedAt: string;
  catalog?: ProviderCatalogSnapshotDto;
  opencodeModels?: ProviderModelDto[];
  opencodeVendors?: OpencodeVendorDto[];
  opencodeEnvironment?: OpencodeEnvironmentDto;
}): BackendEventEnvelope<"providerCatalog.changed"> {
  // Electron structured clone preserves undefined; the JSON contract rejects it.
  // Normalize nested optional catalog fields as well as the envelope request id.
  return sanitizeJsonValue({
    contractVersion: CONTRACT_VERSION,
    eventId: input.eventId,
    requestId: input.requestId,
    kind: "providerCatalog.changed",
    emittedAt: input.emittedAt,
    payload: {
      catalog: input.catalog,
      opencodeModels: input.opencodeModels,
      opencodeVendors: input.opencodeVendors,
      opencodeEnvironment: input.opencodeEnvironment,
    },
  }) as unknown as BackendEventEnvelope<"providerCatalog.changed">;
}

export function providerInventoryChangedEvent(input: {
  eventId: string;
  requestId?: string;
  emittedAt: string;
  inventory: ProviderInventoryDto;
}): BackendEventEnvelope<"providerInventory.changed"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: input.eventId,
    requestId: input.requestId,
    kind: "providerInventory.changed",
    emittedAt: input.emittedAt,
    payload: input.inventory,
  };
}

export function providerUsageChangedEvent(input: {
  eventId: string;
  requestId?: string;
  emittedAt: string;
  usages: ProviderUsageSnapshotDto[];
}): BackendEventEnvelope<"providerUsage.changed"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: input.eventId,
    requestId: input.requestId,
    kind: "providerUsage.changed",
    emittedAt: input.emittedAt,
    payload: { usages: input.usages },
  };
}
