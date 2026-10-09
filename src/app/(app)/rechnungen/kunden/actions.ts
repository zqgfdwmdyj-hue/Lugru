"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArea } from "@/lib/auth/session";
import type { CustomerInput } from "@/lib/invoices/customer-logic";
import { CustomerError, deleteCustomer, saveCustomer } from "@/lib/invoices/customers";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const input = (fd: FormData): CustomerInput => ({
  name: str(fd, "name"),
  contact: str(fd, "contact"),
  street: str(fd, "street"),
  zip: str(fd, "zip"),
  city: str(fd, "city"),
  country: str(fd, "country"),
  vatId: str(fd, "vatId"),
  email: str(fd, "email"),
  customerNumber: str(fd, "customerNumber"),
});

/** Kunde anlegen oder ändern; danach zur Liste (neu) bzw. zurück zum Kunden. */
export async function saveCustomerAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  const id = z.string().uuid().optional().parse(str(fd, "id") || undefined) ?? null;
  const back = id ? `/rechnungen/kunden/${id}` : "/rechnungen/kunden";
  let saved: string;
  try {
    saved = await saveCustomer(session.tenantId, id, input(fd));
  } catch (e) {
    if (e instanceof CustomerError) redirect(`${back}?${new URLSearchParams({ fehler: e.message })}`);
    throw e;
  }
  revalidatePath("/rechnungen/kunden");
  if (fd.get("next") === "rechnung") redirect(`/rechnungen/ausgang/neu?kunde=${saved}`);
  redirect(`/rechnungen/kunden?${new URLSearchParams({ meldung: id ? "Kunde gespeichert." : "Kunde angelegt." })}`);
}

export async function deleteCustomerAction(fd: FormData) {
  const session = await requireArea("buchhaltung");
  await deleteCustomer(session.tenantId, z.string().uuid().parse(fd.get("id")));
  revalidatePath("/rechnungen/kunden");
  redirect(`/rechnungen/kunden?${new URLSearchParams({ meldung: "Kunde gelöscht – seine Rechnungen bleiben unverändert." })}`);
}
