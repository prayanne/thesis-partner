import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDatabase, type Database } from "../packages/db/src/testing";
import { migrate } from "../packages/db/src/migrations";
import { defaultConfig } from "../packages/security/src";
import { registerGeneration } from "../packages/domain/src/generation";
import { claimJob, runClaimedJob } from "../packages/domain/src/jobs";
const fixture = vi.hoisted(() => ({ config: null as any }));
vi.mock("../packages/security/src", async (original) => ({
  ...(await original<typeof import("../packages/security/src")>()),
  readConfig: async () => fixture.config,
  credentialStatus: async () => ({
    openai: { configured: true, revision: "synthetic-key-revision" },
  }),
  readCredential: async () => "synthetic-key-never-valid",
  refreshPrincipal: async (p: unknown) => p,
}));
let db: Database;
let paperId: string;
let payloads: Record<string, any>[];
let incomplete = false;
const principal = { kind: "session" as const, scopes: ["*"] };
beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  payloads = [];
  incomplete = false;
  fixture.config = defaultConfig();
  fixture.config.network.localOnly = false;
  fixture.config.network.allowExternalAi = true;
  fixture.config.ai.paidAiEnabled = true;
  fixture.config.providers[0] = {
    ...fixture.config.providers[0],
    enabled: true,
    modelId: "legacy-fixture-model",
    credentialRef: "openai",
  };
  fixture.config.ai.defaults.summary = "openai";
  fixture.config.ai.taskModels.summary = {
    modelId: "gpt-5.6-sol",
    reasoningEffort: "high",
  };
  paperId = randomUUID();
  const revisionId = randomUUID(),
    runId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO papers(id,title) VALUES($1,'Synthetic paper')",
      [paperId],
    );
    await tx.query(
      "INSERT INTO paper_revisions(id,paper_id,content_hash,byte_size) VALUES($1,$2,'synthetic-hash',10)",
      [revisionId, paperId],
    );
    await tx.query(
      "INSERT INTO extraction_runs(id,paper_revision_id,extractor_version,segmenter_version,state) VALUES($1,$2,'test','test','succeeded')",
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
    await tx.query(
      "INSERT INTO paper_segments(id,extraction_run_id,page_start,order_key,source_text,text_hash,anchors) VALUES($1,$2,1,1,'Synthetic excerpt only','synthetic-text-hash','{}')",
      [randomUUID(), runId],
    );
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: RequestInit) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      payloads.push(JSON.parse(String(init.body)));
      const type = incomplete ? "response.incomplete" : "response.completed";
      return new Response(
        `data: {"type":"response.output_text.delta","delta":"Synthetic summary"}\n\ndata: ${JSON.stringify({ type, response: { id: "resp_synthetic", usage: { input_tokens: 9, output_tokens: 7, output_tokens_details: { reasoning_tokens: 5 } } } })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await db.close();
});
async function request() {
  return registerGeneration(
    db,
    paperId,
    "summary",
    { requestId: randomUUID(), scope: { type: "paper" } },
    principal,
  );
}
async function drain() {
  const job = await claimJob(db, "synthetic-worker");
  expect(job).toBeTruthy();
  await runClaimedJob(db, job!, "synthetic-worker");
}

it("propagates task model and high effort to Responses, cache identity, provenance and usage", async () => {
  const first = await request();
  await drain();
  const [job] = await db.query("SELECT * FROM jobs WHERE id=$1", [first.jobId]);
  expect(job!.state).toBe("succeeded");
  expect(payloads[0]).toMatchObject({
    model: "gpt-5.6-sol",
    reasoning: { effort: "high" },
  });
  const [artifact] = await db.query("SELECT * FROM generated_artifacts");
  expect(artifact!.provenance).toMatchObject({
    modelId: "gpt-5.6-sol",
    reasoningEffort: "high",
  });
  const [usage] = await db.query("SELECT * FROM provider_usage");
  expect(usage).toMatchObject({
    model_id: "gpt-5.6-sol",
    input_tokens: 9,
    output_tokens: 7,
  });
  expect(usage!.raw_usage.output_tokens_details.reasoning_tokens).toBe(5);
  expect((await request()).cache).toBe("hit");
  expect(payloads).toHaveLength(1);
  fixture.config.ai.taskModels.summary.reasoningEffort = "low";
  expect((await request()).cache).toBe("miss");
  await drain();
  expect(payloads[1]?.reasoning).toEqual({ effort: "low" });
  expect(await db.query("SELECT * FROM cache_entries")).toHaveLength(2);
});
it("rejects queued work when its selected task model or effort changed before dispatch", async () => {
  await request();
  fixture.config.ai.taskModels.summary.reasoningEffort = "low";
  await drain();
  expect(payloads).toHaveLength(0);
  expect(await db.query("SELECT * FROM provider_usage")).toHaveLength(0);
  const [job] = await db.query("SELECT * FROM jobs");
  expect(job!.error_code).toBe("INPUT_STALE");
});
it("retains measured reasoning usage without publishing an incomplete response", async () => {
  incomplete = true;
  await request();
  await drain();
  expect(payloads).toHaveLength(1);
  expect(await db.query("SELECT * FROM generated_artifacts")).toHaveLength(0);
  const [usage] = await db.query("SELECT * FROM provider_usage");
  expect(usage).toMatchObject({
    status: "outcome_unknown",
    model_id: "gpt-5.6-sol",
    input_tokens: 9,
    output_tokens: 7,
  });
  expect(usage!.raw_usage.output_tokens_details.reasoning_tokens).toBe(5);
});
