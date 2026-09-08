import { expect, it } from "vitest";
import { createPostgresDatabase } from "../packages/db/src/client";
import { json } from "../packages/domain/src/common";
import { saveWiki, saveItem } from "../packages/domain/src/learning";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "../packages/db/src/schema";
/** Opt-in native PostgreSQL regression. Runs in a rolled-back transaction and touches no application rows. */
it.skipIf(!process.env.TEST_DATABASE_URL)(
  "native PostgreSQL keeps JSONB objects, arrays, null and nested snapshots structured",
  async () => {
    const db = createPostgresDatabase(process.env.TEST_DATABASE_URL!);
    const rollback = new Error("intentional rollback");
    try {
      await expect(
        db.transaction(async (tx) => {
          await tx.query(
            "CREATE TEMP TABLE json_transport_regression(id integer, payload jsonb) ON COMMIT DROP",
          );
          for (const [i, value] of [
            { blocks: [{ payload: { questions: ["Why?"] } }], revision: 1 },
            [],
            null,
          ].entries()) {
            await tx.query(
              "INSERT INTO json_transport_regression(id,payload) VALUES($1,$2)",
              [i, json(value)],
            );
            const [row] = await tx.query(
              "SELECT payload FROM json_transport_regression WHERE id=$1",
              [i],
            );
            expect(row!.payload).toEqual(value);
          }
          const wiki = await saveWiki(tx, {
            title: "Native transport regression",
            slug: `native-${crypto.randomUUID()}`,
            markdown: "Version one",
          });
          expect(wiki.sourceRefs).toEqual([]);
          const edited = await saveWiki(
            tx,
            {
              ...wiki,
              markdown: "Version two",
              expectedRevision: wiki.revision,
            },
            wiki.id,
          );
          expect(edited.revision).toBe(2);
          const [curriculum] = await tx.query(
            "INSERT INTO curricula(title) VALUES('Native rollback-only curriculum') RETURNING *",
          );
          const lesson = await saveItem(tx, curriculum!.id, {
            title: "Native lesson",
            blocks: [
              {
                blockKey: "exercise",
                kind: "exercise",
                payload: { instructions: "Verify native JSON shape" },
              },
            ],
          });
          expect(lesson.blocks[0].payload.instructions).toBe(
            "Verify native JSON shape",
          );
          const [snapshot] = await tx.query(
            "SELECT snapshot FROM lesson_revisions WHERE id=$1",
            [lesson.lessonRevisionId],
          );
          expect(snapshot!.snapshot.blocks[0].payload).toEqual({
            instructions: "Verify native JSON shape",
          });
          const orm = drizzle(async () => ({ rows: [] }), { schema });
          const statement = new PgDialect().sqlToQuery(
            orm
              .insert(schema.papers)
              .values({
                title: "Executable Drizzle schema",
                metadata: { fixture: true },
              })
              .returning()
              .getSQL(),
          );
          const [paper] = await tx.query(statement.sql, statement.params);
          expect(paper!.metadata).toEqual({ fixture: true });
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await db.close();
    }
  },
);
