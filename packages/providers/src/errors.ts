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
  | "UPSTREAM_AUTHENTICATION_ERROR"
  | "UPSTREAM_QUOTA_EXCEEDED"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_MODEL_ACCESS_DENIED"
  | "UPSTREAM_SERVER_ERROR"
  | "UPSTREAM_INVALID_REQUEST"
  | "MAX_OUTPUT_TOKENS"
  | "INVALID_UPSTREAM_RESPONSE"
  | "INCOMPLETE_STREAM"
  | "TRANSLATION_COUNT_MISMATCH"
  | "ABORTED";

// Only locally authored diagnostics may cross the validation persistence boundary.
// Never use an upstream message (or a caller-supplied ProviderError.message).
export function providerFailureDiagnostic(code: unknown) {
  switch (code) {
    case "UPSTREAM_AUTHENTICATION_ERROR":
      return {
        code,
        message:
          "The provider rejected authentication. Check the saved API credential.",
      } as const;
    case "UPSTREAM_QUOTA_EXCEEDED":
      return {
        code,
        message:
          "The provider reported exhausted quota. Check API billing, credits and usage limits.",
      } as const;
    case "UPSTREAM_RATE_LIMITED":
      return {
        code,
        message:
          "The provider reported a rate limit. Wait before explicitly trying validation again.",
      } as const;
    case "UPSTREAM_MODEL_ACCESS_DENIED":
      return {
        code,
        message:
          "The provider reported missing model access or permission. Check the selected model and API project permissions.",
      } as const;
    case "UPSTREAM_SERVER_ERROR":
      return {
        code,
        message:
          "The provider reported an internal server error. Try validation again later with explicit confirmation.",
      } as const;
    case "UPSTREAM_INVALID_REQUEST":
      return {
        code,
        message:
          "The provider reported an invalid request. Review the selected model and supported request settings.",
      } as const;
    case "MAX_OUTPUT_TOKENS":
      return {
        code,
        message:
          "The response reached its output token limit, which includes reasoning tokens. The bounded validation did not finish.",
      } as const;
    case "UPSTREAM_STREAM_ERROR":
      return {
        code,
        message:
          "The provider did not complete the response stream; no recognized failure reason was supplied.",
      } as const;
    default:
      return undefined;
  }
}

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
