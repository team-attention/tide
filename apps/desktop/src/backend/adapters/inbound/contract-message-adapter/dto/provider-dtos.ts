import {
  CONTRACT_VERSION,
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
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: input.eventId,
    requestId: input.requestId,
    kind: "providerCatalog.changed",
    emittedAt: input.emittedAt,
    payload: omitUndefinedProperties({
      catalog: input.catalog,
      opencodeModels: input.opencodeModels,
      opencodeVendors: input.opencodeVendors,
      opencodeEnvironment: input.opencodeEnvironment,
    }),
  };
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

function omitUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
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
