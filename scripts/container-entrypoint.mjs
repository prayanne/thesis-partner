import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

try {
  if (!process.env.DATABASE_URL && process.env.POSTGRES_PASSWORD_FILE) {
    const password = (
      await readFile(process.env.POSTGRES_PASSWORD_FILE, "utf8")
    ).trim();
    if (!password) throw new Error("Empty database credential");
    const databaseHost = process.env.POSTGRES_HOST ?? "postgres";
    if (!/^[a-zA-Z0-9.-]+$/.test(databaseHost))
      throw new Error("Invalid database host");
    process.env.DATABASE_URL = `postgres://thesis:${encodeURIComponent(password)}@${databaseHost}:5432/thesis`;
  }
  const mode = process.argv[2] ?? "web";
  const commands = {
    dev: [
      "node_modules/next/dist/bin/next",
      "dev",
      "apps/web",
      "--hostname",
      "127.0.0.1",
    ],
    web: ["apps/web/.next/standalone/apps/web/server.js"],
    worker: ["--import", "tsx", "apps/worker/src/index.ts"],
    migrate: ["--import", "tsx", "packages/db/src/migrate.ts"],
    seed: ["--import", "tsx", "packages/db/src/seed.ts"],
    "test-native": [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/db-native.test.ts",
    ],
  };
  if (!Object.hasOwn(commands, mode)) throw new Error("Unknown process mode");
  const child = spawn(process.execPath, commands[mode], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(mode === "test-native"
        ? {
            TEST_DATABASE_URL: process.env.DATABASE_URL,
            XDG_DATA_HOME: "/tmp/thesis-test-data",
          }
        : {}),
      HOSTNAME: "0.0.0.0",
      PORT: "3000",
    },
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    console.error("Application process could not start.");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
} catch {
  console.error(
    "Container bootstrap failed. Check secret mounts and process mode; credential values are never printed.",
  );
  process.exitCode = 1;
}
