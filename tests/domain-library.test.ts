import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rename,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestDatabase, type Database } from "../packages/db/src/testing";
import { migrate } from "../packages/db/src/migrations";
import { applySeed } from "../packages/db/src/seed";
import {
  importPaper,
  paperFile,
  resolveLibraryPath,
  scanLibrary,
} from "../packages/domain/src/library";
import { extractPdf, mapTextItem } from "../packages/domain/src/extraction";
import { exportAnalysis } from "../packages/domain/src/projections";
import { executeOperation } from "../packages/domain/src/operations";
const roots: string[] = [];
const dbs: Database[] = [];
const oldPapers = process.env.PAPERS_DIR,
  oldArtifacts = process.env.ARTIFACTS_DIR;
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => db.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  if (oldPapers === undefined) delete process.env.PAPERS_DIR;
  else process.env.PAPERS_DIR = oldPapers;
  if (oldArtifacts === undefined) delete process.env.ARTIFACTS_DIR;
  else process.env.ARTIFACTS_DIR = oldArtifacts;
});
function pdf(text: string) {
  const content = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = Buffer.byteLength(result);
  result += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(result);
}
async function setup() {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "thesis-domain-")),
  );
  roots.push(root);
  process.env.PAPERS_DIR = path.join(root, "library");
  process.env.ARTIFACTS_DIR = path.join(root, "artifacts");
  await mkdir(process.env.PAPERS_DIR);
  const db = await createTestDatabase(path.join(root, "database"));
  dbs.push(db);
  await migrate(db);
  return { root, db };
}
it("imports, deduplicates moved PDFs, extracts real PDF.js text and atomically projects durable snapshots", async () => {
  const { root, db } = await setup();
  const bytes = pdf("Durable local paper test");
  await writeFile(path.join(process.env.PAPERS_DIR!, "first.pdf"), bytes);
  const first = await importPaper(db, "first.pdf");
  expect(first.duplicate).toBe(false);
  await rename(
    path.join(process.env.PAPERS_DIR!, "first.pdf"),
    path.join(process.env.PAPERS_DIR!, "renamed.pdf"),
  );
  const duplicate = await importPaper(db, "renamed.pdf");
  expect(duplicate.paperId).toBe(first.paperId);
  expect(duplicate.paperRevisionId).toBe(first.paperRevisionId);
  expect((await scanLibrary(db)).length).toBe(1);
  const [revision] = await db.query(
    "SELECT * FROM paper_revisions WHERE id=$1",
    [first.paperRevisionId],
  );
  const result = await extractPdf(db, {
    paperId: first.paperId,
    paperRevisionId: first.paperRevisionId,
    relativePath: "renamed.pdf",
    contentHash: revision!.content_hash,
  });
  expect(result.segmentCount).toBeGreaterThan(0);
  expect(result.parsedPages).toBe(1);
  const [segment] = await db.query("SELECT * FROM paper_segments");
  expect(segment!.source_text).toBe("Durable local paper test");
  expect(segment!.anchors.sourceRange.end).toBe(segment!.source_text.length);
  const exported = await exportAnalysis(db, first.paperId);
  const exportedFile = path.join(
    process.env.ARTIFACTS_DIR!,
    "analysis",
    first.paperId,
    "first_analysis.json",
  );
  const snapshot = JSON.parse(await readFile(exportedFile, "utf8"));
  expect(snapshot.analysisRevision).toBe(exported.analysisRevision);
  expect(snapshot.coverage.parsedPages).toBe(1);
  expect(snapshot.status).toBe("partial");
  expect((await paperFile(db, first.paperId)).bytes.equals(bytes)).toBe(true);
  await writeFile(
    path.join(process.env.PAPERS_DIR!, "renamed.pdf"),
    pdf("A changed revision"),
  );
  const changed = await importPaper(db, "renamed.pdf");
  expect(changed.paperId).toBe(first.paperId);
  expect(changed.paperRevisionId).not.toBe(first.paperRevisionId);
  await expect(
    paperFile(db, first.paperId, first.paperRevisionId),
  ).rejects.toMatchObject({ code: "SOURCE_MISSING" });
  expect(
    (await db.query("SELECT * FROM paper_segments WHERE id=$1", [segment!.id]))
      .length,
  ).toBe(1);
  await db.close();
  dbs.splice(dbs.indexOf(db), 1);
  const reopened = await createTestDatabase(path.join(root, "database"));
  dbs.push(reopened);
  expect((await reopened.query("SELECT * FROM paper_revisions")).length).toBe(
    2,
  );
});
it("rejects library traversal and symlink escapes and protects prior export on unsafe destination", async () => {
  const { root, db } = await setup();
  await writeFile(path.join(root, "outside.pdf"), pdf("outside"));
  await symlink(
    path.join(root, "outside.pdf"),
    path.join(process.env.PAPERS_DIR!, "escape.pdf"),
  );
  await expect(resolveLibraryPath("../outside.pdf")).rejects.toMatchObject({
    code: "INVALID_PATH",
  });
  await expect(resolveLibraryPath("escape.pdf")).rejects.toMatchObject({
    code: "INVALID_PATH",
  });
  await writeFile(path.join(process.env.PAPERS_DIR!, "safe.pdf"), pdf("safe"));
  const imported = await importPaper(db, "safe.pdf");
  await mkdir(path.join(root, "outside-artifacts"));
  await mkdir(process.env.ARTIFACTS_DIR!);
  await symlink(
    path.join(root, "outside-artifacts"),
    path.join(process.env.ARTIFACTS_DIR!, "analysis"),
  );
  await expect(exportAnalysis(db, imported.paperId)).rejects.toMatchObject({
    code: "UNSAFE_PATH",
  });
});
it("preserves exact UTF-16 source/item offsets including surrogate pairs and ligatures", () => {
  const item = {
    str: "A😀 ﬁ x",
    transform: [12, 0, 0, 12, 40, 700],
    width: 80,
    height: 12,
  };
  const mapped = mapTextItem(
    item,
    3,
    1,
    [0, 0, 612, 792],
    90,
    "segment",
    "run",
  );
  expect(mapped.anchors.sourceRange).toEqual({ start: 0, end: 7 });
  expect(item.str.slice(1, 3)).toBe("😀");
  expect(mapped.anchors.items[0]!.itemRange).toEqual({ start: 0, end: 7 });
  expect(mapped.anchors.rects).toEqual([]);
});
it("seeds seven practical lessons and twenty Wiki pages once, preserving user changes and archives", async () => {
  const { db } = await setup();
  const result = await applySeed(db);
  expect(result).toMatchObject({
    applied: true,
    lessons: 7,
    wikiPages: 20,
    papers: 7,
  });
  expect(
    (await db.query("SELECT * FROM lesson_blocks WHERE kind='exercise'"))
      .length,
  ).toBe(7);
  expect((await db.query("SELECT * FROM curriculum_dependencies")).length).toBe(
    11,
  );
  const [item] = await db.query("SELECT * FROM curriculum_items LIMIT 1");
  await executeOperation(
    {
      method: "DELETE",
      path: `curriculum-items/${item!.id}`,
      body: { expectedRevision: item!.revision },
    },
    { db, principal: { kind: "session", scopes: ["*"] } },
  );
  expect(await applySeed(db)).toEqual({ applied: false, version: 1 });
  expect(
    (
      await db.query(
        "SELECT * FROM curriculum_items WHERE archived_at IS NOT NULL",
      )
    ).length,
  ).toBe(1);
  expect((await db.query("SELECT * FROM lesson_revisions")).length).toBe(7);
});
