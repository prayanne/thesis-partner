import {
  AppError,
  errorResponse,
  issueAccessToken,
  listAccessTokens,
  readJson,
  requireSession,
} from "@thesis/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireSession(request);
    return Response.json(
      { data: await listAccessTokens() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    await requireSession(request);
    const body = (await readJson(request, 8192)) as {
      name?: unknown;
      scopes?: unknown;
    };
    if (
      typeof body.name !== "string" ||
      (body.scopes !== undefined &&
        (!Array.isArray(body.scopes) ||
          !body.scopes.every((s) => typeof s === "string")))
    )
      throw new AppError(
        "VALIDATION_ERROR",
        "Invalid access token fields.",
        422,
      );
    return Response.json(
      {
        data: await issueAccessToken(
          body.name,
          body.scopes as string[] | undefined,
        ),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
