import { randomBytes } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import {
  atomicPrivateWrite,
  defaultConfig,
  privateDirectory,
  runtimePaths,
} from "../packages/security/src/index";

async function createOnce(file: string, contents: () => string) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Unsafe existing private file.");
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(contents());
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}
async function main() {
  const paths = runtimePaths();
  await privateDirectory(paths.data);
  await privateDirectory(paths.config);
  await privateDirectory(paths.artifacts);
  await privateDirectory(path.dirname(paths.masterKey));
  await createOnce(
    paths.masterKey,
    () => randomBytes(32).toString("hex") + "\n",
  );
  await createOnce(
    paths.bootstrap,
    () => randomBytes(32).toString("base64url") + "\n",
  );
  await createOnce(
    path.join(paths.config, "config.json"),
    () => JSON.stringify(defaultConfig(), null, 2) + "\n",
  );
  await createOnce(
    path.join(paths.data, "postgres-password"),
    () => randomBytes(32).toString("hex") + "\n",
  );
  // No provider credentials are created, imported, or printed by local setup.
  console.log(
    "Local settings initialized; existing settings and secrets were preserved.",
  );
  console.log(`Browser login token file: ${paths.bootstrap}`);
  console.log(`Keep the master key separately backed up: ${paths.masterKey}`);
  console.log(
    "API credentials remain unset. Enter them only through authenticated Configuration.",
  );
}
main().catch(() => {
  console.error(
    "Local setup failed. Check private path ownership and existing file types. No secret values were printed.",
  );
  process.exitCode = 1;
});
