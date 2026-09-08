import type {
  CapabilitySupport,
  ModelCapabilities,
  ModelInfo,
  NormalizedUsage,
} from "./types";

const unknown: CapabilitySupport = "unknown";

export function unknownModelCapabilities(
  overrides: Partial<ModelCapabilities> = {},
): ModelCapabilities {
  return {
    chat: unknown,
    embedding: unknown,
    streaming: unknown,
    structuredOutput: unknown,
    vision: unknown,
    toolUse: unknown,
    ...overrides,
  };
}

export function normalizeOpenAiUsage(
  value: unknown,
): NormalizedUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const raw = value as Record<string, unknown>;
  const inputTokens =
    numberField(raw, "input_tokens") ?? numberField(raw, "prompt_tokens");
  const outputTokens =
    numberField(raw, "output_tokens") ?? numberField(raw, "completion_tokens");
  const totalTokens =
    numberField(raw, "total_tokens") ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  const inputDetails =
    objectField(raw, "input_tokens_details") ??
    objectField(raw, "prompt_tokens_details");
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens: inputDetails
      ? numberField(inputDetails, "cached_tokens")
      : undefined,
    raw,
  };
}

export function normalizeAnthropicUsage(
  value: unknown,
): NormalizedUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const raw = value as Record<string, unknown>;
  const inputTokens = numberField(raw, "input_tokens");
  const outputTokens = numberField(raw, "output_tokens");
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined,
    cacheReadTokens: numberField(raw, "cache_read_input_tokens"),
    cacheWriteTokens: numberField(raw, "cache_creation_input_tokens"),
    raw,
  };
}

export function mergeUsage(
  previous: NormalizedUsage | undefined,
  current: NormalizedUsage | undefined,
): NormalizedUsage | undefined {
  if (!current) return previous;
  const inputTokens = current.inputTokens ?? previous?.inputTokens;
  const outputTokens = current.outputTokens ?? previous?.outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      current.totalTokens ??
      (inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : previous?.totalTokens),
    cacheReadTokens: current.cacheReadTokens ?? previous?.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens ?? previous?.cacheWriteTokens,
    raw: { ...(previous?.raw ?? {}), ...current.raw },
  };
}

export function parseOpenAiModelList(
  value: Record<string, unknown>,
  executionLocation: ModelInfo["executionLocation"],
): ModelInfo[] {
  const data = Array.isArray(value.data) ? value.data : [];
  return data.flatMap((item): ModelInfo[] => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as Record<string, unknown>).id !== "string"
    )
      return [];
    const object = item as Record<string, unknown>;
    return [
      {
        id: object.id as string,
        executionLocation,
        localOnlyEligible: executionLocation === "local",
        capabilities: unknownModelCapabilities(),
        capabilitySource: "unknown",
        details: safeDetails(object),
      },
    ];
  });
}

export function numberField(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  return typeof value[key] === "number" && Number.isFinite(value[key])
    ? (value[key] as number)
    : undefined;
}

export function stringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === "string" ? (value[key] as string) : undefined;
}

export function objectField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  return value[key] &&
    typeof value[key] === "object" &&
    !Array.isArray(value[key])
    ? (value[key] as Record<string, unknown>)
    : undefined;
}

export function safeDetails(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const forbidden = /key|token|secret|authorization|credential/i;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !forbidden.test(key)),
  );
}
