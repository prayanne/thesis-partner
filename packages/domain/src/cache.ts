import type { Database, Row } from "../../db/src/client";
import { DomainError, canonical, hash, json, one, queueJob } from "./common";

export interface GenerationRequest {
  requestId: string;
  cacheMode: "use" | "refresh";
  operation: string;
  scopeKey: string;
  fingerprint: string;
  input: Record<string, unknown>;
}
export async function requestGeneration(
  db: Database,
  request: GenerationRequest,
  authorizeExecution?: () => Promise<void> | void,
) {
  const requestFingerprint = hash(
    canonical({ ...request, requestId: undefined }),
  );
  const logicalKey = hash(
    canonical({
      operation: request.operation,
      fingerprint: request.fingerprint,
    }),
  );
  return db.transaction(async (tx) => {
    // The short registration transaction serializes idempotency across all scope keys.
    await tx.query(
      "LOCK TABLE request_idempotency IN SHARE ROW EXCLUSIVE MODE",
    );
    const [existing] = await tx.query(
      "SELECT * FROM request_idempotency WHERE request_id=$1",
      [request.requestId],
    );
    if (existing) {
      if (existing.fingerprint !== requestFingerprint)
        throw new DomainError(
          "IDEMPOTENCY_CONFLICT",
          "requestId was already used for different input.",
          409,
        );
      return existing.response;
    }
    await tx.query(
      "INSERT INTO cache_entries(logical_key,operation) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [logicalKey, request.operation],
    );
    const cache = await one(
      tx,
      "SELECT * FROM cache_entries WHERE logical_key=$1 FOR UPDATE",
      [logicalKey],
    );
    let response: Row;
    if (request.cacheMode === "use" && cache.current_artifact_id) {
      const artifact = await one(
        tx,
        "SELECT * FROM generated_artifacts WHERE id=$1",
        [cache.current_artifact_id],
      );
      response = {
        artifactId: artifact.id,
        payload: artifact.payload,
        state: "succeeded",
        cache: "hit",
      };
    } else {
      const [running] =
        request.cacheMode === "use"
          ? await tx.query(
              "SELECT * FROM jobs WHERE dedupe_key=$1 AND state IN ('queued','running','blocked_config')",
              [`generation:${logicalKey}:${cache.latest_requested_generation}`],
            )
          : [];
      if (running)
        response = { jobId: running.id, state: running.state, cache: "joined" };
      else {
        await authorizeExecution?.();
        const generation = cache.latest_requested_generation + 1;
        await tx.query(
          "UPDATE cache_entries SET latest_requested_generation=$2,accessed_at=now() WHERE logical_key=$1",
          [logicalKey, generation],
        );
        const scope = await one(
          tx,
          "INSERT INTO publication_scopes(scope_key,request_revision,fingerprint) VALUES($1,1,$2) ON CONFLICT(scope_key) DO UPDATE SET request_revision=publication_scopes.request_revision+1,fingerprint=EXCLUDED.fingerprint RETURNING *",
          [request.scopeKey, request.fingerprint],
        );
        const job = await queueJob(
          tx,
          "generate",
          {
            ...request.input,
            operation: request.operation,
            logicalKey,
            fingerprint: request.fingerprint,
            scopeKey: request.scopeKey,
            scopeRevision: scope.request_revision,
          },
          `generation:${logicalKey}:${generation}`,
          generation,
        );
        response = { jobId: job.id, state: job.state, cache: "miss" };
      }
    }
    await tx.query(
      "INSERT INTO request_idempotency(request_id,fingerprint,response) VALUES($1,$2,$3)",
      [request.requestId, requestFingerprint, json(response)],
    );
    return response;
  });
}
export async function completeGeneration(
  db: Database,
  jobId: string,
  owner: string,
  payload: unknown,
  provenance: unknown,
  publishGuard?: () => Promise<boolean>,
) {
  return db.transaction(async (tx) => {
    const job = await one(tx, "SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [
      jobId,
    ]);
    if (
      job.state !== "running" ||
      job.lease_owner !== owner ||
      job.cancel_requested ||
      new Date(job.lease_until).getTime() < Date.now()
    )
      throw new DomainError(
        "LEASE_LOST",
        "Job lease expired or was cancelled.",
        409,
      );
    const input = job.input;
    let sourceCurrent = true;
    if (input.snapshot?.paperId) {
      const paper = await one(
        tx,
        "SELECT p.current_revision_id,r.active_extraction_id FROM papers p LEFT JOIN paper_revisions r ON r.id=p.current_revision_id WHERE p.id=$1 FOR UPDATE OF p",
        [input.snapshot.paperId],
      );
      sourceCurrent =
        paper.current_revision_id === input.snapshot.paperRevisionId &&
        paper.active_extraction_id === input.snapshot.extractionRunId;
    }
    const artifact = await one(
      tx,
      "INSERT INTO generated_artifacts(logical_key,generation,input_fingerprint,payload,provenance) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [
        input.logicalKey,
        job.generation,
        input.fingerprint,
        json(payload),
        json(provenance),
      ],
    );
    await tx.query(
      "UPDATE cache_entries SET current_artifact_id=$3 WHERE logical_key=$1 AND latest_requested_generation=$2",
      [input.logicalKey, job.generation, artifact.id],
    );
    if (sourceCurrent && (!publishGuard || (await publishGuard())))
      await tx.query(
        "UPDATE publication_scopes SET current_artifact_id=$4 WHERE scope_key=$1 AND request_revision=$2 AND fingerprint=$3",
        [input.scopeKey, input.scopeRevision, input.fingerprint, artifact.id],
      );
    await tx.query(
      "UPDATE jobs SET state='succeeded',progress=$2,lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",
      [jobId, json({ artifactId: artifact.id })],
    );
    return artifact;
  });
}
