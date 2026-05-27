import type {
  ServiceResult,
  ThreadRuntimeService,
  TideMcpToolCallInput,
  TideMcpToolCallResult,
  TideMcpToolDefinition,
} from "../../../application/services/thread-runtime-service.ts";

export interface TideMcpToolSurfaceAdapter {
  listTools(): TideMcpToolDefinition[];
  callTool(
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>>;
}

export interface CreateTideMcpToolSurfaceAdapterInput {
  service: ThreadRuntimeService;
}

export function createTideMcpToolSurfaceAdapter(
  input: CreateTideMcpToolSurfaceAdapterInput,
): TideMcpToolSurfaceAdapter {
  return new BackendTideMcpToolSurfaceAdapter(input.service);
}

class BackendTideMcpToolSurfaceAdapter implements TideMcpToolSurfaceAdapter {
  private readonly service: ThreadRuntimeService;

  constructor(service: ThreadRuntimeService) {
    this.service = service;
  }

  listTools(): TideMcpToolDefinition[] {
    return this.service.listTideMcpTools();
  }

  async callTool(
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>> {
    return this.service.handleTideMcpToolCall(input);
  }
}
