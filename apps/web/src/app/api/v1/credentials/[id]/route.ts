import {
  AppError,
  deleteCredential,
  errorResponse,
  readJson,
  requireSession,
  writeCredential,
} from "@thesis/security";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  try {
    await requireSession(request);
    const { id } = await context.params;
    const body = (await readJson(request, 20000)) as { value?: unknown };
    if (typeof body.value !== "string")
      throw new AppError(
        "VALIDATION_ERROR",
        "Credential value is required.",
        422,
      );
    return Response.json(
      { data: await writeCredential(id, body.value) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    await requireSession(request);
    await deleteCredential((await context.params).id);
    return Response.json(
      { data: { configured: false } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
