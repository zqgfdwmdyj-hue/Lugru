"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, endSession, startSession } from "@/lib/auth";

export type LoginState = { error: string } | null;

// Gegen Durchprobieren: höchstens 10 Fehlversuche je Adresse in 15 Minuten (im Speicher, reicht für einen Server).
const WINDOW = 15 * 60_000;
const MAX_FAILS = 10;
const fails = new Map<string, number[]>();

async function clientKey() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unbekannt").trim();
}

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const password = String(fd.get("password") ?? "");
  const key = await clientKey();
  const now = Date.now();
  const recent = (fails.get(key) ?? []).filter((t) => now - t < WINDOW);
  if (recent.length >= MAX_FAILS) return { error: "Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen." };
  // Kleine Bremse gegen Durchprobieren
  await new Promise((r) => setTimeout(r, 400));
  if (!checkPassword(password)) {
    fails.set(key, [...recent, now]);
    if (fails.size > 5000) fails.clear();
    return { error: "Passwort stimmt nicht." };
  }
  fails.delete(key);
  await startSession();
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
