export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(
    { data: { status: "ok", service: "thesis-partner", check: "liveness" } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
