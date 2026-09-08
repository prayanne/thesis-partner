import type { Range, Segment, PdfRect } from "./types";
export function validRange(range: Range, text: string): boolean {
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start ||
    range.end > text.length
  )
    return false;
  // A UTF-16 offset must never split a surrogate pair.
  return ![range.start, range.end].some(
    (n) =>
      n > 0 &&
      n < text.length &&
      /[\uD800-\uDBFF]/.test(text[n - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[n]),
  );
}
export async function sha256(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function sameHash(a: string, b: string) {
  return a.replace(/^sha256:/, "") === b.replace(/^sha256:/, "");
}
interface ItemAnchor {
  extractionRunId: string;
  segmentId: string;
  pageNumber: number;
  coordinateSpace: string;
  sourceRange: Range;
  sourceTextHash: string;
  items: {
    pageNumber: number;
    itemIndex: number;
    itemTextHash: string;
    itemRange: Range;
  }[];
}
/** Only identity-preserving item maps are currently accepted. Normalized many-to-many
 * mappings need an explicit offset bridge; equal lengths are not sufficient proof. */
export function exactItemSourceRange(
  segment: Segment,
  itemIndex: number,
  itemText: string,
  itemHash: string,
  itemRange: Range,
  pageNumber: number,
  extractionRunId: string,
): Range | null {
  const anchor = segment.anchors as ItemAnchor | undefined;
  if (
    !anchor ||
    anchor.extractionRunId !== extractionRunId ||
    segment.extractionRunId !== extractionRunId ||
    anchor.segmentId !== segment.id ||
    anchor.pageNumber !== pageNumber ||
    anchor.coordinateSpace !== "pdf-user-space-unrotated" ||
    !Array.isArray(anchor.items) ||
    anchor.items.length !== 1
  )
    return null;
  const item = anchor.items[0];
  if (
    item.itemIndex !== itemIndex ||
    item.pageNumber !== pageNumber ||
    !sameHash(item.itemTextHash, itemHash) ||
    !sameHash(segment.textHash, itemHash) ||
    !sameHash(anchor.sourceTextHash, itemHash) ||
    segment.sourceText !== itemText ||
    anchor.sourceRange.start !== 0 ||
    anchor.sourceRange.end !== itemText.length ||
    item.itemRange.start !== 0 ||
    item.itemRange.end !== itemText.length ||
    !validRange(itemRange, itemText)
  )
    return null;
  return { ...itemRange };
}
export function viewportRect(
  rect: PdfRect,
  convert: (rect: PdfRect) => number[],
) {
  const [x1, y1, x2, y2] = convert(rect);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}
export function toPdfRect(
  rect: { left: number; top: number; right: number; bottom: number },
  stage: { left: number; top: number },
  convert: (x: number, y: number) => number[],
): PdfRect {
  const a = convert(rect.left - stage.left, rect.top - stage.top);
  const b = convert(rect.right - stage.left, rect.bottom - stage.top);
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
  ];
}
