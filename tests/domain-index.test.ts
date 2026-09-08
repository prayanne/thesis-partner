import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { QdrantIndex } from "../packages/domain/src/qdrant";
it("reports missing/unavailable Qdrant honestly without fabricated semantic results", async () => {
  const transport = vi.fn(async () => new Response("", { status: 503 }));
  const absent = new QdrantIndex("", transport);
  expect(await absent.status()).toMatchObject({
    available: false,
    fallback: "keyword",
    reason: "QDRANT_NOT_CONFIGURED",
  });
  expect(transport).not.toHaveBeenCalled();
  expect(
    await new QdrantIndex("http://qdrant:6333", transport).status(),
  ).toMatchObject({ available: false, reason: "QDRANT_UNAVAILABLE" });
});
it("namespaces collections by profile and generation and rejects mismatched vector dimensions before sending", async () => {
  const transport = vi.fn(async () => Response.json({ result: true }));
  const adapter = new QdrantIndex("http://qdrant:6333", transport);
  const profileA = randomUUID(),
    profileB = randomUUID(),
    generation = randomUUID();
  const first = await adapter.create(profileA, generation, 3);
  const second = await adapter.create(profileB, generation, 3);
  expect(first).not.toBe(second);
  await expect(
    adapter.upsert(profileA, generation, 3, [
      {
        id: randomUUID(),
        vector: [1, 2],
        payload: {
          chunkId: randomUUID(),
          paperRevisionId: randomUUID(),
          extractionRunId: randomUUID(),
        },
      },
    ]),
  ).rejects.toMatchObject({ code: "VECTOR_SPACE_MISMATCH" });
  expect(transport).toHaveBeenCalledTimes(2);
});
