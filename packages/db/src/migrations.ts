import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { Database } from "./client";

export async function migrate(db: Database) {
  const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const filename of (await readdir(directory))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort()) {
    const sql = await readFile(`${directory}/${filename}`, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await db.transaction(async (tx) => {
      await tx.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
      const [existing] = await tx.query(
        "SELECT checksum FROM schema_migrations WHERE version=$1",
        [filename],
      );
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(`Migration checksum mismatch: ${filename}`);
        return;
      }
      // Each statement carries no user input; delimiter is explicit to support both PG adapters.
      for (const statement of sql
        .split("\n-- statement\n")
        .filter((s) => s.trim()))
        await tx.query(statement);
      await tx.query(
        "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
        [filename, checksum],
      );
    });
  }
}
