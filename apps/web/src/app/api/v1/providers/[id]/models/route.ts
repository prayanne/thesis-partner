import {
  AppError,
  errorResponse,
  readJson,
  requireSession,
} from "@thesis/security";
import { ProviderError } from "@thesis/providers";
import {
  getProviderModels,
  refreshProviderModels,
} from "../../../../../../../../../packages/security/src/provider-verification";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    await requireSession(request);
    return Response.json(
      { data: await getProviderModels((await context.params).id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    await requireSession(request);
    const body = await readJson(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      throw new AppError(
        "VALIDATION_ERROR",
        "Model refresh accepts an empty object and uses saved configuration.",
        422,
      );
    return Response.json(
      { data: await refreshProviderModels((await context.params).id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof ProviderError)
      return errorResponse(
        new AppError(
          e.code,
          e.message,
          ["POLICY_BLOCKED", "PROVIDER_DISABLED"].includes(e.code) ? 403 : 502,
        ),
      );
    return errorResponse(e);
  }
}
