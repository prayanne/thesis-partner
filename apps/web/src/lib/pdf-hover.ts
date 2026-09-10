import { exactItemSourceRange, validRange } from "./pdf-mapping";
import type { Range as SourceRange, Segment } from "./types";

export type PdfTextHover = {
  segmentId: string;
  sourceRange: { start: number; end: number };
};
export type PdfHoverTarget = PdfTextHover & {
  kind: "word" | "sentence";
  paperRevisionId: string;
  extractionRunId: string;
  sourceTextHash: string;
  pageNumber: number;
};

export function pdfWordRanges(text: string): SourceRange[] {
  if (typeof Intl.Segmenter !== "function") return [];
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
  )
    .filter((part) => part.isWordLike)
    .map((part) => ({
      start: part.index,
      end: part.index + part.segment.length,
    }));
}

/** A caret is a boundary, so either adjacent word may contain the pointer.
 * The caller must verify the actual point against each word's DOM Range rects.
 * Cache Intl segmentation per verified text item, not per pointer event. */
export function wordRangesAtCaret(
  text: string,
  offset: number,
  words = pdfWordRanges(text),
): SourceRange[] {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > text.length ||
    (offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[offset]))
  )
    return [];
  const ranges: SourceRange[] = [];
  for (const word of words) {
    if (word.start > offset) break;
    if (offset <= word.end) ranges.push(word);
  }
  return ranges;
}

/** Only the existing identity-preserving PDF item map is reversible. */
export function verifiedHoverRange(
  target: PdfHoverTarget | null | undefined,
  segment: Segment | undefined,
  item: { index: number; text: string; hash: string },
  context: { revisionId: string; pageNumber: number },
): SourceRange | null {
  if (
    !target ||
    !segment ||
    !target.sourceRange ||
    (target.kind !== "word" && target.kind !== "sentence") ||
    target.segmentId !== segment.id ||
    !target.paperRevisionId ||
    target.paperRevisionId !== context.revisionId ||
    segment.paperRevisionId !== context.revisionId ||
    !target.extractionRunId ||
    target.extractionRunId !== segment.extractionRunId ||
    target.pageNumber !== context.pageNumber ||
    (segment.pageNumber !== undefined &&
      segment.pageNumber !== context.pageNumber) ||
    (segment.pageStart !== undefined &&
      segment.pageStart !== context.pageNumber) ||
    !target.sourceTextHash ||
    target.sourceTextHash.replace(/^sha256:/, "") !==
      segment.textHash.replace(/^sha256:/, "")
  )
    return null;
  try {
    return exactItemSourceRange(
      segment,
      item.index,
      item.text,
      item.hash,
      target.sourceRange,
      context.pageNumber,
      target.extractionRunId,
    );
  } catch {
    // Anchors arrive as unknown JSON; malformed provenance is not a mapping.
    return null;
  }
}

type ClientRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export function pointInRects(
  rects: Iterable<ClientRect>,
  x: number,
  y: number,
) {
  return Array.from(rects).some(
    (rect) =>
      [rect.left, rect.top, rect.width, rect.height, x, y].every(
        Number.isFinite,
      ) &&
      rect.width > 0 &&
      rect.height > 0 &&
      x >= rect.left &&
      x <= rect.left + rect.width &&
      y >= rect.top &&
      y <= rect.top + rect.height,
  );
}

/** Range rects already include PDF.js scale and page/text rotation. Only
 * remove the stage's browser position and any outer CSS scaling here. */
export function rangeRectsInStage(
  rects: Iterable<ClientRect>,
  stage: ClientRect,
  viewport: { width: number; height: number },
): ClientRect[] {
  if (
    ![
      stage.left,
      stage.top,
      stage.width,
      stage.height,
      viewport.width,
      viewport.height,
    ].every(Number.isFinite) ||
    stage.width <= 0 ||
    stage.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return [];
  return Array.from(rects)
    .filter(
      (rect) =>
        [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
        rect.width > 0 &&
        rect.height > 0,
    )
    .map((rect) => ({
      left: ((rect.left - stage.left) * viewport.width) / stage.width,
      top: ((rect.top - stage.top) * viewport.height) / stage.height,
      width: (rect.width * viewport.width) / stage.width,
      height: (rect.height * viewport.height) / stage.height,
    }));
}

export function caretAtPoint(document: Document, x: number, y: number) {
  const caret = document.caretPositionFromPoint?.(x, y);
  if (caret) return { node: caret.offsetNode, offset: caret.offset };
  // Safari versions without caretPositionFromPoint expose a collapsed Range.
  const range = document.caretRangeFromPoint?.(x, y);
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : null;
}

export function caretTextOffset(
  element: HTMLElement,
  text: string,
  caret: { node: Node; offset: number },
): number | null {
  if (element.textContent !== text || !element.contains(caret.node))
    return null;
  try {
    const prefix = element.ownerDocument.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(caret.node, caret.offset);
    const value = prefix.toString();
    return text.startsWith(value) ? value.length : null;
  } catch {
    return null;
  }
}

/** Resolve exact UTF-16 offsets across text nodes, including nested spans. */
export function textRange(
  element: HTMLElement,
  text: string,
  offsets: SourceRange,
): globalThis.Range | null {
  if (element.textContent !== text || !validRange(offsets, text)) return null;
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, 4 /* SHOW_TEXT */);
  let start: { node: Node; offset: number } | undefined;
  let end: { node: Node; offset: number } | undefined;
  let position = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const next = position + (node.textContent?.length ?? 0);
    if (!start && offsets.start >= position && offsets.start < next)
      start = { node, offset: offsets.start - position };
    if (offsets.end > position && offsets.end <= next) {
      end = { node, offset: offsets.end - position };
      break;
    }
    position = next;
  }
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range.toString() === text.slice(offsets.start, offsets.end)
    ? range
    : null;
}
