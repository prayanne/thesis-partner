import { describe, it, expect } from "vitest";
import {
  exactItemSourceRange,
  validRange,
  viewportRect,
  toPdfRect,
} from "../apps/web/src/lib/pdf-mapping";
import {
  newBlock,
  supportedBlock,
  reorder,
} from "../apps/web/src/lib/lesson-blocks";
import type { Segment } from "../apps/web/src/lib/types";
const segment: Segment = {
  id: "segment",
  extractionRunId: "run",
  sourceText: "A😀한 text",
  textHash: "abc",
  anchors: {
    extractionRunId: "run",
    segmentId: "segment",
    pageNumber: 2,
    coordinateSpace: "pdf-user-space-unrotated",
    sourceRange: { start: 0, end: 9 },
    sourceTextHash: "abc",
    items: [
      {
        pageNumber: 2,
        itemIndex: 4,
        itemTextHash: "abc",
        itemRange: { start: 0, end: 9 },
      },
    ],
  },
};
describe("verified PDF source mapping", () => {
  it("uses UTF-16 ranges including complete surrogate pairs", () => {
    expect(validRange({ start: 1, end: 3 }, "A😀한 text")).toBe(true);
    expect(validRange({ start: 1, end: 2 }, "A😀한 text")).toBe(false);
    expect(validRange({ start: 2, end: 3 }, "A😀한 text")).toBe(false);
    expect(validRange({ start: 0, end: 10 }, "A😀한 text")).toBe(false);
  });
  it("accepts identity mappings only with exact hashes and namespace", () => {
    expect(
      exactItemSourceRange(
        segment,
        4,
        segment.sourceText,
        "abc",
        { start: 3, end: 4 },
        2,
        "run",
      ),
    ).toEqual({ start: 3, end: 4 });
  });
  it("rejects stale extraction, page, item, content and range", () => {
    for (const args of [
      [4, segment.sourceText, "abc", { start: 3, end: 4 }, 2, "other"],
      [4, segment.sourceText, "abc", { start: 3, end: 4 }, 1, "run"],
      [3, segment.sourceText, "abc", { start: 3, end: 4 }, 2, "run"],
      [4, segment.sourceText, "bad", { start: 3, end: 4 }, 2, "run"],
      [4, "A😀한-text", "abc", { start: 3, end: 4 }, 2, "run"],
      [4, segment.sourceText, "abc", { start: 1, end: 2 }, 2, "run"],
    ] as const) {
      expect(
        exactItemSourceRange(
          segment,
          args[0],
          args[1],
          args[2],
          args[3],
          args[4],
          args[5],
        ),
      ).toBeNull();
    }
  });
  it("never treats many-to-many normalization as identity", () => {
    const changed = structuredClone(segment);
    const anchors = changed.anchors as { items: unknown[] };
    anchors.items.push(anchors.items[0]);
    expect(
      exactItemSourceRange(
        changed,
        4,
        segment.sourceText,
        "abc",
        { start: 3, end: 4 },
        2,
        "run",
      ),
    ).toBeNull();
  });
  it("converts source rectangles with scale and rotated axes", () => {
    const r = viewportRect([10, 20, 30, 40], ([x1, y1, x2, y2]) => [
      y1 * 2,
      200 - x1 * 2,
      y2 * 2,
      200 - x2 * 2,
    ]);
    expect(r).toEqual({ left: 40, top: 140, width: 40, height: 40 });
  });
  it("removes browser stage offset before inverse viewport transform", () => {
    const rect = toPdfRect(
      { left: 140, top: 190, right: 180, bottom: 230 },
      { left: 100, top: 50 },
      (x, y) => [(200 - y) / 2, x / 2],
    );
    expect(rect).toEqual([10, 20, 30, 40]);
  });
});
describe("data-driven curriculum blocks", () => {
  it("adds all six supported block types without a page-specific branch", () => {
    for (const kind of [
      "markdown",
      "paper_reading",
      "wiki_reading",
      "self_explanation",
      "exercise",
      "checklist",
    ] as const)
      expect(supportedBlock(newBlock(kind, `key-${kind}`))).toBe(true);
  });
  it("preserves unknown kind and newer schema in readonly state", () => {
    const unknown = {
      blockKey: "x",
      kind: "future",
      schemaVersion: 9,
      payload: { important: "retain" },
    };
    expect(supportedBlock(unknown)).toBe(false);
    expect(unknown.payload).toEqual({ important: "retain" });
    expect(
      supportedBlock({ ...newBlock("markdown", "x"), schemaVersion: 2 }),
    ).toBe(false);
  });
  it("rejects invalid payloads", () => {
    expect(
      supportedBlock({
        ...newBlock("self_explanation", "x"),
        payload: { questions: [{ html: "bad" }] },
      }),
    ).toBe(false);
  });
  it("reorders immutably and retains every item exactly once", () => {
    const initial = ["a", "b", "c"];
    expect(reorder(initial, 0, 2)).toEqual(["b", "c", "a"]);
    expect(initial).toEqual(["a", "b", "c"]);
    expect(reorder(initial, 0, -1)).toBe(initial);
  });
});
