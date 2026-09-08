import type { Database, Row } from "../../db/src/client";
import { DomainError, json, one } from "./common";
import { extractPdf } from "./extraction";
import { exportAnalysis } from "./projections";
import { runGeneration } from "./generation";
import { readConfig, refreshPrincipal } from "../../security/src";

export async function claimJob(db: Database, owner: string, leaseSeconds = 90) {
  return db.transaction(async (tx) => {
    // A crashed external call has an ambiguous outcome. Never automatically send it again.
    await tx.query(
      "UPDATE jobs SET state='failed',error_code='OUTCOME_UNKNOWN',lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE kind='generate' AND state='running' AND lease_until<now()",
    );
    await tx.query(
      "UPDATE provider_usage SET status='outcome_unknown' WHERE status='reserved' AND job_id IN (SELECT id FROM jobs WHERE error_code='OUTCOME_UNKNOWN')",
    );
    const [job] = await tx.query(
      "SELECT * FROM jobs WHERE cancel_requested=false AND (state='queued' OR (state='running' AND lease_until<now() AND kind<>'generate')) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!job) return null;
    return one(
      tx,
      "UPDATE jobs SET state='running',lease_owner=$2,lease_until=now()+($3::integer * interval '1 second'),attempts=attempts+1,updated_at=now() WHERE id=$1 RETURNING *",
      [job.id, owner, leaseSeconds],
    );
  });
}
export async function appendJobEvent(
  db: Database,
  jobId: string,
  type: string,
  payload: unknown,
) {
  return db.transaction(async (tx) => {
    await one(tx, "SELECT id FROM jobs WHERE id=$1 FOR UPDATE", [jobId]);
    return one(
      tx,
      "INSERT INTO job_events(job_id,sequence,type,payload) VALUES($1,(SELECT coalesce(max(sequence),0)+1 FROM job_events WHERE job_id=$1),$2,$3) RETURNING *",
      [jobId, type, json(payload)],
    );
  });
}
export async function runClaimedJob(
  db: Database,
  job: Row,
  owner: string,
  shutdown?: AbortSignal,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  shutdown?.addEventListener("abort", abort, { once: true });
  let busy = false;
  const heartbeat = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const [live] = await db.query(
        "UPDATE jobs SET lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=$1 AND lease_owner=$2 AND state='running' RETURNING *",
        [job.id, owner],
      );
      if (!live || live.cancel_requested) controller.abort();
      if (job.kind === "generate") {
        await refreshPrincipal(job.input.principal);
        const config = await readConfig();
        const snapshot = job.input.snapshot;
        if (
          snapshot.operation === "translation" &&
          (!config.translation.enabled ||
            config.network.localOnly ||
            !config.network.allowExternalTranslation)
        )
          controller.abort();
        if (
          snapshot.provider &&
          ["openai", "anthropic"].includes(snapshot.provider.adapterId) &&
          (!config.ai.paidAiEnabled ||
            config.network.localOnly ||
            !config.network.allowExternalAi)
        )
          controller.abort();
      }
    } catch {
      controller.abort();
    } finally {
      busy = false;
    }
  }, 1000);
  heartbeat.unref();
  try {
    await appendJobEvent(db, job.id, "running", { attempt: job.attempts });
    let result: unknown;
    if (job.kind === "extract_pdf")
      result = await extractPdf(db, job.input, { jobId: job.id, owner });
    else if (job.kind === "export_analysis")
      result = await exportAnalysis(db, job.input.paperId);
    else if (job.kind === "generate")
      result = await runGeneration(db, job, owner, controller.signal);
    else if (job.kind === "translation_group") {
      const children: Row[] = job.input.children;
      const states = [];
      for (const child of children)
        states.push(
          child.artifactId
            ? { state: "succeeded", progress: { artifactId: child.artifactId } }
            : await one(
                db,
                "SELECT state,progress,error_code FROM jobs WHERE id=$1",
                [child.jobId],
              ),
        );
      const state = states.every((s) => s.state === "succeeded")
        ? "succeeded"
        : states.some((s) => s.state === "blocked_config")
          ? "blocked_config"
          : states.some((s) => ["failed", "cancelled"].includes(s.state))
            ? "failed"
            : "queued";
      await db.query(
        "UPDATE jobs SET state=$3,progress=$4,error_code=$5,lease_owner=NULL,lease_until=NULL,updated_at=now(),created_at=CASE WHEN $3='queued' THEN now() ELSE created_at END WHERE id=$1 AND lease_owner=$2",
        [
          job.id,
          owner,
          state,
          json({
            completed: states.filter((s) => s.state === "succeeded").length,
            total: states.length,
            artifactIds: states.flatMap((s) =>
              s.progress?.artifactId ? [s.progress.artifactId] : [],
            ),
          }),
          states.find((s) => s.error_code)?.error_code ?? null,
        ],
      );
      await appendJobEvent(db, job.id, "group_progress", {
        state,
        completed: states.filter((s) => s.state === "succeeded").length,
        total: states.length,
      });
      return { state };
    } else
      throw new DomainError(
        "NOT_IMPLEMENTED",
        "This worker job kind is not implemented.",
        501,
      );
    if (job.kind !== "generate")
      await db.query(
        "UPDATE jobs SET state=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'succeeded' END,progress=$3,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_owner=$2 AND state='running'",
        [job.id, owner, json(result)],
      );
    await appendJobEvent(db, job.id, "finished", {
      state: (await one(db, "SELECT state FROM jobs WHERE id=$1", [job.id]))
        .state,
    });
    return result;
  } catch (error) {
    const code =
      typeof (error as Row)?.code === "string"
        ? (error as Row).code
        : "WORKER_FAILED";
    const blocked = [
      "PROVIDER_NOT_CONFIGURED",
      "PROVIDER_DISABLED",
      "CREDENTIAL_REQUIRED",
      "POLICY_BLOCKED",
      "MODEL_LOCALITY_UNVERIFIED",
      "TRANSLATION_DISABLED",
      "PRICE_REQUIRED",
      "BUDGET_EXCEEDED",
      "CHARACTER_BUDGET_EXCEEDED",
      "FORBIDDEN",
    ].includes(code);
    await db.query(
      "UPDATE jobs SET state=CASE WHEN cancel_requested THEN 'cancelled' ELSE $3 END,error_code=$4,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_owner=$2 AND state='running'",
      [job.id, owner, blocked ? "blocked_config" : "failed", code],
    );
    await appendJobEvent(db, job.id, "failed", { code });
  } finally {
    clearInterval(heartbeat);
    shutdown?.removeEventListener("abort", abort);
  }
}
