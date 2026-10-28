import { revokeToken } from "@/lib/assistant/oauth-service";
import { CORS, preflight, readParams } from "@/lib/assistant/http";

// Token zurückziehen (RFC 7009): immer 200, auch wenn das Token unbekannt ist.
export async function POST(req: Request) {
  const p = await readParams(req);
  await revokeToken(p.token ?? null);
  return new Response(null, { status: 200, headers: CORS });
}
export async function OPTIONS() {
  return preflight();
}
