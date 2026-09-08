import { DomainError } from "./common";
/** Qdrant contains rebuildable indices only; every collection belongs to one immutable embedding profile. */
export class QdrantIndex {
  constructor(
    private endpoint: string | undefined = process.env.QDRANT_URL,
    private transport: typeof fetch = fetch,
  ) {}
  async status() {
    if (!this.endpoint)
      return {
        available: false,
        fallback: "keyword",
        reason: "QDRANT_NOT_CONFIGURED",
      };
    try {
      await this.request("/collections");
      return { available: true, fallback: null };
    } catch {
      return {
        available: false,
        fallback: "keyword",
        reason: "QDRANT_UNAVAILABLE",
      };
    }
  }
  private async request(path: string, body?: unknown, method = "GET") {
    if (!this.endpoint)
      throw new DomainError(
        "QDRANT_NOT_CONFIGURED",
        "Qdrant is not configured; keyword search remains available.",
        503,
      );
    const url = new URL(this.endpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new DomainError("INVALID_QDRANT_URL", "Invalid Qdrant endpoint.");
    const response = await this.transport(
      this.endpoint.replace(/\/$/, "") + path,
      {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { "content-type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      throw new DomainError(
        "QDRANT_UNAVAILABLE",
        "Derived vector index is unavailable.",
        503,
      );
    return response.json();
  }
  private collection(profileId: string, generationId: string) {
    if (
      !/^[0-9a-f-]{36}$/.test(profileId) ||
      !/^[0-9a-f-]{36}$/.test(generationId)
    )
      throw new DomainError(
        "INVALID_INDEX",
        "Index identifiers must be UUIDs.",
      );
    return `profile_${profileId.replaceAll("-", "")}_${generationId.replaceAll("-", "")}`;
  }
  async create(
    profileId: string,
    generationId: string,
    dimensions: number,
    distance: "Cosine" | "Dot" | "Euclid" = "Cosine",
  ) {
    if (!Number.isInteger(dimensions) || dimensions < 1)
      throw new DomainError(
        "INVALID_DIMENSIONS",
        "Positive embedding dimensions required.",
      );
    const collection = this.collection(profileId, generationId);
    await this.request(
      `/collections/${collection}`,
      { vectors: { size: dimensions, distance } },
      "PUT",
    );
    return collection;
  }
  async upsert(
    profileId: string,
    generationId: string,
    dimensions: number,
    points: {
      id: string;
      vector: number[];
      payload: {
        chunkId: string;
        paperRevisionId: string;
        extractionRunId: string;
      };
    }[],
  ) {
    if (
      points.some(
        (p) =>
          p.vector.length !== dimensions ||
          p.vector.some((v) => !Number.isFinite(v)),
      )
    )
      throw new DomainError(
        "VECTOR_SPACE_MISMATCH",
        "Embedding dimensions do not match this profile.",
      );
    return this.request(
      `/collections/${this.collection(profileId, generationId)}/points?wait=true`,
      { points },
      "PUT",
    );
  }
  async search(
    profileId: string,
    generationId: string,
    vector: number[],
    limit = 20,
  ) {
    return this.request(
      `/collections/${this.collection(profileId, generationId)}/points/query`,
      { query: vector, limit, with_payload: true },
      "POST",
    );
  }
}
