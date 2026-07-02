import {
  CONTRACT_VERSION,
  type BackendEventEnvelope,
  type OpencodeEnvironmentDto,
  type OpencodeVendorDto,
  type ProviderModelDto,
  type ProviderUsageSnapshotDto,
} from "../../../../../shared/contracts/index.ts";

export function providerCatalogChangedEvent(input: {
  eventId: string;
  requestId?: string;
  emittedAt: string;
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
    payload: {
      opencodeModels: input.opencodeModels,
      opencodeVendors: input.opencodeVendors,
      opencodeEnvironment: input.opencodeEnvironment,
    },
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
