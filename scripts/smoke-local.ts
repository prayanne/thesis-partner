import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:3000";
const token = (
  await readFile(
    path.resolve(process.env.APP_DATA_DIR ?? "./data", "bootstrap-token"),
    "utf8",
  )
).trim();
const session = await fetch(origin + "/api/v1/session", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ token }),
});
assert.equal(session.status, 200, "Local session setup must succeed.");
const cookie = session.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "Session must issue an HttpOnly cookie.");
async function api(endpoint: string, method = "GET", body?: unknown) {
  const response = await fetch(origin + "/api/v1" + endpoint, {
    method,
    headers: {
      Cookie: cookie!,
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  assert.ok(
    response.ok,
    `${method} ${endpoint} failed with status ${response.status}, code ${payload.error?.code ?? "unknown"}`,
  );
  return { response, data: payload.data, meta: payload.meta };
}
assert.equal(
  (await fetch(origin + "/api/v1/papers")).status,
  401,
  "Unauthenticated library access must be rejected.",
);
const config = await api("/config");
assert.equal(
  config.data.network.localOnly,
  true,
  "Smoke test requires local-only configuration.",
);
assert.equal(
  config.data.ai.paidAiEnabled,
  false,
  "Smoke test must not enable paid AI.",
);
assert.equal(
  Object.keys(config.meta.credentials).length,
  0,
  "This smoke setup expects no actual provider credentials.",
);
const definitions = await api("/provider-definitions");
assert.equal(definitions.data.length, 5);
const wiki = await api("/wiki", "POST", {
  title: "API smoke verification",
  slug: `api-smoke-${Date.now()}`,
  markdown: "# Local persistence\n\nA test note with no external processing.",
});
const saved = await api(`/wiki/${wiki.data.id}`, "PATCH", {
  expectedRevision: wiki.data.revision,
  markdown: "# Local persistence\n\nUpdated once.",
});
assert.ok(saved.data.revision > wiki.data.revision);
const conflict = await fetch(origin + `/api/v1/wiki/${wiki.data.id}`, {
  method: "PATCH",
  headers: {
    Cookie: cookie!,
    Origin: origin,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    expectedRevision: wiki.data.revision,
    markdown: "Must not overwrite",
  }),
});
assert.equal(conflict.status, 409);
await api(`/wiki/${wiki.data.id}`, "DELETE", {
  expectedRevision: saved.data.revision,
});
const imported = await api("/papers", "POST", {
  relativePath: "pdfjs-tracemonkey-validation.pdf",
});
const paperId = imported.data.paperId ?? imported.data.id;
const deadline = Date.now() + 30000;
let paper;
do {
  paper = (await api(`/papers/${paperId}`)).data;
  if (paper.extractionState === "extracted") break;
  await new Promise((resolve) => setTimeout(resolve, 500));
} while (Date.now() < deadline);
assert.equal(
  paper.extractionState,
  "extracted",
  "PDF extraction must finish within the smoke deadline.",
);
assert.equal(paper.pageCount, 14);
const segments = (await api(`/papers/${paperId}/segments?pageNumber=1`)).data;
assert.ok(
  segments.length > 20,
  "First page must contain actual extracted text.",
);
assert.ok(
  segments.every(
    (s: { anchors: unknown }) => s.anchors && typeof s.anchors === "object",
  ),
);
const mounted = await readFile(
  path.resolve(
    process.env.PAPERS_DIR ?? "./library",
    "pdfjs-tracemonkey-validation.pdf",
  ),
);
assert.equal(
  createHash("sha256").update(mounted).digest("hex"),
  paper.contentHash,
);
const analysis = (await api(`/papers/${paperId}/analysis`)).data;
assert.equal(analysis.status, "partial");
assert.equal(analysis.coverage.parsedPages, 14);
assert.equal(analysis.coverage.aiAnalyzedPages, 0);
const issued = await api("/access-tokens", "POST", {
  name: "Temporary local MCP smoke",
});
const client = new Client(
  { name: "thesis-live-smoke", version: "1.0.0" },
  { versionNegotiation: { mode: "auto" } },
);
try {
  const transport = new StreamableHTTPClientTransport(
    new URL(origin + "/mcp"),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${issued.data.token}` },
      },
    },
  );
  await client.connect(transport);
  assert.equal(client.getProtocolEra(), "modern");
  assert.ok((await client.listTools()).tools.length >= 15);
  const result = await client.callTool({
    name: "papers_get",
    arguments: { id: paperId },
  });
  assert.notEqual(result.isError, true);
  assert.equal(
    (result.structuredContent as { data: { id: string } }).data.id,
    paperId,
  );
  const denied = await client.callTool({
    name: "wiki_create",
    arguments: {
      title: "Never written",
      slug: "denied-mcp-write",
      markdown: "Denied",
    },
  });
  assert.equal(denied.isError, true);
} finally {
  await client.close();
  await api(`/access-tokens/${issued.data.id}`, "DELETE");
}
console.log(
  JSON.stringify({
    status: "passed",
    checks: [
      "session",
      "unauthenticated-denial",
      "local-only",
      "provider-registry",
      "wiki-create-update-archive",
      "revision-conflict",
      "mounted-pdf-import",
      "14-page-extraction",
      "pdf-hash-unchanged",
      "partial-analysis",
      "live-mcp-read",
      "mcp-write-denied",
      "temporary-token-revoked",
    ],
    paperId,
    segmentCountOnFirstPage: segments.length,
    credentialsCreated: 0,
    paidCalls: 0,
  }),
);
