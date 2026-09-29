// Übernahme aus dem Retouren-Tool (SQLite app.db, Tabellen amazon_todos und amazon_mail_seen).

export type LegacyRow = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Message-IDs wie hier gespeichert: mit spitzen Klammern. */
export function normalizeMessageKey(v: unknown): string {
  const s = str(v);
  if (!s) return "";
  return s.startsWith("<") ? s : `<${s.replace(/^<|>$/g, "")}>`;
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m && !Number.isNaN(Date.parse(m[1]))) return m[1];
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  return de ? `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}` : null;
}

function timestamp(v: unknown): Date {
  const s = str(v);
  if (/^\d{10,13}$/.test(s)) return new Date(Number(s) * (s.length === 10 ? 1000 : 1));
  const d = new Date(s.includes("T") || /Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + (s.length > 10 ? "Z" : "T00:00:00Z"));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

const PRIO: Record<string, "high" | "medium" | "low"> = { hoch: "high", mittel: "medium", niedrig: "low", high: "high", medium: "medium", low: "low" };
const STATUS: Record<string, "open" | "done" | "ignored"> = { offen: "open", erledigt: "done", ignoriert: "ignored", open: "open", done: "done", ignored: "ignored" };

export type MappedTodo = {
  messageKey: string;
  receivedAt: Date;
  sender: string | null;
  subject: string | null;
  category: string;
  priority: "high" | "medium" | "low";
  deadline: string | null;
  asins: string[];
  summary: string | null;
  bodyShort: string | null;
  status: "open" | "done" | "ignored";
  infoOnly: boolean;
  note: string | null;
  closedAt: Date | null;
  closedBy: string | null;
};

export function mapLegacyTodo(r: LegacyRow): MappedTodo | null {
  const messageKey = normalizeMessageKey(r.message_id);
  if (!messageKey) return null;
  const status = STATUS[str(r.status).toLowerCase()] ?? "open";
  const category = str(r.kategorie).toLowerCase() || "sonstiges";
  const updated = r.updated_at ? timestamp(r.updated_at) : null;
  return {
    messageKey,
    receivedAt: timestamp(r.datum),
    sender: str(r.absender) || null,
    subject: str(r.betreff) || null,
    category,
    priority: PRIO[str(r.prioritaet).toLowerCase()] ?? "medium",
    deadline: isoDate(r.frist),
    asins: [...new Set(str(r.asins).toUpperCase().split(/[\s,;]+/).filter((a) => /^[A-Z0-9]{10}$/.test(a)))],
    summary: str(r.zusammenfassung) || null,
    bodyShort: str(r.body_kurz).slice(0, 1500) || null,
    status,
    infoOnly: status === "done" && category === "freigabe_info",
    note: str(r.notiz) || null,
    closedAt: status === "open" ? null : updated,
    closedBy: status === "open" ? null : "aus dem Retouren-Tool übernommen",
  };
}
