import { z } from "zod";
import { getDatabase, type Database, type Row } from "../../db/src/client";
import {
  type OperationInput,
  type OperationResult,
  uuid,
} from "../../contracts/src";
import { type Principal } from "../../security/src";
import {
  DomainError,
  assertRevision,
  camel,
  json,
  one,
  queueJob,
} from "./common";
import { importPaper, scanLibrary } from "./library";
import {
  addDependency,
  createResource,
  createStudySession,
  getCurriculum,
  getItem,
  getWiki,
  reorderItems,
  saveItem,
  saveWiki,
  setProgress,
  submitExercise,
} from "./learning";
import { snapshotAnalysis } from "./projections";
import { registerGeneration } from "./generation";

export function requireScope(principal: Principal, scope: string) {
  if (
    !(principal.kind === "session" && principal.scopes.includes("*")) &&
    !principal.scopes.includes(scope)
  )
    throw new DomainError("FORBIDDEN", `Required scope: ${scope}`, 403);
}
function requireAnyScope(principal: Principal, scopes: string[]) {
  if (
    !(principal.kind === "session" && principal.scopes.includes("*")) &&
    !scopes.some((scope) => principal.scopes.includes(scope))
  )
    throw new DomainError(
      "FORBIDDEN",
      `Required scope: ${scopes.join(" or ")}`,
      403,
    );
}
export function operationScope(method: string, path: string[]) {
  const write = !["GET", "HEAD"].includes(method);
  if (path[0] === "wiki") return `wiki:${write ? "write" : "read"}`;
  if (
    [
      "curricula",
      "curriculum-items",
      "resources",
      "study-sessions",
      "exercise-submissions",
      "learning-progress",
    ].includes(path[0] ?? "")
  )
    return `learning:${write ? "write" : "read"}`;
  if (
    path[0] === "papers" &&
    ["translations", "summaries", "chat", "analysis-jobs"].includes(
      path[2] ?? "",
    )
  )
    return "library:read";
  return `library:${write ? "write" : "read"}`;
}
const mutableTables: Record<string, string> = {
  papers: "papers",
  wiki: "wiki_pages",
  curricula: "curricula",
  "curriculum-items": "curriculum_items",
  annotations: "annotations",
  resources: "learning_resources",
};
function generationJobScopes(job: Row) {
  if (!["generate", "translation_group"].includes(job.kind)) return null;
  const snapshot = job.input?.snapshot as Row | undefined;
  const remote =
    job.kind === "translation_group" ||
    snapshot?.operation === "translation" ||
    ["openai", "anthropic"].includes(snapshot?.provider?.adapterId);
  return [
    "library:read",
    "ai:run",
    ...(remote ? ["external:invoke", "paid:invoke"] : []),
  ];
}
function authorizeJob(principal: Principal, job: Row, method: string) {
  if (principal.kind === "session" && principal.scopes.includes("*")) return;
  const scopes = generationJobScopes(job);
  if (!scopes) {
    requireScope(
      principal,
      ["GET", "HEAD"].includes(method) ? "library:read" : "library:write",
    );
    return;
  }
  const origin = job.input?.principal as Principal | undefined;
  if (
    principal.kind !== "token" ||
    origin?.kind !== "token" ||
    !principal.tokenId ||
    origin.tokenId !== principal.tokenId
  )
    throw new DomainError(
      "FORBIDDEN",
      "This job belongs to a different originating access token.",
      403,
    );
  for (const scope of scopes) requireScope(principal, scope);
}
async function archive(
  db: Database,
  table: string,
  id: string,
  body: Row,
  restore: boolean,
) {
  return db.transaction(async (tx) => {
    const row = await one(tx, `SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [
      id,
    ]);
    assertRevision(row, body.expectedRevision);
    if (table === "curriculum_items" && row.kind === "section" && !restore) {
      const children = await tx.query(
        "SELECT id FROM curriculum_items WHERE parent_id=$1 AND archived_at IS NULL",
        [id],
      );
      if (children.length)
        throw new DomainError(
          "SECTION_HAS_LESSONS",
          "Archive or move each contained lesson first.",
          409,
        );
    }
    const result = await one(
      tx,
      `UPDATE ${table} SET archived_at=${restore ? "NULL" : "now()"},revision=revision+1${["papers", "wiki_pages", "curricula", "curriculum_items", "annotations", "learning_resources"].includes(table) ? ",updated_at=now()" : ""} WHERE id=$1 RETURNING *`,
      [id],
    );
    if (table === "papers") await snapshotAnalysis(tx, id);
    if (table === "curriculum_items")
      await tx.query(
        "UPDATE curricula SET revision=revision+1,updated_at=now() WHERE id=$1",
        [row.curriculum_id],
      );
    return camel(result);
  });
}
export async function executeOperation(
  input: OperationInput,
  context: { principal: Principal; db?: Database },
): Promise<OperationResult> {
  const method = input.method.toUpperCase();
  const parts = Array.isArray(input.path)
    ? input.path
    : input.path
        .replace(/^\/api\/v1\/?/, "")
        .split("/")
        .filter(Boolean);
  if (parts[0] === "jobs")
    requireAnyScope(
      context.principal,
      ["GET", "HEAD"].includes(method)
        ? ["library:read"]
        : ["library:read", "library:write"],
    );
  else requireScope(context.principal, operationScope(method, parts));
  const [resource, id, action, childId] = parts;
  const query = input.query ?? new URLSearchParams();
  const body = (input.body ?? {}) as Row;
  if (
    id &&
    !["scan", "scans", "files"].includes(id) &&
    !["library", "search", "usage"].includes(resource ?? "")
  )
    uuid.parse(id);
  const db = context.db ?? getDatabase();
  const includeArchived = query.get("includeArchived") === "true";
  if (
    resource === "library" &&
    (id === "scan" || id === "scans") &&
    method === "POST"
  )
    return { data: await scanLibrary(db) };
  if (resource === "library" && id === "files" && method === "GET") {
    // Listing may inspect the mount but GET never mutates missing-source state.
    return { data: await scanLibrary(db, false) };
  }
  if (resource === "papers" && !id && method === "POST") {
    const data = await importPaper(
      db,
      z.object({ relativePath: z.string().min(1) }).parse(body).relativePath,
    );
    return { data, status: 202 };
  }
  if (resource === "papers" && !id && method === "GET") {
    const rows = await db.query(
      "SELECT p.*,r.state AS extraction_state,r.page_count,r.active_extraction_id,(SELECT state FROM paper_analyses a WHERE a.paper_id=p.id ORDER BY analysis_revision DESC LIMIT 1) AS analysis_state FROM papers p LEFT JOIN paper_revisions r ON r.id=p.current_revision_id WHERE ($1::boolean OR p.archived_at IS NULL) AND ($2='' OR p.title ILIKE '%'||$2||'%' OR p.doi ILIKE '%'||$2||'%') ORDER BY p.created_at DESC LIMIT 500",
      [includeArchived, query.get("q") ?? ""],
    );
    return { data: rows.map(camel), meta: { limit: 500 } };
  }
  if (resource === "papers" && id && !action && method === "GET")
    return {
      data: camel(
        await one(
          db,
          "SELECT p.*,r.content_hash,r.page_count,r.state AS extraction_state,r.active_extraction_id FROM papers p LEFT JOIN paper_revisions r ON r.id=p.current_revision_id WHERE p.id=$1",
          [id],
        ),
      ),
    };
  if (resource === "papers" && id && !action && method === "PATCH") {
    const patch = z
      .object({
        expectedRevision: z.number().int(),
        title: z.string().min(1).max(500).optional(),
        doi: z.string().max(500).nullable().optional(),
        readingStatus: z.enum(["unread", "reading", "completed"]).optional(),
        tags: z.array(z.string().min(1).max(100)).max(100).optional(),
        userPriority: z.number().int().min(1).max(5).nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .parse(body);
    return {
      data: await db.transaction(async (tx) => {
        const row = await one(
          tx,
          "SELECT * FROM papers WHERE id=$1 FOR UPDATE",
          [id],
        );
        assertRevision(row, patch.expectedRevision);
        const changed = await one(
          tx,
          "UPDATE papers SET title=$2,doi=$3,reading_status=$4,tags=$5,user_priority=$6,metadata=$7,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
          [
            id,
            patch.title ?? row.title,
            patch.doi === undefined ? row.doi : patch.doi,
            patch.readingStatus ?? row.reading_status,
            patch.tags ?? row.tags,
            patch.userPriority === undefined
              ? row.user_priority
              : patch.userPriority,
            json(patch.metadata ?? row.metadata),
          ],
        );
        await snapshotAnalysis(tx, id);
        return camel(changed);
      }),
    };
  }
  if (
    resource === "papers" &&
    id &&
    action === "segments" &&
    method === "GET"
  ) {
    const page = query.has("pageNumber")
      ? z.coerce.number().int().positive().parse(query.get("pageNumber"))
      : null;
    const rows = await db.query(
      "SELECT s.*,r.paper_id,r.id AS paper_revision_id FROM papers p JOIN paper_revisions r ON r.id=p.current_revision_id JOIN paper_segments s ON s.extraction_run_id=r.active_extraction_id WHERE p.id=$1 AND ($2::integer IS NULL OR s.page_start=$2) ORDER BY s.order_key",
      [id, page],
    );
    return {
      data: rows.map((r) => ({
        ...camel(r),
        pageNumber: r.page_start,
        segmentId: r.id,
      })),
    };
  }
  if (
    resource === "papers" &&
    id &&
    action === "annotations" &&
    method === "GET"
  )
    return {
      data: (
        await db.query(
          "SELECT * FROM annotations WHERE paper_id=$1 AND archived_at IS NULL ORDER BY created_at",
          [id],
        )
      ).map(camel),
    };
  if (
    resource === "papers" &&
    id &&
    action === "annotations" &&
    method === "POST"
  ) {
    const value = z
      .object({
        paperRevisionId: uuid,
        anchor: z
          .object({
            pageNumber: z.number().int().positive(),
            segmentId: uuid.optional(),
            sourceRange: z
              .object({
                start: z.number().int().min(0),
                end: z.number().int().min(0),
              })
              .optional(),
          })
          .passthrough()
          .optional(),
        kind: z.enum(["note", "highlight", "bookmark"]),
        text: z.string().max(100000).default(""),
        color: z
          .union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.literal("yellow")])
          .default("#fde68a"),
      })
      .parse(body);
    if (value.kind !== "note" && !value.anchor)
      throw new DomainError(
        "INVALID_ANCHOR",
        "Highlights and bookmarks require a verified source anchor.",
      );
    const revision = await one(
      db,
      "SELECT * FROM paper_revisions WHERE id=$1 AND paper_id=$2",
      [value.paperRevisionId, id],
    );
    if (
      revision.page_count &&
      value.anchor &&
      value.anchor.pageNumber > revision.page_count
    )
      throw new DomainError("INVALID_ANCHOR", "Page is outside the PDF.");
    if (value.anchor?.segmentId) {
      const segment = await one(
        db,
        "SELECT s.* FROM paper_segments s JOIN extraction_runs e ON e.id=s.extraction_run_id WHERE s.id=$1 AND e.paper_revision_id=$2",
        [value.anchor.segmentId, value.paperRevisionId],
      );
      const range = value.anchor.sourceRange;
      if (
        range &&
        (range.start > range.end || range.end > segment.source_text.length)
      )
        throw new DomainError(
          "INVALID_ANCHOR",
          "Range exceeds stored UTF-16 source text.",
        );
      value.anchor.extractionRunId = segment.extraction_run_id;
      value.anchor.paperId = id;
      value.anchor.paperRevisionId = value.paperRevisionId;
    }
    return {
      data: camel(
        await one(
          db,
          "INSERT INTO annotations(paper_id,paper_revision_id,anchor,kind,text,color) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            id,
            value.paperRevisionId,
            json(value.anchor ?? null),
            value.kind,
            value.text,
            value.color === "yellow" ? "#fde68a" : value.color,
          ],
        ),
      ),
      status: 201,
    };
  }
  if (resource === "annotations" && id && method === "PATCH")
    return {
      data: await db.transaction(async (tx) => {
        const row = await one(
          tx,
          "SELECT * FROM annotations WHERE id=$1 FOR UPDATE",
          [id],
        );
        assertRevision(row, body.expectedRevision);
        const patch = z
          .object({
            text: z.string().max(100000).optional(),
            color: z
              .string()
              .regex(/^#[0-9a-fA-F]{6}$/)
              .optional(),
            expectedRevision: z.number().int(),
          })
          .parse(body);
        return camel(
          await one(
            tx,
            "UPDATE annotations SET text=$2,color=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id, patch.text ?? row.text, patch.color ?? row.color],
          ),
        );
      }),
    };
  if (
    resource === "papers" &&
    id &&
    action === "reading-state" &&
    method === "GET"
  ) {
    const [state] = await db.query(
      "SELECT * FROM reading_states WHERE paper_id=$1",
      [id],
    );
    return { data: state ? camel(state) : null };
  }
  if (
    resource === "papers" &&
    id &&
    action === "reading-state" &&
    method === "PATCH"
  ) {
    const paper = await one(
      db,
      "SELECT current_revision_id FROM papers WHERE id=$1",
      [id],
    );
    const value = z
      .object({
        paperRevisionId: uuid,
        pageNumber: z.number().int().positive(),
        scale: z.number().min(0.25).max(5),
        expectedRevision: z.number().int().optional(),
      })
      .parse({ paperRevisionId: paper.current_revision_id, ...body });
    return {
      data: await db.transaction(async (tx) => {
        await one(tx, "SELECT id FROM papers WHERE id=$1 FOR UPDATE", [id]);
        const [old] = await tx.query(
          "SELECT * FROM reading_states WHERE paper_id=$1",
          [id],
        );
        if (old) assertRevision(old, value.expectedRevision);
        return camel(
          await one(
            tx,
            "INSERT INTO reading_states(paper_id,paper_revision_id,page_number,scale) VALUES($1,$2,$3,$4) ON CONFLICT(paper_id) DO UPDATE SET paper_revision_id=EXCLUDED.paper_revision_id,page_number=EXCLUDED.page_number,scale=EXCLUDED.scale,revision=reading_states.revision+1,updated_at=now() RETURNING *",
            [id, value.paperRevisionId, value.pageNumber, value.scale],
          ),
        );
      }),
    };
  }
  if (
    resource === "papers" &&
    id &&
    action === "analysis" &&
    method === "GET"
  ) {
    const [analysis] = await db.query(
      "SELECT snapshot FROM paper_analyses WHERE paper_id=$1 ORDER BY analysis_revision DESC LIMIT 1",
      [id],
    );
    return { data: analysis?.snapshot ?? null };
  }
  if (resource === "papers" && id && action === "relations" && method === "GET")
    return {
      data: (
        await db.query(
          "SELECT * FROM paper_relations WHERE (source_paper_id=$1 OR target_paper_id=$1) AND archived_at IS NULL",
          [id],
        )
      ).map(camel),
      meta: {
        vectorStatus: "not_indexed",
        fallback: "No derived similarity index is active.",
      },
    };
  if (
    resource === "papers" &&
    id &&
    action === "artifacts" &&
    method === "GET"
  ) {
    const paper = await one(
      db,
      "SELECT p.current_revision_id,r.active_extraction_id FROM papers p LEFT JOIN paper_revisions r ON r.id=p.current_revision_id WHERE p.id=$1",
      [id],
    );
    const rows = await db.query(
      "SELECT a.*,p.scope_key FROM publication_scopes p JOIN generated_artifacts a ON a.id=p.current_artifact_id WHERE p.scope_key LIKE $1 AND ($2='' OR p.scope_key LIKE $3) ORDER BY a.completed_at DESC",
      [
        `${id}:%`,
        query.get("operation") ?? "",
        `${id}:${query.get("operation") ?? ""}:%`,
      ],
    );
    const current = rows.filter(
      (a) =>
        a.provenance.paperRevisionId === paper.current_revision_id &&
        a.provenance.extractionRunId === paper.active_extraction_id,
    );
    if (query.get("operation") === "translation") {
      const page = query.has("pageNumber")
        ? z.coerce.number().int().positive().parse(query.get("pageNumber"))
        : null;
      const segments = await db.query(
        "SELECT id,order_key FROM paper_segments WHERE extraction_run_id=$1 AND ($2::integer IS NULL OR page_start=$2) ORDER BY order_key",
        [paper.active_extraction_id, page],
      );
      const order = new Map(segments.map((s) => [s.id, s.order_key]));
      const matching = current.filter((a) =>
        a.payload.segments?.some((s: Row) => order.has(s.segmentId)),
      );
      return {
        data: matching.length
          ? [
              {
                ...camel(matching[0]!),
                artifactId: matching[0]!.id,
                artifactIds: matching.map((a) => a.id),
                payload: {
                  segments: matching
                    .flatMap((a) =>
                      (a.payload.segments ?? [])
                        .filter((s: Row) => order.has(s.segmentId))
                        .map((s: Row) => ({
                          ...s,
                          generation: a.generation,
                          artifactId: a.id,
                        })),
                    )
                    .sort(
                      (a: Row, b: Row) =>
                        order.get(a.segmentId)! - order.get(b.segmentId)!,
                    ),
                  attribution: matching[0]!.payload.attribution,
                },
              },
            ]
          : [],
        meta: { staleCount: rows.length - current.length },
      };
    }
    return {
      data: current.map(camel),
      meta: { staleCount: rows.length - current.length },
    };
  }
  if (
    resource === "papers" &&
    id &&
    action &&
    ["translations", "summaries", "chat", "analysis-jobs"].includes(action) &&
    method === "POST"
  ) {
    requireScope(context.principal, "ai:run");
    requireScope(context.principal, "library:read");
    const result = await registerGeneration(
      db,
      id,
      action === "translations"
        ? "translation"
        : action === "summaries"
          ? "summary"
          : action === "chat"
            ? "chat"
            : "analysis",
      body,
      context.principal,
    );
    return {
      data: result,
      status: result.artifactId ? 200 : 202,
      meta: { cache: { status: result.cache } },
    };
  }
  if (resource === "jobs" && id) {
    const job = await one(db, "SELECT * FROM jobs WHERE id=$1", [id]);
    authorizeJob(context.principal, job, method);
    if (method === "GET" && !action) {
      const { input: _, ...safe } = job;
      return { data: camel(safe) };
    }
    if (method === "GET" && action === "events")
      return {
        data: (
          await db.query(
            "SELECT * FROM job_events WHERE job_id=$1 AND sequence>$2 ORDER BY sequence",
            [id, Number(query.get("after") ?? 0)],
          )
        ).map(camel),
      };
    if (method === "POST" && action === "cancel") {
      if (job.kind === "translation_group")
        throw new DomainError(
          "NOT_IMPLEMENTED",
          "Cancel each owned child job explicitly; the group may contain shared generation work and was not cancelled.",
          501,
        );
      return {
        data: camel(
          await one(
            db,
            "UPDATE jobs SET cancel_requested=true,state=CASE WHEN state IN ('queued','blocked_config') THEN 'cancelled' ELSE state END,updated_at=now() WHERE id=$1 RETURNING id,state,cancel_requested",
            [id],
          ),
        ),
      };
    }
    if (method === "POST" && action === "retry") {
      if (["generate", "translation_group"].includes(job.kind))
        throw new DomainError(
          "NOT_IMPLEMENTED",
          "Create a new explicit generation request; ambiguous upstream attempts are never replayed automatically.",
          501,
        );
      return {
        data: camel(
          await one(
            db,
            "UPDATE jobs SET state='queued',error_code=NULL,cancel_requested=false,updated_at=now() WHERE id=$1 AND state IN ('failed','blocked_config') RETURNING id,state",
            [id],
          ),
        ),
        status: 202,
      };
    }
  }
  if (resource === "wiki" && !id && method === "GET")
    return {
      data: (
        await db.query(
          "SELECT w.*,r.markdown,r.source_refs,r.origin FROM wiki_pages w LEFT JOIN wiki_revisions r ON r.id=w.current_revision_id WHERE ($1::boolean OR archived_at IS NULL) AND ($2='' OR title ILIKE '%'||$2||'%' OR r.markdown ILIKE '%'||$2||'%') ORDER BY title",
          [includeArchived, query.get("q") ?? ""],
        )
      ).map(camel),
    };
  if (resource === "wiki" && !id && method === "POST")
    return { data: await saveWiki(db, body), status: 201 };
  if (resource === "wiki" && id && !action && method === "GET")
    return { data: await getWiki(db, id) };
  if (resource === "wiki" && id && !action && method === "PATCH") {
    const current = await getWiki(db, id);
    return { data: await saveWiki(db, { ...current, ...body }, id) };
  }
  if (resource === "wiki" && id && action === "revisions" && method === "GET")
    return {
      data: (
        await db.query(
          "SELECT * FROM wiki_revisions WHERE wiki_id=$1 ORDER BY revision DESC",
          [id],
        )
      ).map(camel),
    };
  if (resource === "curricula" && !id && method === "GET")
    return {
      data: (
        await db.query(
          "SELECT * FROM curricula WHERE ($1::boolean OR archived_at IS NULL) ORDER BY created_at",
          [includeArchived],
        )
      ).map(camel),
    };
  if (resource === "curricula" && !id && method === "POST") {
    const b = z
      .object({
        title: z.string().min(1).max(500),
        description: z.string().max(100000).default(""),
      })
      .parse(body);
    return {
      data: camel(
        await one(
          db,
          "INSERT INTO curricula(title,description) VALUES($1,$2) RETURNING *",
          [b.title, b.description],
        ),
      ),
      status: 201,
    };
  }
  if (resource === "curricula" && id && !action && method === "GET")
    return { data: await getCurriculum(db, id, includeArchived) };
  if (resource === "curricula" && id && !action && method === "PATCH")
    return {
      data: await db.transaction(async (tx) => {
        const row = await one(
          tx,
          "SELECT * FROM curricula WHERE id=$1 FOR UPDATE",
          [id],
        );
        assertRevision(row, body.expectedRevision);
        const b = z
          .object({
            title: z.string().min(1).max(500).optional(),
            description: z.string().max(100000).optional(),
          })
          .parse(body);
        return camel(
          await one(
            tx,
            "UPDATE curricula SET title=$2,description=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id, b.title ?? row.title, b.description ?? row.description],
          ),
        );
      }),
    };
  if (resource === "curricula" && id && action === "items" && method === "GET")
    return { data: (await getCurriculum(db, id, includeArchived)).items };
  if (resource === "curricula" && id && action === "items" && method === "POST")
    return { data: await saveItem(db, id, body), status: 201 };
  if (
    resource === "curricula" &&
    id &&
    (action === "reorder" || action === "order") &&
    ["POST", "PUT"].includes(method)
  )
    return { data: await reorderItems(db, id, body) };
  if (
    resource === "curricula" &&
    id &&
    action === "dependencies" &&
    method === "POST"
  )
    return { data: await addDependency(db, id, body), status: 201 };
  if (
    resource === "curricula" &&
    id &&
    action === "dependencies" &&
    childId &&
    method === "DELETE"
  )
    return {
      data: await db.transaction(async (tx) => {
        const row = await one(
          tx,
          "SELECT * FROM curricula WHERE id=$1 FOR UPDATE",
          [id],
        );
        assertRevision(row, body.expectedRevision);
        await one(
          tx,
          "DELETE FROM curriculum_dependencies WHERE id=$1 AND curriculum_id=$2 RETURNING id",
          [uuid.parse(childId), id],
        );
        return camel(
          await one(
            tx,
            "UPDATE curricula SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id],
          ),
        );
      }),
    };
  if (resource === "curriculum-items" && id && !action && method === "GET")
    return { data: await getItem(db, id) };
  if (resource === "curriculum-items" && id && !action && method === "PATCH") {
    const old = await getItem(db, id);
    return {
      data: await saveItem(
        db,
        old.curriculumId,
        {
          ...old,
          ...body,
          resources:
            body.resources ??
            old.resources.map((r: Row) => ({ resourceId: r.id, role: r.role })),
        },
        id,
      ),
    };
  }
  if (
    resource === "curriculum-items" &&
    id &&
    action === "revisions" &&
    method === "GET"
  )
    return {
      data: (
        await db.query(
          "SELECT * FROM lesson_revisions WHERE item_id=$1 ORDER BY content_version DESC",
          [id],
        )
      ).map(camel),
    };
  if (resource === "resources" && !id && method === "GET")
    return {
      data: (
        await db.query(
          "SELECT * FROM learning_resources WHERE ($1::boolean OR archived_at IS NULL) ORDER BY title",
          [includeArchived],
        )
      ).map(camel),
    };
  if (resource === "resources" && !id && method === "POST")
    return { data: await createResource(db, body), status: 201 };
  if (resource === "study-sessions" && !id && method === "POST")
    return { data: await createStudySession(db, body), status: 201 };
  if (resource === "exercise-submissions" && !id && method === "POST")
    return { data: await submitExercise(db, body), status: 201 };
  if (
    ["study-sessions", "exercise-submissions"].includes(resource ?? "") &&
    !id &&
    method === "GET"
  ) {
    const table =
      resource === "study-sessions" ? "study_sessions" : "exercise_submissions";
    return {
      data: (
        await db.query(
          `SELECT * FROM ${table} WHERE ($1::uuid IS NULL OR item_id=$1) AND archived_at IS NULL`,
          [query.get("itemId")],
        )
      ).map(camel),
    };
  }
  if (resource === "learning-progress" && method === "PUT")
    return { data: await setProgress(db, body) };
  if (
    resource === "curriculum-items" &&
    id &&
    action === "progress" &&
    method === "PUT"
  )
    return { data: await setProgress(db, { ...body, itemId: id }) };
  if (resource === "usage" && method === "GET") {
    requireScope(context.principal, "ai:run");
    return {
      data: (
        await db.query(
          "SELECT * FROM provider_usage ORDER BY created_at DESC LIMIT 500",
        )
      ).map(camel),
      meta: { estimateOnly: true },
    };
  }
  if (
    resource &&
    mutableTables[resource] &&
    id &&
    ((method === "DELETE" && !action) ||
      (method === "POST" && action === "restore"))
  )
    return {
      data: await archive(
        db,
        mutableTables[resource]!,
        id,
        body,
        action === "restore",
      ),
    };
  throw new DomainError(
    "NOT_IMPLEMENTED",
    "This operation is not implemented in the current local core.",
    501,
  );
}
