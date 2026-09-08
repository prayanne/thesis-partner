import { randomUUID } from "node:crypto";
import { getDatabase } from "../../../packages/db/src";
import { claimJob, runClaimedJob } from "../../../packages/domain/src";
const db = getDatabase();
const owner = `worker-${randomUUID()}`;
const shutdown = new AbortController();
process.once("SIGTERM", () => shutdown.abort());
process.once("SIGINT", () => shutdown.abort());
console.log("Durable PostgreSQL worker started.");
try {
  while (!shutdown.signal.aborted) {
    try {
      const job = await claimJob(db, owner);
      if (job) await runClaimedJob(db, job, owner, shutdown.signal);
      else await new Promise((r) => setTimeout(r, 1000));
    } catch {
      console.error(
        "Worker database operation failed; retrying in five seconds.",
      );
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
} finally {
  await db
    .query(
      "UPDATE jobs SET lease_until=now() WHERE lease_owner=$1 AND state='running'",
      [owner],
    )
    .catch(() => {});
  await db.close();
}
