import type { AcpProviderProfile } from "../acp/acp-provider-factory.ts";

export const opencodeAcpProfile: AcpProviderProfile = {
  provider: "opencode",
  command: "opencode",
  args: ["acp"],
  displayName: "opencode",
};
