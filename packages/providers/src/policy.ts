import { ProviderError } from "./errors";
import { getProviderDefinition } from "./registry";
import type {
  AdapterId,
  ModelInfo,
  ProviderCallPolicy,
  ProviderConfig,
  ProviderOperation,
} from "./types";

const CLOUD_ENDPOINTS: Readonly<Record<string, string>> = Object.freeze({
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  "google-translate-v2":
    "https://translation.googleapis.com/language/translate/v2",
});

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "host.docker.internal",
]);

function canonicalEndpoint(value: string): string {
  return value.replace(/\/+$/, "");
}

export function validateEndpoint(
  adapterId: AdapterId,
  endpoint: string,
): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ProviderError({
      code: "INVALID_ENDPOINT",
      adapterId,
      message: "Provider endpoint is not a valid URL.",
    });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ProviderError({
      code: "INVALID_ENDPOINT",
      adapterId,
      message:
        "Provider endpoints cannot contain credentials, query parameters, or fragments.",
    });
  }

  const fixed = CLOUD_ENDPOINTS[adapterId];
  if (fixed) {
    if (canonicalEndpoint(url.toString()) !== fixed) {
      throw new ProviderError({
        code: "INVALID_ENDPOINT",
        adapterId,
        message: "Cloud provider endpoint is not allowlisted.",
      });
    }
    return fixed;
  }

  if (
    (adapterId !== "ollama" && adapterId !== "lmstudio") ||
    !LOCAL_HOSTS.has(url.hostname) ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    canonicalEndpoint(url.pathname) !== "/v1"
  ) {
    throw new ProviderError({
      code: "INVALID_ENDPOINT",
      adapterId,
      message:
        "Local provider endpoint must use an approved local host and the /v1 path.",
    });
  }
  return canonicalEndpoint(url.toString());
}

export function isKnownCloudModel(
  adapterId: AdapterId,
  modelId: string,
): boolean {
  return adapterId === "ollama" && /(?:^|:)\S*-cloud$/i.test(modelId);
}

export function assertProviderCallAllowed(
  policy: ProviderCallPolicy,
  provider: Pick<ProviderConfig, "adapterId" | "enabled"> | AdapterId,
  operation: ProviderOperation,
  model?: Pick<ModelInfo, "id" | "executionLocation" | "localOnlyEligible">,
): void {
  const adapterId =
    typeof provider === "string" ? provider : provider.adapterId;
  const definition = getProviderDefinition(adapterId);
  if (typeof provider !== "string" && !provider.enabled) {
    throw new ProviderError({
      code: "PROVIDER_DISABLED",
      adapterId,
      message: "Provider is disabled.",
    });
  }
  if (operation === "embedding" && !definition.capabilities.embedding) {
    throw new ProviderError({
      code: "CAPABILITY_UNSUPPORTED",
      adapterId,
      message: "This provider does not support embeddings.",
    });
  }
  if (operation === "translation" && !definition.capabilities.translation) {
    throw new ProviderError({
      code: "CAPABILITY_UNSUPPORTED",
      adapterId,
      message: "This provider does not support translation.",
    });
  }

  const isTranslation =
    operation === "translation" || adapterId === "google-translate-v2";
  if (definition.executionLocation === "remote") {
    if (
      policy.localOnly ||
      !policy.paperAllowsExternal ||
      (isTranslation
        ? !policy.allowExternalTranslation
        : !policy.allowExternalAi)
    ) {
      throw new ProviderError({
        code: "POLICY_BLOCKED",
        adapterId,
        message:
          "External provider calls are blocked by the current data-transfer policy.",
      });
    }
  }
  const isBillableAiInference =
    operation === "chat" || operation === "embedding";
  if (
    definition.billingClass === "paid" &&
    isBillableAiInference &&
    !policy.paidAiEnabled
  ) {
    throw new ProviderError({
      code: "POLICY_BLOCKED",
      adapterId,
      message: "Paid AI calls are disabled.",
    });
  }

  if (
    policy.localOnly &&
    definition.executionLocation === "local" &&
    operation !== "listModels" &&
    operation !== "inspectModel" &&
    operation !== "testConnection"
  ) {
    if (
      model &&
      (isKnownCloudModel(adapterId, model.id) ||
        !model.localOnlyEligible ||
        model.executionLocation === "remote")
    ) {
      throw new ProviderError({
        code: "CLOUD_MODEL_BLOCKED",
        adapterId,
        message: "Cloud-backed models cannot run in local-only mode.",
      });
    }
    if (!model || model.executionLocation !== "local") {
      throw new ProviderError({
        code: "MODEL_LOCALITY_UNVERIFIED",
        adapterId,
        message:
          "Native model inspection must verify local execution before use in local-only mode.",
      });
    }
    if (!policy.localProviderIsolationVerified) {
      throw new ProviderError({
        code: "MODEL_LOCALITY_UNVERIFIED",
        adapterId,
        message:
          "Local provider cloud-forwarding controls have not been verified.",
      });
    }
  }
}
