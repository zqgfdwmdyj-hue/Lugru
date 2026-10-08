import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// Einfacher Team-Zugang: ein gemeinsames Passwort (APP_PASSWORD), Sitzung als signiertes Cookie.

export const SESSION_COOKIE = "spenden_session";
const DAYS = 30;

function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET fehlt oder ist kürzer als 32 Zeichen.");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(input: string) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) throw new Error("APP_PASSWORD ist nicht gesetzt.");
  return safeEqual(sign(input), sign(pw));
}

export async function startSession() {
  const expires = Date.now() + DAYS * 86400_000;
  (await cookies()).set(SESSION_COOKIE, `${expires}.${sign(String(expires))}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.startsWith("http://"),
    path: "/",
    expires: new Date(expires),
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function isLoggedIn() {
  const v = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!v) return false;
  const [expires, sig] = v.split(".");
  return !!sig && Number(expires) > Date.now() && safeEqual(sig, sign(expires));
}

/** In jeder Seite, Server-Aktion und Route aufrufen. */
export async function requireLogin() {
  if (!(await isLoggedIn())) redirect("/login");
}
