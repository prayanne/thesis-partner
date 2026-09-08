import {
  errorResponse,
  requireSession,
  revokeAccessToken,
} from "@thesis/security";
export const runtime = "nodejs";
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession(request);
    await revokeAccessToken((await context.params).id);
    return Response.json(
      { data: { revoked: true } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
