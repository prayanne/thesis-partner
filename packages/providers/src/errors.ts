import type { AdapterId, RequestIdentity } from "./types";

export type ProviderErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_ENDPOINT"
  | "REDIRECT_BLOCKED"
  | "POLICY_BLOCKED"
  | "PROVIDER_DISABLED"
  | "CREDENTIAL_REQUIRED"
  | "CAPABILITY_UNSUPPORTED"
  | "MODEL_LOCALITY_UNVERIFIED"
  | "CLOUD_MODEL_BLOCKED"
  | "UPSTREAM_HTTP_ERROR"
  | "UPSTREAM_STREAM_ERROR"
  | "INVALID_UPSTREAM_RESPONSE"
  | "INCOMPLETE_STREAM"
  | "TRANSLATION_COUNT_MISMATCH"
  | "ABORTED";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly adapterId?: AdapterId;
  readonly status?: number;
  readonly retryable: boolean;
  readonly requestIdentity?: RequestIdentity;
  readonly providerRequestId?: string;

  constructor(options: {
    code: ProviderErrorCode;
    message: string;
    adapterId?: AdapterId;
    status?: number;
    retryable?: boolean;
    requestIdentity?: RequestIdentity;
    providerRequestId?: string;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "ProviderError";
    this.code = options.code;
    this.adapterId = options.adapterId;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.requestIdentity = options.requestIdentity;
    this.providerRequestId = options.providerRequestId;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function redactSecrets(
  value: string,
  secrets: readonly (string | undefined)[],
): string {
  let result = value;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}
