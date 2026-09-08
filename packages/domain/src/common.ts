import { createHash } from "node:crypto";
import type { Database, Row } from "../../db/src/client";
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function required<T>(
  value: T | undefined | null,
  message = "Record not found",
): T {
  if (value == null) throw new DomainError("NOT_FOUND", message, 404);
  return value;
}
export function assertRevision(row: Row, expected: unknown) {
  if (!Number.isInteger(expected) || row.revision !== expected)
    throw new DomainError(
      "REVISION_CONFLICT",
      "Reload the latest revision before saving.",
      409,
    );
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export function camel(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v,
    ]),
  );
}
export async function one(db: Database, sql: string, params: unknown[] = []) {
  return required((await db.query(sql, params))[0]);
}
export const json = (value: unknown) => JSON.stringify(value);
export async function queueJob(
  tx: Database,
  kind: string,
  input: unknown,
  dedupeKey: string | null = null,
  generation: number | null = null,
) {
  return one(
    tx,
    "INSERT INTO jobs(kind,input,dedupe_key,generation) VALUES($1,$2,$3,$4) ON CONFLICT(dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING *",
    [kind, json(input), dedupeKey, generation],
  );
}
