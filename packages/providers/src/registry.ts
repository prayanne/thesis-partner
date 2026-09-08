import { z } from "zod";
import { ProviderError } from "./errors";
import type {
  AdapterId,
  GoogleTranslationConfig,
  ProviderConfig,
  ProviderDefinition,
} from "./types";

const id = z.string().min(1).max(200);
const optionalId = id.optional();
export const reasoningEffortSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const providerConfigSchema = z
  .object({
    adapterId: z.enum(["openai", "anthropic", "ollama", "lmstudio"]),
    providerInstanceId: id,
    enabled: z.boolean(),
    endpoint: z.url(),
    modelId: optionalId,
    modelRevision: optionalId,
    embeddingModelId: optionalId,
    credentialRef: optionalId,
    reasoningEffort: reasoningEffortSchema.optional(),
  })
  .strict();

export const googleTranslationConfigSchema = z
  .object({
    adapterId: z.literal("google-translate-v2"),
    providerInstanceId: id,
    enabled: z.boolean(),
    endpoint: z.url().optional(),
    credentialRef: id,
    translatorConfigVersion: id,
  })
  .strict();

const commonFields = [
  {
    key: "enabled",
    label: "Enabled",
    kind: "boolean",
    required: true,
    secret: false,
  },
  {
    key: "modelId",
    label: "Chat model",
    kind: "text",
    required: false,
    secret: false,
  },
] as const;

const providerDefinitions = [
  {
    adapterId: "openai",
    adapterVersion: "1",
    displayName: "OpenAI API",
    billingClass: "paid",
    executionLocation: "remote",
    defaultEndpoint: "https://api.openai.com/v1",
    fixedEndpoint: true,
    credentialRequired: true,
    capabilities: {
      chat: true,
      embedding: true,
      streaming: true,
      structuredOutput: true,
      translation: false,
      modelListing: true,
      modelInspection: true,
    },
    configFields: [
      ...commonFields,
      {
        key: "embeddingModelId",
        label: "Embedding model",
        kind: "text",
        required: false,
        secret: false,
      },
      {
        key: "credentialRef",
        label: "API key",
        kind: "credential-reference",
        required: true,
        secret: false,
      },
    ],
    limitations: [
      "Uses the native Responses API with store=false.",
      "ChatGPT subscriptions do not grant API usage.",
    ],
  },
  {
    adapterId: "anthropic",
    adapterVersion: "1",
    displayName: "Anthropic Claude API",
    billingClass: "paid",
    executionLocation: "remote",
    defaultEndpoint: "https://api.anthropic.com/v1",
    fixedEndpoint: true,
    credentialRequired: true,
    capabilities: {
      chat: true,
      embedding: false,
      streaming: true,
      structuredOutput: false,
      translation: false,
      modelListing: true,
      modelInspection: true,
    },
    configFields: [
      ...commonFields,
      {
        key: "credentialRef",
        label: "API key",
        kind: "credential-reference",
        required: true,
        secret: false,
      },
    ],
    limitations: [
      "Anthropic does not provide an embedding endpoint; select a separate embedding provider.",
    ],
  },
  {
    adapterId: "ollama",
    adapterVersion: "1",
    displayName: "Ollama",
    billingClass: "no_api_charge",
    executionLocation: "local",
    defaultEndpoint: "http://host.docker.internal:11434/v1",
    fixedEndpoint: false,
    credentialRequired: false,
    capabilities: {
      chat: true,
      embedding: true,
      streaming: true,
      structuredOutput: false,
      translation: false,
      modelListing: true,
      modelInspection: true,
    },
    configFields: [
      {
        key: "endpoint",
        label: "Local endpoint",
        kind: "url",
        required: true,
        secret: false,
      },
      ...commonFields,
      {
        key: "embeddingModelId",
        label: "Embedding model",
        kind: "text",
        required: false,
        secret: false,
      },
    ],
    limitations: [
      "A local endpoint can still invoke Ollama cloud models.",
      "Local-only mode requires native model inspection and Ollama cloud features disabled.",
    ],
  },
  {
    adapterId: "lmstudio",
    adapterVersion: "1",
    displayName: "LM Studio",
    billingClass: "no_api_charge",
    executionLocation: "local",
    defaultEndpoint: "http://host.docker.internal:1234/v1",
    fixedEndpoint: false,
    credentialRequired: false,
    capabilities: {
      chat: true,
      embedding: true,
      streaming: true,
      structuredOutput: false,
      translation: false,
      modelListing: true,
      modelInspection: true,
    },
    configFields: [
      {
        key: "endpoint",
        label: "Local endpoint",
        kind: "url",
        required: true,
        secret: false,
      },
      ...commonFields,
      {
        key: "embeddingModelId",
        label: "Embedding model",
        kind: "text",
        required: false,
        secret: false,
      },
      {
        key: "credentialRef",
        label: "Optional server token",
        kind: "credential-reference",
        required: false,
        secret: false,
      },
    ],
    limitations: [
      "Only native model inventory can establish LLM versus embedding capability.",
      "A localhost API does not prove that LM Link or cloud execution is disabled.",
    ],
  },
  {
    adapterId: "google-translate-v2",
    adapterVersion: "1",
    displayName: "Google Cloud Translation Basic v2",
    billingClass: "paid",
    executionLocation: "remote",
    defaultEndpoint: "https://translation.googleapis.com/language/translate/v2",
    fixedEndpoint: true,
    credentialRequired: true,
    capabilities: {
      chat: false,
      embedding: false,
      streaming: false,
      structuredOutput: false,
      translation: true,
      modelListing: false,
      modelInspection: false,
    },
    configFields: [
      {
        key: "enabled",
        label: "Enabled",
        kind: "boolean",
        required: true,
        secret: false,
      },
      {
        key: "credentialRef",
        label: "API key",
        kind: "credential-reference",
        required: true,
        secret: false,
      },
    ],
    limitations: [
      "Returns segment translations, not word alignment.",
      "UI display must include Google Translate attribution.",
    ],
  },
] satisfies readonly ProviderDefinition[];

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] =
  Object.freeze(
    providerDefinitions.map((definition) =>
      Object.freeze({
        ...definition,
        capabilities: Object.freeze({ ...definition.capabilities }),
        configFields: Object.freeze(
          definition.configFields.map((field) => Object.freeze({ ...field })),
        ),
        limitations: Object.freeze([...definition.limitations]),
      }),
    ),
  );

const registry = new Map(
  PROVIDER_DEFINITIONS.map((definition) => [definition.adapterId, definition]),
);

export function getProviderDefinition(
  adapterId: AdapterId,
): ProviderDefinition {
  const definition = registry.get(adapterId);
  if (!definition)
    throw new ProviderError({
      code: "INVALID_CONFIG",
      message: "Unknown provider adapter.",
    });
  return definition;
}

export function validateProviderConfig(input: unknown): ProviderConfig {
  const result = providerConfigSchema.safeParse(input);
  if (!result.success)
    throw new ProviderError({
      code: "INVALID_CONFIG",
      message: "Provider configuration is invalid.",
    });
  return result.data;
}

export function validateGoogleTranslationConfig(
  input: unknown,
): GoogleTranslationConfig {
  const result = googleTranslationConfigSchema.safeParse(input);
  if (!result.success)
    throw new ProviderError({
      code: "INVALID_CONFIG",
      message: "Translation provider configuration is invalid.",
    });
  return result.data;
}
