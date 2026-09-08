import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  realpath,
  readFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  atomicPrivateWrite,
  authorize,
  createSession,
  credentialStatus,
  defaultConfig,
  deleteCredential,
  errorResponse,
  issueAccessToken,
  listAccessTokens,
  readConfig,
  readCredential,
  readJson,
  refreshPrincipal,
  requireSession,
  revokeAccessToken,
  revokeSession,
  runtimePaths,
  updateConfig,
  validateRequestOrigin,
  writeCredential,
} from "../packages/security/src/index";

let directory: string;
const previousEnv = { ...process.env };
const origin = "http://127.0.0.1:3000";
function request(options: RequestInit = {}) {
  return new Request(origin + "/api/v1/papers", options);
}
beforeEach(async () => {
  directory = await mkdtemp(
    path.join(await realpath(tmpdir()), "thesis-security-"),
  );
  process.env.APP_DATA_DIR = directory;
  delete process.env.CONFIG_DIR;
  delete process.env.MASTER_KEY_FILE;
  delete process.env.CONTAINER_RUNTIME;
  process.env.APP_ORIGIN = origin;
  await atomicPrivateWrite(runtimePaths().masterKey, "12".repeat(32));
  await atomicPrivateWrite(
    runtimePaths().bootstrap,
    "test-bootstrap-token-not-an-api-key",
  );
});
afterEach(async () => {
  process.env = { ...previousEnv };
  await rm(directory, { recursive: true, force: true });
});

describe("private local configuration", () => {
  it("defaults to no external processing or paid providers", async () => {
    const config = await readConfig();
    expect(config.network.localOnly).toBe(true);
    expect(config.ai.paidAiEnabled).toBe(false);
    expect(config.providers.every((p) => !p.enabled)).toBe(true);
    expect(config.providers.find((p) => p.id === "ollama")?.endpoint).toContain(
      "127.0.0.1",
    );
  });
  it("persists partial updates with revision conflict protection", async () => {
    const next = await updateConfig(
      { general: { displayName: "Local reader" } },
      1,
    );
    expect(next.revision).toBe(2);
    expect((await readConfig()).general.displayName).toBe("Local reader");
    await expect(
      updateConfig({ reading: { scale: 2 } }, 1),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(
      (await stat(path.join(runtimePaths().config, "config.json"))).mode &
        0o777,
    ).toBe(0o600);
  });
  it("serializes concurrent writes; exactly one expected revision wins", async () => {
    const results = await Promise.allSettled([
      updateConfig({ reading: { scale: 1.2 } }, 1),
      updateConfig({ reading: { scale: 1.4 } }, 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await readConfig()).revision).toBe(2);
  });
  it("rejects schema, endpoint, provider identity and prototype bypasses", async () => {
    await expect(updateConfig({ revision: 999 }, 1)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      updateConfig(JSON.parse('{"__proto__":{"bad":true}}'), 1),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const providers = defaultConfig().providers;
    providers[0].endpoint = "https://attacker.example/v1";
    await expect(updateConfig({ providers }, 1)).rejects.toMatchObject({
      code: "UNSAFE_ENDPOINT",
    });
    await expect(
      updateConfig({ providers: [providers[1], providers[1]] }, 1),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("encrypts credentials, exposes only status, detects tampering and deletes", async () => {
    const secret = "synthetic-provider-credential-for-tests";
    await writeCredential("openai", secret);
    const file = path.join(runtimePaths().config, "secrets.enc.json");
    expect(await readFile(file, "utf8")).not.toContain(secret);
    expect(await readCredential("openai")).toBe(secret);
    expect(JSON.stringify(await credentialStatus())).not.toContain(secret);
    const store = JSON.parse(await readFile(file, "utf8"));
    store.entries.openai.tag = Buffer.alloc(16).toString("base64");
    await atomicPrivateWrite(file, JSON.stringify(store));
    await expect(readCredential("openai")).rejects.toMatchObject({
      code: "SECRET_UNREADABLE",
    });
    await deleteCredential("openai");
    expect(await readCredential("openai")).toBeUndefined();
  });
  it("does not use a rotated credential for an older queued request", async () => {
    const old = await writeCredential("openai", "synthetic-old-credential");
    await writeCredential("openai", "synthetic-new-credential");
    await expect(readCredential("openai", old.revision)).rejects.toMatchObject({
      code: "INPUT_STALE",
    });
    await deleteCredential("openai");
    await expect(readCredential("openai", old.revision)).rejects.toMatchObject({
      code: "INPUT_STALE",
    });
  });
  it("invalidates local isolation acknowledgement when an endpoint changes", async () => {
    const providers = defaultConfig().providers;
    providers[2].localIsolationVerified = true;
    const acknowledged = await updateConfig({ providers }, 1);
    expect(acknowledged.providers[2].localIsolationVerified).toBe(true);
    acknowledged.providers[2].endpoint = "http://localhost:11434/v1";
    const changed = await updateConfig(
      { providers: acknowledged.providers },
      2,
    );
    expect(changed.providers[2].localIsolationVerified).toBe(false);
  });
  it("rejects symbolic links instead of reading or replacing outside files", async () => {
    await updateConfig({}, 1);
    const file = path.join(runtimePaths().config, "config.json");
    await rm(file);
    await symlink(runtimePaths().bootstrap, file);
    await expect(readConfig()).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    await expect(atomicPrivateWrite(file, "{}")).rejects.toMatchObject({
      code: "UNSAFE_PATH",
    });
    expect(await readFile(runtimePaths().bootstrap, "utf8")).toBe(
      "test-bootstrap-token-not-an-api-key",
    );
  });
});
describe("local session and scoped tokens", () => {
  it("rejects rebinding hosts, foreign origins and untrusted ports", () => {
    expect(() =>
      validateRequestOrigin(
        request({ headers: { host: "attacker.example:3000" } }),
      ),
    ).toThrow();
    expect(() =>
      validateRequestOrigin(
        request({ headers: { origin: "https://attacker.example" } }),
      ),
    ).toThrow();
    expect(() =>
      validateRequestOrigin(new Request("http://localhost:3001/api")),
    ).toThrow();
    expect(() => validateRequestOrigin(request())).not.toThrow();
  });
  it("authenticates signed cookie but refuses forged cookie and absent mutation Origin", async () => {
    const session = await createSession(
      request({ method: "POST" }),
      "test-bootstrap-token-not-an-api-key",
    );
    const cookie = `thesis_session=${session}`;
    expect((await authorize(request({ headers: { cookie } }))).kind).toBe(
      "session",
    );
    await expect(
      authorize(request({ method: "POST", headers: { cookie } })),
    ).rejects.toMatchObject({ code: "INVALID_ORIGIN" });
    expect(
      (
        await authorize(
          request({ method: "POST", headers: { cookie, origin } }),
        )
      ).kind,
    ).toBe("session");
    await expect(
      authorize(request({ headers: { cookie: cookie + "forged" } })),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("hashes token persistence, defaults read-only, enforces scopes and revocation", async () => {
    const issued = await issueAccessToken("Test Agent");
    const authorized = request({
      headers: { authorization: `Bearer ${issued.token}` },
    });
    const principal = await authorize(authorized, "library:read");
    expect(principal.kind).toBe("token");
    expect((await refreshPrincipal(principal)).tokenId).toBe(issued.id);
    await expect(authorize(authorized, "library:write")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(requireSession(authorized)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      await readFile(
        path.join(runtimePaths().config, "access-tokens.json"),
        "utf8",
      ),
    ).not.toContain(issued.token);
    expect(JSON.stringify(await listAccessTokens())).not.toContain("hash");
    await revokeAccessToken(issued.id);
    await expect(authorize(authorized)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(refreshPrincipal(principal)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
  it("revalidates queued session work after logout and denies untracked wildcard principals", async () => {
    const session = await createSession(
      request({ method: "POST" }),
      "test-bootstrap-token-not-an-api-key",
    );
    const authenticated = request({
      headers: { cookie: `thesis_session=${session}` },
    });
    const principal = await authorize(authenticated);
    expect((await refreshPrincipal(principal)).sessionId).toBeTruthy();
    await revokeSession(principal);
    await expect(refreshPrincipal(principal)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(authorize(authenticated)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      refreshPrincipal({ kind: "session", scopes: ["*"] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("limits JSON bodies and suppresses internal error details", async () => {
    await expect(
      readJson(
        request({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "abc" }),
        }),
        3,
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    const response = errorResponse(new Error("synthetic-secret-value"));
    expect(await response.text()).not.toContain("synthetic-secret-value");
  });
});
