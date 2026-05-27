import type {
  ProviderReadinessCheckInput,
  ProviderReadinessResult,
} from "../../domains/provider-readiness/provider-readiness.ts";

export interface ProviderReadinessPort {
  check(input: ProviderReadinessCheckInput): Promise<ProviderReadinessResult>;
}
