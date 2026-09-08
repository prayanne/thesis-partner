import { AnthropicMessagesAdapter } from "./anthropic";
import { ProviderError } from "./errors";
import { GoogleTranslationV2Adapter } from "./google-translation";
import { OpenAiCompatibleAdapter } from "./openai-compatible";
import { OpenAiResponsesAdapter } from "./openai";
import { validateEndpoint } from "./policy";
import {
  getProviderDefinition,
  validateGoogleTranslationConfig,
  validateProviderConfig,
} from "./registry";
import type {
  FetchImplementation,
  GoogleTranslationConfig,
  ProviderAdapter,
  ProviderConfig,
  TranslationAdapter,
} from "./types";

export * from "./errors";
export * from "./google-translation";
export * from "./policy";
export * from "./registry";
export * from "./sse";
export * from "./model-profiles";
export type * from "./types";

export interface ProviderAdapterDependencies {
  fetch: FetchImplementation;
}

export function createProviderAdapter(
  input: unknown,
  dependencies: ProviderAdapterDependencies,
): ProviderAdapter {
  const parsed = validateProviderConfig(input);
  const endpoint = validateEndpoint(parsed.adapterId, parsed.endpoint);
  const definition = getProviderDefinition(parsed.adapterId);
  if (definition.credentialRequired && !parsed.credentialRef) {
    throw new ProviderError({
      code: "INVALID_CONFIG",
      adapterId: parsed.adapterId,
      message: "Provider configuration requires a credential reference.",
    });
  }
  const config: ProviderConfig = { ...parsed, endpoint };
  if (config.adapterId === "openai")
    return new OpenAiResponsesAdapter(config, dependencies.fetch);
  if (config.adapterId === "anthropic")
    return new AnthropicMessagesAdapter(config, dependencies.fetch);
  return new OpenAiCompatibleAdapter(config, dependencies.fetch);
}

export function createGoogleTranslationAdapter(
  input: unknown,
  dependencies: ProviderAdapterDependencies,
): TranslationAdapter {
  const parsed = validateGoogleTranslationConfig(input);
  if (parsed.endpoint) validateEndpoint("google-translate-v2", parsed.endpoint);
  const config: GoogleTranslationConfig = {
    ...parsed,
    endpoint: getProviderDefinition("google-translate-v2").defaultEndpoint,
  };
  return new GoogleTranslationV2Adapter(config, dependencies.fetch);
}
