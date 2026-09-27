import type { AttemptRow, Db, InvoiceRow, StoredToken } from './db';

/**
 * Datenzugriff im Speicher — für Tests. Verhält sich wie die Postgres-Umsetzung,
 * einschließlich der Eindeutigkeitsregeln der Rechnungen.
 */
export function openMemoryDb(): Db {
  const settings = new Map<string, string>();
  const tokens = new Map<string, StoredToken>();
  const attempts = new Map<number, AttemptRow>();
  const invoices = new Map<number, InvoiceRow>();
  const idealo = new Map<string, number>();
  let nextAttempt = 1;
  let nextInvoice = 1;
  const clone = <T>(v: T): T => structuredClone(v);

  const db: Db = {
    async getSetting(key) {
      return settings.get(key) ?? null;
    },
    async setSetting(key, value) {
      settings.set(key, value);
    },
    async getToken(env, type) {
      const t = tokens.get(`${env}|${type}`);
      return t ? { ...t } : null;
    },
    async saveToken(env, type, token) {
      tokens.set(`${env}|${type}`, { ...token });
    },
    async insertAttempt(row) {
      const id = nextAttempt++;
      attempts.set(id, clone({ ...row, id }));
      return id;
    },
    async updateAttempt(id, columns) {
      const row = attempts.get(id);
      if (row) attempts.set(id, clone({ ...row, ...columns }));
    },
    async getAttempt(id) {
      const row = attempts.get(id);
      return row ? clone(row) : null;
    },
    async listAttempts() {
      return [...attempts.values()].sort((a, b) => b.id - a.id).map(clone);
    },
    async listInvoices() {
      return [...invoices.values()].sort((a, b) => b.id - a.id).map(clone);
    },
    async getInvoice(id) {
      const row = invoices.get(id);
      return row ? clone(row) : null;
    },
    async maxInvoiceSeq(year) {
      const seqs = [...invoices.values()].filter((i) => i.year === year).map((i) => i.seq);
      return seqs.length ? Math.max(...seqs) : null;
    },
    async insertInvoice(row) {
      const all = [...invoices.values()];
      if (all.some((i) => i.number === row.number)) throw new Error('UNIQUE constraint failed: invoices.number');
      if (all.some((i) => i.year === row.year && i.seq === row.seq)) throw new Error('UNIQUE constraint failed: invoices.year, invoices.seq');
      if (row.kind === 'invoice' && all.some((i) => i.kind === 'invoice' && i.cancelled_by_id === null && i.order_id === row.order_id)) {
        throw new Error('UNIQUE constraint failed: invoices.order_id');
      }
      const id = nextInvoice++;
      invoices.set(id, clone({ ...row, id }));
      return id;
    },
    async updateInvoice(id, columns) {
      const row = invoices.get(id);
      if (row) invoices.set(id, { ...row, ...columns });
    },
    async recordIdealoPrice(productKey, day, price) {
      const k = `${productKey}|${day}`;
      idealo.set(k, Math.min(price, idealo.get(k) ?? Infinity));
    },
    async idealoHistory(productKey) {
      return [...idealo.entries()]
        .filter(([k]) => k.startsWith(`${productKey}|`))
        .map(([k, price]) => ({ day: k.slice(productKey.length + 1), price }))
        .sort((a, b) => a.day.localeCompare(b.day));
    },
    async transaction(fn) {
      // Im Speicher gibt es keine Nebenläufigkeit — bei einem Fehler den Stand zurücksetzen.
      const snapshot = { settings: new Map(settings), attempts: clone(attempts), invoices: clone(invoices), nextAttempt, nextInvoice };
      try {
        return await fn(db);
      } catch (err) {
        settings.clear();
        for (const [k, v] of snapshot.settings) settings.set(k, v);
        attempts.clear();
        for (const [k, v] of snapshot.attempts) attempts.set(k, v);
        invoices.clear();
        for (const [k, v] of snapshot.invoices) invoices.set(k, v);
        nextAttempt = snapshot.nextAttempt;
        nextInvoice = snapshot.nextInvoice;
        throw err;
      }
    },
  };
  return db;
}
