import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDatabase, type Database } from "../packages/db/src/testing";
import { migrate } from "../packages/db/src/migrations";
import { defaultConfig } from "../packages/security/src";
import { registerGeneration } from "../packages/domain/src/generation";
import { requestGeneration } from "../packages/domain/src/cache";
import { canonical, hash } from "../packages/domain/src/common";
import {
  GOOGLE_HTML_MARKERS_V1,
  prepareTranslationPayload,
} from "../packages/providers/src/translation-markup";
import { executeOperation } from "../packages/domain/src/operations";
import { claimJob, runClaimedJob } from "../packages/domain/src/jobs";
const fixture = vi.hoisted(() => ({ config: null as any }));
vi.mock("../packages/security/src", async (original) => ({
  ...(await original<typeof import("../packages/security/src")>()),
  readConfig: async () => fixture.config,
  credentialStatus: async () => ({
    "google-translation": { configured: true, revision: "fixture-revision" },
  }),
  readCredential: async () => "fixture-only-not-a-real-key",
  refreshPrincipal: async (p: unknown) => p,
}));
let db: Database;
let paperId: string;
let segmentIds: string[];
let calls = 0;
const principal = { kind: "session" as const, scopes: ["*"] };
beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  calls = 0;
  fixture.config = defaultConfig();
  fixture.config.network = {
    localOnly: false,
    allowExternalAi: true,
    allowExternalTranslation: true,
    allowExternalMetadata: false,
  };
  fixture.config.translation.enabled = true;
  paperId = randomUUID();
  const revisionId = randomUUID(),
    runId = randomUUID();
  segmentIds = [randomUUID(), randomUUID(), randomUUID()];
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO papers(id,title) VALUES($1,$2)", [
      paperId,
      "Fixture",
    ]);
    await tx.query(
      "INSERT INTO paper_revisions(id,paper_id,content_hash,byte_size) VALUES($1,$2,'fixture-hash',100)",
      [revisionId, paperId],
    );
    await tx.query(
      "INSERT INTO extraction_runs(id,paper_revision_id,extractor_version,segmenter_version,state) VALUES($1,$2,'fixture','fixture','succeeded')",
      [runId, revisionId],
    );
    await tx.query("UPDATE papers SET current_revision_id=$2 WHERE id=$1", [
      paperId,
      revisionId,
    ]);
    await tx.query(
      "UPDATE paper_revisions SET active_extraction_id=$2 WHERE id=$1",
      [revisionId, runId],
    );
    for (const [i, id] of segmentIds.entries())
      await tx.query(
        "INSERT INTO paper_segments(id,extraction_run_id,page_start,order_key,source_text,text_hash,anchors) VALUES($1,$2,$3,$4,$5,$6,'{}')",
        [id, runId, i === 2 ? 2 : 1, i, `Source ${i}`, `hash-${i}`],
      );
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      calls++;
      const body = JSON.parse(init.body as string);
      const texts = Array.isArray(body.q) ? body.q : [body.q];
      return Response.json({
        data: {
          translations: texts.map((s: string) => ({
            translatedText: `번역 ${s}`,
            detectedSourceLanguage: "en",
          })),
        },
      });
    }),
  );
});
afterEach(async () => {
  await db.close();
  vi.unstubAllGlobals();
});
async function drain() {
  for (let i = 0; i < 20; i++) {
    const job = await claimJob(db, "test-worker");
    if (!job) return;
    await runClaimedJob(db, job, "test-worker");
  }
  throw new Error("Worker did not drain");
}
it("executes a page through the native Google adapter once per canonical segment, reuses cache and refreshes explicitly", async () => {
  const body = {
    requestId: randomUUID(),
    cacheMode: "use",
    scope: { type: "page", pageNumber: 1 },
    targetLanguage: "ko",
  };
  const first = await registerGeneration(
    db,
    paperId,
    "translation",
    body,
    principal,
  );
  expect(first.jobId).toBeTruthy();
  expect(
    (await registerGeneration(db, paperId, "translation", body, principal))
      .jobId,
  ).toBe(first.jobId);
  await drain();
  expect(calls).toBe(2);
  const [parent] = await db.query("SELECT * FROM jobs WHERE id=$1", [
    first.jobId,
  ]);
  expect(parent!.state).toBe("succeeded");
  const cached = await registerGeneration(
    db,
    paperId,
    "translation",
    { ...body, requestId: randomUUID() },
    principal,
  );
  expect(cached.cache).toBe("hit");
  expect(cached.payload.segments).toHaveLength(2);
  expect(calls).toBe(2);
  const page1 = await executeOperation(
    {
      method: "GET",
      path: `papers/${paperId}/artifacts`,
      query: new URLSearchParams({ operation: "translation", pageNumber: "1" }),
    },
    { db, principal },
  );
  expect((page1.data as any[])[0].payload.segments).toHaveLength(2);
  const page2 = await executeOperation(
    {
      method: "GET",
      path: `papers/${paperId}/artifacts`,
      query: new URLSearchParams({ operation: "translation", pageNumber: "2" }),
    },
    { db, principal },
  );
  expect(page2.data).toEqual([]);
  await registerGeneration(
    db,
    paperId,
    "translation",
    { ...body, cacheMode: "refresh", requestId: randomUUID() },
    principal,
  );
  await drain();
  expect(calls).toBe(4);
  expect((await db.query("SELECT * FROM provider_usage")).length).toBe(4);
});
it("denies paid/external scopes atomically before advancing any cache generation", async () => {
  await expect(
    registerGeneration(
      db,
      paperId,
      "translation",
      { requestId: randomUUID(), scope: { type: "page", pageNumber: 1 } },
      { kind: "token", scopes: ["library:read", "ai:run"] },
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await db.query("SELECT * FROM jobs")).length).toBe(0);
  expect((await db.query("SELECT * FROM cache_entries")).length).toBe(0);
  expect(calls).toBe(0);
});
it("rechecks local-only policy immediately before execution and creates no provider usage", async () => {
  await registerGeneration(
    db,
    paperId,
    "translation",
    { requestId: randomUUID(), scope: { type: "page", pageNumber: 1 } },
    principal,
  );
  fixture.config.network.localOnly = true;
  await drain();
  expect(calls).toBe(0);
  expect((await db.query("SELECT * FROM provider_usage")).length).toBe(0);
  const jobs = await db.query("SELECT * FROM jobs");
  expect(jobs.every((j) => j.state === "blocked_config")).toBe(true);
});
it("reserves overlapping page and segment refreshes in one generation series", async () => {
  await registerGeneration(
    db,
    paperId,
    "translation",
    { requestId: randomUUID(), cacheMode: "refresh", scope: { type: "paper" } },
    principal,
  );
  await registerGeneration(
    db,
    paperId,
    "translation",
    {
      requestId: randomUUID(),
      cacheMode: "refresh",
      scope: { type: "segments", segmentIds: [segmentIds[0]] },
    },
    principal,
  );
  const caches = await db.query("SELECT * FROM cache_entries");
  expect(caches).toHaveLength(3);
  expect(caches.map((c) => c.latest_requested_generation).sort()).toEqual([
    1, 1, 2,
  ]);
  await drain();
  const scopes = await db.query(
    "SELECT p.scope_key,a.generation FROM publication_scopes p JOIN generated_artifacts a ON a.id=p.current_artifact_id",
  );
  expect(
    scopes.find((s) => s.scope_key.includes(segmentIds[0]!))!.generation,
  ).toBe(2);
});

it("stores text-bound word links and reserves/settles the complete HTML payload count", async () => {
  const result = await registerGeneration(
    db,
    paperId,
    "translation",
    {
      requestId: randomUUID(),
      scope: { type: "segments", segmentIds: [segmentIds[0]] },
    },
    principal,
  );
  const [job] = await db.query("SELECT * FROM jobs WHERE id=$1", [
    result.jobId,
  ]);
  expect(job!.input.snapshot.translationMode).toBe(GOOGLE_HTML_MARKERS_V1);
  await drain();
  expect(calls).toBe(1);
  const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
  const expected = prepareTranslationPayload(
    ["Source 0"],
    GOOGLE_HTML_MARKERS_V1,
  );
  expect(body).toMatchObject({ q: expected.q, format: "html" });
  const [usage] = await db.query("SELECT * FROM provider_usage");
  expect(usage).toMatchObject({
    status: "succeeded",
    reserved_characters: expected.characterCount,
    characters: expected.characterCount,
  });
  const [artifact] = await db.query("SELECT * FROM generated_artifacts");
  const row = artifact!.payload.segments[0];
  expect(row).toMatchObject({
    sourceText: "Source 0",
    targetText: "번역 Source 0",
    translatedText: "번역 Source 0",
    alignmentStatus: "partial",
    wordAlignment: {
      method: GOOGLE_HTML_MARKERS_V1,
      status: "partial",
      sourceText: "Source 0",
      targetText: "번역 Source 0",
      links: [
        {
          id: "w0-6",
          sourceRange: { start: 0, end: 6 },
          targetRange: { start: 3, end: 9 },
        },
        {
          id: "w7-8",
          sourceRange: { start: 7, end: 8 },
          targetRange: { start: 10, end: 11 },
        },
      ],
    },
  });
  expect(row.targetTextHash).toBe(hash(row.targetText));
});

it("enforces the existing monthly limit against HTML overhead before sending any request", async () => {
  fixture.config.translation.monthlyCharacterLimit = 8; // Plain text fits, HTML does not.
  await registerGeneration(
    db,
    paperId,
    "translation",
    {
      requestId: randomUUID(),
      scope: { type: "segments", segmentIds: [segmentIds[0]] },
    },
    principal,
  );
  await drain();
  expect(calls).toBe(0);
  expect(await db.query("SELECT * FROM provider_usage")).toHaveLength(0);
  const [job] = await db.query("SELECT * FROM jobs");
  expect(job!.error_code).toBe("CHARACTER_BUDGET_EXCEEDED");
});

it("keeps legacy queued snapshots in text mode and legacy caches separate from marker generations", async () => {
  const current = await registerGeneration(
    db,
    paperId,
    "translation",
    {
      requestId: randomUUID(),
      scope: { type: "segments", segmentIds: [segmentIds[0]] },
    },
    principal,
  );
  const [currentJob] = await db.query("SELECT * FROM jobs WHERE id=$1", [
    current.jobId,
  ]);
  const legacySnapshot = { ...currentJob!.input.snapshot };
  delete legacySnapshot.translationMode;
  const legacyRequest = {
    requestId: randomUUID(),
    cacheMode: "use" as const,
    operation: "translation",
    scopeKey: currentJob!.input.scopeKey,
    fingerprint: hash(canonical(legacySnapshot)),
    input: { snapshot: legacySnapshot, principal },
  };
  const legacy = await requestGeneration(db, legacyRequest);
  const [legacyJob] = await db.query("SELECT * FROM jobs WHERE id=$1", [
    legacy.jobId,
  ]);
  expect(legacyJob!.input.logicalKey).not.toBe(currentJob!.input.logicalKey);
  expect(legacyJob!.input.snapshot.translationMode).toBeUndefined();
  await drain();
  expect(calls).toBe(2);
  const bodies = vi
    .mocked(fetch)
    .mock.calls.map((call) => JSON.parse(String(call[1]!.body)));
  expect(bodies).toContainEqual({
    q: ["Source 0"],
    target: "ko",
    format: "text",
  });
  expect(bodies.filter((body) => body.format === "html")).toHaveLength(1);
  const [legacyUsage] = await db.query(
    "SELECT * FROM provider_usage WHERE job_id=$1",
    [legacy.jobId],
  );
  expect(legacyUsage).toMatchObject({ reserved_characters: 8, characters: 8 });
  const legacyCache = await requestGeneration(db, {
    ...legacyRequest,
    requestId: randomUUID(),
  });
  expect(legacyCache.cache).toBe("hit");
  expect(legacyCache.payload.segments[0].wordAlignment).toBeUndefined();
  expect(legacyCache.payload.segments[0].alignmentStatus).toBe("unavailable");
  const currentCache = await registerGeneration(
    db,
    paperId,
    "translation",
    {
      requestId: randomUUID(),
      scope: { type: "segments", segmentIds: [segmentIds[0]] },
    },
    principal,
  );
  expect(currentCache.cache).toBe("hit");
  expect(currentCache.payload.segments[0].wordAlignment.method).toBe(
    GOOGLE_HTML_MARKERS_V1,
  );
  expect(calls).toBe(2);
});

it("never retries rejected HTML and retains the full uncertain usage reservation", async () => {
  vi.mocked(fetch).mockImplementation(async () => {
    calls++;
    return Response.json({
      data: { translations: [{ translatedText: "<script>bad</script>" }] },
    });
  });
  await registerGeneration(
    db,
    paperId,
    "translation",
    {
      requestId: randomUUID(),
      scope: { type: "segments", segmentIds: [segmentIds[0]] },
    },
    principal,
  );
  await drain();
  await drain();
  expect(calls).toBe(1);
  expect(await db.query("SELECT * FROM generated_artifacts")).toHaveLength(0);
  const [job] = await db.query("SELECT * FROM jobs");
  expect(job).toMatchObject({
    state: "failed",
    error_code: "INVALID_UPSTREAM_RESPONSE",
    attempts: 1,
  });
  const [usage] = await db.query("SELECT * FROM provider_usage");
  expect(usage).toMatchObject({
    status: "outcome_unknown",
    reserved_characters: prepareTranslationPayload(
      ["Source 0"],
      GOOGLE_HTML_MARKERS_V1,
    ).characterCount,
  });
});
