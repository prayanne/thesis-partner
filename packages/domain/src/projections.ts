import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { analysisSchema } from "../../contracts/src";
import { privateDirectory, atomicPrivateWrite } from "../../security/src";
import type { Database } from "../../db/src/client";
import { json, one, queueJob } from "./common";

export async function snapshotAnalysis(tx: Database, paperId: string) {
  const paper = await one(tx, "SELECT * FROM papers WHERE id=$1 FOR UPDATE", [
    paperId,
  ]);
  const [revision] = await tx.query(
    "SELECT r.*,e.metadata AS extraction_metadata FROM paper_revisions r LEFT JOIN extraction_runs e ON e.id=r.active_extraction_id WHERE r.id=$1",
    [paper.current_revision_id],
  );
  const [source] = await tx.query(
    "SELECT root_id,relative_path FROM paper_sources WHERE paper_id=$1 AND observed_hash=$2 AND missing_at IS NULL ORDER BY relative_path LIMIT 1",
    [paperId, revision?.content_hash ?? ""],
  );
  const [previous] = await tx.query(
    "SELECT analysis_revision FROM paper_analyses WHERE paper_id=$1 ORDER BY analysis_revision DESC LIMIT 1",
    [paperId],
  );
  const analysisRevision = (previous?.analysis_revision ?? 0) + 1;
  const snapshot = analysisSchema.parse({
    schemaVersion: "1.0",
    paperId,
    paperRevisionId: revision?.id ?? null,
    extractionRunId: revision?.active_extraction_id ?? null,
    contentHash: revision?.content_hash ?? null,
    analysisRevision,
    status: revision?.active_extraction_id ? "partial" : "pending",
    generatedAt: new Date().toISOString(),
    source: source
      ? { rootId: source.root_id, relativePath: source.relative_path }
      : null,
    bibliography: {
      title: paper.title,
      authors: paper.metadata.authors ?? [],
      year: paper.metadata.year ?? null,
      doi: paper.doi,
    },
    summary: null,
    topics: paper.tags,
    importance: {
      userPriority: paper.user_priority,
      suggestedPriority: null,
      reasons: [],
      scope: "personal-library",
    },
    relations: [],
    references: [],
    curriculumLinks: [],
    provenance: {
      extractorVersion: revision?.active_extraction_id
        ? "pdfjs-items-v1"
        : null,
      embeddingProfileId: null,
    },
    coverage: {
      parsedPages: revision?.extraction_metadata?.parsedPages ?? 0,
      totalPages: revision?.page_count ?? null,
      aiAnalyzedPages: 0,
    },
    warnings: [
      "AI analysis has not been performed.",
      "Vector retrieval is not indexed.",
      ...(revision?.state === "ocr_required"
        ? ["OCR required: no extractable text."]
        : []),
    ],
  });
  await tx.query(
    "INSERT INTO paper_analyses(paper_id,analysis_revision,source_revision_id,snapshot,state) VALUES($1,$2,$3,$4,$5)",
    [
      paperId,
      analysisRevision,
      revision?.id ?? null,
      json(snapshot),
      snapshot.status,
    ],
  );
  await queueJob(
    tx,
    "export_analysis",
    { paperId, analysisRevision },
    `export:${paperId}:${analysisRevision}`,
  );
  return snapshot;
}
export async function exportAnalysis(db: Database, paperId: string) {
  // Hold the paper lock through rename: metadata commits and concurrent exports cannot overtake publication.
  return db.transaction(async (tx) => {
    const paper = await one(tx, "SELECT * FROM papers WHERE id=$1 FOR UPDATE", [
      paperId,
    ]);
    const analysis = await one(
      tx,
      "SELECT * FROM paper_analyses WHERE paper_id=$1 ORDER BY analysis_revision DESC LIMIT 1",
      [paperId],
    );
    const snapshot = analysisSchema.parse(analysis.snapshot);
    const directory = path.join(
      path.resolve(
        /* turbopackIgnore: true */ process.env.ARTIFACTS_DIR ??
          path.join(process.env.APP_DATA_DIR ?? "./data", "artifacts"),
      ),
      "analysis",
      paperId,
    );
    await privateDirectory(directory);
    // Stable stem avoids leaving stale exports after a title edit.
    const stem =
      typeof paper.metadata.safeFileStem === "string"
        ? paper.metadata.safeFileStem
        : paperId;
    const safeStem =
      stem.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 100) || paperId;
    const destination = path.join(directory, `${safeStem}_analysis.json`);
    await atomicPrivateWrite(
      destination,
      JSON.stringify(snapshot, null, 2) + "\n",
    );
    return {
      analysisRevision: analysis.analysis_revision,
      relativePath: path.relative(
        path.dirname(path.dirname(directory)),
        destination,
      ),
    };
  });
}
