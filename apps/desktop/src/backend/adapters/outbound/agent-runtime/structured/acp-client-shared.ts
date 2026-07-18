export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConfigOptions(
  value: unknown,
): Array<{ configId: string; value: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const options: Array<{ configId: string; value: string }> = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.configId === "string" && typeof entry.value === "string") {
      options.push({ configId: entry.configId, value: entry.value });
    }
  }
  return options;
}

export function mergeConfigOptions(
  existing: Array<{ configId: string; value: string }> | undefined,
  incoming: Array<{ configId: string; value: string }>,
): Array<{ configId: string; value: string }> {
  const merged = new Map<string, string>();
  for (const option of existing ?? []) merged.set(option.configId, option.value);
  for (const option of incoming) merged.set(option.configId, option.value);
  return Array.from(merged, ([configId, value]) => ({ configId, value }));
}

export interface AcpModelCatalog {
  models: Array<{ value: string; label: string; vendor?: string }>;
  currentModel?: string;
}

export function parseAcpModelCatalog(result: Record<string, unknown>): AcpModelCatalog | undefined {
  const standardModels = isRecord(result.models) ? result.models : undefined;
  if (standardModels !== undefined && Array.isArray(standardModels.availableModels)) {
    const models = standardModels.availableModels
      .filter(isRecord)
      .map((entry) => {
        const value = stringField(entry, "modelId") ?? "";
        return { value, label: stringField(entry, "name") ?? value };
      })
      .filter((model) => model.value.length > 0);
    if (models.length > 0) return { models, currentModel: stringField(standardModels, "currentModelId") };
  }
  if (Array.isArray(result.configOptions)) {
    const modelOption = result.configOptions
      .filter(isRecord)
      .find((option) => stringField(option, "category") === "model" || stringField(option, "id") === "model");
    if (modelOption !== undefined && Array.isArray(modelOption.options)) {
      const models = modelOption.options
        .filter(isRecord)
        .map((entry) => {
          const value = stringField(entry, "value") ?? "";
          const slash = value.indexOf("/");
          return {
            value,
            label: slash > 0 ? value.slice(slash + 1) : stringField(entry, "name") ?? value,
            ...(slash > 0 ? { vendor: value.slice(0, slash) } : {}),
          };
        })
        .filter((model) => model.value.length > 0);
      if (models.length > 0) return { models, currentModel: stringField(modelOption, "currentValue") };
    }
  }
  return undefined;
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

export function acpToolOutput(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!isRecord(item)) return "";
      const inner = isRecord(item.content) ? item.content : undefined;
      return inner !== undefined && typeof inner.text === "string" ? inner.text : "";
    })
    .join("\n")
    .trim();
}
