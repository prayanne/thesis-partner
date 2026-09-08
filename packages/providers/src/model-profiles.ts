import { ProviderError } from "./errors";
import type {
  AiAdapterId,
  AiFunction,
  ModelInfo,
  ReasoningEffort,
} from "./types";

export interface ModelChoice {
  id: string;
  displayName: string;
  available: boolean | null;
  supportedFunctions: AiFunction[];
  reasoningEfforts: ReasoningEffort[];
  protocol:
    "responses" | "messages" | "chat-completions" | "embeddings" | "unknown";
  profileSource: "official" | "native" | "unknown";
  selectable: boolean;
  reason?: string;
}
const textFunctions: AiFunction[] = ["summary", "chat", "analysis"];
// Exact profile, never an alias or fallback. Source: developers.openai.com/api/docs/models/gpt-5.6-sol.
const openAiProfiles: ModelChoice[] = [
  {
    id: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    available: null,
    supportedFunctions: textFunctions,
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    protocol: "responses",
    profileSource: "official",
    selectable: true,
  },
  ...["text-embedding-3-small", "text-embedding-3-large"].map(
    (id): ModelChoice => ({
      id,
      displayName: id,
      available: null,
      supportedFunctions: ["embedding"],
      reasoningEfforts: [],
      protocol: "embeddings",
      profileSource: "official",
      selectable: true,
    }),
  ),
];

export function modelChoices(
  adapterId: AiAdapterId,
  inventory?: readonly ModelInfo[],
  configuredIds: string[] = [],
): ModelChoice[] {
  const known = adapterId === "openai" ? openAiProfiles : [];
  const ids = [
    ...new Set([
      ...known.map((p) => p.id),
      ...(inventory ?? []).map((p) => p.id),
      ...configuredIds.filter(Boolean),
    ]),
  ];
  return ids.map((id) => {
    const official = known.find((p) => p.id === id);
    const native = inventory?.find((p) => p.id === id);
    const available = inventory ? !!native : null;
    const supportedFunctions: AiFunction[] = official
      ? [...official.supportedFunctions]
      : [
          ...(native?.capabilities.chat === "supported" &&
          native.capabilities.streaming === "supported"
            ? textFunctions
            : []),
          ...(native?.capabilities.embedding === "supported"
            ? ["embedding" as const]
            : []),
        ];
    const protocol =
      official?.protocol ??
      (supportedFunctions.includes("chat")
        ? adapterId === "anthropic"
          ? "messages"
          : "chat-completions"
        : supportedFunctions.includes("embedding")
          ? "embeddings"
          : "unknown");
    const reason =
      available === false
        ? "Model was not found in the saved provider inventory; no alternative is selected."
        : !supportedFunctions.length
          ? "No supported protocol profile or native capability evidence is available for this model."
          : undefined;
    return {
      id,
      displayName: official?.displayName ?? native?.displayName ?? id,
      available,
      supportedFunctions,
      reasoningEfforts: [...(official?.reasoningEfforts ?? [])],
      protocol,
      profileSource: official
        ? "official"
        : native && supportedFunctions.length
          ? "native"
          : "unknown",
      selectable: !reason,
      ...(reason ? { reason } : {}),
    };
  });
}

export function assertModelSelection(
  adapterId: AiAdapterId,
  modelId: string,
  operation: AiFunction,
  effort?: ReasoningEffort,
  inventory?: readonly ModelInfo[],
  requireProfile = true,
): ModelChoice {
  if (adapterId === "anthropic" && operation === "embedding")
    throw new ProviderError({
      code: "CAPABILITY_UNSUPPORTED",
      adapterId,
      message: "Anthropic does not provide embeddings.",
    });
  const choice = modelChoices(adapterId, inventory, [modelId]).find(
    (p) => p.id === modelId,
  )!;
  if (
    choice.available === false ||
    (requireProfile && !choice.supportedFunctions.includes(operation)) ||
    (choice.profileSource !== "unknown" &&
      !choice.supportedFunctions.includes(operation))
  )
    throw new ProviderError({
      code: "CAPABILITY_UNSUPPORTED",
      adapterId,
      message:
        choice.reason ?? "This model does not support the selected function.",
    });
  if (
    effort !== undefined &&
    (operation === "embedding" || !choice.reasoningEfforts.includes(effort))
  )
    throw new ProviderError({
      code: "CAPABILITY_UNSUPPORTED",
      adapterId,
      message:
        "The selected model and protocol do not support this reasoning effort.",
    });
  return choice;
}
