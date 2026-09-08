import { open, realpath, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { Database } from "../../db/src/client";
import { DomainError, camel, hash, json, one, queueJob } from "./common";
import { snapshotAnalysis } from "./projections";

export function libraryRoot() {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.PAPERS_DIR ?? "./library",
  );
}
export async function resolveLibraryPath(relativePath: string) {
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.isAbsolute(relativePath) ||
    relativePath.split("/").includes("..") ||
    !relativePath.toLowerCase().endsWith(".pdf")
  )
    throw new DomainError(
      "INVALID_PATH",
      "Select a PDF inside the mounted library.",
    );
  let root: string, resolved: string;
  try {
    root = await realpath(/* turbopackIgnore: true */ libraryRoot());
    resolved = await realpath(
      /* turbopackIgnore: true */ path.join(root, relativePath),
    );
  } catch {
    throw new DomainError("SOURCE_MISSING", "Mounted PDF is unavailable.", 404);
  }
  if (!resolved.startsWith(root + path.sep))
    throw new DomainError(
      "INVALID_PATH",
      "Path escapes the mounted library.",
      403,
    );
  return resolved;
}
export async function readStablePdf(relativePath: string) {
  const resolved = await resolveLibraryPath(relativePath);
  const handle = await open(
    resolved,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 200 * 1024 * 1024)
      throw new DomainError(
        "INVALID_PDF",
        "PDF must be a regular file below 200 MiB.",
      );
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pathStat = await stat(resolved);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.length !== before.size ||
      (await resolveLibraryPath(relativePath)) !== resolved ||
      pathStat.ino !== after.ino ||
      pathStat.dev !== after.dev
    )
      throw new DomainError(
        "SOURCE_CHANGED",
        "PDF changed while being read; retry.",
        409,
      );
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new DomainError("INVALID_PDF", "File is not a PDF.");
    return { bytes, contentHash: hash(bytes), byteSize: bytes.length };
  } finally {
    await handle.close();
  }
}
export async function scanLibrary(db: Database, updateMissing = true) {
  const files: {
    relativePath: string;
    byteSize: number;
    modifiedAt: string;
  }[] = [];
  async function walk(dir: string, prefix = "") {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      throw new DomainError(
        "LIBRARY_NOT_CONFIGURED",
        "Mounted library directory is unavailable.",
        503,
      );
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const relativePath = prefix + entry.name;
      if (entry.isDirectory())
        await walk(path.join(dir, entry.name), relativePath + "/");
      else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        const s = await stat(path.join(dir, entry.name));
        files.push({
          relativePath,
          byteSize: s.size,
          modifiedAt: s.mtime.toISOString(),
        });
      }
    }
  }
  await walk(libraryRoot());
  const sources = await db.query("SELECT * FROM paper_sources");
  const present = new Set(files.map((f) => f.relativePath));
  if (updateMissing)
    await db.transaction(async (tx) => {
      for (const source of sources)
        await tx.query(
          "UPDATE paper_sources SET missing_at=$2,updated_at=now() WHERE id=$1",
          [source.id, present.has(source.relative_path) ? null : new Date()],
        );
    });
  return files
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((f) => ({
      ...f,
      paperId:
        sources.find((s) => s.relative_path === f.relativePath)?.paper_id ??
        null,
    }));
}
export async function importPaper(db: Database, relativePath: string) {
  const file = await readStablePdf(relativePath);
  return db.transaction(async (tx) => {
    // Serialize hash/path claims across web requests without relying on a process mutex.
    await tx.query("LOCK TABLE paper_sources IN SHARE ROW EXCLUSIVE MODE");
    const [existing] = await tx.query(
      "SELECT * FROM paper_revisions WHERE content_hash=$1",
      [file.contentHash],
    );
    const [source] = await tx.query(
      "SELECT * FROM paper_sources WHERE root_id='papers' AND relative_path=$1",
      [relativePath],
    );
    let paperId = existing?.paper_id ?? source?.paper_id;
    if (!paperId)
      paperId = (
        await one(
          tx,
          "INSERT INTO papers(title,metadata) VALUES($1,$2) RETURNING id",
          [
            path.basename(relativePath, ".pdf"),
            json({
              safeFileStem: path
                .basename(relativePath)
                .replace(/\.pdf$/i, "")
                .replace(/[^\p{L}\p{N}._-]/gu, "_")
                .slice(0, 100),
            }),
          ],
        )
      ).id;
    let revision = existing;
    if (!revision) {
      revision = await one(
        tx,
        "INSERT INTO paper_revisions(paper_id,content_hash,byte_size) VALUES($1,$2,$3) RETURNING *",
        [paperId, file.contentHash, file.byteSize],
      );
      await tx.query(
        "UPDATE papers SET current_revision_id=$2,revision=revision+1,updated_at=now() WHERE id=$1",
        [paperId, revision.id],
      );
    }
    await tx.query(
      "INSERT INTO paper_sources(paper_id,root_id,relative_path,observed_hash) VALUES($1,'papers',$2,$3) ON CONFLICT(root_id,relative_path) DO UPDATE SET paper_id=EXCLUDED.paper_id,observed_hash=EXCLUDED.observed_hash,missing_at=NULL,updated_at=now()",
      [paperId, relativePath, file.contentHash],
    );
    const job = await queueJob(
      tx,
      "extract_pdf",
      {
        paperId,
        paperRevisionId: revision.id,
        relativePath,
        contentHash: file.contentHash,
      },
      `extract:${revision.id}`,
    );
    await snapshotAnalysis(tx, paperId);
    return {
      paperId,
      paperRevisionId: revision.id,
      jobId: job.id,
      state: job.state,
      duplicate: !!existing,
    };
  });
}
export async function paperFile(
  db: Database,
  paperId: string,
  revisionId?: string,
) {
  const paper = await one(db, "SELECT * FROM papers WHERE id=$1", [paperId]);
  const revision = await one(
    db,
    "SELECT * FROM paper_revisions WHERE paper_id=$1 AND id=$2",
    [paperId, revisionId ?? paper.current_revision_id],
  );
  const sources = await db.query(
    "SELECT * FROM paper_sources WHERE paper_id=$1 AND observed_hash=$2 AND missing_at IS NULL",
    [paperId, revision.content_hash],
  );
  for (const source of sources) {
    try {
      const file = await readStablePdf(source.relative_path);
      if (file.contentHash === revision.content_hash) return file;
    } catch (error) {
      if (error instanceof DomainError && error.code === "INVALID_PATH")
        throw error;
    }
  }
  throw new DomainError(
    "SOURCE_MISSING",
    "PDF bytes for this revision are unavailable; saved text and notes remain accessible.",
    409,
  );
}
