import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type Row = Record<string, any>;
export interface Database {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function wrap(sql: any, transactional = false): Database {
  return {
    query: async (text, params = []) => [...(await sql.unsafe(text, params))],
    transaction: (fn) =>
      transactional
        ? fn(wrap(sql, true))
        : sql.begin((tx: any) => fn(wrap(tx, true))),
    close: async () => {
      if (!transactional) await sql.end();
    },
  };
}

let database: Database | undefined;
let sqlClient: ReturnType<typeof postgres> | undefined;
const postgresOptions = {
  max: 5,
  connect_timeout: 5,
  idle_timeout: 20,
  types: {
    json: {
      to: 114,
      from: [114, 3802],
      serialize: (value: unknown) =>
        typeof value === "string" ? value : JSON.stringify(value),
      parse: (value: string) => JSON.parse(value),
    },
  },
};
export function createPostgresDatabase(url: string): Database {
  return wrap(postgres(url, postgresOptions));
}
function sqlConnection() {
  if (!process.env.DATABASE_URL)
    throw Object.assign(new Error("PostgreSQL DATABASE_URL is required."), {
      code: "DATABASE_NOT_CONFIGURED",
      status: 503,
    });
  return (sqlClient ??= postgres(process.env.DATABASE_URL, postgresOptions));
}
export function getDatabase(): Database {
  return (database ??= wrap(sqlConnection()));
}
export function getDrizzleDatabase() {
  return drizzle(sqlConnection(), { schema });
}
