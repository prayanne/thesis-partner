import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { issueAccessToken } from "../packages/security/src/index";
import {
  createThesisMcpHandler,
  type DomainOperation,
} from "../packages/mcp/src/index";

let directory: string;
const previousEnv = { ...process.env };
beforeEach(async () => {
  directory = await mkdtemp(path.join(await realpath(tmpdir()), "thesis-mcp-"));
  process.env.APP_DATA_DIR = directory;
  delete process.env.CONFIG_DIR;
  process.env.APP_ORIGIN = "http://127.0.0.1:3000";
});
afterEach(async () => {
  process.env = { ...previousEnv };
  await rm(directory, { recursive: true, force: true });
});

describe("modern MCP using the real SDK client and in-process HTTP fetch", () => {
  it("negotiates modern discovery, lists tools, reads data and denies a write with a read-only token", async () => {
    const seen: DomainOperation[] = [];
    const handler = createThesisMcpHandler(async (operation) => {
      seen.push(operation);
      return { data: [{ id: "test-record", title: "Fixture paper" }] };
    });
    const { token } = await issueAccessToken("MCP read-only");
    const client = new Client(
      { name: "thesis-contract-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("http://127.0.0.1:3000/mcp"),
      {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: async (input, init) => handler.fetch(new Request(input, init)),
      },
    );
    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe("modern");
      const listed = await client.listTools();
      expect(listed.tools.some((t) => t.name === "papers_search")).toBe(true);
      const read = await client.callTool({
        name: "papers_search",
        arguments: { q: "fixture" },
      });
      expect(read.isError).not.toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0].principal?.kind).toBe("token");
      expect(seen[0].query?.get("q")).toBe("fixture");
      const denied = await client.callTool({
        name: "wiki_create",
        arguments: { title: "Do not write", slug: "test", markdown: "test" },
      });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain("FORBIDDEN");
      expect(seen).toHaveLength(1);
    } finally {
      await client.close();
      await handler.close();
    }
  });
  it("allows an explicitly scoped write and forwards the same principal to domain policy", async () => {
    const seen: DomainOperation[] = [];
    const handler = createThesisMcpHandler(async (operation) => {
      seen.push(operation);
      return { data: { id: "fixture-wiki" } };
    });
    const { token } = await issueAccessToken("MCP writer", ["wiki:write"]);
    const client = new Client(
      { name: "thesis-writer-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("http://127.0.0.1:3000/mcp"),
      {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: async (input, init) => handler.fetch(new Request(input, init)),
      },
    );
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "wiki_create",
        arguments: { title: "Fixture", slug: "fixture", markdown: "# Fixture" },
      });
      expect(result.isError).not.toBe(true);
      expect(seen[0].method).toBe("POST");
      expect(seen[0].principal?.scopes).toEqual(["wiki:write"]);
    } finally {
      await client.close();
      await handler.close();
    }
  });
  it("rejects unauthenticated or foreign-origin requests before discovery and never supports GET sessions", async () => {
    const handler = createThesisMcpHandler(async () => {
      throw new Error("must not execute");
    });
    try {
      expect(
        (
          await handler.fetch(
            new Request("http://127.0.0.1:3000/mcp", { method: "POST" }),
          )
        ).status,
      ).toBe(401);
      const { token } = await issueAccessToken("MCP negative");
      expect(
        (
          await handler.fetch(
            new Request("http://127.0.0.1:3000/mcp", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                Origin: "https://attacker.example",
              },
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await handler.fetch(
            new Request("http://127.0.0.1:3000/mcp", {
              headers: { Authorization: `Bearer ${token}` },
            }),
          )
        ).status,
      ).toBe(405);
      const malformed = await handler.fetch(
        new Request("http://127.0.0.1:3000/mcp", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: "{invalid",
        }),
      );
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
    } finally {
      await handler.close();
    }
  });
  it("sanitizes resource failures as well as tool failures", async () => {
    const secret = "synthetic-database-credential-never-exposed";
    const handler = createThesisMcpHandler(async () => {
      throw new Error(secret);
    });
    const { token } = await issueAccessToken("Resource negative");
    const client = new Client(
      { name: "thesis-resource-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("http://127.0.0.1:3000/mcp"),
      {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        fetch: async (input, init) => handler.fetch(new Request(input, init)),
      },
    );
    try {
      await client.connect(transport);
      let caught: unknown;
      try {
        await client.readResource({
          uri: "paper://11111111-1111-4111-a111-111111111111/metadata",
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeTruthy();
      expect(String(caught)).toContain("OPERATION_FAILED");
      expect(String(caught)).not.toContain(secret);
    } finally {
      await client.close();
      await handler.close();
    }
  });
});
