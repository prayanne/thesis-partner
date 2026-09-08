import {
  AppError,
  errorResponse,
  readJson,
  requireSession,
} from "@thesis/security";
import {
  getProviderValidation,
  validateProvider,
} from "../../../../../../../../../packages/security/src/provider-verification";
import { aiFunctionSchema } from "../../../../../../../../../packages/security/src/verification-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    await requireSession(request);
    const operation = aiFunctionSchema.safeParse(
      new URL(request.url).searchParams.get("function") ?? "summary",
    );
    if (!operation.success)
      throw new AppError("VALIDATION_ERROR", "Unknown AI function.", 422);
    return Response.json(
      {
        data: await getProviderValidation(
          (await context.params).id,
          operation.data,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    await requireSession(request);
    return Response.json(
      {
        data: await validateProvider(
          (await context.params).id,
          await readJson(request),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
