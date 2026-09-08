import { ProviderError } from "./errors";
import { fetchChecked, jsonHeaders, readJson, requireCredential } from "./http";
import { getProviderDefinition } from "./registry";
import type {
  FetchImplementation,
  GoogleTranslationConfig,
  ProviderCallContext,
  TranslationAdapter,
  TranslationRequest,
  TranslationResult,
} from "./types";

const ATTRIBUTION = Object.freeze({
  service: "Google Translate" as const,
  displayText: "Powered by Google Translate" as const,
  href: "https://translate.google.com" as const,
  required: true as const,
});

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
});

export function normalizeTranslatedText(value: string): string {
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) {
        const point = Number.parseInt(code.slice(2), 16);
        return Number.isFinite(point) && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      if (code.startsWith("#")) {
        const point = Number.parseInt(code.slice(1), 10);
        return Number.isFinite(point) && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : entity;
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    })
    .normalize("NFC");
}

export class GoogleTranslationV2Adapter implements TranslationAdapter {
  readonly definition = getProviderDefinition("google-translate-v2");

  constructor(
    readonly config: Readonly<GoogleTranslationConfig>,
    private readonly fetch: FetchImplementation,
  ) {}

  async translate(
    request: TranslationRequest,
    context: ProviderCallContext,
  ): Promise<TranslationResult> {
    requireCredential("google-translate-v2", context);
    if (request.texts.length === 0)
      throw new ProviderError({
        code: "INVALID_CONFIG",
        adapterId: "google-translate-v2",
        message: "At least one translation input is required.",
        requestIdentity: request.requestIdentity,
      });
    const body: Record<string, unknown> = {
      q: request.texts,
      target: request.targetLanguage,
      format: "text",
    };
    if (request.sourceLanguage) body.source = request.sourceLanguage;
    const headers = jsonHeaders(context.credential, "google");
    const response = await fetchChecked({
      fetch: this.fetch,
      adapterId: "google-translate-v2",
      url: this.definition.defaultEndpoint,
      init: { method: "POST", headers, body: JSON.stringify(body) },
      context,
      requestIdentity: request.requestIdentity,
    });
    const value = await readJson(response, "google-translate-v2");
    const data =
      value.data && typeof value.data === "object"
        ? (value.data as Record<string, unknown>)
        : undefined;
    const translations =
      data && Array.isArray(data.translations) ? data.translations : undefined;
    if (!translations)
      throw new ProviderError({
        code: "INVALID_UPSTREAM_RESPONSE",
        adapterId: "google-translate-v2",
        message: "Google Translate returned an invalid response.",
        requestIdentity: request.requestIdentity,
      });
    if (translations.length !== request.texts.length)
      throw new ProviderError({
        code: "TRANSLATION_COUNT_MISMATCH",
        adapterId: "google-translate-v2",
        message:
          "Google Translate response count did not match the request count.",
        requestIdentity: request.requestIdentity,
        providerRequestId: response.headers.get("x-request-id") ?? undefined,
      });
    const items = translations.map((entry, index) => {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as Record<string, unknown>).translatedText !== "string"
      )
        throw new ProviderError({
          code: "INVALID_UPSTREAM_RESPONSE",
          adapterId: "google-translate-v2",
          message: "Google Translate returned an invalid translation item.",
          requestIdentity: request.requestIdentity,
        });
      const object = entry as Record<string, unknown>;
      return {
        sourceText: request.texts[index]!,
        translatedText: normalizeTranslatedText(
          object.translatedText as string,
        ),
        detectedSourceLanguage:
          typeof object.detectedSourceLanguage === "string"
            ? object.detectedSourceLanguage
            : undefined,
      };
    });
    return {
      items,
      characterCount: request.texts.reduce(
        (sum, text) => sum + Array.from(text).length,
        0,
      ),
      attribution: ATTRIBUTION,
      requestIdentity: request.requestIdentity,
      providerRequestId: response.headers.get("x-request-id") ?? undefined,
      complete: true,
    };
  }

  async testConnection(context: ProviderCallContext) {
    requireCredential("google-translate-v2", context);
    // No billable translation or credential-testing side effect is hidden behind connection test.
    return {
      ok: true as const,
      modelCount: 0,
      verification: "configuration_only" as const,
    };
  }
}
