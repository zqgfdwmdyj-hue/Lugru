"use server";

import bcrypt from "bcryptjs";
import { asc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { createSession, destroySession } from "@/lib/auth/session";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// Einfache Bremse gegen Durchprobieren von Passwörtern (pro Prozess).
const attempts = new Map<string, { count: number; until: number }>();

export type LoginState = { error: string; email: string } | null;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const typedEmail = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: "Bitte E-Mail und Passwort eingeben.", email: typedEmail };
  const { email, password } = parsed.data;

  const a = attempts.get(email);
  if (a && a.count >= 5 && a.until > Date.now()) {
    return { error: "Zu viele Versuche. Bitte in ein paar Minuten erneut probieren.", email };
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, email));
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !ok) {
    const next = { count: (a?.count ?? 0) + 1, until: Date.now() + 5 * 60_000 };
    attempts.set(email, next);
    return { error: "E-Mail oder Passwort ist falsch.", email };
  }
  attempts.delete(email);

  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(asc(schema.memberships.createdAt))
    .limit(1);
  if (!membership) return { error: "Diesem Konto ist noch keine Firma zugeordnet.", email };

  await createSession(user.id, membership.tenantId);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
