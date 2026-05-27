export interface TideBackendEntrypoint {
  transport: "message_port";
  ownsAgentRuntime: true;
}

export const tideBackendEntrypoint: TideBackendEntrypoint = {
  transport: "message_port",
  ownsAgentRuntime: true,
};
