import type { AcpProviderProfile } from "../acp/acp-provider-factory.ts";

export const qwenAcpProfile: AcpProviderProfile = {
  provider: "qwen",
  command: "qwen",
  args: ["--acp"],
  displayName: "Qwen Code",
};
