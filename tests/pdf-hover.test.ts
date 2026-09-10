import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  caretAtPoint,
  pointInRects,
  rangeRectsInStage,
  verifiedHoverRange,
  wordRangesAtCaret,
} from "../apps/web/src/lib/pdf-hover";
import type { PdfHoverTarget } from "../apps/web/src/components/pdf-viewer";
import type { Segment } from "../apps/web/src/lib/types";

function fixture() {
  const text = "😀 café 한국어 word";
  const hash = createHash("sha256").update(text).digest("hex");
  const segment: Segment = {
    id: "segment-1",
    paperRevisionId: "revision-1",
    extractionRunId: "extraction-1",
    pageStart: 2,
    sourceText: text,
    textHash: hash,
    anchors: {
      segmentId: "segment-1",
      extractionRunId: "extraction-1",
      pageNumber: 2,
      coordinateSpace: "pdf-user-space-unrotated",
      sourceRange: { start: 0, end: text.length },
      sourceTextHash: hash,
      items: [
        {
          pageNumber: 2,
          itemIndex: 4,
          itemTextHash: hash,
          itemRange: { start: 0, end: text.length },
        },
      ],
    },
  };
  const target: PdfHoverTarget = {
    segmentId: segment.id,
    sourceRange: { start: 3, end: 8 },
    kind: "word",
    paperRevisionId: "revision-1",
    extractionRunId: "extraction-1",
    sourceTextHash: hash,
    pageNumber: 2,
  };
  return {
    text,
    hash,
    segment,
    target,
    item: { index: 4, text, hash },
    context: { revisionId: "revision-1", pageNumber: 2 },
  };
}

describe("PDF word boundaries at a browser caret", () => {
  it("returns exact UTF-16 offsets after emoji and across combining marks", () => {
    const { text } = fixture();
    expect(wordRangesAtCaret(text, 6)).toEqual([{ start: 3, end: 8 }]);
    expect(wordRangesAtCaret(text, 10)).toEqual([{ start: 9, end: 12 }]);
    expect(wordRangesAtCaret(text, text.length)).toEqual([
      { start: 13, end: 17 },
    ]);
  });

  it("includes both adjacent word candidates for subsequent geometry checks", () => {
    expect(wordRangesAtCaret("hello世界", 5)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 7 },
    ]);
  });

  it("keeps contractions intact and excludes punctuation and whitespace", () => {
    expect(wordRangesAtCaret("don’t re-enter", 3)).toEqual([
      { start: 0, end: 5 },
    ]);
    expect(wordRangesAtCaret("alpha,  beta", 6)).toEqual([]);
    expect(wordRangesAtCaret("alpha,  beta", 7)).toEqual([]);
    expect(wordRangesAtCaret("😀 !!!", 4)).toEqual([]);
  });

  it.each([-1, 1.5, 100, NaN, Infinity, 1])(
    "never guesses for invalid or split-surrogate caret %s",
    (offset) => expect(wordRangesAtCaret("😀 word", offset)).toEqual([]),
  );

  it("returns no guessed words when Intl.Segmenter is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter")!;
    try {
      Object.defineProperty(Intl, "Segmenter", {
        ...descriptor,
        value: undefined,
      });
      expect(wordRangesAtCaret("word", 2)).toEqual([]);
    } finally {
      Object.defineProperty(Intl, "Segmenter", descriptor);
    }
  });
});

describe("verified transient PDF target ranges", () => {
  it("returns only the requested word or sentence subrange", () => {
    const { target, segment, item, context, text } = fixture();
    expect(verifiedHoverRange(target, segment, item, context)).toEqual({
      start: 3,
      end: 8,
    });
    expect(
      verifiedHoverRange(
        { ...target, kind: "sentence", sourceRange: { start: 3, end: 12 } },
        segment,
        item,
        context,
      ),
    ).toEqual({ start: 3, end: 12 });
    expect(text.slice(target.sourceRange.start, target.sourceRange.end)).toBe(
      "café",
    );
  });

  it("accepts matching prefixed SHA-256 hashes", () => {
    const { target, segment, item, context } = fixture();
    expect(
      verifiedHoverRange(
        { ...target, sourceTextHash: `sha256:${target.sourceTextHash}` },
        segment,
        item,
        context,
      ),
    ).toEqual(target.sourceRange);
  });

  it("rejects absent targets, absent segments, and missing source ranges", () => {
    const { target, segment, item, context } = fixture();
    expect(verifiedHoverRange(null, segment, item, context)).toBeNull();
    expect(verifiedHoverRange(undefined, segment, item, context)).toBeNull();
    expect(verifiedHoverRange(target, undefined, item, context)).toBeNull();
    expect(
      verifiedHoverRange(
        { ...target, sourceRange: null } as unknown as PdfHoverTarget,
        segment,
        item,
        context,
      ),
    ).toBeNull();
  });

  it.each([
    { segmentId: "other" },
    { paperRevisionId: "old-revision" },
    { extractionRunId: "old-extraction" },
    { sourceTextHash: "stale-hash" },
    { pageNumber: 1 },
    { kind: "segment" },
    { sourceRange: { start: 0, end: 1 } },
    { sourceRange: { start: 1, end: 2 } },
    { sourceRange: { start: -1, end: 4 } },
    { sourceRange: { start: 3, end: 3 } },
    { sourceRange: { start: 3, end: 100 } },
    { sourceRange: { start: 3.5, end: 8 } },
  ])("rejects stale or invalid target %j", (change) => {
    const { target, segment, item, context } = fixture();
    expect(
      verifiedHoverRange(
        { ...target, ...change } as PdfHoverTarget,
        segment,
        item,
        context,
      ),
    ).toBeNull();
  });

  it.each([
    { paperRevisionId: undefined },
    { paperRevisionId: "old-revision" },
    { extractionRunId: "old-extraction" },
    { pageNumber: 3 },
    { pageStart: 3 },
    { textHash: "stale-hash" },
    { sourceText: "😀 café 한국어 Word" },
    { anchors: null },
  ])("rejects unverified segment metadata %j", (change) => {
    const { target, segment, item, context } = fixture();
    expect(
      verifiedHoverRange(target, { ...segment, ...change }, item, context),
    ).toBeNull();
  });

  it("requires the current view, item index, text and computed hash", () => {
    const { target, segment, item, context } = fixture();
    expect(
      verifiedHoverRange(target, segment, item, {
        ...context,
        revisionId: "new-revision",
      }),
    ).toBeNull();
    expect(
      verifiedHoverRange(target, segment, item, { ...context, pageNumber: 3 }),
    ).toBeNull();
    for (const change of [
      { index: 5 },
      { text: item.text.normalize("NFC") },
      { hash: "different" },
    ])
      expect(
        verifiedHoverRange(target, segment, { ...item, ...change }, context),
      ).toBeNull();
  });

  it("rejects malformed and many-to-many anchor maps", () => {
    const { target, segment, item, context } = fixture();
    const anchors = segment.anchors as { items: unknown[] };
    expect(
      verifiedHoverRange(
        target,
        {
          ...segment,
          anchors: { ...anchors, items: [...anchors.items, ...anchors.items] },
        },
        item,
        context,
      ),
    ).toBeNull();
    expect(
      verifiedHoverRange(
        target,
        {
          ...segment,
          anchors: {
            ...anchors,
            items: [{ itemIndex: item.index, pageNumber: context.pageNumber }],
          },
        },
        item,
        context,
      ),
    ).toBeNull();
  });
});

describe("PDF range geometry", () => {
  const stage = { left: 100, top: 200, width: 600, height: 800 };
  const viewport = { width: 600, height: 800 };
  it("preserves every range fragment instead of merging into a segment box", () => {
    expect(
      rangeRectsInStage(
        [
          { left: 120, top: 220, width: 80, height: 12 },
          { left: 120, top: 240, width: 35, height: 12 },
        ],
        stage,
        viewport,
      ),
    ).toEqual([
      { left: 20, top: 20, width: 80, height: 12 },
      { left: 20, top: 40, width: 35, height: 12 },
    ]);
  });

  it("retains rendered PDF zoom and rotation without applying them twice", () => {
    const zoomedRotatedStage = {
      left: 100,
      top: 200,
      width: 1600,
      height: 1200,
    };
    expect(
      rangeRectsInStage(
        [{ left: 140, top: 260, width: 24, height: 160 }],
        zoomedRotatedStage,
        { width: 1600, height: 1200 },
      ),
    ).toEqual([{ left: 40, top: 60, width: 24, height: 160 }]);
  });

  it("removes outer CSS scaling while preserving local overlay coordinates", () => {
    expect(
      rangeRectsInStage(
        [{ left: 140, top: 240, width: 160, height: 24 }],
        { ...stage, width: 1200, height: 1600 },
        viewport,
      ),
    ).toEqual([{ left: 20, top: 20, width: 80, height: 12 }]);
  });

  it("excludes zero-size and non-finite rectangles or unavailable stage bounds", () => {
    expect(
      rangeRectsInStage(
        [
          { left: 120, top: 220, width: 0, height: 12 },
          { left: NaN, top: 220, width: 20, height: 12 },
          { left: 120, top: 220, width: 20, height: Infinity },
        ],
        stage,
        viewport,
      ),
    ).toEqual([]);
    expect(
      rangeRectsInStage([stage], { ...stage, width: 0 }, viewport),
    ).toEqual([]);
    expect(
      rangeRectsInStage([stage], stage, { ...viewport, height: NaN }),
    ).toEqual([]);
  });

  it("rejects nearby whitespace and gaps between range fragments", () => {
    const rects = [
      { left: 20, top: 20, width: 40, height: 12 },
      { left: 20, top: 40, width: 20, height: 12 },
    ];
    expect(pointInRects(rects, 30, 25)).toBe(true);
    expect(pointInRects(rects, 61, 25)).toBe(false);
    expect(pointInRects(rects, 30, 35)).toBe(false);
    expect(
      pointInRects([{ left: 0, top: 0, width: Infinity, height: 12 }], 1, 1),
    ).toBe(false);
  });
});

describe("browser caret API compatibility", () => {
  it("uses caretPositionFromPoint without needing the Safari fallback", () => {
    const node = {} as Node;
    const fallback = vi.fn();
    const document = {
      caretPositionFromPoint: vi.fn(() => ({ offsetNode: node, offset: 4 })),
      caretRangeFromPoint: fallback,
    } as unknown as Document;
    expect(caretAtPoint(document, 10, 20)).toEqual({ node, offset: 4 });
    expect(document.caretPositionFromPoint).toHaveBeenCalledWith(10, 20);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses the exact Safari Range caret when the standard API is absent or null", () => {
    const node = {} as Node;
    const fallback = vi.fn(() => ({ startContainer: node, startOffset: 7 }));
    expect(
      caretAtPoint(
        { caretRangeFromPoint: fallback } as unknown as Document,
        10,
        20,
      ),
    ).toEqual({ node, offset: 7 });
    expect(
      caretAtPoint(
        {
          caretPositionFromPoint: () => null,
          caretRangeFromPoint: fallback,
        } as unknown as Document,
        10,
        20,
      ),
    ).toEqual({ node, offset: 7 });
    expect(fallback).toHaveBeenCalledWith(10, 20);
    expect(caretAtPoint({} as Document, 10, 20)).toBeNull();
  });
});
