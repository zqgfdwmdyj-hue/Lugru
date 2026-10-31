// Versandbestätigung an Amazon als Datei (B15.1) – reine Logik.

/** Amazon-„carrier-code“ (Seller Central akzeptiert diese Namen; sonst „Other“ + Name). */
export function carrierCode(carrier: string | null): { code: string; name: string } {
  const c = (carrier ?? "").trim();
  const bekannt: [RegExp, string][] = [
    [/^dhl/i, "DHL"],
    [/deutsche post|warensendung/i, "Deutsche Post"],
    [/^dpd/i, "DPD"],
    [/^gls/i, "GLS"],
    [/^hermes/i, "Hermes"],
    [/^ups/i, "UPS"],
    [/^fedex/i, "FedEx"],
  ];
  for (const [re, code] of bekannt) if (re.test(c)) return { code, name: "" };
  return { code: "Other", name: c || "Prep Center" };
}

/** Datei „Versandbestätigung“ (Tab-getrennt) für die übergebenen Aufträge. */
export function bestaetigungsDatei(rows: { externalId: string; versendetAm: string | null; tracking: string | null; carrier: string | null }[]): string {
  const header = ["order-id", "order-item-id", "quantity", "ship-date", "carrier-code", "carrier-name", "tracking-number", "ship-method"];
  const lines = rows.map((o) => {
    const c = carrierCode(o.carrier);
    const post = c.code === "Deutsche Post" && !o.tracking;
    return [o.externalId, "", "", (o.versendetAm ?? new Date().toISOString()).slice(0, 10), c.code, c.name, o.tracking ?? "", post ? "Warensendung" : ""].join("\t");
  });
  return `${[header.join("\t"), ...lines].join("\r\n")}\r\n`;
}
