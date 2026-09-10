import type { Artifact, Range, Segment } from "./types";
import { sha256, validRange } from "./pdf-mapping";

export interface WordLink {
  sourceRange: Range;
  targetRange: Range;
}
export interface TranslationRow {
  segment: Segment;
  targetText: string | null;
  links: WordLink[];
  linked: boolean;
  artifactId?: string;
}
export type ReadingFocus = {
  origin: "source" | "translation";
  segmentId: string;
  range?: Range;
} | null;
export interface TranslationParagraph {
  id: string;
  heading: boolean;
  rows: TranslationRow[];
}
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const range = (value: unknown): Range | null => {
  const v = object(value);
  return typeof v?.start === "number" && typeof v.end === "number"
    ? { start: v.start, end: v.end }
    : null;
};
const hashMatches = (a: unknown, b: string) =>
  typeof a === "string" &&
  a.replace(/^sha256:/, "") === b.replace(/^sha256:/, "");

/** Read only exact current text pairs. A translation generation never borrows
 * another generation's offsets; legacy pairs retain phrase highlighting. */
export async function translationRows(
  artifact: Artifact,
  segments: Segment[],
): Promise<TranslationRow[]> {
  const payload = object(artifact.payload);
  const values = payload?.segments ?? payload?.items;
  const parts = Array.isArray(values) ? values.map(object).filter(Boolean) : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const part of parts) {
    if (typeof part?.segmentId === "string" && !byId.has(part.segmentId))
      byId.set(part.segmentId, part);
  }
  return Promise.all(
    segments
      .filter((s) => s.sourceText.trim())
      .map(async (segment) => {
        const part = byId.get(segment.id);
        const text = part?.targetText ?? part?.translatedText;
        const targetText = typeof text === "string" ? text : null;
        const sourceDigest = await sha256(segment.sourceText);
        const linked =
          !!part &&
          targetText !== null &&
          part.sourceText === segment.sourceText &&
          artifact.provenance?.extractionRunId === segment.extractionRunId &&
          !!segment.paperRevisionId &&
          artifact.provenance?.paperRevisionId === segment.paperRevisionId &&
          hashMatches(segment.textHash, sourceDigest) &&
          hashMatches(part.sourceTextHash, sourceDigest);
        const links: WordLink[] = [];
        const alignment = object(part?.wordAlignment);
        // Only known, hash-bound provider metadata can identify a cross-language word.
        if (
          linked &&
          alignment?.method === "google-html-markers-v1" &&
          ["available", "partial"].includes(String(alignment.status)) &&
          alignment.sourceText === segment.sourceText &&
          alignment.targetText === targetText &&
          hashMatches(part?.targetTextHash, await sha256(targetText!)) &&
          Array.isArray(alignment.links)
        ) {
          const ids = new Set<string>();
          let invalidId = false;
          for (const value of alignment.links) {
            const entry = object(value);
            if (typeof entry?.id !== "string" || !entry.id || ids.has(entry.id))
              invalidId = true;
            else ids.add(entry.id);
            const sourceRange = range(entry?.sourceRange);
            const targetRange = range(entry?.targetRange);
            if (
              !sourceRange ||
              !targetRange ||
              !validRange(sourceRange, segment.sourceText) ||
              !validRange(targetRange, targetText!)
            )
              continue;
            links.push({ sourceRange, targetRange });
          }
          // Reject ambiguous overlaps instead of pairing words by their order.
          const ambiguous = links.some((a, i) =>
            links.some(
              (b, j) =>
                j > i &&
                (overlaps(a.sourceRange, b.sourceRange) ||
                  overlaps(a.targetRange, b.targetRange)),
            ),
          );
          if (ambiguous || invalidId) links.length = 0;
          links.sort((a, b) => a.targetRange.start - b.targetRange.start);
        }
        return {
          segment,
          targetText,
          linked,
          links,
          artifactId:
            typeof part?.artifactId === "string"
              ? part.artifactId
              : artifact.id,
        };
      }),
  );
}
export function overlaps(a: Range, b: Range) {
  return a.start < b.end && b.start < a.end;
}
export function focusedWord(row: TranslationRow, focus: ReadingFocus) {
  if (!focus?.range || focus.segmentId !== row.segment.id || !row.linked)
    return undefined;
  const key = focus.origin === "source" ? "sourceRange" : "targetRange";
  const matches = row.links.filter((link) => overlaps(link[key], focus.range!));
  return matches.length === 1 ? matches[0] : undefined;
}
function geometry(row: TranslationRow) {
  const anchor = object(row.segment.anchors);
  const items = anchor?.items;
  const item = Array.isArray(items) ? object(items[0]) : null;
  const transform = item?.transform;
  if (
    !Array.isArray(transform) ||
    transform.length !== 6 ||
    !transform.every(Number.isFinite)
  )
    return null;
  const height =
    typeof item?.height === "number" && item.height > 0
      ? item.height
      : Math.hypot(transform[2], transform[3]);
  return { x: transform[4] as number, y: transform[5] as number, height };
}
/** Paragraph layout is a presentation heuristic, not a claim to reconstruct
 * the source PDF's columns or sentence boundaries. Exact row text stays intact. */
export function translationParagraphs(
  rows: TranslationRow[],
): TranslationParagraph[] {
  const heights = rows
    .map(geometry)
    .flatMap((g) => (g?.height ? [g.height] : []))
    .sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 10;
  const result: TranslationParagraph[] = [];
  let count = 0;
  let lineStartX: number | null = null;
  let lineY: number | null = null;
  for (const row of rows) {
    const g = geometry(row);
    const prev = result.at(-1)?.rows.at(-1);
    const previous = prev ? geometry(prev) : null;
    const heading =
      (g && g.height >= median * 1.24 && row.segment.sourceText.length < 180) ||
      /^(?:abstract|references|acknowledg(?:e)?ments|\d+(?:\.\d+)*\.?\s+[A-Z][^.!?]{2,65})$/i.test(
        row.segment.sourceText.trim(),
      );
    const lineChange =
      g && previous && Math.abs(g.y - previous.y) > median * 0.45;
    const breakGeometry =
      g &&
      previous &&
      (g.y - previous.y > median ||
        Math.abs(g.y - previous.y) > median * 1.95 ||
        (lineChange && lineStartX !== null && Math.abs(g.x - lineStartX) > 45));
    const continuesHeading =
      heading &&
      result.at(-1)?.heading &&
      g &&
      previous &&
      Math.abs(g.y - previous.y) <= Math.max(g.height, previous.height) * 1.65;
    const fresh =
      !prev ||
      !!heading !== result.at(-1)!.heading ||
      row.targetText === null ||
      prev.targetText === null ||
      (breakGeometry && !continuesHeading) ||
      (!heading &&
        count > 600 &&
        /[.!?。！？][\s"'’”)]*$/.test(prev.segment.sourceText));
    if (fresh) {
      result.push({ id: row.segment.id, heading: !!heading, rows: [] });
      count = 0;
    }
    if (g) {
      if (fresh || lineY === null || Math.abs(g.y - lineY) > median * 0.45) {
        lineY = g.y;
        lineStartX = g.x;
      } else lineStartX = Math.min(lineStartX ?? g.x, g.x);
    }
    result.at(-1)!.rows.push(row);
    count += row.targetText?.length ?? 0;
  }
  return result;
}

/** Complete source sentences may span multiple PDF TextItems. Keep the group
 * bounded to its visual paragraph; ambiguous/multi-sentence items fall back to a phrase. */
export function sentenceRows(
  paragraphs: TranslationParagraph[],
  id: string,
): TranslationRow[] {
  const paragraph = paragraphs.find((p) =>
    p.rows.some((r) => r.segment.id === id),
  );
  if (!paragraph) return [];
  const rows = paragraph.rows;
  const index = rows.findIndex((r) => r.segment.id === id);
  if (!rows[index].linked) return [];
  const multiSentence = (r: TranslationRow) =>
    Array.from(
      new Intl.Segmenter("en", { granularity: "sentence" }).segment(
        r.segment.sourceText,
      ),
    ).filter((s) => s.segment.trim()).length > 1;
  if (multiSentence(rows[index])) return [rows[index]];
  const ends = (r: TranslationRow) =>
    /[.!?。！？][\s"'’”)]*$/.test(r.segment.sourceText);
  let start = index,
    end = index;
  while (
    start > 0 &&
    !ends(rows[start - 1]) &&
    rows[start - 1].linked &&
    !multiSentence(rows[start - 1])
  )
    start--;
  while (
    end < rows.length - 1 &&
    !ends(rows[end]) &&
    rows[end + 1].linked &&
    !multiSentence(rows[end + 1])
  )
    end++;
  return rows.slice(start, end + 1).filter((r) => r.linked);
}
