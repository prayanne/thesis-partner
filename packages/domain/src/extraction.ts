import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type { Database } from "../../db/src/client";
import { DomainError, hash, json, one } from "./common";
import { readStablePdf } from "./library";
import { snapshotAnalysis } from "./projections";

export interface PdfItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}
/** Conservative identity mapping: one TextItem per segment, UTF-16 offsets in both strings.
 * This does not claim sentence segmentation, column ordering, or word-level geometry. */
export function mapTextItem(
  item: PdfItem,
  itemIndex: number,
  pageNumber: number,
  pageBox: number[],
  rotation: number,
  segmentId: string,
  extractionRunId: string,
) {
  const textHash = hash(item.str);
  const [a, b, c, d, e, f] = item.transform as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return {
    sourceText: item.str,
    textHash,
    anchors: {
      extractionRunId,
      segmentId,
      pageNumber,
      coordinateSpace: "pdf-user-space-unrotated",
      pageBox,
      rotation,
      sourceRange: { start: 0, end: item.str.length },
      sourceTextHash: textHash,
      rects: [],
      items: [
        {
          pageNumber,
          itemIndex,
          itemTextHash: textHash,
          itemRange: { start: 0, end: item.str.length },
          transform: [a, b, c, d, e, f],
          width: item.width,
          height: item.height,
        },
      ],
      geometryStatus: "text_item_only",
    },
    quality: {
      readingOrder: "pdfjs_item_order",
      segmentation: "text_item",
      wordGeometry: "unavailable",
    },
  };
}
export async function extractPdf(
  db: Database,
  input: {
    paperId: string;
    paperRevisionId: string;
    relativePath: string;
    contentHash: string;
  },
  lease?: { jobId: string; owner: string },
) {
  let relativePath = input.relativePath;
  let file;
  try {
    file = await readStablePdf(relativePath);
  } catch (error) {
    const sources = await db.query(
      "SELECT relative_path FROM paper_sources WHERE paper_id=$1 AND observed_hash=$2 AND missing_at IS NULL ORDER BY relative_path",
      [input.paperId, input.contentHash],
    );
    for (const source of sources) {
      try {
        const candidate = await readStablePdf(source.relative_path);
        if (candidate.contentHash === input.contentHash) {
          relativePath = source.relative_path;
          file = candidate;
          break;
        }
      } catch {}
    }
    if (!file) throw error;
  }
  if (file.contentHash !== input.contentHash)
    throw new DomainError(
      "SOURCE_CHANGED",
      "Source content changed after import.",
      409,
    );
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fontDirectory =
    path.join(
      path.dirname(
        createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
      ),
      "standard_fonts",
    ) + path.sep;
  const task = pdfjs.getDocument({
    data: new Uint8Array(file.bytes),
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: fontDirectory,
  });
  const pdf = await task.promise;
  const runId = randomUUID();
  const segments: {
    id: string;
    page: number;
    order: number;
    sourceText: string;
    textHash: string;
    anchors: unknown;
    quality: unknown;
  }[] = [];
  let parsedPages = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageHasText = false;
      content.items.forEach((raw, index) => {
        if (!("str" in raw) || !raw.str.trim()) return;
        pageHasText = true;
        const id = randomUUID();
        const mapped = mapTextItem(
          raw,
          index,
          pageNumber,
          page.view,
          page.rotate,
          id,
          runId,
        );
        segments.push({
          id,
          page: pageNumber,
          order: segments.length,
          ...mapped,
        });
      });
      if (pageHasText) parsedPages++;
      page.cleanup();
    }
    // Check the mounted bytes again before committing an immutable extraction namespace.
    if ((await readStablePdf(relativePath)).contentHash !== input.contentHash)
      throw new DomainError(
        "SOURCE_CHANGED",
        "Source changed during extraction.",
        409,
      );
    return await db.transaction(async (tx) => {
      if (lease) {
        const job = await one(tx, "SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [
          lease.jobId,
        ]);
        if (
          job.state !== "running" ||
          job.lease_owner !== lease.owner ||
          job.cancel_requested
        )
          throw new DomainError(
            "LEASE_LOST",
            "Job no longer owns execution.",
            409,
          );
      }
      await one(tx, "SELECT * FROM papers WHERE id=$1 FOR UPDATE", [
        input.paperId,
      ]);
      await tx.query(
        "INSERT INTO extraction_runs(id,paper_revision_id,extractor_version,segmenter_version,state,metadata,completed_at) VALUES($1,$2,'pdfjs-items-v1','identity-items-v1','succeeded',$3,now())",
        [
          runId,
          input.paperRevisionId,
          json({
            parsedPages,
            totalPages: pdf.numPages,
            limitations: [
              "TextItem segments; sentence/column reconstruction and word rectangles unverified.",
            ],
          }),
        ],
      );
      for (const segment of segments)
        await tx.query(
          "INSERT INTO paper_segments(id,extraction_run_id,page_start,order_key,source_text,text_hash,anchors,quality) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            segment.id,
            runId,
            segment.page,
            segment.order,
            segment.sourceText,
            segment.textHash,
            json(segment.anchors),
            json(segment.quality),
          ],
        );
      let chunkOrder = 0;
      let current: typeof segments = [];
      let size = 0;
      const flush = async () => {
        if (!current.length) return;
        const text = current.map((s) => s.sourceText).join("\n");
        await tx.query(
          "INSERT INTO paper_chunks(extraction_run_id,chunker_version,order_key,segment_ranges,text,text_hash) VALUES($1,'page-items-v1',$2,$3,$4,$5)",
          [
            runId,
            chunkOrder++,
            json(
              current.map((s) => ({
                segmentId: s.id,
                sourceRange: { start: 0, end: s.sourceText.length },
              })),
            ),
            text,
            hash(text),
          ],
        );
        current = [];
        size = 0;
      };
      for (const segment of segments) {
        if (
          current.length &&
          (size + segment.sourceText.length > 4000 ||
            current[0]!.page !== segment.page)
        )
          await flush();
        current.push(segment);
        size += segment.sourceText.length;
      }
      await flush();
      await tx.query(
        "UPDATE paper_revisions SET active_extraction_id=$2,page_count=$3,state=$4 WHERE id=$1",
        [
          input.paperRevisionId,
          runId,
          pdf.numPages,
          segments.length ? "extracted" : "ocr_required",
        ],
      );
      await snapshotAnalysis(tx, input.paperId);
      const result = {
        extractionRunId: runId,
        pageCount: pdf.numPages,
        parsedPages,
        segmentCount: segments.length,
        state: segments.length ? "extracted" : "ocr_required",
      };
      if (lease)
        await tx.query(
          "UPDATE jobs SET state='succeeded',progress=$2,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
          [lease.jobId, json(result)],
        );
      return result;
    });
  } finally {
    await task.destroy();
  }
}
