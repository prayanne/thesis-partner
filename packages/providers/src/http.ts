import { ProviderError, isAbortError, redactSecrets } from "./errors";
import type {
  AdapterId,
  FetchImplementation,
  ProviderCallContext,
  RequestIdentity,
} from "./types";

export interface HttpRequestOptions {
  fetch: FetchImplementation;
  adapterId: AdapterId;
  url: string;
  init?: RequestInit;
  context: ProviderCallContext;
  requestIdentity?: RequestIdentity;
}

export async function fetchChecked(
  options: HttpRequestOptions,
): Promise<Response> {
  let response: Response;
  try {
    response = await options.fetch(options.url, {
      ...options.init,
      signal: options.context.signal,
      redirect: "error",
    });
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    if (isAbortError(cause)) throw cause;
    const safeCause =
      cause instanceof Error
        ? redactSecrets(cause.message, [options.context.credential])
        : "Provider request failed.";
    throw new ProviderError({
      code: "UPSTREAM_HTTP_ERROR",
      adapterId: options.adapterId,
      message: safeCause || "Provider request failed.",
      requestIdentity: options.requestIdentity,
    });
  }
  if (
    response.redirected ||
    (response.status >= 300 && response.status < 400)
  ) {
    throw new ProviderError({
      code: "REDIRECT_BLOCKED",
      adapterId: options.adapterId,
      message: "Provider redirects are not allowed.",
      status: response.status,
      requestIdentity: options.requestIdentity,
    });
  }
  const providerRequestId =
    response.headers.get("x-request-id") ??
    response.headers.get("request-id") ??
    undefined;
  if (!response.ok) {
    // Do not reflect upstream bodies: they may echo request data or credentials.
    throw new ProviderError({
      code: "UPSTREAM_HTTP_ERROR",
      adapterId: options.adapterId,
      message: `Provider request failed with HTTP ${response.status}.`,
      status: response.status,
      retryable:
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        response.status >= 500,
      requestIdentity: options.requestIdentity,
      providerRequestId,
    });
  }
  return response;
}

export async function readJson(
  response: Response,
  adapterId: AdapterId,
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch (cause) {
    throw new ProviderError({
      code: "INVALID_UPSTREAM_RESPONSE",
      adapterId,
      message: "Provider returned invalid JSON.",
      cause,
    });
  }
}

export function jsonHeaders(
  credential?: string,
  style: "bearer" | "anthropic" | "google" = "bearer",
): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  if (credential) {
    if (style === "anthropic") {
      headers.set("x-api-key", credential);
      headers.set("anthropic-version", "2023-06-01");
    } else if (style === "google") headers.set("x-goog-api-key", credential);
    else headers.set("Authorization", `Bearer ${credential}`);
  }
  return headers;
}

export function requireCredential(
  adapterId: AdapterId,
  context: ProviderCallContext,
): string {
  if (!context.credential)
    throw new ProviderError({
      code: "CREDENTIAL_REQUIRED",
      adapterId,
      message: "Provider credential is required.",
    });
  return context.credential;
}

export function appendPath(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function nativeRoot(base: string): string {
  const url = new URL(base);
  url.pathname = "";
  return url.toString().replace(/\/+$/, "");
}
