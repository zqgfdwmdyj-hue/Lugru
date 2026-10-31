import { getIntegration } from "@/lib/integrations/store";
import { twilioSignaturOk } from "@/lib/integrations/clients/sms";
import { mandantFuerNummer, smsAntwortVerarbeiten } from "@/lib/mobil/sms";
import { publicUrl } from "@/lib/public-url";

// Antworten auf SMS (Twilio-Webhook): nur von der eingetragenen Nummer, Signatur geprüft. Antwortet mit einer kurzen
// Bestätigung (wird im Auto vorgelesen). Löst nur Aufgaben oder Entwürfe aus.

export const dynamic = "force-dynamic";

const xml = (t: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${t ? `<Message>${t.replace(/[<&>]/g, "")}</Message>` : ""}</Response>`, { headers: { "Content-Type": "text/xml" } });

export async function POST(request: Request) {
  const fd = await request.formData().catch(() => null);
  if (!fd) return new Response("Bad Request", { status: 400 });
  const params = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
  const tenantId = params.From ? await mandantFuerNummer(params.From) : null;
  if (!tenantId) return xml("");
  const tw = await getIntegration(tenantId, "twilio");
  const url = `${(publicUrl() ?? new URL(request.url).origin).replace(/\/$/, "")}/api/sms/antwort`;
  if (!tw?.authToken || !twilioSignaturOk(tw.authToken, url, params, request.headers.get("x-twilio-signature"))) return new Response("Forbidden", { status: 403 });
  const ergebnis = await smsAntwortVerarbeiten(tenantId, (params.Body ?? "").slice(0, 500));
  return xml(`OK: ${ergebnis}`.slice(0, 160));
}
