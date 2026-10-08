"use server";

import { redirect } from "next/navigation";
import { checkPassword, endSession, startSession } from "@/lib/auth";

export type LoginState = { error: string } | null;

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const password = String(fd.get("password") ?? "");
  // Kleine Bremse gegen Durchprobieren
  await new Promise((r) => setTimeout(r, 400));
  if (!checkPassword(password)) return { error: "Passwort stimmt nicht." };
  await startSession();
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
