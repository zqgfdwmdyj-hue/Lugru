"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { unlockPrivate } from "@/lib/private/service";
import { withParams } from "@/lib/assistant/oauth-logic";
import { checkAuthRequest, createAuthCode } from "@/lib/assistant/oauth-service";

export type ConsentState = { error: string } | null;

const FIELDS = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource", "response_type"] as const;

/** Claude den Zugriff erlauben oder ablehnen – danach zurück zu Claude. */
export async function decideConsent(_prev: ConsentState, fd: FormData): Promise<ConsentState> {
  const session = await requireSession();
  const p = Object.fromEntries(FIELDS.map((k) => [k, fd.get(k) ? String(fd.get(k)) : undefined]));
  const check = await checkAuthRequest(p);
  if ("fatal" in check) return { error: check.fatal };
  if ("redirectError" in check) redirect(withParams(check.redirectUri, { error: check.redirectError, error_description: check.description, state: check.state }));
  const req = check.ok;
  if (fd.get("decision") !== "allow") redirect(withParams(req.redirectUri, { error: "access_denied", error_description: "Abgelehnt", state: req.state }));
  if (session.role !== "owner") return { error: "Claude verbinden kann nur der Inhaber." };
  const scope = ["lesen"];
  if (fd.get("aendern") === "on") scope.push("aendern");
  if (fd.get("privat") === "on" && session.privateAccess) {
    if (session.privatePin) {
      const problem = await unlockPrivate(session, String(fd.get("pin") ?? ""));
      if (problem) return { error: `Privat-PIN: ${problem}` };
    }
    scope.push("privat");
  }
  const code = await createAuthCode({ clientId: req.clientId, tenantId: session.tenantId, userId: session.userId, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge, scope: scope.join(" "), resource: req.resource });
  redirect(withParams(req.redirectUri, { code, state: req.state }));
}
