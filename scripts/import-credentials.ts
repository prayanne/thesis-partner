import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import {
  AppError,
  importProviderCredential,
  runtimePaths,
} from "../packages/security/src/index";

const variables = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
} as const;
const help = `Import a manually issued API key without making any network requests.
Usage: npm run credentials:import -- --from .env --provider openai --confirm-write
Options: --from .env|.env.local  --provider openai|anthropic  --replace  --help
--confirm-write explicitly authorizes writing the encrypted store and config reference.
The provider must be disabled. Existing different keys require --replace.
The source stays unchanged and must be Git-ignored, owner-only, and not a symlink.
Network, paid-use, model and provider enablement settings are never enabled by import.`;

function git(workspace: string, args: string[]) {
  try {
    return execFileSync("git", ["-C", workspace, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new AppError(
      "UNSAFE_SOURCE",
      "Run from the repository root and use an untracked, Git-ignored .env or .env.local.",
    );
  }
}

async function validateDestination(workspace: string) {
  const root = await realpath(workspace);
  const paths = runtimePaths();
  // Git ignore alone does not imply Docker/Next build exclusion. Keep this CLI
  // on the exact private layout already excluded by both build configurations.
  if (
    paths.config !== path.join(root, "data", "config") ||
    paths.masterKey !== path.join(root, "data", "master.key")
  )
    throw new AppError(
      "UNSAFE_DESTINATION",
      "This importer requires the default data/config and data/master.key layout excluded from Git and builds. Custom layouts require separate Configuration setup.",
    );
  for (const file of [
    paths.masterKey,
    path.join(paths.config, "config.json"),
    path.join(paths.config, "secrets.enc.json"),
  ]) {
    const relative = path.relative(root, file);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === ".." ||
      path.isAbsolute(relative) ||
      git(root, ["ls-files", "--", relative]) ||
      !git(root, ["check-ignore", "--", relative])
    )
      throw new AppError(
        "UNSAFE_DESTINATION",
        "Import destinations must be untracked, Git-ignored private files inside this workspace. Use Configuration for other layouts.",
      );
    let current = root;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if (
          current === file &&
          file.endsWith("/secrets.enc.json") &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        )
          continue;
        throw new AppError(
          "SETUP_REQUIRED",
          "Run local setup before importing credentials.",
        );
      }
      if (
        info.isSymbolicLink() ||
        (process.getuid && info.uid !== process.getuid()) ||
        (info.mode & 0o077) !== 0 ||
        (current === file
          ? !info.isFile() || info.nlink !== 1
          : !info.isDirectory())
      )
        throw new AppError(
          "UNSAFE_DESTINATION",
          "Private destination files and directories must be owner-only and must not use symbolic or hard links.",
        );
    }
  }
}

async function readSource(workspace: string, filename: string) {
  // Never source a shell file or load its variables into the process environment.
  const root = await realpath(workspace);
  if ((await realpath(git(root, ["rev-parse", "--show-toplevel"]))) !== root)
    throw new AppError("UNSAFE_SOURCE", "Run from the repository root.");
  if (
    git(root, ["ls-files", "--", filename]) ||
    !git(root, ["check-ignore", "--", filename])
  )
    throw new AppError(
      "UNSAFE_SOURCE",
      "The source must be untracked and Git-ignored.",
    );
  const file = path.join(root, filename);
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink())
    throw new AppError(
      "UNSAFE_SOURCE",
      "The source must be a regular file, not a symbolic link.",
    );
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.ino !== before.ino ||
      stat.dev !== before.dev ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new AppError(
        "PRIVATE_SOURCE_REQUIRED",
        "The env file must be owned by you with owner-only permissions (chmod 600) and no hard links.",
      );
    if (stat.size > 65536)
      throw new AppError(
        "INVALID_IMPORT",
        "The env file exceeds the 64 KiB import limit.",
      );
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536)
      throw new AppError(
        "INVALID_IMPORT",
        "The env file exceeds the 64 KiB import limit.",
      );
    return parseEnv(buffer.subarray(0, bytesRead).toString("utf8"));
  } finally {
    await handle.close();
  }
}

export async function runCredentialImport(
  args: string[],
  workspace = process.cwd(),
  log: (message: string) => void = console.log,
) {
  let options;
  try {
    options = parseArgs({
      args,
      options: {
        from: { type: "string", default: ".env" },
        provider: { type: "string", default: "openai" },
        "confirm-write": { type: "boolean", default: false },
        replace: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    }).values;
  } catch {
    // Never echo argv: a user might accidentally pass the secret as an option.
    throw new AppError(
      "INVALID_OPTIONS",
      "Invalid options. Use --help; never pass a key on the command line.",
    );
  }
  if (options.help) {
    log(help);
    return;
  }
  if (
    ![".env", ".env.local"].includes(options.from!) ||
    !Object.hasOwn(variables, options.provider!)
  )
    throw new AppError(
      "INVALID_OPTIONS",
      "Use --from .env or .env.local and --provider openai or anthropic.",
    );
  const provider = options.provider as keyof typeof variables;
  if (!options["confirm-write"])
    throw new AppError(
      "CONFIRMATION_REQUIRED",
      "No key was read or written. Add --confirm-write to authorize the local encrypted import.",
    );
  await validateDestination(workspace);
  const contents = await readSource(workspace, options.from!);
  const value = contents[variables[provider]];
  if (!value)
    throw new AppError(
      "KEY_NOT_FOUND",
      `The selected file does not contain a non-empty ${variables[provider]}.`,
    );
  const result = await importProviderCredential(
    provider,
    value,
    options.replace,
  );
  log(
    `${result.changed ? "Imported" : "Unchanged"}: ${variables[provider]}; credential reference: ${result.credentialRef}; config revision: ${result.configRevision}.`,
  );
  log(
    `Encrypted destination: ${path.join(runtimePaths().config, "secrets.enc.json")}`,
  );
  log(
    "No API request was made. The source file was left unchanged; existing network and paid-use settings were preserved. Reload Configuration before editing settings.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCredentialImport(process.argv.slice(2)).catch((error: unknown) => {
    // File-system/parser errors can contain source bytes or user-supplied paths.
    console.error(
      error instanceof AppError
        ? `${error.code}: ${error.message}`
        : "IMPORT_FAILED: Check local setup, file ownership and source format. No secret values were printed.",
    );
    process.exitCode = 1;
  });
}
