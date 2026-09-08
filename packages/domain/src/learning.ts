import { z } from "zod";
import type { Database, Row } from "../../db/src/client";
import { blockSchema, resourceSchema, uuid } from "../../contracts/src";
import {
  DomainError,
  assertRevision,
  camel,
  json,
  one,
  required,
} from "./common";

export async function getWiki(db: Database, id: string) {
  return camel(
    await one(
      db,
      "SELECT w.*,r.markdown,r.source_refs,r.origin FROM wiki_pages w LEFT JOIN wiki_revisions r ON r.id=w.current_revision_id WHERE w.id=$1",
      [id],
    ),
  );
}
export async function saveWiki(
  db: Database,
  input: unknown,
  id?: string,
  origin: "user" | "seed" = "user",
) {
  const body = z
    .object({
      title: z.string().min(1).max(500),
      slug: z
        .string()
        .regex(/^[\p{L}\p{N}_-]+$/u)
        .max(200),
      markdown: z.string().max(1000000),
      sourceRefs: z.array(z.record(z.string(), z.unknown())).default([]),
      expectedRevision: z.number().int().optional(),
    })
    .parse(input);
  return db.transaction(async (tx) => {
    let row: Row;
    if (id) {
      row = await one(tx, "SELECT * FROM wiki_pages WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      assertRevision(row, body.expectedRevision);
      row = await one(
        tx,
        "UPDATE wiki_pages SET title=$2,slug=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
        [id, body.title, body.slug],
      );
    } else
      row = await one(
        tx,
        "INSERT INTO wiki_pages(title,slug) VALUES($1,$2) RETURNING *",
        [body.title, body.slug],
      );
    const revision = await one(
      tx,
      "INSERT INTO wiki_revisions(wiki_id,revision,markdown,source_refs,origin) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [row.id, row.revision, body.markdown, json(body.sourceRefs), origin],
    );
    await tx.query("UPDATE wiki_pages SET current_revision_id=$2 WHERE id=$1", [
      row.id,
      revision.id,
    ]);
    return getWiki(tx, row.id);
  });
}
export async function getItem(db: Database, id: string): Promise<Row> {
  const row = await one(db, "SELECT * FROM curriculum_items WHERE id=$1", [id]);
  const blocks = (
    await db.query(
      "SELECT * FROM lesson_blocks WHERE item_id=$1 ORDER BY position",
      [id],
    )
  ).map(camel);
  const resources = (
    await db.query(
      "SELECT r.*,i.role,i.position FROM item_resources i JOIN learning_resources r ON r.id=i.resource_id WHERE i.item_id=$1 ORDER BY i.position",
      [id],
    )
  ).map(camel);
  const [latest] = await db.query(
    "SELECT * FROM lesson_revisions WHERE item_id=$1 ORDER BY content_version DESC LIMIT 1",
    [id],
  );
  const progress = latest
    ? (
        await db.query(
          "SELECT * FROM learning_progress WHERE item_id=$1 AND lesson_revision_id=$2",
          [id, latest.id],
        )
      )[0]
    : null;
  return {
    ...camel(row),
    blocks,
    resources,
    lessonRevisionId: latest?.id ?? null,
    progress: progress ? camel(progress) : null,
  };
}
export async function getCurriculum(
  db: Database,
  id: string,
  includeArchived = false,
) {
  const row = await one(db, "SELECT * FROM curricula WHERE id=$1", [id]);
  const items = await db.query(
    "SELECT id FROM curriculum_items WHERE curriculum_id=$1 AND ($2::boolean OR archived_at IS NULL) ORDER BY position,id",
    [id, includeArchived],
  );
  const dependencies = await db.query(
    "SELECT * FROM curriculum_dependencies WHERE curriculum_id=$1",
    [id],
  );
  return {
    ...camel(row),
    items: await Promise.all(items.map((i) => getItem(db, i.id))),
    dependencies: dependencies.map(camel),
  };
}
export async function snapshotLesson(tx: Database, itemId: string) {
  const item = await getItem(tx, itemId);
  if (item.kind !== "lesson") return null;
  const resources = [];
  for (const resource of item.resources) {
    const paper = resource.paperId
      ? (
          await tx.query("SELECT current_revision_id FROM papers WHERE id=$1", [
            resource.paperId,
          ])
        )[0]
      : null;
    const wiki = resource.wikiId
      ? (
          await tx.query(
            "SELECT current_revision_id FROM wiki_pages WHERE id=$1",
            [resource.wikiId],
          )
        )[0]
      : null;
    resources.push({
      ...resource,
      paperRevisionId: paper?.current_revision_id ?? null,
      wikiRevisionId: wiki?.current_revision_id ?? null,
    });
  }
  const blocks = [];
  for (const block of item.blocks) {
    const payload = { ...block.payload };
    if (block.kind === "wiki_reading" && payload.wikiId) {
      const wiki = await one(
        tx,
        "SELECT current_revision_id FROM wiki_pages WHERE id=$1",
        [uuid.parse(payload.wikiId)],
      );
      payload.wikiRevisionId = wiki.current_revision_id;
    }
    if (block.kind === "paper_reading" && payload.paperId) {
      const paper = await one(
        tx,
        "SELECT current_revision_id FROM papers WHERE id=$1",
        [uuid.parse(payload.paperId)],
      );
      payload.paperRevisionId = paper.current_revision_id;
    }
    blocks.push({ ...block, payload });
  }
  const snapshot = {
    schemaVersion: 1,
    title: item.title,
    estimatedMinutes: item.estimatedMinutes,
    blocks,
    resources,
    completionCriteria: {
      readingConfirmation: true,
      selfExplanation: true,
      exerciseEvidence: true,
      userConfirmation: true,
    },
  };
  return one(
    tx,
    "INSERT INTO lesson_revisions(item_id,content_version,snapshot) VALUES($1,$2,$3) RETURNING *",
    [itemId, item.contentVersion, json(snapshot)],
  );
}
const itemInput = z.object({
  title: z.string().min(1).max(500),
  kind: z.enum(["section", "lesson"]).default("lesson"),
  parentId: uuid.nullable().default(null),
  estimatedMinutes: z.number().int().positive().nullable().default(null),
  blocks: z.array(blockSchema).max(100).default([]),
  resources: z
    .array(
      z.object({
        resourceId: uuid,
        role: z
          .enum(["required", "optional", "assignment"])
          .default("required"),
      }),
    )
    .max(100)
    .default([]),
  expectedRevision: z.number().int().optional(),
  expectedCurriculumRevision: z.number().int().optional(),
});
export async function saveItem(
  db: Database,
  curriculumId: string,
  input: unknown,
  id?: string,
) {
  const body = itemInput.parse(input);
  if (new Set(body.blocks.map((b) => b.blockKey)).size !== body.blocks.length)
    throw new DomainError("INVALID_BLOCKS", "Block keys must be unique.");
  if (body.kind === "section" && (body.blocks.length || body.parentId))
    throw new DomainError(
      "INVALID_SECTION",
      "A section is top-level and has no lesson blocks.",
    );
  for (const block of body.blocks) {
    if (block.kind === "markdown" && typeof block.payload.markdown !== "string")
      throw new DomainError(
        "INVALID_BLOCK",
        "Markdown block needs markdown text.",
      );
    if (
      block.kind === "self_explanation" &&
      !Array.isArray(block.payload.questions)
    )
      throw new DomainError(
        "INVALID_BLOCK",
        "Self-explanation block needs questions.",
      );
    if (
      block.kind === "exercise" &&
      typeof block.payload.instructions !== "string"
    )
      throw new DomainError("INVALID_BLOCK", "Exercise needs instructions.");
    if (block.kind === "checklist" && !Array.isArray(block.payload.items))
      throw new DomainError("INVALID_BLOCK", "Checklist needs items.");
  }
  return db.transaction(async (tx) => {
    const curriculum = await one(
      tx,
      "SELECT * FROM curricula WHERE id=$1 FOR UPDATE",
      [curriculumId],
    );
    if (curriculum.archived_at)
      throw new DomainError(
        "ARCHIVED",
        "Restore the curriculum before editing.",
        409,
      );
    if (body.expectedCurriculumRevision !== undefined)
      assertRevision(curriculum, body.expectedCurriculumRevision);
    let row: Row;
    if (id) {
      row = await one(
        tx,
        "SELECT * FROM curriculum_items WHERE id=$1 AND curriculum_id=$2 FOR UPDATE",
        [id, curriculumId],
      );
      assertRevision(row, body.expectedRevision);
      if (row.kind !== body.kind)
        throw new DomainError("INVALID_KIND", "Item kind cannot be changed.");
      row = await one(
        tx,
        "UPDATE curriculum_items SET title=$2,parent_id=$3,estimated_minutes=$4,revision=revision+1,content_version=content_version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [id, body.title, body.parentId, body.estimatedMinutes],
      );
    } else
      row = await one(
        tx,
        "INSERT INTO curriculum_items(curriculum_id,title,kind,parent_id,estimated_minutes,position) VALUES($1,$2,$3,$4,$5,(SELECT coalesce(max(position),-1)+1 FROM curriculum_items WHERE curriculum_id=$1)) RETURNING *",
        [
          curriculumId,
          body.title,
          body.kind,
          body.parentId,
          body.estimatedMinutes,
        ],
      );
    await tx.query("DELETE FROM lesson_blocks WHERE item_id=$1", [row.id]);
    await tx.query("DELETE FROM item_resources WHERE item_id=$1", [row.id]);
    for (const [position, block] of body.blocks.entries())
      await tx.query(
        "INSERT INTO lesson_blocks(item_id,block_key,kind,position,schema_version,payload) VALUES($1,$2,$3,$4,$5,$6)",
        [
          row.id,
          block.blockKey,
          block.kind,
          position,
          block.schemaVersion,
          json(block.payload),
        ],
      );
    for (const [position, resource] of body.resources.entries())
      await tx.query(
        "INSERT INTO item_resources(item_id,resource_id,role,position) VALUES($1,$2,$3,$4)",
        [row.id, resource.resourceId, resource.role, position],
      );
    await snapshotLesson(tx, row.id);
    await tx.query(
      "UPDATE curricula SET revision=revision+1,updated_at=now() WHERE id=$1",
      [curriculumId],
    );
    return getItem(tx, row.id);
  });
}
export async function reorderItems(
  db: Database,
  curriculumId: string,
  input: unknown,
) {
  const body = z
    .object({ itemIds: z.array(uuid), expectedRevision: z.number().int() })
    .parse(input);
  return db.transaction(async (tx) => {
    const curriculum = await one(
      tx,
      "SELECT * FROM curricula WHERE id=$1 FOR UPDATE",
      [curriculumId],
    );
    assertRevision(curriculum, body.expectedRevision);
    const rows = await tx.query(
      "SELECT id FROM curriculum_items WHERE curriculum_id=$1 AND archived_at IS NULL",
      [curriculumId],
    );
    if (
      rows.length !== body.itemIds.length ||
      new Set(body.itemIds).size !== rows.length ||
      rows.some((r) => !body.itemIds.includes(r.id))
    )
      throw new DomainError(
        "INVALID_ORDER",
        "Supply every active item ID exactly once.",
      );
    for (const [position, id] of body.itemIds.entries())
      await tx.query(
        "UPDATE curriculum_items SET position=$2,revision=revision+1,updated_at=now() WHERE id=$1",
        [id, position],
      );
    await tx.query(
      "UPDATE curricula SET revision=revision+1,updated_at=now() WHERE id=$1",
      [curriculumId],
    );
    return getCurriculum(tx, curriculumId);
  });
}
export async function addDependency(
  db: Database,
  curriculumId: string,
  input: unknown,
) {
  const body = z
    .object({
      prerequisiteItemId: uuid,
      dependentItemId: uuid,
      expectedRevision: z.number().int(),
    })
    .parse(input);
  return db.transaction(async (tx) => {
    const curriculum = await one(
      tx,
      "SELECT * FROM curricula WHERE id=$1 FOR UPDATE",
      [curriculumId],
    );
    assertRevision(curriculum, body.expectedRevision);
    const edge = await one(
      tx,
      "INSERT INTO curriculum_dependencies(curriculum_id,prerequisite_item_id,dependent_item_id) VALUES($1,$2,$3) RETURNING *",
      [curriculumId, body.prerequisiteItemId, body.dependentItemId],
    );
    await tx.query(
      "UPDATE curricula SET revision=revision+1,updated_at=now() WHERE id=$1",
      [curriculumId],
    );
    return camel(edge);
  });
}
export async function createResource(db: Database, input: unknown) {
  const body = resourceSchema.parse(input);
  return camel(
    await one(
      db,
      "INSERT INTO learning_resources(kind,title,source_url,paper_id,wiki_id,reading_scope,metadata) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        body.kind,
        body.title,
        body.sourceUrl ?? null,
        body.paperId ?? null,
        body.wikiId ?? null,
        json(body.readingScope),
        json(body.metadata),
      ],
    ),
  );
}
export async function createStudySession(db: Database, input: unknown) {
  const body = z
    .object({
      itemId: uuid,
      lessonRevisionId: uuid,
      startedAt: z.string().datetime().optional(),
      endedAt: z.string().datetime().nullable().optional(),
      elapsedSeconds: z.number().int().min(0).default(0),
      reflection: z.string().max(100000).default(""),
    })
    .parse(input);
  return camel(
    await one(
      db,
      "INSERT INTO study_sessions(item_id,lesson_revision_id,started_at,ended_at,elapsed_seconds,reflection) VALUES($1,$2,coalesce($3::timestamptz,now()),$4,$5,$6) RETURNING *",
      [
        body.itemId,
        body.lessonRevisionId,
        body.startedAt ?? null,
        body.endedAt ?? null,
        body.elapsedSeconds,
        body.reflection,
      ],
    ),
  );
}
export async function submitExercise(db: Database, input: unknown) {
  const body = z
    .object({
      itemId: uuid,
      lessonRevisionId: uuid,
      blockKey: z.string(),
      sessionId: uuid.nullable().optional(),
      answers: z.record(z.string(), z.unknown()).default({}),
      evidencePath: z.string().max(2000).nullable().optional(),
      commitRef: z.string().max(200).nullable().optional(),
      resultNote: z.string().min(1).max(100000),
    })
    .parse(input);
  const revision = await one(
    db,
    "SELECT * FROM lesson_revisions WHERE id=$1 AND item_id=$2",
    [body.lessonRevisionId, body.itemId],
  );
  if (
    !revision.snapshot.blocks.some(
      (b: Row) => b.blockKey === body.blockKey && b.kind === "exercise",
    )
  )
    throw new DomainError(
      "INVALID_BLOCK",
      "Exercise must exist in the recorded lesson revision.",
    );
  if (body.sessionId)
    await one(
      db,
      "SELECT id FROM study_sessions WHERE id=$1 AND item_id=$2 AND lesson_revision_id=$3",
      [body.sessionId, body.itemId, body.lessonRevisionId],
    );
  return camel(
    await one(
      db,
      "INSERT INTO exercise_submissions(item_id,lesson_revision_id,block_key,session_id,answers,evidence_path,commit_ref,result_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        body.itemId,
        body.lessonRevisionId,
        body.blockKey,
        body.sessionId ?? null,
        json(body.answers),
        body.evidencePath ?? null,
        body.commitRef ?? null,
        body.resultNote,
      ],
    ),
  );
}
export async function setProgress(db: Database, input: unknown) {
  const body = z
    .object({
      itemId: uuid,
      lessonRevisionId: uuid,
      state: z.enum(["not_started", "in_progress", "completed"]),
      expectedRevision: z.number().int().optional(),
      nextReviewAt: z.string().datetime().nullable().optional(),
      checks: z
        .object({
          readingConfirmed: z.boolean().default(false),
          selfExplanationAnswers: z
            .array(z.string().max(20000))
            .max(1000)
            .default([]),
          exerciseConfirmed: z.boolean().default(false),
          userConfirmed: z.boolean().default(false),
          blockResponses: z
            .record(z.string().max(120), z.string().max(20000))
            .refine((v) => Object.keys(v).length <= 1000)
            .default({}),
        })
        .default({
          readingConfirmed: false,
          selfExplanationAnswers: [],
          exerciseConfirmed: false,
          userConfirmed: false,
          blockResponses: {},
        }),
    })
    .parse(input);
  return db.transaction(async (tx) => {
    await one(tx, "SELECT id FROM curriculum_items WHERE id=$1 FOR UPDATE", [
      body.itemId,
    ]);
    const lesson = await one(
      tx,
      "SELECT * FROM lesson_revisions WHERE id=$1 AND item_id=$2",
      [body.lessonRevisionId, body.itemId],
    );
    for (const key of Object.keys(body.checks.blockResponses)) {
      const separator = key.lastIndexOf(":");
      const blockKey = key.slice(0, separator);
      const index = Number(key.slice(separator + 1));
      const block = lesson.snapshot.blocks.find(
        (b: Row) =>
          b.blockKey === blockKey &&
          ["checklist", "self_explanation"].includes(b.kind),
      );
      const entries =
        block?.kind === "checklist"
          ? block.payload.items
          : block?.payload.questions;
      if (
        separator < 1 ||
        !Number.isInteger(index) ||
        index < 0 ||
        !Array.isArray(entries) ||
        index >= entries.length
      )
        throw new DomainError(
          "INVALID_BLOCK_RESPONSE",
          "Responses must reference a question or checklist item in this lesson revision.",
          422,
        );
    }
    const [prior] = await tx.query(
      "SELECT * FROM learning_progress WHERE item_id=$1 AND lesson_revision_id=$2",
      [body.itemId, body.lessonRevisionId],
    );
    if (prior) assertRevision(prior, body.expectedRevision);
    if (body.state === "completed") {
      const questions = lesson.snapshot.blocks
        .filter((b: Row) => b.kind === "self_explanation")
        .flatMap((b: Row) => b.payload.questions ?? []);
      const exercises = lesson.snapshot.blocks.filter(
        (b: Row) => b.kind === "exercise",
      );
      const submitted = await tx.query(
        "SELECT block_key FROM exercise_submissions WHERE item_id=$1 AND lesson_revision_id=$2 AND archived_at IS NULL AND result_note<>''",
        [body.itemId, body.lessonRevisionId],
      );
      if (
        !body.checks.readingConfirmed ||
        !body.checks.userConfirmed ||
        body.checks.selfExplanationAnswers.filter((s) => s.trim()).length <
          questions.length ||
        exercises.some(
          (b: Row) => !submitted.some((s) => s.block_key === b.blockKey),
        ) ||
        (exercises.length && !body.checks.exerciseConfirmed)
      )
        throw new DomainError(
          "COMPLETION_INCOMPLETE",
          "Confirm reading, answer the questions, record exercise evidence and explicitly confirm completion.",
          422,
        );
    }
    return camel(
      await one(
        tx,
        "INSERT INTO learning_progress(item_id,lesson_revision_id,state,completed_at,next_review_at,checks) VALUES($1,$2,$3,CASE WHEN $3='completed' THEN now() ELSE NULL END,$4,$5) ON CONFLICT(item_id,lesson_revision_id) DO UPDATE SET state=EXCLUDED.state,completed_at=EXCLUDED.completed_at,next_review_at=EXCLUDED.next_review_at,checks=EXCLUDED.checks,revision=learning_progress.revision+1 RETURNING *",
        [
          body.itemId,
          body.lessonRevisionId,
          body.state,
          body.nextReviewAt ?? null,
          json(body.checks),
        ],
      ),
    );
  });
}
