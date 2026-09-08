import {
  authorize,
  createSession,
  errorResponse,
  readJson,
  revokeSession,
  SESSION_COOKIE,
  validateRequestOrigin,
} from "@thesis/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.APP_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`;
export async function GET(request: Request) {
  try {
    const principal = await authorize(request);
    return Response.json(
      {
        data: {
          authenticated: true,
          kind: principal.kind,
          scopes: principal.scopes,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    validateRequestOrigin(request);
    const body = (await readJson(request, 4096)) as { token?: unknown };
    const session = await createSession(
      request,
      typeof body.token === "string" ? body.token : "",
    );
    return Response.json(
      { data: { authenticated: true } },
      {
        headers: {
          "Set-Cookie": cookie(session, 604800),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request) {
  try {
    await revokeSession(await authorize(request));
    return Response.json(
      { data: { authenticated: false } },
      { headers: { "Set-Cookie": cookie("", 0), "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
