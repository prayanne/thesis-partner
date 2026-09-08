import { z } from "zod";
import { authorize, readJson, AppError, errorResponse } from "@thesis/security";
import {
  executeOperation,
  DomainError,
  paperFile,
  requireScope,
} from "@thesis/domain";
import { getDatabase } from "@thesis/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const principal = await authorize(request);
    const { path } = await context.params;
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      path[0] === "papers" &&
      path[2] === "file"
    ) {
      requireScope(principal, "library:read");
      z.string().uuid().parse(path[1]);
      const file = await paperFile(
        getDatabase(),
        path[1]!,
        url.searchParams.get("revision") ?? undefined,
      );
      const etag = `"${file.contentHash}"`;
      const headers: Record<string, string> = {
        "Content-Type": "application/pdf",
        "Accept-Ranges": "bytes",
        ETag: etag,
        "Cache-Control": "private, no-cache",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      };
      if (request.headers.get("if-none-match") === etag)
        return new Response(null, { status: 304, headers });
      const range = request.headers.get("range");
      if (
        range &&
        (!request.headers.get("if-range") ||
          request.headers.get("if-range") === etag)
      ) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        let start: number, end: number;
        if (!match || (!match[1] && !match[2]))
          return new Response(null, {
            status: 416,
            headers: {
              ...headers,
              "Content-Range": `bytes */${file.byteSize}`,
            },
          });
        if (!match[1]) {
          const suffix = Number(match[2]);
          start = Math.max(0, file.byteSize - suffix);
          end = file.byteSize - 1;
        } else {
          start = Number(match[1]);
          end = match[2]
            ? Math.min(Number(match[2]), file.byteSize - 1)
            : file.byteSize - 1;
        }
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= file.byteSize
        )
          return new Response(null, {
            status: 416,
            headers: {
              ...headers,
              "Content-Range": `bytes */${file.byteSize}`,
            },
          });
        return new Response(
          new Uint8Array(file.bytes.subarray(start, end + 1)),
          {
            status: 206,
            headers: {
              ...headers,
              "Content-Range": `bytes ${start}-${end}/${file.byteSize}`,
              "Content-Length": String(end - start + 1),
            },
          },
        );
      }
      return new Response(new Uint8Array(file.bytes), {
        headers: { ...headers, "Content-Length": String(file.byteSize) },
      });
    }
    let body: unknown = undefined;
    if (!["GET", "HEAD"].includes(request.method) && request.body)
      body = await readJson(request, 1024 * 1024);
    const idempotency = request.headers.get("idempotency-key");
    if (idempotency && body && typeof body === "object")
      body = { ...body, requestId: idempotency };
    const result = await executeOperation(
      { method: request.method, path, body, query: url.searchParams },
      { principal },
    );
    return Response.json(
      { data: result.data, ...(result.meta ? { meta: result.meta } : {}) },
      {
        status: result.status ?? 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof DomainError)
      return errorResponse(
        new AppError(error.code, error.message, error.status),
      );
    if (error instanceof z.ZodError)
      return errorResponse(
        new AppError("VALIDATION_ERROR", "Invalid request fields.", 422),
      );
    const code = (error as { code?: string })?.code;
    if (code === "23505")
      return errorResponse(
        new AppError(
          "CONFLICT",
          "A record with these unique fields already exists.",
          409,
        ),
      );
    if (["23503", "23514", "P0001"].includes(code ?? ""))
      return errorResponse(
        new AppError(
          "CONSTRAINT_VIOLATION",
          "The operation violates a relationship, immutable revision or curriculum dependency rule.",
          422,
        ),
      );
    if (
      code === "DATABASE_NOT_CONFIGURED" ||
      ["ECONNREFUSED", "CONNECT_TIMEOUT"].includes(code ?? "")
    )
      return errorResponse(
        new AppError(
          "DATABASE_UNAVAILABLE",
          "Configure and start PostgreSQL to use durable data.",
          503,
        ),
      );
    return errorResponse(error);
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
