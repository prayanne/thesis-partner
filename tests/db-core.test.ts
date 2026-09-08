import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type Database } from "../packages/db/src/testing";
import { migrate } from "../packages/db/src/migrations";
import { randomUUID } from "node:crypto";
import {
  saveWiki,
  saveItem,
  getItem,
  addDependency,
  setProgress,
  submitExercise,
} from "../packages/domain/src/learning";
import {
  requestGeneration,
  completeGeneration,
} from "../packages/domain/src/cache";
import { claimJob } from "../packages/domain/src/jobs";
import { reserveUsage, settleUsage } from "../packages/domain/src/usage";
import { executeOperation } from "../packages/domain/src/operations";
const open: Database[] = [];
async function database() {
  const db = await createTestDatabase();
  open.push(db);
  await migrate(db);
  return db;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((db) => db.close()));
});
describe("PostgreSQL durable core via explicit PGlite test adapter", () => {
  it("applies versioned migrations idempotently and enforces immutable wiki history", async () => {
    const db = await database();
    await migrate(db);
    expect((await db.query("SELECT * FROM schema_migrations")).length).toBe(4);
    const wiki = await saveWiki(db, {
      title: "Contracts",
      slug: "contracts",
      markdown: "First version",
    });
    const changed = await saveWiki(
      db,
      {
        title: "Contracts",
        slug: "contracts",
        markdown: "Second version",
        expectedRevision: wiki.revision,
      },
      wiki.id,
    );
    expect(changed.revision).toBe(2);
    expect(
      (
        await db.query("SELECT * FROM wiki_revisions WHERE wiki_id=$1", [
          wiki.id,
        ])
      ).length,
    ).toBe(2);
    await expect(
      saveWiki(
        db,
        {
          title: "Stale",
          slug: "contracts",
          markdown: "overwrite",
          expectedRevision: 1,
        },
        wiki.id,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      db.query("UPDATE wiki_revisions SET markdown='tamper' WHERE wiki_id=$1", [
        wiki.id,
      ]),
    ).rejects.toThrow("immutable");
  });
  it("enforces curriculum DAG and retains the completed lesson snapshot after editing", async () => {
    const db = await database();
    const [curriculum] = await db.query(
      "INSERT INTO curricula(title) VALUES('CS') RETURNING *",
    );
    const blocks = [
      {
        blockKey: "q",
        kind: "self_explanation",
        payload: { questions: ["Why?"] },
      },
      {
        blockKey: "exercise",
        kind: "exercise",
        payload: { instructions: "Run a rollback experiment." },
      },
    ];
    const first = await saveItem(db, curriculum!.id, {
      title: "Transactions",
      blocks,
    });
    const second = await saveItem(db, curriculum!.id, {
      title: "Distributed systems",
    });
    let [current] = await db.query("SELECT * FROM curricula WHERE id=$1", [
      curriculum!.id,
    ]);
    await addDependency(db, curriculum!.id, {
      prerequisiteItemId: first.id,
      dependentItemId: second.id,
      expectedRevision: current!.revision,
    });
    [current] = await db.query("SELECT * FROM curricula WHERE id=$1", [
      curriculum!.id,
    ]);
    await expect(
      addDependency(db, curriculum!.id, {
        prerequisiteItemId: second.id,
        dependentItemId: first.id,
        expectedRevision: current!.revision,
      }),
    ).rejects.toThrow("cycle");
    await expect(
      setProgress(db, {
        itemId: first.id,
        lessonRevisionId: first.lessonRevisionId,
        state: "completed",
      }),
    ).rejects.toMatchObject({ code: "COMPLETION_INCOMPLETE" });
    await expect(
      setProgress(db, {
        itemId: first.id,
        lessonRevisionId: first.lessonRevisionId,
        state: "in_progress",
        checks: { blockResponses: { "missing:0": "answer" } },
      }),
    ).rejects.toMatchObject({ code: "INVALID_BLOCK_RESPONSE" });
    await submitExercise(db, {
      itemId: first.id,
      lessonRevisionId: first.lessonRevisionId,
      blockKey: "exercise",
      resultNote: "Rollback preserved original count.",
      evidencePath: "local/results.txt",
    });
    const completed = await setProgress(db, {
      itemId: first.id,
      lessonRevisionId: first.lessonRevisionId,
      state: "completed",
      checks: {
        readingConfirmed: true,
        selfExplanationAnswers: [
          "Atomicity keeps the partial write invisible.",
        ],
        exerciseConfirmed: true,
        userConfirmed: true,
        blockResponses: { "q:0": "Atomicity keeps partial writes invisible." },
      },
    });
    expect(completed.checks.blockResponses["q:0"]).toBe(
      "Atomicity keeps partial writes invisible.",
    );
    await saveItem(
      db,
      curriculum!.id,
      {
        title: "Transactions revised",
        blocks,
        expectedRevision: first.revision,
      },
      first.id,
    );
    const item = await getItem(db, first.id);
    expect(item.lessonRevisionId).not.toBe(first.lessonRevisionId);
    expect(item.progress).toBeNull();
    const [history] = await db.query(
      "SELECT r.snapshot,p.state FROM lesson_revisions r JOIN learning_progress p ON p.lesson_revision_id=r.id WHERE r.id=$1",
      [first.lessonRevisionId],
    );
    expect(history!.snapshot.title).toBe("Transactions");
    expect(history!.state).toBe("completed");
  });
  it("deduplicates refreshes and fences reversed completion across input fingerprints", async () => {
    const db = await database();
    const request = {
      requestId: randomUUID(),
      cacheMode: "refresh" as const,
      operation: "summary",
      scopeKey: "paper:summary:all",
      fingerprint: "source-v1",
      input: {},
    };
    const first = await requestGeneration(db, request);
    expect((await requestGeneration(db, request)).jobId).toBe(first.jobId);
    await expect(
      requestGeneration(db, { ...request, fingerprint: "different" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const claimedFirst = await claimJob(db, "first");
    expect(claimedFirst!.id).toBe(first.jobId);
    const second = await requestGeneration(db, {
      ...request,
      requestId: randomUUID(),
      fingerprint: "source-v2",
    });
    await claimJob(db, "second");
    const latest = await completeGeneration(
      db,
      second.jobId,
      "second",
      { text: "Latest" },
      {},
    );
    await completeGeneration(db, first.jobId, "first", { text: "Old" }, {});
    const [scope] = await db.query("SELECT * FROM publication_scopes");
    expect(scope!.current_artifact_id).toBe(latest.id);
    const cacheHit = await requestGeneration(db, {
      ...request,
      requestId: randomUUID(),
      cacheMode: "use",
      fingerprint: "source-v2",
    });
    expect(cacheHit.cache).toBe("hit");
    expect((await db.query("SELECT * FROM jobs")).length).toBe(2);
  });
  it("keeps unknown usage reserved and rejects cross-provider budget overspend", async () => {
    const db = await database();
    const input = {
      logicalCallId: "call-1",
      attempt: 1,
      scope: "ai" as const,
      providerId: "openai",
      modelId: "mock",
      timeZone: "Asia/Seoul",
      estimateUsd: 0.7,
      monthlyLimitUsd: 1,
    };
    const usage = await reserveUsage(db, input);
    expect((await reserveUsage(db, input)).id).toBe(usage.id);
    await settleUsage(db, usage.id, {
      status: "outcome_unknown",
      estimatedUsd: null,
    });
    await expect(
      reserveUsage(db, {
        ...input,
        logicalCallId: "call-2",
        providerId: "anthropic",
        estimateUsd: 0.4,
      }),
    ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
    await settleUsage(db, usage.id, {
      status: "succeeded",
      estimatedUsd: 0.2,
      usage: { inputTokens: 100, outputTokens: 20, raw: {} },
    });
    await reserveUsage(db, {
      ...input,
      logicalCallId: "call-2",
      providerId: "anthropic",
      estimateUsd: 0.4,
    });
    await expect(
      reserveUsage(db, {
        ...input,
        logicalCallId: "call-3",
        estimateUsd: null,
      }),
    ).rejects.toMatchObject({ code: "PRICE_REQUIRED" });
  });
  it("keeps the previous artifact after cancellation and refuses expired provider replay", async () => {
    const db = await database();
    const request = {
      requestId: randomUUID(),
      cacheMode: "refresh" as const,
      operation: "summary",
      scopeKey: "paper:summary:all",
      fingerprint: "unchanged-source",
      input: {},
    };
    const first = await requestGeneration(db, request);
    await claimJob(db, "worker");
    const artifact = await completeGeneration(
      db,
      first.jobId,
      "worker",
      { text: "Saved" },
      {},
    );
    const refresh = await requestGeneration(db, {
      ...request,
      requestId: randomUUID(),
    });
    await claimJob(db, "worker");
    await db.query("UPDATE jobs SET cancel_requested=true WHERE id=$1", [
      refresh.jobId,
    ]);
    await expect(
      completeGeneration(
        db,
        refresh.jobId,
        "worker",
        { text: "Cancelled" },
        {},
      ),
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    const [cache] = await db.query("SELECT * FROM cache_entries");
    expect(cache!.current_artifact_id).toBe(artifact.id);
    await db.query(
      "UPDATE jobs SET cancel_requested=false,lease_until=now()-interval '1 minute' WHERE id=$1",
      [refresh.jobId],
    );
    expect(await claimJob(db, "replacement")).toBeNull();
    const [expired] = await db.query("SELECT * FROM jobs WHERE id=$1", [
      refresh.jobId,
    ]);
    expect(expired!.state).toBe("failed");
    expect(expired!.error_code).toBe("OUTCOME_UNKNOWN");
  });
  it("rejects scope violations before any database work", async () => {
    await expect(
      executeOperation(
        { method: "POST", path: "papers", body: {} },
        { principal: { kind: "token", scopes: ["library:read"] } },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
