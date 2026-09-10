import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  focusedWord,
  sentenceRows,
  translationParagraphs,
  translationRows,
  type TranslationParagraph,
  type TranslationRow,
} from "../apps/web/src/lib/translation-page";
import type { Artifact, Range, Segment } from "../apps/web/src/lib/types";

// All text, identities, hashes, and PDF geometry below are synthetic. In
// particular, this suite never imports domain/config/database/provider code.
const digest = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const span = (start: number, end: number): Range => ({ start, end });
const marker = (
  sourceStart: number,
  sourceEnd: number,
  targetStart: number,
  targetEnd: number,
  id = `w${sourceStart}-${sourceEnd}`,
) => ({
  id,
  sourceRange: span(sourceStart, sourceEnd),
  targetRange: span(targetStart, targetEnd),
});

function fixture(sourceText = "red blue", targetText = "파랑 빨강") {
  const segment: Segment = {
    id: "synthetic-segment",
    extractionRunId: "synthetic-extraction",
    paperRevisionId: "synthetic-revision",
    pageNumber: 1,
    sourceText,
    textHash: digest(sourceText),
  };
  const part = {
    segmentId: segment.id,
    sourceText,
    sourceTextHash: digest(sourceText),
    targetText,
    targetTextHash: digest(targetText),
    wordAlignment: {
      method: "google-html-markers-v1",
      status: "available",
      sourceText,
      targetText,
      // Deliberately source-ordered: Korean target words are reordered.
      links: [marker(0, 3, 3, 5), marker(4, 8, 0, 2)],
    },
  };
  const artifact: Artifact = {
    id: "synthetic-artifact",
    operation: "translation",
    provenance: {
      extractionRunId: segment.extractionRunId,
      paperRevisionId: segment.paperRevisionId,
    },
    payload: { segments: [part] },
  };
  return { segment, part, artifact };
}

function row(
  id: string,
  sourceText: string,
  options: {
    x?: number;
    y?: number;
    height?: number;
    targetText?: string | null;
    linked?: boolean;
  } = {},
): TranslationRow {
  const { x = 40, y = 700, height = 10 } = options;
  return {
    segment: {
      id,
      extractionRunId: "synthetic-extraction",
      paperRevisionId: "synthetic-revision",
      pageNumber: 1,
      sourceText,
      textHash: digest(sourceText),
      anchors: {
        items: [{ transform: [height, 0, 0, height, x, y], height }],
      },
    },
    targetText:
      options.targetText === undefined ? `합성 번역 ${id}` : options.targetText,
    linked: options.linked ?? options.targetText !== null,
    links: [],
  };
}

const ids = (rows: TranslationRow[]) => rows.map((value) => value.segment.id);
const paragraph = (rows: TranslationRow[]): TranslationParagraph => ({
  id: rows[0]?.segment.id ?? "empty",
  heading: false,
  rows,
});

describe("translation rows: exact text and generation binding", () => {
  it("uses final wordAlignment metadata and preserves reordered target words", async () => {
    const { artifact, segment } = fixture();
    const [result] = await translationRows(artifact, [segment]);

    expect(result).toMatchObject({
      segment,
      targetText: "파랑 빨강",
      linked: true,
      artifactId: "synthetic-artifact",
    });
    expect(
      result.links.map((link) => [
        segment.sourceText.slice(link.sourceRange.start, link.sourceRange.end),
        result.targetText!.slice(link.targetRange.start, link.targetRange.end),
      ]),
    ).toEqual([
      ["blue", "파랑"],
      ["red", "빨강"],
    ]);
    expect(
      focusedWord(result, {
        origin: "source",
        segmentId: segment.id,
        range: span(0, 3),
      }),
    ).toBe(result.links[1]);
    expect(
      focusedWord(result, {
        origin: "translation",
        segmentId: segment.id,
        range: span(0, 2),
      }),
    ).toBe(result.links[0]);
  });

  it("accepts bare and sha256-prefixed hashes independently", async () => {
    const { artifact, segment, part } = fixture();
    segment.textHash = `sha256:${segment.textHash}`;
    part.targetTextHash = `sha256:${part.targetTextHash}`;
    expect((await translationRows(artifact, [segment]))[0].links).toHaveLength(
      2,
    );
    segment.textHash = digest(segment.sourceText);
    part.sourceTextHash = `sha256:${part.sourceTextHash}`;
    expect((await translationRows(artifact, [segment]))[0].links).toHaveLength(
      2,
    );
  });

  it.each(["source text", "segment hash", "artifact source hash"])(
    "disables source linking on mismatched %s without hiding saved text",
    async (field) => {
      const { artifact, segment, part } = fixture();
      if (field === "source text") part.sourceText = "red Blue";
      if (field === "segment hash") segment.textHash = digest("red Blue");
      if (field === "artifact source hash")
        part.sourceTextHash = digest("red Blue");
      const [result] = await translationRows(artifact, [segment]);
      expect(result).toMatchObject({
        targetText: "파랑 빨강",
        linked: false,
        links: [],
      });
    },
  );

  it.each(["extractionRunId", "paperRevisionId"])(
    "rejects a stale artifact %s even when its source text and hashes match",
    async (field) => {
      const { artifact, segment } = fixture();
      artifact.provenance![field] = "different-generation";
      const [result] = await translationRows(artifact, [segment]);
      expect(result).toMatchObject({ linked: false, links: [] });
    },
  );

  it("keeps text readable but disables links when artifact provenance is absent", async () => {
    const { artifact, segment } = fixture();
    delete artifact.provenance;
    expect((await translationRows(artifact, [segment]))[0]).toMatchObject({
      targetText: "파랑 빨강",
      linked: false,
      links: [],
    });
  });

  it("does not infer a paper revision when the current segment lacks one", async () => {
    const { artifact, segment } = fixture();
    delete segment.paperRevisionId;
    expect((await translationRows(artifact, [segment]))[0]).toMatchObject({
      linked: false,
      links: [],
    });
  });

  it.each(["sourceText", "targetText"])(
    "falls back to the phrase when alignment.%s is not the exact rendered text",
    async (field) => {
      const { artifact, segment, part } = fixture();
      part.wordAlignment[field as "sourceText" | "targetText"] += " ";
      const [result] = await translationRows(artifact, [segment]);
      expect(result).toMatchObject({
        linked: true,
        targetText: part.targetText,
        links: [],
      });
    },
  );

  it("rejects equal-length target replacement with a stale target digest", async () => {
    const { artifact, segment, part } = fixture();
    part.targetText = "초록 빨강";
    part.wordAlignment.targetText = part.targetText;
    const [result] = await translationRows(artifact, [segment]);
    expect(result).toMatchObject({
      linked: true,
      targetText: "초록 빨강",
      links: [],
    });
  });

  it("does not normalize target text to reuse another text's offsets", async () => {
    const { artifact, segment, part } = fixture("red blue", "é blue");
    part.wordAlignment.targetText = "e\u0301 blue";
    part.wordAlignment.links = [marker(0, 3, 0, 2)];
    expect((await translationRows(artifact, [segment]))[0].links).toEqual([]);
  });

  it("requires a target hash before enabling word links", async () => {
    const { artifact, segment, part } = fixture();
    Reflect.deleteProperty(part, "targetTextHash");
    expect((await translationRows(artifact, [segment]))[0]).toMatchObject({
      linked: true,
      links: [],
    });
  });

  it.each(["unavailable", "unknown", ""])(
    "does not trust links with alignment status %j",
    async (status) => {
      const { artifact, segment, part } = fixture();
      part.wordAlignment.status = status;
      expect((await translationRows(artifact, [segment]))[0].links).toEqual([]);
    },
  );

  it("does not trust an unknown marker method", async () => {
    const { artifact, segment, part } = fixture();
    part.wordAlignment.method = "position-based-guess";
    expect((await translationRows(artifact, [segment]))[0].links).toEqual([]);
  });

  it("retains only supplied links for partial metadata without filling gaps", async () => {
    const { artifact, segment, part } = fixture();
    part.wordAlignment.status = "partial";
    part.wordAlignment.links = [marker(4, 8, 0, 2)];
    const [result] = await translationRows(artifact, [segment]);
    expect(result.links).toEqual([
      { sourceRange: span(4, 8), targetRange: span(0, 2) },
    ]);
    expect(
      focusedWord(result, {
        origin: "source",
        segmentId: segment.id,
        range: span(0, 3),
      }),
    ).toBeUndefined();
  });

  it.each(["segments", "items"])(
    "keeps exact legacy %s/translatedText rows linked at phrase level",
    async (key) => {
      const { artifact, segment, part } = fixture();
      const {
        targetText,
        wordAlignment: _unused,
        targetTextHash: _hash,
        ...legacy
      } = part;
      artifact.payload = {
        [key]: [{ ...legacy, translatedText: targetText }],
      };
      const [result] = await translationRows(artifact, [segment]);
      expect(result).toMatchObject({
        targetText: "파랑 빨강",
        linked: true,
        links: [],
      });
      expect(
        ids(sentenceRows(translationParagraphs([result]), segment.id)),
      ).toEqual([segment.id]);
    },
  );

  it("does not borrow word offsets from the retired alignment property", async () => {
    const { artifact, segment, part } = fixture();
    const { wordAlignment, ...legacy } = part;
    artifact.payload = { segments: [{ ...legacy, alignment: wordAlignment }] };
    expect((await translationRows(artifact, [segment]))[0]).toMatchObject({
      linked: true,
      links: [],
    });
  });

  it("keeps current segment order, represents missing translations, and omits whitespace", async () => {
    const { artifact, segment, part } = fixture();
    const missing = { ...segment, id: "missing" };
    const blank = { ...segment, id: "blank", sourceText: " \n\t" };
    const second = { ...segment, id: "second" };
    artifact.payload = {
      segments: [
        {
          ...part,
          segmentId: second.id,
          targetText: "두 번째",
          wordAlignment: null,
        },
        { ...part, segmentId: "not-on-current-page" },
        part,
      ],
    };
    const rows = await translationRows(artifact, [
      segment,
      missing,
      blank,
      second,
    ]);
    expect(ids(rows)).toEqual([segment.id, "missing", "second"]);
    expect(rows[1]).toMatchObject({
      targetText: null,
      linked: false,
      links: [],
    });
    expect(rows[2].targetText).toBe("두 번째");
  });

  it.each([null, [], "invalid", { segments: [null, 7, []] }])(
    "treats malformed payload %j as missing translations",
    async (payload) => {
      const { artifact, segment } = fixture();
      artifact.payload = payload;
      expect((await translationRows(artifact, [segment]))[0]).toMatchObject({
        targetText: null,
        linked: false,
        links: [],
      });
    },
  );
});

describe("translation links: unambiguous UTF-16 ranges", () => {
  it("accepts a complete surrogate pair on either side", async () => {
    const { artifact, segment, part } = fixture("A😀 B", "나🚀 다");
    part.wordAlignment.links = [marker(1, 3, 1, 3)];
    const [result] = await translationRows(artifact, [segment]);
    expect(result.links).toEqual([
      { sourceRange: span(1, 3), targetRange: span(1, 3) },
    ]);
  });

  it.each([
    ["sourceRange", 1, 2],
    ["sourceRange", 2, 3],
    ["targetRange", 1, 2],
    ["targetRange", 2, 3],
  ] as const)(
    "rejects %s [%i,%i) splitting a surrogate pair",
    async (key, start, end) => {
      const { artifact, segment, part } = fixture("A😀 B", "나🚀 다");
      const link = marker(1, 3, 1, 3);
      link[key] = span(start, end);
      part.wordAlignment.links = [link];
      expect((await translationRows(artifact, [segment]))[0].links).toEqual([]);
    },
  );

  it.each([
    ["sourceRange", -1, 3],
    ["sourceRange", 0, 9],
    ["sourceRange", 0.5, 3],
    ["sourceRange", 3, 3],
    ["targetRange", 0, 6],
    ["targetRange", 3, 1],
    ["targetRange", 0, Number.POSITIVE_INFINITY],
  ] as const)("rejects invalid %s [%s,%s)", async (key, start, end) => {
    const { artifact, segment, part } = fixture();
    const link = marker(0, 3, 3, 5);
    link[key] = span(start, end);
    part.wordAlignment.links = [link];
    expect((await translationRows(artifact, [segment]))[0].links).toEqual([]);
  });

  it.each([
    ["duplicate range", marker(0, 3, 3, 5)],
    ["source overlap only", marker(2, 5, 0, 2)],
    ["target overlap only", marker(4, 8, 2, 4)],
    ["duplicate marker ID with disjoint ranges", marker(4, 8, 0, 2, "w0-3")],
  ])("rejects ambiguous links: %s", async (_name, extra) => {
    const { artifact, segment, part } = fixture();
    part.wordAlignment.links = [
      marker(0, 3, 3, 5),
      extra as ReturnType<typeof marker>,
    ];
    expect((await translationRows(artifact, [segment]))[0]).toMatchObject({
      linked: true,
      links: [],
    });
  });

  it("accepts adjacent ranges without treating touching endpoints as overlap", async () => {
    const { artifact, segment, part } = fixture("ab", "가나");
    part.wordAlignment.links = [marker(0, 1, 1, 2), marker(1, 2, 0, 1)];
    expect((await translationRows(artifact, [segment]))[0].links).toHaveLength(
      2,
    );
  });

  it.each([null, undefined, "", 7])(
    "rejects marker links with an invalid identity %j",
    async (id) => {
      const { artifact, segment, part } = fixture();
      Reflect.set(part.wordAlignment.links[0], "id", id);
      expect((await translationRows(artifact, [segment]))[0].links).toEqual([]);
    },
  );

  it("does not select one word for focus spanning multiple links", async () => {
    const { artifact, segment } = fixture();
    const [result] = await translationRows(artifact, [segment]);
    expect(
      focusedWord(result, {
        origin: "source",
        segmentId: segment.id,
        range: span(0, 8),
      }),
    ).toBeUndefined();
    expect(
      focusedWord(result, {
        origin: "translation",
        segmentId: segment.id,
        range: span(2, 3),
      }),
    ).toBeUndefined();
    expect(
      focusedWord(result, {
        origin: "source",
        segmentId: "other-segment",
        range: span(0, 3),
      }),
    ).toBeUndefined();
    expect(focusedWord(result, null)).toBeUndefined();
    expect(
      focusedWord(result, { origin: "source", segmentId: segment.id }),
    ).toBeUndefined();
    expect(
      focusedWord(
        { ...result, linked: false },
        {
          origin: "source",
          segmentId: segment.id,
          range: span(0, 3),
        },
      ),
    ).toBeUndefined();
  });
});

describe("translation paragraphs and source sentence groups", () => {
  it("groups a source sentence spanning adjacent TextItems and line wraps", () => {
    const rows = [
      row("previous", "Previous sentence.", { y: 714 }),
      row("start", "This sentence", { x: 40, y: 700 }),
      row("middle", "crosses", { x: 120, y: 700 }),
      row("end", "a line boundary.", { x: 40, y: 686 }),
      row("next", "Next sentence.", { y: 672 }),
    ];
    const paragraphs = translationParagraphs(rows);
    expect(paragraphs).toHaveLength(1);
    for (const id of ["start", "middle", "end"])
      expect(ids(sentenceRows(paragraphs, id))).toEqual([
        "start",
        "middle",
        "end",
      ]);
    expect(ids(sentenceRows(paragraphs, "previous"))).toEqual(["previous"]);
    expect(ids(sentenceRows(paragraphs, "next"))).toEqual(["next"]);
  });

  it("uses source punctuation rather than a translated item's punctuation", () => {
    const rows = [
      row("start", "A sentence", { targetText: "번역은 끝처럼 보입니다." }),
      row("end", "continues here.", { targetText: "이어지는 번역" }),
    ];
    const paragraphs = translationParagraphs(rows);
    expect(ids(sentenceRows(paragraphs, "end"))).toEqual(["start", "end"]);
  });

  it.each(['Done."', "Done!’", "Done?)", "완료。", "완료！", "완료？"])(
    "recognizes a preceding sentence ending %j",
    (ending) => {
      const paragraphs = [
        paragraph([row("previous", ending), row("current", "Next.")]),
      ];
      expect(ids(sentenceRows(paragraphs, "current"))).toEqual(["current"]);
    },
  );

  it("never bridges an explicit paragraph boundary without punctuation", () => {
    const paragraphs = [
      paragraph([row("first", "An unfinished fragment")]),
      paragraph([row("second", "a separate paragraph.")]),
    ];
    expect(ids(sentenceRows(paragraphs, "first"))).toEqual(["first"]);
    expect(ids(sentenceRows(paragraphs, "second"))).toEqual(["second"]);
  });

  it("detects a large paragraph gap and preserves exact source and target strings", () => {
    const rows = [
      row("first", "  An unfinished fragment  ", {
        y: 700,
        targetText: "  번역  ",
      }),
      row("second", "a separate paragraph.", { y: 660 }),
    ];
    const paragraphs = translationParagraphs(rows);
    expect(paragraphs.map((value) => ids(value.rows))).toEqual([
      ["first"],
      ["second"],
    ]);
    expect(paragraphs[0].rows[0]).toBe(rows[0]);
    expect(paragraphs[0].rows[0].targetText).toBe("  번역  ");
    expect(ids(sentenceRows(paragraphs, "second"))).toEqual(["second"]);
  });

  it("keeps a heading separate from surrounding body TextItems", () => {
    const paragraphs = translationParagraphs([
      row("heading", "Abstract", { y: 720 }),
      row("body-start", "A study", { y: 706 }),
      row("body-end", "of mapping.", { y: 692 }),
    ]);
    expect(
      paragraphs.map((value) => ({
        heading: value.heading,
        ids: ids(value.rows),
      })),
    ).toEqual([
      { heading: true, ids: ["heading"] },
      { heading: false, ids: ["body-start", "body-end"] },
    ]);
    expect(ids(sentenceRows(paragraphs, "body-end"))).toEqual([
      "body-start",
      "body-end",
    ]);
  });

  it("still separates an actual indentation change using the previous line start", () => {
    const paragraphs = translationParagraphs([
      row("line-start", "An unfinished", { x: 40, y: 700 }),
      row("line-end", "fragment", { x: 110, y: 700 }),
      row("indented", "A separate paragraph.", { x: 110, y: 686 }),
    ]);
    expect(paragraphs.map((value) => ids(value.rows))).toEqual([
      ["line-start", "line-end"],
      ["indented"],
    ]);
    expect(ids(sentenceRows(paragraphs, "indented"))).toEqual(["indented"]);
  });

  it.each([
    [
      710,
      [
        ["title-start", "title-end"],
        ["body-1", "body-2", "body-3"],
      ],
    ],
    [680, [["title-start"], ["title-end"], ["body-1", "body-2", "body-3"]]],
  ] as const)(
    "groups heading lines at their own font size while respecting a large gap (y=%i)",
    (secondY, expected) => {
      const paragraphs = translationParagraphs([
        row("title-start", "A synthetic research title", {
          y: 740,
          height: 20,
        }),
        row("title-end", "continued on another line", {
          y: secondY,
          height: 20,
        }),
        row("body-1", "Body sentence one.", { y: 650 }),
        row("body-2", "Body sentence two.", { y: 636 }),
        row("body-3", "Body sentence three.", { y: 622 }),
      ]);
      expect(paragraphs.map((value) => ids(value.rows))).toEqual(expected);
      expect(paragraphs[0].heading).toBe(true);
      expect(paragraphs.at(-1)!.heading).toBe(false);
    },
  );

  it("uses a phrase fallback for a TextItem containing multiple source sentences", () => {
    const rows = [
      row("before", "A preceding fragment"),
      row("ambiguous", "ends here. Another sentence begins"),
      row("after", "and continues."),
    ];
    expect(ids(sentenceRows([paragraph(rows)], "ambiguous"))).toEqual([
      "ambiguous",
    ]);
  });

  it("does not absorb a neighboring TextItem containing an internal sentence boundary", () => {
    const rows = [
      row("before", "A preceding fragment"),
      row("ambiguous", "ends here. Another sentence begins"),
      row("after", "and continues."),
    ];
    expect(ids(sentenceRows([paragraph(rows)], "before"))).toEqual(["before"]);
    expect(ids(sentenceRows([paragraph(rows)], "after"))).toEqual(["after"]);
  });

  it("makes missing translations explicit barriers to sentence grouping", () => {
    const rows = [
      row("before", "A sentence starts"),
      row("missing", "in untranslated material", { targetText: null }),
      row("after", "and ends."),
    ];
    const paragraphs = translationParagraphs(rows);
    expect(paragraphs.map((value) => ids(value.rows))).toEqual([
      ["before"],
      ["missing"],
      ["after"],
    ]);
    expect(ids(sentenceRows(paragraphs, "before"))).toEqual(["before"]);
    expect(ids(sentenceRows(paragraphs, "after"))).toEqual(["after"]);
    expect(sentenceRows(paragraphs, "missing")).toEqual([]);
  });

  it("does not bridge an unverified source row or return its linked neighbors", () => {
    const rows = [
      row("before", "A sentence starts"),
      row("stale", "in stale extracted material", { linked: false }),
      row("after", "and ends."),
    ];
    const paragraphs = [paragraph(rows)];
    expect(ids(sentenceRows(paragraphs, "before"))).toEqual(["before"]);
    expect(ids(sentenceRows(paragraphs, "after"))).toEqual(["after"]);
    expect(sentenceRows(paragraphs, "stale")).toEqual([]);
  });

  it("handles absent geometry and unknown or empty focus without throwing", () => {
    const first = row("first", "A sentence");
    const second = row("second", "ends here.");
    first.segment.anchors = null;
    second.segment.anchors = { items: [{ transform: [1, 2] }] };
    const paragraphs = translationParagraphs([first, second]);
    expect(ids(sentenceRows(paragraphs, "second"))).toEqual([
      "first",
      "second",
    ]);
    expect(sentenceRows(paragraphs, "unknown")).toEqual([]);
    expect(translationParagraphs([])).toEqual([]);
    expect(sentenceRows([], "unknown")).toEqual([]);
  });
});
