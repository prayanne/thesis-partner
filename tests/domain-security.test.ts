import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestDatabase, type Database } from "../packages/db/src/testing";
import type { Row } from "../packages/db/src/client";
import { migrate } from "../packages/db/src/migrations";
import { executeOperation } from "../packages/domain/src/operations";
import {
  assertUsageWithinBudget,
  reserveUsage,
  settleUsage,
} from "../packages/domain/src/usage";
import {
  atomicPrivateWrite,
  authorize,
  createSession,
  runtimePaths,
  SESSION_COOKIE,
  type Principal,
} from "../packages/security/src";

const open: Database[] = [];
const privateRoots: string[] = [];
const previousEnv = { ...process.env };
async function database() {
  const db = await createTestDatabase();
  open.push(db);
  await migrate(db);
  return db;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((db) => db.close()));
  await Promise.all(
    privateRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
  process.env = { ...previousEnv };
});

function token(tokenId: string, scopes: string[]): Principal {
  return { kind: "token", tokenId, scopes };
}
async function validSession() {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "thesis-domain-security-"),
  );
  privateRoots.push(root);
  process.env.APP_DATA_DIR = root;
  delete process.env.CONFIG_DIR;
  delete process.env.MASTER_KEY_FILE;
  process.env.APP_ORIGIN = "http://127.0.0.1:3000";
  const bootstrap = "synthetic-domain-security-bootstrap";
  await atomicPrivateWrite(runtimePaths().masterKey, "12".repeat(32));
  await atomicPrivateWrite(runtimePaths().bootstrap, bootstrap);
  const value = await createSession(
    new Request("http://127.0.0.1:3000/api/v1/session", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000" },
    }),
    bootstrap,
  );
  return authorize(
    new Request("http://127.0.0.1:3000/api/v1/jobs", {
      headers: { cookie: `${SESSION_COOKIE}=${value}` },
    }),
  );
}
async function generationJob(
  db: Database,
  principal: Principal,
  kind = "generate",
) {
  const snapshot = { operation: "translation", provider: null };
  const [job] = await db.query(
    "INSERT INTO jobs(kind,input) VALUES($1,$2) RETURNING *",
    [
      kind,
      JSON.stringify(
        kind === "translation_group"
          ? { principal, children: [] }
          : { principal, snapshot },
      ),
    ],
  );
  return job!;
}

describe("durable job authorization", () => {
  it("denies a different token and a same-owner token missing original paid scopes", async () => {
    const db = await database();
    const scopes = ["library:read", "ai:run", "external:invoke", "paid:invoke"];
    const job = await generationJob(db, token("origin", scopes));
    const other = token("other", scopes);
    for (const operation of [
      { method: "GET", path: `jobs/${job.id}` },
      { method: "GET", path: `jobs/${job.id}/events` },
      { method: "POST", path: `jobs/${job.id}/cancel` },
      { method: "POST", path: `jobs/${job.id}/retry` },
    ])
      await expect(
        executeOperation(operation, { db, principal: other }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      executeOperation(
        { method: "GET", path: `jobs/${job.id}` },
        { db, principal: token("origin", ["library:read", "ai:run"]) },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows the originating token and administrator while refusing paid replay", async () => {
    const db = await database();
    const scopes = ["library:read", "ai:run", "external:invoke", "paid:invoke"];
    const principal = token("origin", scopes);
    const readable = await generationJob(db, principal);
    expect(
      (
        await executeOperation(
          { method: "GET", path: `jobs/${readable.id}` },
          { db, principal },
        )
      ).data,
    ).toMatchObject({ id: readable.id, state: "queued" });
    expect(
      (
        await executeOperation(
          { method: "GET", path: `jobs/${readable.id}/events` },
          { db, principal },
        )
      ).data,
    ).toEqual([]);
    expect(
      (
        await executeOperation(
          { method: "POST", path: `jobs/${readable.id}/cancel` },
          { db, principal },
        )
      ).data,
    ).toMatchObject({ state: "cancelled", cancelRequested: true });
    const replay = await generationJob(db, principal);
    await expect(
      executeOperation(
        { method: "POST", path: `jobs/${replay.id}/retry` },
        { db, principal },
      ),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    expect(
      (
        await executeOperation(
          { method: "GET", path: `jobs/${replay.id}` },
          { db, principal: await validSession() },
        )
      ).data,
    ).toMatchObject({ id: replay.id });
  });

  it("applies the same owner and original-scope checks to translation groups and their children", async () => {
    const db = await database();
    const scopes = ["library:read", "ai:run", "external:invoke", "paid:invoke"];
    const owner = token("origin", scopes),
      other = token("other", scopes);
    const child = await generationJob(db, owner);
    const [group] = await db.query<Row>(
      "INSERT INTO jobs(kind,input) VALUES('translation_group',$1) RETURNING *",
      [JSON.stringify({ principal: owner, children: [{ jobId: child.id }] })],
    );
    await expect(
      executeOperation(
        { method: "GET", path: `jobs/${group!.id}` },
        { db, principal: other },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      executeOperation(
        { method: "GET", path: `jobs/${child.id}` },
        { db, principal: other },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (
        await executeOperation(
          { method: "GET", path: `jobs/${group!.id}` },
          { db, principal: owner },
        )
      ).data,
    ).toMatchObject({ id: group!.id });
    expect(
      (
        await executeOperation(
          { method: "GET", path: `jobs/${child.id}` },
          { db, principal: owner },
        )
      ).data,
    ).toMatchObject({ id: child.id });
    await expect(
      executeOperation(
        { method: "POST", path: `jobs/${group!.id}/cancel` },
        { db, principal: owner },
      ),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    expect(
      (
        await db.query("SELECT state,cancel_requested FROM jobs WHERE id=$1", [
          group!.id,
        ])
      )[0],
    ).toMatchObject({ state: "queued", cancel_requested: false });
    await expect(
      executeOperation(
        { method: "POST", path: `jobs/${group!.id}/retry` },
        { db, principal: owner },
      ),
    ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });
});

describe("latest budget guard", () => {
  it("blocks a tightened character limit before dispatch and releases an unsent reservation", async () => {
    const db = await database();
    const usage = await reserveUsage(db, {
      logicalCallId: "translation-call",
      attempt: 1,
      scope: "translation",
      providerId: "google-translation",
      modelId: "google-basic-v2",
      timeZone: "Asia/Seoul",
      estimateUsd: null,
      monthlyLimitUsd: null,
      characters: 8,
      monthlyCharacterLimit: 10,
    });
    await expect(
      assertUsageWithinBudget(db, usage.id, {
        monthlyLimitUsd: null,
        monthlyCharacterLimit: 7,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_BUDGET_EXCEEDED" });
    await settleUsage(db, usage.id, { status: "not_sent", estimatedUsd: null });
    const [bucket] = await db.query(
      "SELECT * FROM budget_buckets WHERE scope='translation' AND provider_id='*'",
    );
    expect(Number(bucket!.reserved_characters)).toBe(0);
  });
});
