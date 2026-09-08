import { execFileSync } from "node:child_process";
import {
  chmod,
  link,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCredentialImport } from "../scripts/import-credentials";
import {
  atomicPrivateWrite,
  credentialStatus,
  defaultConfig,
  importProviderCredential,
  readConfig,
  readCredential,
  runtimePaths,
  updateConfig,
} from "../packages/security/src/index";

const faults = vi.hoisted(() => ({ configRename: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      if (faults.configRename && to.endsWith("/config.json"))
        throw new Error("synthetic rename failure");
      return fs.rename(from, to);
    },
  };
});

let workspace: string;
const previousEnv = { ...process.env };
const key = "synthetic-openai-credential-not-a-real-key";
const otherKey = "synthetic-rotated-credential-not-a-real-key";
const args = ["--from", ".env", "--provider", "openai", "--confirm-write"];
function git(args: string[]) {
  return execFileSync("git", ["-C", workspace, ...args], { stdio: "pipe" });
}
async function source(contents = `OPENAI_API_KEY=${key}\n`) {
  await writeFile(path.join(workspace, ".env"), contents, { mode: 0o600 });
}
beforeEach(async () => {
  workspace = await mkdtemp(
    path.join(await realpath(tmpdir()), "thesis-import-"),
  );
  process.env.APP_DATA_DIR = path.join(workspace, "data");
  delete process.env.CONFIG_DIR;
  delete process.env.MASTER_KEY_FILE;
  delete process.env.CONTAINER_RUNTIME;
  git(["init", "--quiet"]);
  await writeFile(
    path.join(workspace, ".gitignore"),
    ".env\n.env.local\ndata/\n",
  );
  await atomicPrivateWrite(runtimePaths().masterKey, "34".repeat(32));
  await atomicPrivateWrite(
    path.join(runtimePaths().config, "config.json"),
    JSON.stringify(defaultConfig()),
  );
});
afterEach(async () => {
  faults.configRename = false;
  vi.unstubAllGlobals();
  process.env = { ...previousEnv };
  await rm(workspace, { recursive: true, force: true });
});

describe("explicit manual credential import", () => {
  it("runs the real CLI entrypoint against an isolated repository without printing its synthetic key", async () => {
    await source();
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        path.resolve("scripts/import-credentials.ts"),
        ...args,
      ],
      {
        cwd: workspace,
        env: process.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(output).toContain("Imported: OPENAI_API_KEY");
    expect(output).not.toContain(key);
    const config = await readConfig();
    expect(await readCredential(config.providers[0].credentialRef!)).toBe(key);
    expect(config.network.localOnly).toBe(true);
    expect(config.ai.paidAiEnabled).toBe(false);
  });
  it("requires confirmation before even reading the env file", async () => {
    await expect(
      runCredentialImport([], workspace, () => {}),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(await credentialStatus()).toEqual({});
    expect((await readConfig()).revision).toBe(1);
  });
  it("imports only the selected key, preserves settings and source bytes, and never calls fetch", async () => {
    const text = `# private\nexport OPENAI_API_KEY='${key}'\nANTHROPIC_API_KEY=${otherKey}\nAPP_DATA_DIR=/ignored-path\nNEXT_PUBLIC_API_KEY=do-not-import\n`;
    await source(text);
    const before = await readConfig();
    const fetch = vi.fn(() => {
      throw new Error("network forbidden");
    });
    vi.stubGlobal("fetch", fetch);
    const output: string[] = [];
    await runCredentialImport(args, workspace, (line) => output.push(line));
    const after = await readConfig();
    const ref = after.providers[0].credentialRef!;
    expect(await readCredential(ref)).toBe(key);
    expect(after).toEqual({
      ...before,
      revision: 2,
      providers: before.providers.map((p) =>
        p.id === "openai" ? { ...p, credentialRef: ref } : p,
      ),
    });
    expect(Object.keys(await credentialStatus())).toEqual([ref]);
    expect(await readFile(path.join(workspace, ".env"), "utf8")).toBe(text);
    expect(process.env.APP_DATA_DIR).toBe(path.join(workspace, "data"));
    expect(fetch).not.toHaveBeenCalled();
    const encryptedFile = path.join(runtimePaths().config, "secrets.enc.json");
    expect(await readFile(encryptedFile, "utf8")).not.toContain(key);
    expect((await stat(encryptedFile)).mode & 0o777).toBe(0o600);
    expect(output.join("\n")).not.toContain(key);
    expect(output.join("\n")).not.toContain(otherKey);
  });
  it("makes repeated import idempotent and refuses an accidental overwrite", async () => {
    await source();
    await runCredentialImport(args, workspace, () => {});
    const original = await credentialStatus();
    await runCredentialImport(args, workspace, () => {});
    expect(await credentialStatus()).toEqual(original);
    expect((await readConfig()).revision).toBe(2);
    await source(`OPENAI_API_KEY=${otherKey}\n`);
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "CREDENTIAL_EXISTS" });
    expect(await credentialStatus()).toEqual(original);
    await runCredentialImport([...args, "--replace"], workspace, () => {});
    const config = await readConfig();
    expect(config.revision).toBe(3);
    expect(await readCredential(config.providers[0].credentialRef!)).toBe(
      otherKey,
    );
    expect(await readCredential(Object.keys(original)[0])).toBe(key);
  });
  it("supports Anthropic independently and does not overwrite existing user policy", async () => {
    await updateConfig(
      {
        general: { displayName: "Local owner" },
        ai: { paidAiEnabled: true, maxOutputTokens: 512 },
        network: { localOnly: false, allowExternalAi: true },
      },
      1,
    );
    await source(`ANTHROPIC_API_KEY=${otherKey}\n`);
    await runCredentialImport(
      ["--provider", "anthropic", "--confirm-write"],
      workspace,
      () => {},
    );
    const config = await readConfig();
    expect(config.ai.paidAiEnabled).toBe(true);
    expect(config.ai.maxOutputTokens).toBe(512);
    expect(config.general.displayName).toBe("Local owner");
    expect(config.network.allowExternalAi).toBe(true);
    expect(config.providers.every((p) => !p.enabled)).toBe(true);
    expect(config.providers[0].credentialRef).toBeUndefined();
    expect(await readCredential(config.providers[1].credentialRef!)).toBe(
      otherKey,
    );
  });
  it("requires disabling the provider before replacement can affect new requests", async () => {
    const providers = defaultConfig().providers;
    providers[0].enabled = true;
    await updateConfig({ providers }, 1);
    await expect(
      importProviderCredential("openai", key, true),
    ).rejects.toMatchObject({ code: "PROVIDER_ENABLED" });
    expect(await credentialStatus()).toEqual({});
  });
  it("serializes concurrent imports and preserves both provider references", async () => {
    await Promise.all([
      importProviderCredential("openai", key),
      importProviderCredential("anthropic", otherKey),
    ]);
    const config = await readConfig();
    expect(config.revision).toBe(3);
    expect(await readCredential(config.providers[0].credentialRef!)).toBe(key);
    expect(await readCredential(config.providers[1].credentialRef!)).toBe(
      otherKey,
    );
  });
  it("preserves the previous reference and key if the staged config swap fails", async () => {
    await importProviderCredential("openai", key);
    const before = await readConfig();
    faults.configRename = true;
    await expect(
      importProviderCredential("openai", otherKey, true),
    ).rejects.toMatchObject({ code: "IMPORT_INCOMPLETE" });
    expect(await readConfig()).toEqual(before);
    expect(await readCredential(before.providers[0].credentialRef!)).toBe(key);
    expect(Object.keys(await credentialStatus())).toHaveLength(2);
  });
  it("rejects tracked and unignored env files", async () => {
    await source();
    git(["add", "--force", ".env"]);
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "UNSAFE_SOURCE" });
    git(["rm", "--cached", "--force", ".env"]);
    await writeFile(path.join(workspace, ".gitignore"), "data/\n");
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "UNSAFE_SOURCE" });
    expect(await credentialStatus()).toEqual({});
  });
  it("supports an explicitly selected .env.local without process environment fallback", async () => {
    await writeFile(
      path.join(workspace, ".env.local"),
      `OPENAI_API_KEY=${key}\n`,
      { mode: 0o600 },
    );
    process.env.OPENAI_API_KEY = otherKey;
    await runCredentialImport(
      ["--from", ".env.local", "--confirm-write"],
      workspace,
      () => {},
    );
    const config = await readConfig();
    expect(await readCredential(config.providers[0].credentialRef!)).toBe(key);
    expect(process.env.OPENAI_API_KEY).toBe(otherKey);
  });
  it("rejects unsafe destination permissions, links and tracked files before importing", async () => {
    await source();
    const configFile = path.join(runtimePaths().config, "config.json");
    await chmod(runtimePaths().masterKey, 0o644);
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "UNSAFE_DESTINATION" });
    await chmod(runtimePaths().masterKey, 0o600);
    await link(
      runtimePaths().masterKey,
      path.join(workspace, "master-hardlink"),
    );
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "UNSAFE_DESTINATION" });
    await rm(path.join(workspace, "master-hardlink"));
    git(["add", "--force", "data/config/config.json"]);
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "UNSAFE_DESTINATION" });
    git(["rm", "--cached", "--force", "data/config/config.json"]);
    await rm(configFile);
    await symlink(runtimePaths().masterKey, configFile);
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "UNSAFE_DESTINATION" });
    expect(await credentialStatus()).toEqual({});
  });
  it("rejects custom Git-ignored destinations that are not excluded from Docker and Next builds", async () => {
    await source();
    const custom = path.join(workspace, "private-workspace");
    await writeFile(
      path.join(workspace, ".git", "info", "exclude"),
      "private-workspace/\n",
    );
    await atomicPrivateWrite(path.join(custom, "key.bin"), "56".repeat(32));
    await atomicPrivateWrite(
      path.join(custom, "config", "config.json"),
      JSON.stringify(defaultConfig()),
    );
    process.env.CONFIG_DIR = path.join(custom, "config");
    process.env.MASTER_KEY_FILE = path.join(custom, "key.bin");
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "UNSAFE_DESTINATION" });
    expect(await credentialStatus()).toEqual({});
    expect((await readConfig()).revision).toBe(1);
  });
  it("rejects broadly readable source files, hard links and symlinks", async () => {
    await source();
    const file = path.join(workspace, ".env");
    await chmod(file, 0o644);
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "PRIVATE_SOURCE_REQUIRED" });
    await chmod(file, 0o600);
    await link(file, path.join(workspace, "hardlink"));
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "PRIVATE_SOURCE_REQUIRED" });
    await rm(file);
    await symlink(path.join(workspace, "hardlink"), file);
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "UNSAFE_SOURCE" });
    expect(await credentialStatus()).toEqual({});
  });
  it("rejects unsafe options, missing keys, empty or multiline values, and oversized files without leaking contents", async () => {
    await expect(
      runCredentialImport(["--key", key], workspace, () => {}),
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    await expect(
      runCredentialImport(
        ["--from", "../.env", "--confirm-write"],
        workspace,
        () => {},
      ),
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    await source("OPENAI_API_KEY=\n");
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "KEY_NOT_FOUND" });
    await source(`OPENAI_API_KEY="${key}\n${key}"\n`);
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    await source("#".repeat(65537));
    await expect(
      runCredentialImport(args, workspace, () => {}),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT" });
    expect(await credentialStatus()).toEqual({});
  });
});
