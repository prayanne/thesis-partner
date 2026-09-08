import { describe, expect, it, vi } from "vitest";
import {
  createGoogleTranslationAdapter,
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
