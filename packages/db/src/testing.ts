import type { Database } from "./client";
export type { Database } from "./client";
/** Explicit test adapter only, excluded from the production barrel. */
export async function createTestDatabase(path?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(path);
  const adapt = (client: any, inTransaction = false): Database => ({
    query: async (text, params = []) => (await client.query(text, params)).rows,
    transaction: (fn) =>
      inTransaction
        ? fn(adapt(client, true))
        : pg.transaction((tx) => fn(adapt(tx, true))),
    close: () => pg.close(),
  });
  return adapt(pg);
}
