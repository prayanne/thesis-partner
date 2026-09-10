import { ProviderError } from "./errors";
import type {
  TranslationRequest,
  TranslationTextRange,
  TranslationWordAlignment,
  TranslationWordLink,
} from "./types";

export const GOOGLE_HTML_MARKERS_V1 = "google-html-markers-v1" as const;

// Local bounds limit work before dispatch and while parsing untrusted responses.
const MAX_SOURCE_LENGTH = 100_000;
const MAX_MARKUP_LENGTH = 1_000_000;
const MAX_WORDS = 10_000;
const MAX_TAGS = 40_000;
const WORD =
  /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu;
const ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
});

function invalid(message: string, input = false): never {
  throw new ProviderError({
    code: input ? "INVALID_CONFIG" : "INVALID_UPSTREAM_RESPONSE",
    adapterId: "google-translate-v2",
    message,
  });
}

function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function boundary(text: string, offset: number): boolean {
  return !(
    offset > 0 &&
    offset < text.length &&
    text.charCodeAt(offset - 1) >= 0xd800 &&
    text.charCodeAt(offset - 1) <= 0xdbff &&
    text.charCodeAt(offset) >= 0xdc00 &&
    text.charCodeAt(offset) <= 0xdfff
  );
}

function validRange(text: string, range: TranslationTextRange): boolean {
  return (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    range.start >= 0 &&
    range.start < range.end &&
    range.end <= text.length &&
    boundary(text, range.start) &&
    boundary(text, range.end)
  );
}

export function translationSourceWords(sourceText: string) {
  if (sourceText.length > MAX_SOURCE_LENGTH || !wellFormed(sourceText))
    invalid(
      "Translation marker input exceeds its bounds or contains invalid Unicode.",
      true,
    );
  const words: Array<{ id: string; sourceRange: TranslationTextRange }> = [];
  for (const match of sourceText.matchAll(WORD)) {
    if (words.length === MAX_WORDS)
      invalid("Translation marker input contains too many words.", true);
    const start = match.index;
    const end = start + match[0].length;
    words.push({ id: `w${start}-${end}`, sourceRange: { start, end } });
  }
  return words;
}

function escapePlainText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

/** Only our generated span subset is sent; input is always escaped plain text. */
export function markTranslationText(sourceText: string): string {
  const chunks: string[] = [];
  let cursor = 0;
  for (const word of translationSourceWords(sourceText)) {
    chunks.push(
      escapePlainText(sourceText.slice(cursor, word.sourceRange.start)),
    );
    chunks.push(
      `<span id="${word.id}">${escapePlainText(sourceText.slice(word.sourceRange.start, word.sourceRange.end))}</span>`,
    );
    cursor = word.sourceRange.end;
  }
  chunks.push(escapePlainText(sourceText.slice(cursor)));
  const markup = chunks.join("");
  if (markup.length > MAX_MARKUP_LENGTH)
    invalid("Translation marker input exceeds the HTML payload bound.", true);
  return markup;
}

/** Reservation and dispatch share exactly this payload calculation. */
export function prepareTranslationPayload(
  texts: readonly string[],
  mode?: TranslationRequest["translationMode"],
): { q: readonly string[]; format: "html" | "text"; characterCount: number } {
  if (mode !== undefined && mode !== "text" && mode !== GOOGLE_HTML_MARKERS_V1)
    invalid("Unsupported translation mode.", true);
  const html = mode === GOOGLE_HTML_MARKERS_V1;
  if (html && (texts.length === 0 || texts.length > 128))
    invalid("HTML translation requires between 1 and 128 inputs.", true);
  const q = html ? texts.map(markTranslationText) : texts;
  // Google counts tags and whitespace too. Count the actual escaped HTML strings,
  // conservatively including the full entity spellings, rather than source words.
  // https://docs.cloud.google.com/translate/faq
  return {
    q,
    format: html ? "html" : "text",
    characterCount: q.reduce((sum, text) => sum + Array.from(text).length, 0),
  };
}

function decodeText(value: string): string {
  const decoded = value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (!code.startsWith("#")) return ENTITIES[code.toLowerCase()] ?? entity;
      const hex = code[1]?.toLowerCase() === "x";
      const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        !Number.isSafeInteger(point) ||
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        invalid("Google Translate returned an invalid Unicode entity.");
      return String.fromCodePoint(point);
    },
  );
  if (!wellFormed(decoded))
    invalid("Google Translate returned invalid Unicode.");
  return decoded.normalize("NFC");
}

/**
 * A bounded, non-recursive parser for text and flat <span id="wN-N"> tags only.
 * Also accepts <span> when Google drops an ID; rejects all other tags/attributes,
 * comments, declarations, nesting and unbalanced markup. Decoded text is never
 * parsed again as HTML. A lost/duplicated/unknown ID never triggers guessed links.
 *
 * v2 documents HTML support, but its response has no word-alignment contract:
 * https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate
 * Google's HTML guide qualifies tag placement by language differences:
 * https://docs.cloud.google.com/translate/docs/translate-text
 */
export function parseTranslationMarkup(
  sourceText: string,
  markup: string,
): {
  translatedText: string;
  wordAlignment: TranslationWordAlignment;
} {
  if (markup.length > MAX_MARKUP_LENGTH)
    invalid("Google Translate HTML response exceeds the parser bound.");
  const expected = new Map(
    translationSourceWords(sourceText).map((word) => [word.id, word]),
  );
  const occurrences = new Map<string, number>();
  const candidates: TranslationWordLink[] = [];
  const chunks: string[] = [];
  let length = 0;
  let cursor = 0;
  let tags = 0;
  let degraded = false;
  let active: { id?: string; start: number } | undefined;
  while (cursor < markup.length) {
    if (markup[cursor] !== "<") {
      const next = markup.indexOf("<", cursor);
      const end = next === -1 ? markup.length : next;
      const text = decodeText(markup.slice(cursor, end));
      chunks.push(text);
      length += text.length;
      if (!active?.id && /[\p{L}\p{N}]/u.test(text)) degraded = true;
      cursor = end;
      continue;
    }
    if (++tags > MAX_TAGS)
      invalid("Google Translate HTML response contains too many tags.");
    const end = markup.indexOf(">", cursor);
    if (end === -1 || end - cursor > 100)
      invalid("Google Translate returned malformed marker HTML.");
    const tag = markup.slice(cursor, end + 1);
    if (/^<\/span[\t\n\f\r ]*>$/i.test(tag)) {
      if (!active) invalid("Google Translate returned unbalanced marker HTML.");
      const word = active.id ? expected.get(active.id) : undefined;
      if (word && length > active.start) {
        candidates.push({
          ...word,
          targetRange: { start: active.start, end: length },
        });
      } else degraded = true;
      active = undefined;
    } else {
      const opening =
        /^<span(?:[\t\n\f\r ]+id[\t\n\f\r ]*=[\t\n\f\r ]*(?:"(w\d{1,6}-\d{1,6})"|'(w\d{1,6}-\d{1,6})'))?[\t\n\f\r ]*>$/i.exec(
          tag,
        );
      if (!opening || active)
        invalid("Google Translate returned unsupported marker HTML.");
      const id = opening[1] ?? opening[2];
      if (id) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
      if (!id || !expected.has(id)) degraded = true;
      active = { id, start: length };
    }
    cursor = end + 1;
  }
  if (active) invalid("Google Translate returned unbalanced marker HTML.");
  const joined = chunks.join("");
  const translatedText = joined.normalize("NFC");
  // If normalization composes across a marker boundary, every candidate is
  // discarded instead of transferring stale offsets to the final target text.
  const links =
    joined !== translatedText
      ? []
      : candidates.filter(
          (link) =>
            occurrences.get(link.id) === 1 &&
            validRange(sourceText, link.sourceRange) &&
            validRange(translatedText, link.targetRange) &&
            translatedText
              .slice(link.targetRange.start, link.targetRange.end)
              .trim().length > 0,
        );
  links.sort((a, b) => a.sourceRange.start - b.sourceRange.start);
  return {
    translatedText,
    wordAlignment: {
      method: GOOGLE_HTML_MARKERS_V1,
      status:
        links.length === 0
          ? "unavailable"
          : links.length === expected.size && !degraded
            ? "available"
            : "partial",
      sourceText,
      targetText: translatedText,
      links,
    },
  };
}
