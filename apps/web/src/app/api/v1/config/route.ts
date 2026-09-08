import {
  credentialStatus,
  errorResponse,
  readConfig,
  readJson,
  requireSession,
  updateConfig,
} from "@thesis/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireSession(request);
    return Response.json(
      {
        data: await readConfig(),
        meta: { credentials: await credentialStatus() },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PATCH(request: Request) {
  try {
    await requireSession(request);
    const body = (await readJson(request)) as {
      patch?: unknown;
      expectedRevision?: unknown;
    };
    const config = await updateConfig(
      body.patch,
      Number(body.expectedRevision),
    );
    return Response.json(
      { data: config },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
