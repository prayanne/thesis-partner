import { describe, expect, it, vi } from "vitest";
import {
  createGoogleTranslationAdapter,
  GOOGLE_HTML_MARKERS_V1,
  markTranslationText,
  normalizeTranslatedText,
  type FetchImplementation,
  type RequestIdentity,
} from "@thesis/providers";

const identity: RequestIdentity = {
  logicalCallId: "translation-call",
  attempt: 1,
  idempotencyKey: "translation-attempt-1",
};

describe("Google Cloud Translation Basic v2", () => {
  it("sends plain-text batches, normalizes entities, preserves order, and returns attribution", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            translations: [
              {
                translatedText: "Tom &amp; Jerry &#x1F600;",
                detectedSourceLanguage: "en",
              },
              { translatedText: "caf&#233; &quot;ok&quot;" },
            ],
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "google-1",
          },
        },
      ),
    );
    const adapter = createGoogleTranslationAdapter(
      {
        adapterId: "google-translate-v2",
        providerInstanceId: "google",
        enabled: true,
        credentialRef: "google-key",
        translatorConfigVersion: "v1",
      },
      { fetch: fetchMock },
    );
    const result = await adapter.translate(
      {
        texts: ["A😀", "Cafe"],
        sourceLanguage: "en",
        targetLanguage: "ko",
        requestIdentity: identity,
      },
      { credential: "google-secret" },
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://translation.googleapis.com/language/translate/v2",
    );
    expect(String(url)).not.toContain("google-secret");
    expect((init?.headers as Headers).get("x-goog-api-key")).toBe(
      "google-secret",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      q: ["A😀", "Cafe"],
      source: "en",
      target: "ko",
      format: "text",
    });
    expect(result).toMatchObject({
      complete: true,
      characterCount: 6,
      providerRequestId: "google-1",
      requestIdentity: identity,
      attribution: {
        service: "Google Translate",
        displayText: "Powered by Google Translate",
        href: "https://translate.google.com",
        required: true,
      },
    });
    expect(result.items.map((item) => item.translatedText)).toEqual([
      "Tom & Jerry 😀",
      'café "ok"',
    ]);
    expect(result.items.every((item) => item.wordAlignment === undefined)).toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explicitly sends marked HTML once and returns plain text with validated reordered links", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      Response.json({
        data: {
          translations: [
            {
              translatedText:
                '<span id="w6-11">세계</span> <span id="w0-5">안녕</span>',
              detectedSourceLanguage: "en",
            },
          ],
        },
      }),
    );
    const adapter = createGoogleTranslationAdapter(
      {
        adapterId: "google-translate-v2",
        providerInstanceId: "google",
        enabled: true,
        credentialRef: "fixture",
        translatorConfigVersion: "v1",
      },
      { fetch: fetchMock },
    );
    const result = await adapter.translate(
      {
        texts: ["Hello world"],
        targetLanguage: "ko",
        sourceLanguage: "en",
        translationMode: GOOGLE_HTML_MARKERS_V1,
        requestIdentity: identity,
      },
      { credential: "fixture" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      q: [markTranslationText("Hello world")],
      format: "html",
      source: "en",
      target: "ko",
    });
    expect(result.characterCount).toBe(
      Array.from(markTranslationText("Hello world")).length,
    );
    expect(result.items[0]).toMatchObject({
      sourceText: "Hello world",
      translatedText: "세계 안녕",
      detectedSourceLanguage: "en",
      wordAlignment: {
        method: GOOGLE_HTML_MARKERS_V1,
        status: "available",
        sourceText: "Hello world",
        targetText: "세계 안녕",
        links: [
          {
            id: "w0-5",
            sourceRange: { start: 0, end: 5 },
            targetRange: { start: 3, end: 5 },
          },
          {
            id: "w6-11",
            sourceRange: { start: 6, end: 11 },
            targetRange: { start: 0, end: 2 },
          },
        ],
      },
    });
    expect(result.attribution.required).toBe(true);
  });

  it.each([
    ["둘 하나", "unavailable"],
    [
      '<span id="w0-3">하나</span> <span id="w4-7">둘</span> <span id="w0-3">일</span>',
      "partial",
    ],
  ])(
    "keeps lost or duplicated markers as fallback without another request",
    async (translatedText, status) => {
      const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
        Response.json({
          data: { translations: [{ translatedText }] },
        }),
      );
      const adapter = createGoogleTranslationAdapter(
        {
          adapterId: "google-translate-v2",
          providerInstanceId: "google",
          enabled: true,
          credentialRef: "fixture",
          translatorConfigVersion: "v1",
        },
        { fetch: fetchMock },
      );
      const result = await adapter.translate(
        {
          texts: ["one two"],
          targetLanguage: "ko",
          translationMode: GOOGLE_HTML_MARKERS_V1,
          requestIdentity: identity,
        },
        { credential: "fixture" },
      );
      expect(result.items[0]!.wordAlignment!.status).toBe(status);
      expect(result.items[0]!.translatedText).not.toContain("<span");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects unsafe upstream HTML without retrying or returning raw markup", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      Response.json({
        data: {
          translations: [{ translatedText: '<img src=x onerror="alert(1)">' }],
        },
      }),
    );
    const adapter = createGoogleTranslationAdapter(
      {
        adapterId: "google-translate-v2",
        providerInstanceId: "google",
        enabled: true,
        credentialRef: "fixture",
        translatorConfigVersion: "v1",
      },
      { fetch: fetchMock },
    );
    await expect(
      adapter.translate(
        {
          texts: ["one"],
          targetLanguage: "ko",
          translationMode: GOOGLE_HTML_MARKERS_V1,
          requestIdentity: identity,
        },
        { credential: "fixture" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_UPSTREAM_RESPONSE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails the complete batch on a response-count mismatch", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { translations: [{ translatedText: "one" }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const adapter = createGoogleTranslationAdapter(
      {
        adapterId: "google-translate-v2",
        providerInstanceId: "google",
        enabled: true,
        credentialRef: "google-key",
        translatorConfigVersion: "v1",
      },
      { fetch: fetchMock },
    );
    await expect(
      adapter.translate(
        {
          texts: ["one", "two"],
          targetLanguage: "ko",
          requestIdentity: identity,
        },
        { credential: "secret" },
      ),
    ).rejects.toMatchObject({ code: "TRANSLATION_COUNT_MISMATCH" });
  });

  it("normalizes numeric and named HTML entities without treating output as HTML", () => {
    expect(
      normalizeTranslatedText(
        "&lt;b&gt;A&amp;B&lt;/b&gt; &#65; &#x1F642; &unknown;",
      ),
    ).toBe("<b>A&B</b> A 🙂 &unknown;");
  });
});
