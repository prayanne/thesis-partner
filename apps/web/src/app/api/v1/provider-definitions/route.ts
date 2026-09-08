import { PROVIDER_DEFINITIONS } from "@thesis/providers";
import { authorize, errorResponse } from "@thesis/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await authorize(request);
    return Response.json(
      { data: PROVIDER_DEFINITIONS },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
