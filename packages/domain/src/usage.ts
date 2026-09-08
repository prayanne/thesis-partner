import type { Database, Row } from "../../db/src/client";
import { DomainError, json, one } from "./common";
export interface UsageReservation {
  jobId?: string;
  logicalCallId: string;
  attempt: number;
  scope: "ai" | "translation";
  providerId: string;
  modelId: string;
  timeZone: string;
  estimateUsd: number | null;
  monthlyLimitUsd: number | null;
  providerLimitUsd?: number | null;
  characters?: number;
  monthlyCharacterLimit?: number | null;
  pricingRevision?: string;
}
export interface CurrentUsageLimits {
  monthlyLimitUsd: number | null;
  monthlyCharacterLimit?: number | null;
}
export function budgetPeriod(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}
export async function reserveUsage(db: Database, input: UsageReservation) {
  if (
    input.estimateUsd === null &&
    (input.monthlyLimitUsd !== null || input.providerLimitUsd != null)
  )
    throw new DomainError(
      "PRICE_REQUIRED",
      "A configured monetary budget requires verified model pricing.",
      429,
    );
  return db.transaction(async (tx) => {
    const period = budgetPeriod(input.timeZone);
    const keys = ["*", input.providerId];
    // All providers take the shared scope lock first, then their own lock.
    for (const providerId of keys) {
      await tx.query(
        "INSERT INTO budget_buckets(scope,period,provider_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [input.scope, period, providerId],
      );
      await one(
        tx,
        "SELECT * FROM budget_buckets WHERE scope=$1 AND period=$2 AND provider_id=$3 FOR UPDATE",
        [input.scope, period, providerId],
      );
    }
    const [prior] = await tx.query(
      "SELECT * FROM provider_usage WHERE logical_call_id=$1 AND attempt=$2",
      [input.logicalCallId, input.attempt],
    );
    if (prior) return prior;
    for (const [index, providerId] of keys.entries()) {
      const bucket = await one(
        tx,
        "SELECT * FROM budget_buckets WHERE scope=$1 AND period=$2 AND provider_id=$3",
        [input.scope, period, providerId],
      );
      const limit =
        index === 0 ? input.monthlyLimitUsd : input.providerLimitUsd;
      if (
        limit != null &&
        Number(bucket.reserved_usd) +
          Number(bucket.settled_usd) +
          (input.estimateUsd ?? 0) >
          limit
      )
        throw new DomainError(
          "BUDGET_EXCEEDED",
          "The estimated monthly budget is exhausted.",
          429,
        );
      if (
        index === 0 &&
        input.monthlyCharacterLimit != null &&
        Number(bucket.reserved_characters) +
          Number(bucket.settled_characters) +
          (input.characters ?? 0) >
          input.monthlyCharacterLimit
      )
        throw new DomainError(
          "CHARACTER_BUDGET_EXCEEDED",
          "The monthly translation character limit is exhausted.",
          429,
        );
      await tx.query(
        "UPDATE budget_buckets SET reserved_usd=reserved_usd+$4,reserved_characters=reserved_characters+$5 WHERE scope=$1 AND period=$2 AND provider_id=$3",
        [
          input.scope,
          period,
          providerId,
          input.estimateUsd ?? 0,
          input.characters ?? 0,
        ],
      );
    }
    return one(
      tx,
      "INSERT INTO provider_usage(job_id,logical_call_id,attempt,budget_scope,budget_period,budget_timezone,provider_instance_id,model_id,status,reserved_usd,reserved_characters,pricing_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'reserved',$9,$10,$11) RETURNING *",
      [
        input.jobId ?? null,
        input.logicalCallId,
        input.attempt,
        input.scope,
        period,
        input.timeZone,
        input.providerId,
        input.modelId,
        input.estimateUsd,
        input.characters ?? 0,
        input.pricingRevision ?? null,
      ],
    );
  });
}
export async function assertUsageWithinBudget(
  db: Database,
  id: string,
  limits: CurrentUsageLimits,
) {
  return db.transaction(async (tx) => {
    const preliminary = await one(
      tx,
      "SELECT * FROM provider_usage WHERE id=$1",
      [id],
    );
    const bucket = await one(
      tx,
      "SELECT * FROM budget_buckets WHERE scope=$1 AND period=$2 AND provider_id=$3 FOR UPDATE",
      [preliminary.budget_scope, preliminary.budget_period, "*"],
    );
    const usage = await one(
      tx,
      "SELECT * FROM provider_usage WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (usage.status !== "reserved")
      throw new DomainError(
        "USAGE_NOT_RESERVED",
        "The provider usage reservation is no longer dispatchable.",
        409,
      );
    if (limits.monthlyLimitUsd !== null && usage.reserved_usd === null)
      throw new DomainError(
        "PRICE_REQUIRED",
        "A configured monetary budget requires verified model pricing.",
        429,
      );
    if (
      limits.monthlyLimitUsd !== null &&
      Number(bucket.reserved_usd) + Number(bucket.settled_usd) >
        limits.monthlyLimitUsd
    )
      throw new DomainError(
        "BUDGET_EXCEEDED",
        "The estimated monthly budget is exhausted.",
        429,
      );
    if (
      limits.monthlyCharacterLimit != null &&
      Number(bucket.reserved_characters) + Number(bucket.settled_characters) >
        limits.monthlyCharacterLimit
    )
      throw new DomainError(
        "CHARACTER_BUDGET_EXCEEDED",
        "The monthly translation character limit is exhausted.",
        429,
      );
    return usage;
  });
}
export async function settleUsage(
  db: Database,
  id: string,
  result: {
    status: "succeeded" | "outcome_unknown" | "not_sent";
    estimatedUsd: number | null;
    usage?: Row;
    characters?: number;
  },
) {
  return db.transaction(async (tx) => {
    const preliminary = await one(
      tx,
      "SELECT * FROM provider_usage WHERE id=$1",
      [id],
    );
    for (const providerId of ["*", preliminary.provider_instance_id])
      await one(
        tx,
        "SELECT * FROM budget_buckets WHERE scope=$1 AND period=$2 AND provider_id=$3 FOR UPDATE",
        [preliminary.budget_scope, preliminary.budget_period, providerId],
      );
    const row = await one(
      tx,
      "SELECT * FROM provider_usage WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (row.status !== "reserved" && row.status !== "outcome_unknown")
      return row;
    const uncertain =
      result.status === "outcome_unknown" ||
      (result.status === "succeeded" &&
        result.estimatedUsd === null &&
        row.reserved_usd !== null);
    if (!uncertain) {
      for (const providerId of ["*", row.provider_instance_id])
        await tx.query(
          "UPDATE budget_buckets SET reserved_usd=reserved_usd-$4,settled_usd=settled_usd+$5,reserved_characters=reserved_characters-$6,settled_characters=settled_characters+$7 WHERE scope=$1 AND period=$2 AND provider_id=$3",
          [
            row.budget_scope,
            row.budget_period,
            providerId,
            row.reserved_usd ?? 0,
            result.status === "not_sent" ? 0 : (result.estimatedUsd ?? 0),
            row.reserved_characters,
            result.status === "not_sent"
              ? 0
              : (result.characters ?? row.reserved_characters),
          ],
        );
    }
    return one(
      tx,
      "UPDATE provider_usage SET status=$2,estimated_usd=$3,input_tokens=$4,output_tokens=$5,cache_read_tokens=$6,cache_write_tokens=$7,characters=$8,raw_usage=$9 WHERE id=$1 RETURNING *",
      [
        id,
        uncertain ? "outcome_unknown" : result.status,
        result.estimatedUsd,
        result.usage?.inputTokens ?? null,
        result.usage?.outputTokens ?? null,
        result.usage?.cacheReadTokens ?? null,
        result.usage?.cacheWriteTokens ?? null,
        result.characters ?? null,
        json(result.usage?.raw ?? {}),
      ],
    );
  });
}
