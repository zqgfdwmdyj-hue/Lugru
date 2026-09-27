import { timingSafeEqual } from "node:crypto";
import { runScheduledJobs } from "@/lib/scheduler";

// Für externe Zeitsteuerung (z. B. Cron des Hosters): GET /api/cron mit Header
// "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Nicht erlaubt", { status: 401 });
  }
  const r = await runScheduledJobs(true);
  return Response.json(r);
}
