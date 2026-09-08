import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const providerSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    adapterId: z.enum(["openai", "anthropic", "ollama", "lmstudio"]),
    enabled: z.boolean(),
    endpoint: z.string().url(),
    modelId: z.string().max(200),
    modelRevision: z.string().max(200),
    embeddingModelId: z.string().max(200),
    localIsolationVerified: z.boolean().default(false),
    credentialRef: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .optional(),
  })
  .strict();
export const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().positive(),
    general: z
      .object({
        displayName: z.string().max(80),
        language: z.string().max(16),
        timeZone: z.string().refine((v) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: v });
            return true;
          } catch {
            return false;
          }
        }, "Invalid time zone"),
      })
      .strict(),
    network: z
      .object({
        localOnly: z.boolean(),
        allowExternalAi: z.boolean(),
        allowExternalTranslation: z.boolean(),
        allowExternalMetadata: z.boolean(),
      })
      .strict(),
    ai: z
      .object({
        paidAiEnabled: z.boolean(),
        maxOutputTokens: z.number().int().min(1).max(32768),
        monthlyBudgetUsd: z.number().nonnegative().nullable(),
        defaults: z
          .object({
            summary: z.string().nullable(),
            chat: z.string().nullable(),
            analysis: z.string().nullable(),
            embedding: z.string().nullable(),
          })
          .strict(),
      })
      .strict(),
    translation: z
      .object({
        enabled: z.boolean(),
        targetLanguage: z.string().min(2).max(16),
        monthlyCharacterLimit: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    providers: z.array(providerSchema).max(16),
    library: z.object({ rootId: z.literal("papers") }).strict(),
    reading: z.object({ scale: z.number().min(0.25).max(4) }).strict(),
  })
  .strict();
export type AppConfig = z.infer<typeof configSchema>;
export type ProviderConfig = AppConfig["providers"][number];
export type Principal = {
  kind: "session" | "token";
  scopes: string[];
  tokenId?: string;
  sessionId?: string;
  sessionExpiresAt?: number;
};

export function runtimePaths() {
  const data = path.resolve(
    /* turbopackIgnore: true */ process.env.APP_DATA_DIR ?? "./data",
  );
  return {
    data,
    config: path.resolve(
      /* turbopackIgnore: true */ process.env.CONFIG_DIR ??
        path.join(data, "config"),
    ),
    masterKey: path.resolve(
      /* turbopackIgnore: true */ process.env.MASTER_KEY_FILE ??
        path.join(data, "master.key"),
    ),
    bootstrap: path.join(data, "bootstrap-token"),
    library: path.resolve(
      /* turbopackIgnore: true */ process.env.PAPERS_DIR ?? "./library",
    ),
    artifacts: path.resolve(
      /* turbopackIgnore: true */ process.env.ARTIFACTS_DIR ??
        path.join(data, "artifacts"),
    ),
  };
}
export function defaultConfig(): AppConfig {
  const localHost =
    process.env.CONTAINER_RUNTIME === "1"
      ? "host.docker.internal"
      : "127.0.0.1";
  return {
    schemaVersion: 1,
    revision: 1,
    general: { displayName: "", language: "ko", timeZone: "Asia/Seoul" },
    network: {
      localOnly: true,
      allowExternalAi: false,
      allowExternalTranslation: false,
      allowExternalMetadata: false,
    },
    ai: {
      paidAiEnabled: false,
      maxOutputTokens: 2048,
      monthlyBudgetUsd: null,
      defaults: { summary: null, chat: null, analysis: null, embedding: null },
    },
    translation: {
      enabled: false,
      targetLanguage: "ko",
      monthlyCharacterLimit: null,
    },
    providers: [
      {
        id: "openai",
        adapterId: "openai",
        endpoint: "https://api.openai.com/v1",
      },
      {
        id: "anthropic",
        adapterId: "anthropic",
        endpoint: "https://api.anthropic.com/v1",
      },
      {
        id: "ollama",
        adapterId: "ollama",
        endpoint: `http://${localHost}:11434/v1`,
      },
      {
        id: "lmstudio",
        adapterId: "lmstudio",
        endpoint: `http://${localHost}:1234/v1`,
      },
    ].map((p) => ({
      ...p,
      adapterId: p.adapterId as ProviderConfig["adapterId"],
      enabled: false,
      modelId: "",
      modelRevision: "",
      embeddingModelId: "",
      localIsolationVerified: false,
    })),
    library: { rootId: "papers" },
    reading: { scale: 1 },
  };
}

function errno(error: unknown, code: string) {
  return (error as NodeJS.ErrnoException)?.code === code;
}
async function rejectSymlink(file: string) {
  try {
    if ((await lstat(file)).isSymbolicLink())
      throw new AppError(
        "UNSAFE_PATH",
        "Symbolic links are not allowed for private files.",
        400,
      );
  } catch (e) {
    if (!errno(e, "ENOENT")) throw e;
  }
}
export async function privateDirectory(directory: string) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    await rejectSymlink(current);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (e) {
      if (!errno(e, "EEXIST")) throw e;
    }
  }
  await chmod(absolute, 0o700);
}
async function readPrivate(file: string) {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const part of absolute
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    await rejectSymlink(current);
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile())
      throw new AppError("UNSAFE_PATH", "Expected a private regular file.");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
export async function atomicPrivateWrite(file: string, body: string) {
  await privateDirectory(path.dirname(file));
  await rejectSymlink(file);
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(12).toString("hex")}.tmp`,
  );
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(body, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, file);
  } catch (e) {
    await rm(temporary, { force: true });
    throw e;
  }
}
async function locked<T>(action: () => Promise<T>): Promise<T> {
  const root = runtimePaths().config;
  await privateDirectory(root);
  const lock = path.join(root, ".write-lock");
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (e) {
      if (!errno(e, "EEXIST")) throw e;
      if (attempt === 49)
        throw new AppError(
          "CONFIG_BUSY",
          "Configuration is locked; retry or inspect a stale lock after stopping the app.",
          409,
        );
      await new Promise((r) => setTimeout(r, 40));
      continue;
    }
    try {
      return await action();
    } finally {
      await rmdir(lock);
    }
  }
  throw new AppError("CONFIG_BUSY", "Configuration is busy.", 409);
}
export async function readConfig(): Promise<AppConfig> {
  try {
    return validateConfig(
      JSON.parse(
        await readPrivate(path.join(runtimePaths().config, "config.json")),
      ),
    );
  } catch (e) {
    if (errno(e, "ENOENT")) return defaultConfig();
    if (e instanceof AppError) throw e;
    throw new AppError(
      "CONFIG_INVALID",
      "Local configuration is invalid; inspect the file without exposing secrets.",
      503,
    );
  }
}
function validateConfig(value: unknown): AppConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      "VALIDATION_ERROR",
      "Invalid configuration fields.",
      422,
    );
  const config = parsed.data;
  if (
    new Set(config.providers.map((p) => p.id)).size !== config.providers.length
  )
    throw new AppError("VALIDATION_ERROR", "Provider IDs must be unique.", 422);
  for (const provider of config.providers) {
    const url = new URL(provider.endpoint);
    if (url.username || url.password || url.search || url.hash)
      throw new AppError(
        "UNSAFE_ENDPOINT",
        "Credentials and parameters are not allowed in provider endpoints.",
        422,
      );
    if (
      provider.adapterId === "openai" &&
      provider.endpoint !== "https://api.openai.com/v1"
    )
      throw new AppError(
        "UNSAFE_ENDPOINT",
        "OpenAI uses its fixed official endpoint.",
        422,
      );
    if (
      provider.adapterId === "anthropic" &&
      provider.endpoint !== "https://api.anthropic.com/v1"
    )
      throw new AppError(
        "UNSAFE_ENDPOINT",
        "Anthropic uses its fixed official endpoint.",
        422,
      );
    if (
      ["ollama", "lmstudio"].includes(provider.adapterId) &&
      (!["http:", "https:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]", "host.docker.internal"].includes(
          url.hostname,
        ) ||
        url.pathname !== "/v1")
    )
      throw new AppError(
        "UNSAFE_ENDPOINT",
        "Local AI must use a local host and /v1 endpoint.",
        422,
      );
  }
  for (const selected of Object.values(config.ai.defaults))
    if (selected && !config.providers.some((p) => p.id === selected))
      throw new AppError(
        "VALIDATION_ERROR",
        "Default provider does not exist.",
        422,
      );
  return config;
}
function mergeObject(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      [
        "__proto__",
        "constructor",
        "prototype",
        "schemaVersion",
        "revision",
      ].includes(key)
    )
      throw new AppError(
        "VALIDATION_ERROR",
        "Reserved configuration field.",
        422,
      );
    merged[key] =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
        ? mergeObject(
            merged[key] as Record<string, unknown>,
            value as Record<string, unknown>,
          )
        : value;
  }
  return merged;
}
export async function updateConfig(patch: unknown, expectedRevision: number) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new AppError(
      "VALIDATION_ERROR",
      "A configuration patch object is required.",
      422,
    );
  return locked(async () => {
    const previous = await readConfig();
    if (previous.revision !== expectedRevision)
      throw new AppError(
        "REVISION_CONFLICT",
        "Configuration changed; reload before saving.",
        409,
      );
    const next = validateConfig({
      ...mergeObject(previous, patch as Record<string, unknown>),
      revision: previous.revision + 1,
    });
    for (const provider of next.providers) {
      const old = previous.providers.find((p) => p.id === provider.id);
      if (
        !old ||
        old.adapterId !== provider.adapterId ||
        old.endpoint !== provider.endpoint
      )
        provider.localIsolationVerified = false;
    }
    await atomicPrivateWrite(
      path.join(runtimePaths().config, "config.json"),
      JSON.stringify(next, null, 2) + "\n",
    );
    return next;
  });
}
async function masterKey() {
  try {
    const text = (await readPrivate(runtimePaths().masterKey)).trim();
    if (!/^[a-f0-9]{64}$/.test(text)) throw new Error("invalid key");
    return Buffer.from(text, "hex");
  } catch {
    throw new AppError(
      "SETUP_REQUIRED",
      "Run local setup to configure the master key.",
      503,
    );
  }
}
type SecretEntry = {
  revision: string;
  iv: string;
  tag: string;
  ciphertext: string;
};
type SecretStore = { schemaVersion: 1; entries: Record<string, SecretEntry> };
async function secretStore(): Promise<SecretStore> {
  try {
    const parsed = JSON.parse(
      await readPrivate(path.join(runtimePaths().config, "secrets.enc.json")),
    );
    if (
      parsed.schemaVersion !== 1 ||
      !parsed.entries ||
      typeof parsed.entries !== "object" ||
      Array.isArray(parsed.entries)
    )
      throw new Error("invalid");
    return parsed;
  } catch (e) {
    if (errno(e, "ENOENT")) return { schemaVersion: 1, entries: {} };
    throw new AppError(
      "SECRET_STORE_INVALID",
      "Encrypted secret store is invalid.",
      503,
    );
  }
}
function credentialId(id: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
    throw new AppError("VALIDATION_ERROR", "Invalid credential ID.", 422);
}
export async function credentialStatus() {
  const store = await secretStore();
  return Object.fromEntries(
    Object.entries(store.entries).map(([id, entry]) => [
      id,
      { configured: true, revision: entry.revision },
    ]),
  );
}
export async function writeCredential(id: string, value: string) {
  credentialId(id);
  if (!value || value.length > 16384 || /[\r\n]/.test(value))
    throw new AppError(
      "VALIDATION_ERROR",
      "A valid credential value is required.",
      422,
    );
  return locked(async () => {
    const key = await masterKey(),
      store = await secretStore();
    const iv = randomBytes(12),
      revision = randomBytes(16).toString("hex");
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`thesis-partner:1:${id}:${revision}`));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    store.entries[id] = {
      revision,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    await atomicPrivateWrite(
      path.join(runtimePaths().config, "secrets.enc.json"),
      JSON.stringify(store, null, 2) + "\n",
    );
    return { configured: true, revision };
  });
}
export async function readCredential(
  id: string,
  expectedRevision?: string | null,
): Promise<string | undefined> {
  credentialId(id);
  const entry = (await secretStore()).entries[id];
  if (
    expectedRevision !== undefined &&
    (entry?.revision ?? null) !== expectedRevision
  )
    throw new AppError(
      "INPUT_STALE",
      "Credential changed; request a new generation.",
      409,
    );
  if (!entry) return undefined;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await masterKey(),
      Buffer.from(entry.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(`thesis-partner:1:${id}:${entry.revision}`));
    decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(entry.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(
      "SECRET_UNREADABLE",
      "Credential could not be decrypted with the current master key.",
      503,
    );
  }
}
export async function deleteCredential(id: string) {
  credentialId(id);
  await locked(async () => {
    const store = await secretStore();
    delete store.entries[id];
    await atomicPrivateWrite(
      path.join(runtimePaths().config, "secrets.enc.json"),
      JSON.stringify(store, null, 2) + "\n",
    );
  });
}

export function validateRequestOrigin(request: Request) {
  const configured = new URL(process.env.APP_ORIGIN ?? "http://127.0.0.1:3000");
  const port =
    configured.port || (configured.protocol === "https:" ? "443" : "80");
  const permitted = new Set(
    ["127.0.0.1", "localhost", "[::1]"].map(
      (host) =>
        `${configured.protocol}//${host}${(configured.protocol === "http:" && port === "80") || (configured.protocol === "https:" && port === "443") ? "" : ":" + port}`,
    ),
  );
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host") ?? requestUrl.host;
  if (!permitted.has(`${configured.protocol}//${host}`))
    throw new AppError(
      "INVALID_HOST",
      "Only the configured local origin is allowed.",
      403,
    );
  const origin = request.headers.get("origin");
  if (origin && !permitted.has(origin))
    throw new AppError(
      "INVALID_ORIGIN",
      "Cross-origin requests are not allowed.",
      403,
    );
}
function safeEqual(a: string, b: string) {
  const left = createHash("sha256").update(a).digest(),
    right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}
export const SESSION_COOKIE = "thesis_session";
type LocalSession = { id: string; expiresAt: number };
async function sessionStore(): Promise<LocalSession[]> {
  try {
    return z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-f0-9]{24}$/),
            expiresAt: z.number(),
          })
          .strict(),
      )
      .parse(
        JSON.parse(
          await readPrivate(path.join(runtimePaths().config, "sessions.json")),
        ),
      );
  } catch (error) {
    if (errno(error, "ENOENT")) return [];
    throw new AppError(
      "SESSION_STORE_INVALID",
      "Local session store is invalid.",
      503,
    );
  }
}
export async function revokeSession(principal: Principal) {
  if (principal.kind !== "session" || !principal.sessionId)
    throw new AppError(
      "FORBIDDEN",
      "An interactive local session is required.",
      403,
    );
  await locked(async () => {
    const sessions = (await sessionStore()).filter(
      (s) => s.id !== principal.sessionId && s.expiresAt > Date.now(),
    );
    await atomicPrivateWrite(
      path.join(runtimePaths().config, "sessions.json"),
      JSON.stringify(sessions) + "\n",
    );
  });
}
const loginAttempts = new Map<string, { count: number; until: number }>();
export async function createSession(request: Request, token: string) {
  validateRequestOrigin(request);
  const bucketKey = "local";
  const bucket = loginAttempts.get(bucketKey);
  if (bucket && bucket.until > Date.now() && bucket.count >= 10)
    throw new AppError(
      "RATE_LIMITED",
      "Too many login attempts; wait ten minutes.",
      429,
    );
  let expected: string;
  try {
    expected = (await readPrivate(runtimePaths().bootstrap)).trim();
  } catch {
    throw new AppError(
      "SETUP_REQUIRED",
      "Run npm run setup:local before signing in.",
      503,
    );
  }
  if (!token || !safeEqual(token, expected)) {
    loginAttempts.set(bucketKey, {
      count: bucket && bucket.until > Date.now() ? bucket.count + 1 : 1,
      until:
        bucket && bucket.until > Date.now()
          ? bucket.until
          : Date.now() + 600000,
    });
    throw new AppError("UNAUTHORIZED", "Invalid local access token.", 401);
  }
  loginAttempts.delete(bucketKey);
  const expiresAt = Date.now() + 7 * 86400000,
    id = randomBytes(12).toString("hex");
  await locked(async () => {
    const sessions = (await sessionStore()).filter(
      (s) => s.expiresAt > Date.now(),
    );
    sessions.push({ id, expiresAt });
    await atomicPrivateWrite(
      path.join(runtimePaths().config, "sessions.json"),
      JSON.stringify(sessions) + "\n",
    );
  });
  const payload = Buffer.from(
    JSON.stringify({ exp: expiresAt, nonce: id }),
  ).toString("base64url");
  const signature = createHmac("sha256", await masterKey())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}
type AccessToken = {
  id: string;
  name: string;
  hash: string;
  scopes: string[];
  createdAt: string;
  revokedAt?: string;
};
async function tokenStore(): Promise<AccessToken[]> {
  try {
    return JSON.parse(
      await readPrivate(path.join(runtimePaths().config, "access-tokens.json")),
    );
  } catch (e) {
    if (errno(e, "ENOENT")) return [];
    throw new AppError(
      "TOKEN_STORE_INVALID",
      "Access token store is invalid.",
      503,
    );
  }
}
const allowedScopes = [
  "library:read",
  "library:write",
  "wiki:read",
  "wiki:write",
  "learning:read",
  "learning:write",
  "ai:run",
  "external:invoke",
  "paid:invoke",
];
export async function issueAccessToken(
  name: string,
  scopes: string[] = ["library:read", "wiki:read", "learning:read"],
) {
  if (
    !name ||
    name.length > 80 ||
    !scopes.length ||
    scopes.some((s) => !allowedScopes.includes(s))
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Invalid token name or scopes.",
      422,
    );
  return locked(async () => {
    const tokens = await tokenStore();
    const token = `tp_${randomBytes(32).toString("base64url")}`;
    const entry: AccessToken = {
      id: randomBytes(16).toString("hex"),
      name,
      hash: createHash("sha256").update(token).digest("hex"),
      scopes: [...new Set(scopes)],
      createdAt: new Date().toISOString(),
    };
    tokens.push(entry);
    await atomicPrivateWrite(
      path.join(runtimePaths().config, "access-tokens.json"),
      JSON.stringify(tokens, null, 2) + "\n",
    );
    return { id: entry.id, name, scopes: entry.scopes, token };
  });
}
export async function listAccessTokens() {
  return (await tokenStore()).map(({ hash: _, ...rest }) => rest);
}
export async function revokeAccessToken(id: string) {
  await locked(async () => {
    const tokens = await tokenStore();
    const token = tokens.find((t) => t.id === id);
    if (!token) throw new AppError("NOT_FOUND", "Token not found.", 404);
    token.revokedAt = new Date().toISOString();
    await atomicPrivateWrite(
      path.join(runtimePaths().config, "access-tokens.json"),
      JSON.stringify(tokens, null, 2) + "\n",
    );
  });
}
export async function refreshPrincipal(
  principal: Principal,
): Promise<Principal> {
  if (principal.kind === "session") {
    const session = (await sessionStore()).find(
      (s) =>
        s.id === principal.sessionId &&
        s.expiresAt === principal.sessionExpiresAt &&
        s.expiresAt > Date.now(),
    );
    if (!session)
      throw new AppError(
        "UNAUTHORIZED",
        "The originating session expired or was signed out.",
        401,
      );
    return {
      kind: "session",
      scopes: ["*"],
      sessionId: session.id,
      sessionExpiresAt: session.expiresAt,
    };
  }
  const current = (await tokenStore()).find(
    (t) => t.id === principal.tokenId && !t.revokedAt,
  );
  if (!current)
    throw new AppError(
      "UNAUTHORIZED",
      "The originating access token has been revoked or cannot be verified.",
      401,
    );
  return { kind: "token", tokenId: current.id, scopes: [...current.scopes] };
}
export async function authorize(
  request: Request,
  scope?: string,
): Promise<Principal> {
  validateRequestOrigin(request);
  const bearer = request.headers.get("authorization");
  if (bearer) {
    if (!bearer.startsWith("Bearer ") || bearer.length > 256)
      throw new AppError("UNAUTHORIZED", "Invalid access token.", 401);
    const hash = createHash("sha256").update(bearer.slice(7)).digest("hex");
    const entry = (await tokenStore()).find(
      (t) => !t.revokedAt && safeEqual(t.hash, hash),
    );
    if (!entry)
      throw new AppError(
        "UNAUTHORIZED",
        "Invalid or revoked access token.",
        401,
      );
    if (scope && !entry.scopes.includes(scope))
      throw new AppError(
        "FORBIDDEN",
        "Access token lacks the required scope.",
        403,
      );
    return { kind: "token", tokenId: entry.id, scopes: entry.scopes };
  }
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw || raw.length > 1024)
    throw new AppError(
      "UNAUTHORIZED",
      "Sign in with the local access token.",
      401,
    );
  const parts = raw.split(".");
  if (
    parts.length !== 2 ||
    !safeEqual(
      parts[1],
      createHmac("sha256", await masterKey())
        .update(parts[0])
        .digest("base64url"),
    )
  )
    throw new AppError("UNAUTHORIZED", "Invalid session.", 401);
  let sessionId: string, sessionExpiresAt: number;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (
      !Number.isFinite(payload.exp) ||
      payload.exp < Date.now() ||
      typeof payload.nonce !== "string"
    )
      throw new Error("expired");
    sessionId = payload.nonce;
    sessionExpiresAt = payload.exp;
  } catch {
    throw new AppError("UNAUTHORIZED", "Session expired.", 401);
  }
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    !request.headers.get("origin")
  )
    throw new AppError(
      "INVALID_ORIGIN",
      "Browser mutations require a same-origin request.",
      403,
    );
  return refreshPrincipal({
    kind: "session",
    scopes: ["*"],
    sessionId,
    sessionExpiresAt,
  });
}
export async function requireSession(request: Request) {
  const principal = await authorize(request);
  if (principal.kind !== "session")
    throw new AppError(
      "FORBIDDEN",
      "Settings require an interactive local session.",
      403,
    );
  return principal;
}
export async function readJson(
  request: Request,
  limit = 128 * 1024,
): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json"))
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Use application/json.", 415);
  const body = request.body?.getReader();
  if (!body)
    throw new AppError("INVALID_JSON", "A JSON body is required.", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await body.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await body.cancel();
        throw new AppError(
          "PAYLOAD_TOO_LARGE",
          "Request body is too large.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    body.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("INVALID_JSON", "Invalid JSON body.", 400);
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message:
          "The local operation failed. No credentials or internal details are exposed.",
      },
    },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
