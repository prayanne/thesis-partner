import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const files = execFileSync("git", [
  "diff",
  "--cached",
  "--name-only",
  "--diff-filter=ACMR",
  "-z",
])
  .toString()
  .split("\0")
  .filter(Boolean);
const values = [];
for (const name of ["bootstrap-token", "master.key", "postgres-password"]) {
  try {
    const value = (await readFile(path.resolve("data", name), "utf8")).trim();
    if (value.length >= 24) values.push(Buffer.from(value));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
for (const file of files) {
  if (
    /^(?:data|library|config|artifacts|backups|model-cache|test-results)\//.test(
      file,
    ) ||
    /(?:^|\/)(?:master\.key|bootstrap-token|postgres-password|secrets\.enc\.json|sessions\.json|access-tokens\.json)$/.test(
      file,
    ) ||
    /\.pdf$/i.test(file) ||
    (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".example"))
  )
    throw new Error(
      "A private runtime path was staged. Unstage it before committing.",
    );
  const bytes = execFileSync("git", ["show", `:${file}`], {
    maxBuffer: 32 * 1024 * 1024,
  });
  if (values.some((value) => bytes.includes(value)))
    throw new Error("A private runtime value was staged. Do not commit.");
}
console.log(
  `Git boundary passed: ${files.length} staged files; no private runtime paths or known bootstrap values.`,
);
