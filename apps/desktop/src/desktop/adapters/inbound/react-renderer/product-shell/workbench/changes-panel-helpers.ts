import type { GitPushTargetResult } from "../support/types.ts";

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function fileDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function pushTargetLabel(pushTarget: GitPushTargetResult | null): string {
  return pushTarget === null ? "Resolving push target" : pushTarget.ok ? pushTarget.label : "No push target";
}

export function pushTargetTitle(pushTarget: GitPushTargetResult | null): string {
  return pushTarget === null ? "Resolving push target" : pushTarget.ok ? `Pushes to ${pushTarget.label}` : pushTarget.message;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
