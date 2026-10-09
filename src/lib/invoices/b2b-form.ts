import type { B2bInput } from "@/lib/ebay/invoices/b2b";
import type { TaxCase } from "@/lib/ebay/invoices/types";
import { parseAmount } from "@/lib/numbers";

const TAX_CASES: TaxCase[] = ["domestic", "eu_supply", "reverse_charge", "export"];
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Formular „Neue B2B-Rechnung“ → Eingabe für die Rechnung (Positionen als Listen-Felder). */
export function b2bInputFromForm(fd: FormData): B2bInput & { saveCustomer: boolean; mailCustomer: boolean } {
  const desc = fd.getAll("l_desc").map(String);
  const qty = fd.getAll("l_qty").map(String);
  const unit = fd.getAll("l_unit").map(String);
  const price = fd.getAll("l_price").map(String);
  const vat = fd.getAll("l_vat").map(String);
  const rc = fd.getAll("l_rc").map(String);
  const taxCase = str(fd, "taxCase") as TaxCase;
  const days = parseAmount(str(fd, "paymentDays"));
  return {
    buyer: {
      name: str(fd, "name"),
      contact: str(fd, "contact") || undefined,
      street: str(fd, "street"),
      zip: str(fd, "zip"),
      city: str(fd, "city"),
      country: (str(fd, "country") || "DE").toUpperCase(),
      vatId: str(fd, "vatId") || undefined,
      email: str(fd, "email") || undefined,
      customerNumber: str(fd, "customerNumber") || undefined,
    },
    taxCase: TAX_CASES.includes(taxCase) ? taxCase : "domestic",
    serviceDate: str(fd, "serviceDate"),
    serviceDateTo: str(fd, "serviceDateTo") || undefined,
    paymentDays: days === null ? 14 : Math.round(days),
    reference: str(fd, "reference") || undefined,
    note: str(fd, "note") || undefined,
    rcWhole: fd.get("rcWhole") === "on",
    lines: desc
      .map((d, i) => ({
        description: d.trim(),
        quantity: parseAmount(qty[i] ?? "") ?? 1,
        unit: (unit[i] ?? "").trim() || "Stk",
        unitNet: parseAmount(price[i] ?? "") ?? NaN,
        vatRate: Number(vat[i] ?? 19),
        device: rc[i] === "1",
      }))
      .filter((l) => l.description || Number.isFinite(l.unitNet)),
    saveCustomer: fd.get("saveCustomer") === "on",
    mailCustomer: fd.get("mailCustomer") === "on",
  };
}
