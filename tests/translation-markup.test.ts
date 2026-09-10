import { describe, expect, it } from "vitest";
import {
  GOOGLE_HTML_MARKERS_V1,
  markTranslationText,
  parseTranslationMarkup,
  prepareTranslationPayload,
  translationSourceWords,
} from "../packages/providers/src/translation-markup";

const span = (id: string, text: string) => `<span id="${id}">${text}</span>`;

describe("Google HTML marker input", () => {
  it("uses stable UTF-16 token offsets with repeated words, combining marks and astral letters", () => {
    const source = "😀 go go cafe\u0301 𐐀";
    expect(translationSourceWords(source)).toEqual([
      { id: "w3-5", sourceRange: { start: 3, end: 5 } },
      { id: "w6-8", sourceRange: { start: 6, end: 8 } },
      { id: "w9-14", sourceRange: { start: 9, end: 14 } },
      { id: "w15-17", sourceRange: { start: 15, end: 17 } },
    ]);
    expect(markTranslationText(source)).toBe(markTranslationText(source));
  });

  it("escapes every plain-text input fragment, including HTML-looking text and entities", () => {
    expect(markTranslationText('<b>Tom & "Jerry"</b>')).toBe(
      `&lt;${span("w1-2", "b")}&gt;${span("w3-6", "Tom")} &amp; &quot;${span("w10-15", "Jerry")}&quot;&lt;/${span("w18-19", "b")}&gt;`,
    );
    expect(markTranslationText("don't < & > ' \" 😀")).toBe(
      `${span("w0-5", "don&#39;t")} &lt; &amp; &gt; &#39; &quot; 😀`,
    );
  });

  it("counts actual escaped HTML payload codepoints, including marker/entity overhead", () => {
    const source = "A & 😀";
    const payload = prepareTranslationPayload([source], GOOGLE_HTML_MARKERS_V1);
    expect(payload).toEqual({
      q: [`${span("w0-1", "A")} &amp; 😀`],
      format: "html",
      characterCount: Array.from(`${span("w0-1", "A")} &amp; 😀`).length,
    });
    expect(payload.characterCount).toBeGreaterThan(Array.from(source).length);
    expect(prepareTranslationPayload([source])).toEqual({
      q: [source],
      format: "text",
      characterCount: 5,
    });
  });

  it("rejects unsupported modes and bounded or invalid Unicode inputs before dispatch", () => {
    expect(() => prepareTranslationPayload(["a"], "future" as any)).toThrow(
      /mode/,
    );
    expect(() =>
      prepareTranslationPayload(Array(129).fill("a"), GOOGLE_HTML_MARKERS_V1),
    ).toThrow(/128/);
    expect(() => markTranslationText("x".repeat(100_001))).toThrow(/bounds/);
    expect(() => markTranslationText("a ".repeat(10_001))).toThrow(/words/);
    expect(() => markTranslationText("\ud800")).toThrow(/Unicode/);
  });
});

describe("Google HTML marker response", () => {
  it("allows reordering without positional guesses and binds ranges to exact final texts", () => {
    const source = "Hello world";
    const result = parseTranslationMarkup(
      source,
      `${span("w6-11", "세계")} ${span("w0-5", "안녕 😀")}`,
    );
    expect(result).toEqual({
      translatedText: "세계 안녕 😀",
      wordAlignment: {
        method: GOOGLE_HTML_MARKERS_V1,
        status: "available",
        sourceText: source,
        targetText: "세계 안녕 😀",
        links: [
          {
            id: "w0-5",
            sourceRange: { start: 0, end: 5 },
            targetRange: { start: 3, end: 8 },
          },
          {
            id: "w6-11",
            sourceRange: { start: 6, end: 11 },
            targetRange: { start: 0, end: 2 },
          },
        ],
      },
    });
    expect(result.translatedText.slice(3, 8)).toBe("안녕 😀");
  });

  it("decodes entities once and calculates offsets after NFC normalization", () => {
    const result = parseTranslationMarkup(
      "cafe\u0301 smile",
      `${span("w0-5", "cafe&#x301;")} &amp; ${span("w6-11", "&#128512;")}`,
    );
    expect(result.translatedText).toBe("café & 😀");
    expect(result.wordAlignment.sourceText).toBe("cafe\u0301 smile");
    expect(result.wordAlignment.links.map((link) => link.targetRange)).toEqual([
      { start: 0, end: 4 },
      { start: 7, end: 9 },
    ]);
    expect(
      parseTranslationMarkup("word", span("w0-4", "&amp;lt;b&amp;gt;"))
        .translatedText,
    ).toBe("&lt;b&gt;");
  });

  it("keeps escaped HTML-looking content as literal text without re-parsing it", () => {
    const result = parseTranslationMarkup(
      "word",
      span("w0-4", "&lt;script&gt;alert(1)&lt;/script&gt;"),
    );
    expect(result.translatedText).toBe("<script>alert(1)</script>");
    expect(result.wordAlignment.links[0]!.targetRange.end).toBe(
      result.translatedText.length,
    );
  });

  it("retains item fallback when every marker disappears, never pairing words by order", () => {
    expect(parseTranslationMarkup("one two", "둘 하나")).toEqual({
      translatedText: "둘 하나",
      wordAlignment: {
        method: GOOGLE_HTML_MARKERS_V1,
        status: "unavailable",
        sourceText: "one two",
        targetText: "둘 하나",
        links: [],
      },
    });
  });

  it("keeps only unique surviving marker links when words or IDs are missing", () => {
    const result = parseTranslationMarkup(
      "one two three",
      `${span("w0-3", "하나")} 둘 <span>셋</span>`,
    );
    expect(result.translatedText).toBe("하나 둘 셋");
    expect(result.wordAlignment.status).toBe("partial");
    expect(result.wordAlignment.links.map((link) => link.id)).toEqual(["w0-3"]);
  });

  it("rejects every occurrence of duplicate IDs but preserves the translated item and other links", () => {
    const result = parseTranslationMarkup(
      "one two",
      `${span("w0-3", "하나")} ${span("w4-7", "둘")} ${span("w0-3", "일")}`,
    );
    expect(result.translatedText).toBe("하나 둘 일");
    expect(result.wordAlignment.status).toBe("partial");
    expect(result.wordAlignment.links.map((link) => link.id)).toEqual(["w4-7"]);
    expect(
      parseTranslationMarkup("one", span("w0-3", "하나") + span("w0-3", "일"))
        .wordAlignment.status,
    ).toBe("unavailable");
  });

  it.each(["w0-999", "w4-1", "w0-0", "w01-3", "w1-3"])(
    "rejects unknown/out-of-range/non-token mapping %s",
    (id) => {
      const result = parseTranslationMarkup("one", span(id, "하나"));
      expect(result.translatedText).toBe("하나");
      expect(result.wordAlignment).toMatchObject({
        status: "unavailable",
        links: [],
      });
    },
  );

  it("rejects marker IDs that split an astral source token", () => {
    const result = parseTranslationMarkup("𐐀", span("w0-1", "A"));
    expect(result.wordAlignment).toMatchObject({
      status: "unavailable",
      links: [],
    });
    expect(
      parseTranslationMarkup("𐐀", span("w0-2", "😀")).wordAlignment.links,
    ).toEqual([
      {
        id: "w0-2",
        sourceRange: { start: 0, end: 2 },
        targetRange: { start: 0, end: 2 },
      },
    ]);
  });

  it("drops ranges when NFC composition crosses a marker boundary", () => {
    const result = parseTranslationMarkup(
      "one two",
      span("w0-3", "e") + span("w4-7", "&#769;"),
    );
    expect(result.translatedText).toBe("é");
    expect(result.wordAlignment).toMatchObject({
      targetText: "é",
      status: "unavailable",
      links: [],
    });
  });

  it("marks uncovered translated words as partial and empty/whitespace markers unavailable", () => {
    expect(
      parseTranslationMarkup("one", `prefix ${span("w0-3", "하나")}`)
        .wordAlignment.status,
    ).toBe("partial");
    expect(
      parseTranslationMarkup("one", span("w0-3", "")).wordAlignment.status,
    ).toBe("unavailable");
    expect(
      parseTranslationMarkup("one", span("w0-3", " \n ")).wordAlignment.status,
    ).toBe("unavailable");
    expect(parseTranslationMarkup("😀 !", "😀 !").wordAlignment.status).toBe(
      "unavailable",
    );
  });

  it.each([
    '<img src=x onerror="alert(1)">',
    "<script>alert(1)</script>",
    "<!-- comment -->",
    "<!DOCTYPE html>",
    "<div>text</div>",
    '<span id="w0-3" onclick="alert(1)">text</span>',
    '<span id="w0-3" id="w0-3">text</span>',
    '<span class="x">text</span>',
    "<span id=w0-3>text</span>",
    '<span id="w0-3">nested<span>text</span></span>',
    '<span id="w0-3">unclosed',
    "unopened</span>",
    '<span id="w0-3"',
    '<span id="w0-3"/>',
    '<span\u00a0id="w0-3">text</span>',
  ])("rejects unsupported or malformed markup: %s", (markup) => {
    expect(() => parseTranslationMarkup("one", markup)).toThrow();
  });

  it.each(["&#xD800;", "&#55296;", "&#x110000;", "&#0;", "\ud800"])(
    "rejects invalid Unicode output %s",
    (value) => {
      expect(() => parseTranslationMarkup("one", span("w0-3", value))).toThrow(
        /Unicode/,
      );
    },
  );

  it("accepts harmless span case/quote/whitespace differences within the subset", () => {
    expect(
      parseTranslationMarkup("one", "<SPAN id = 'w0-3' >하나</SPAN >")
        .wordAlignment.status,
    ).toBe("available");
  });

  it("bounds untrusted response size, tag count, and individual tag size", () => {
    expect(() => parseTranslationMarkup("one", "x".repeat(1_000_001))).toThrow(
      /bound/,
    );
    expect(() =>
      parseTranslationMarkup("one", "<span></span>".repeat(20_001)),
    ).toThrow(/tags/);
    expect(() =>
      parseTranslationMarkup("one", `<span${" ".repeat(101)}>`),
    ).toThrow(/malformed/);
  });
});
