"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { syncMailbox } from "@/lib/inbox/service";
import { saveImapMailbox } from "@/lib/mail/accounts";
import { detectServers, testAccount, type Account } from "@/lib/mail/connect";
import { domainOf, type ServerSettings } from "@/lib/mail/servers";
import { finishMailOAuth, parsePastedRedirect, PASTE_REDIRECT } from "@/lib/oauth/mail-flow";
import { verifyState } from "@/lib/oauth/state";

export type ConnectState = { ok: boolean; message: string; hint?: string; settings?: ServerSettings; manual?: boolean; address?: string } | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function connectImap(prev: ConnectState, fd: FormData): Promise<ConnectState> {
  const r = await tryConnect(fd);
  // Adresse fürs erneute Ausfüllen zurückgeben (React leert das Formular nach dem Absenden).
  return r && { ...r, address: str(fd, "address"), settings: r.settings ?? prev?.settings };
}

async function tryConnect(fd: FormData): Promise<ConnectState> {
  const session = await requireSession();
  const address = str(fd, "address").toLowerCase();
  // Google zeigt App-Passwörter in Vierergruppen („abcd efgh ijkl mnop“) – die Leerzeichen gehören nicht dazu.
  const rawPassword = String(fd.get("password") ?? "");
  const compact = rawPassword.replace(/\s/g, "");
  const password = /^[a-z]{16}$/i.test(compact) ? compact : rawPassword;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return { ok: false, message: "Bitte eine gültige E-Mail-Adresse eingeben." };
  if (!password) return { ok: false, message: "Bitte das Passwort bzw. App-Passwort eingeben." };

  let settings: ServerSettings | null;
  if (str(fd, "imapHost")) {
    settings = {
      imapHost: str(fd, "imapHost"),
      imapPort: Number(str(fd, "imapPort")) || 993,
      imapSecure: str(fd, "imapSecure") !== "starttls",
      smtpHost: str(fd, "smtpHost") || str(fd, "imapHost"),
      smtpPort: Number(str(fd, "smtpPort")) || 465,
      smtpSecure: str(fd, "smtpSecure") !== "starttls",
      user: str(fd, "user") || address,
      provider: "Eigene Einstellungen",
    };
  } else {
    settings = await detectServers(address);
    if (!settings) {
      const d = domainOf(address);
      return {
        ok: false,
        manual: true,
        message: "Die Server für diese Adresse wurden nicht automatisch gefunden – bitte unten eintragen (steht beim Anbieter meist unter „IMAP/SMTP“ oder „E-Mail-Programm einrichten“).",
        settings: { imapHost: `imap.${d}`, imapPort: 993, imapSecure: true, smtpHost: `smtp.${d}`, smtpPort: 465, smtpSecure: true, user: address, provider: "" },
      };
    }
    if (!settings.imapHost || !settings.smtpHost) return { ok: false, manual: true, message: "Bitte die Server unten ergänzen.", hint: settings.hint, settings };
  }

  let account: Account = { ...settings, address, password };
  try {
    await testAccount(account);
  } catch (e) {
    // Manche Anbieter wollen die volle Adresse als Benutzernamen, andere nur den Teil vor dem @.
    const authFailed = e instanceof Error && /Anmeldung abgelehnt/.test(e.message);
    const alt = !authFailed || settings.user === address ? null : { ...account, user: address };
    const ok = alt && (await testAccount(alt).then(() => true, () => false));
    if (!ok) return { ok: false, manual: true, message: e instanceof Error ? e.message : String(e), hint: settings.hint, settings };
    account = alt;
  }
  const id = await saveImapMailbox(session.tenantId, account);
  await syncMailbox(session.tenantId, id).catch(() => undefined);
  revalidatePath("/", "layout");
  redirect(`/posteingang?verbunden=${encodeURIComponent(address)}`);
}

export type PasteState = { ok: boolean; message: string } | null;

export async function finishPaste(_prev: PasteState, fd: FormData): Promise<PasteState> {
  const session = await requireSession();
  const { code, state, error } = parsePastedRedirect(String(fd.get("url") ?? ""));
  if (error) return { ok: false, message: `Anmeldung abgelehnt: ${error}` };
  if (!code || !state) return { ok: false, message: "Bitte die komplette Adresse aus der Browserzeile einfügen (beginnt mit http://localhost/?…code=…)." };
  const s = verifyState(state);
  if (!s || s.t !== session.tenantId || !s.p.endsWith("-paste")) return { ok: false, message: "Die Anmeldung ist abgelaufen oder gehört nicht zu dieser Sitzung – bitte noch einmal starten." };
  const provider = s.p === "google-paste" ? "google" : "microsoft";
  let address: string;
  try {
    address = await finishMailOAuth(session.tenantId, provider, code, PASTE_REDIRECT);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/", "layout");
  redirect(`/posteingang?verbunden=${encodeURIComponent(address)}`);
}
