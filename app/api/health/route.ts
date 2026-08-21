export const runtime = "nodejs";

export function GET() {
  return Response.json({
    ok: true,
    service: "todotodolist",
    timestamp: new Date().toISOString()
  }, {
    headers: {
      "cache-control": "no-store"
    }
  });
}
