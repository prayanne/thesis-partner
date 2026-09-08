import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const build = path.resolve(process.argv[2] ?? "apps/web/.next");
const privateFiles = [
  "master.key",
  "bootstrap-token",
  "postgres-password",
  "secrets.enc.json",
  "sessions.json",
  "access-tokens.json",
];
const forbiddenNames = new Set(privateFiles);
const privateValues = [];
for (const name of privateFiles.slice(0, 3)) {
  try {
    const value = (await readFile(path.resolve("data", name), "utf8")).trim();
    if (value.length >= 24) privateValues.push(Buffer.from(value));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
let count = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "dev") await inspect(file);
      continue;
    }
    if (
      forbiddenNames.has(entry.name) ||
      /^\.env(?:\.|$)/.test(entry.name) ||
      entry.name.endsWith(".pdf")
    )
      throw new Error("Private runtime file was included in the build.");
    if (/\.(?:m?js|cjs|json|map|txt|html)$/.test(entry.name)) {
      const bytes = await readFile(file);
      count++;
      if (privateValues.some((value) => bytes.includes(value)))
        throw new Error("Private runtime value was included in a build asset.");
    } else if (privateValues.length) {
      const bytes = await readFile(file);
      if (privateValues.some((value) => bytes.includes(value)))
        throw new Error(
          "Private runtime value was included in a binary build asset.",
        );
    }
  }
}
await inspect(build);
console.log(
  `Build boundary passed: ${count} text assets inspected; no private runtime files or bootstrap values included.`,
);
